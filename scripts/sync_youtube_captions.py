#!/usr/bin/env python3
"""Sync public YouTube captions into the Shy2Speak course catalog.

This script never downloads video or audio. It reads public caption tracks and
metadata, prefers creator-provided English captions, and falls back to YouTube
automatic English captions. A failed sync exits non-zero so inaccurate sample
copy cannot be published as if it were the real transcript.
"""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


STOP_WORDS = {
    "about", "after", "again", "also", "and", "are", "because", "been", "before", "being", "but", "can", "could", "did", "does", "doing", "for", "from", "get", "got", "had", "has", "have", "her", "here", "him", "his", "how", "into", "its", "just", "like", "more", "most", "not", "now", "of", "off", "on", "one", "only", "or", "our", "out", "over", "really", "said", "she", "should", "some", "than", "that", "the", "their", "them", "then", "there", "these", "they", "this", "those", "through", "too", "very", "was", "we", "were", "what", "when", "where", "which", "who", "why", "will", "with", "would", "you", "your",
}


def clean_caption(value: str) -> str:
    text = html.unescape(re.sub(r"<[^>]+>", "", value or ""))
    text = re.sub(r"\[(?:music|applause|laughter|foreign|silence)\]", "", text, flags=re.I)
    return re.sub(r"\s+", " ", text).strip()


def merge_text(left: str, right: str) -> str:
    if not left:
        return right
    if not right:
        return left
    left_words, right_words = left.split(), right.split()
    overlap = 0
    for size in range(min(12, len(left_words), len(right_words)), 0, -1):
        if [word.lower() for word in left_words[-size:]] == [word.lower() for word in right_words[:size]]:
            overlap = size
            break
    return " ".join(left_words + right_words[overlap:])


def translated_text(start: float, translations: list[dict]) -> str:
    if not translations:
        return ""
    nearest = min(translations, key=lambda row: abs(float(row["start"]) - start))
    return clean_caption(nearest.get("text", "")) if abs(float(nearest["start"]) - start) <= 0.35 else ""


def segment_captions(english: list[dict], translations: list[dict] | None = None) -> list[dict]:
    rows = []
    for row in english:
        text = clean_caption(row.get("text", ""))
        if not text:
            continue
        start = round(float(row.get("start", 0)), 3)
        duration = max(0.08, float(row.get("duration", 0)))
        rows.append({"start": start, "end": round(start + duration, 3), "en": text, "zh": translated_text(start, translations or [])})

    sentences: list[dict] = []
    current = None
    for row in rows:
        if current:
            gap = row["start"] - current["end"]
            projected = max(current["end"], row["end"]) - current["start"]
            hard_break = gap > 1.15 or projected > 12 or len(current["en"]) + len(row["en"]) > 170
            sentence_break = bool(re.search(r"[.!?][\"'’”)]?$", current["en"])) and current["end"] - current["start"] >= 1
            if hard_break or sentence_break:
                sentences.append(current)
                current = None
        if current is None:
            current = dict(row)
        else:
            current["en"] = merge_text(current["en"], row["en"])
            current["zh"] = merge_text(current["zh"], row["zh"])
            current["end"] = max(current["end"], row["end"])
    if current:
        sentences.append(current)

    for index, sentence in enumerate(sentences):
        if index + 1 < len(sentences):
            sentence["end"] = min(sentence["end"], sentences[index + 1]["start"])
        sentence["end"] = round(max(sentence["start"] + 0.08, sentence["end"]), 3)
        sentence["id"] = f"sentence-{index + 1:03d}"
        sentence["words"] = []
    return sentences


def preview_words(sentences: list[dict], limit: int = 10) -> list[str]:
    tokens = re.findall(r"[A-Za-z][A-Za-z'-]{3,}", " ".join(item["en"] for item in sentences).lower())
    return [word for word, _ in Counter(word for word in tokens if word not in STOP_WORDS).most_common(limit)]


def normalize_chapters(raw_chapters: list[dict] | None, duration: float, sentences: list[dict]) -> list[dict]:
    if raw_chapters:
        chapters = [{
            "start": max(0.0, float(item.get("start_time", item.get("start", 0)))),
            "end": float(item.get("end_time", item.get("end", duration or 0))),
            "title": clean_caption(item.get("title", "")) or f"Chapter {index + 1:02d}",
        } for index, item in enumerate(raw_chapters)]
    else:
        inferred_end = max([item["end"] for item in sentences], default=duration or 0)
        chapters = [{"start": 0.0, "end": duration or inferred_end, "title": "Full video"}]

    result = []
    for index, chapter in enumerate(chapters):
        end = chapter["end"] or (chapters[index + 1]["start"] if index + 1 < len(chapters) else duration)
        items = [dict(sentence) for sentence in sentences if sentence["start"] >= chapter["start"] and (index + 1 == len(chapters) or sentence["start"] < chapters[index + 1]["start"])]
        result.append({
            "id": f"chapter-{index + 1:02d}",
            "index": index + 1,
            "title": chapter["title"],
            "titleZh": chapter["title"],
            "start": round(chapter["start"], 3),
            "durationSeconds": round(max(0, end - chapter["start"]), 3),
            "durationLabel": format_duration(max(0, end - chapter["start"])),
            "previewWords": preview_words(items),
            "sentences": items,
        })
    return result


def format_duration(seconds: float) -> str:
    total = max(0, round(seconds))
    return f"{total // 60}:{total % 60:02d}"


def get_public_transcript(video_id: str):
    from youtube_transcript_api import YouTubeTranscriptApi

    api = YouTubeTranscriptApi()
    tracks = list(api.list(video_id))
    english = [track for track in tracks if track.language_code.lower().startswith("en")]
    if not english:
        raise RuntimeError("No public English caption track is available")
    english.sort(key=lambda track: (track.is_generated, track.language_code != "en"))
    selected = english[0]
    fetched = selected.fetch().to_raw_data()
    translated = []
    if selected.is_translatable:
        for code in ("zh-Hans", "zh-CN", "zh"):
            try:
                translated = selected.translate(code).fetch().to_raw_data()
                if translated:
                    break
            except Exception:
                continue
    return fetched, translated, selected


def get_public_metadata(url: str) -> dict:
    from yt_dlp import YoutubeDL

    options = {"quiet": True, "no_warnings": True, "skip_download": True, "extract_flat": False, "noplaylist": True}
    with YoutubeDL(options) as client:
        return client.extract_info(url, download=False)


def sync_catalog(catalog_path: Path) -> dict:
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    synced = 0
    for topic in catalog.get("topics", []):
        video_id = topic.get("videoId")
        if topic.get("provider") != "youtube" or not video_id:
            continue
        english, translated, track = get_public_transcript(video_id)
        sentences = segment_captions(english, translated)
        if not sentences:
            raise RuntimeError(f"{video_id}: caption track contained no usable English text")
        metadata = {}
        try:
            metadata = get_public_metadata(topic.get("sourceUrl") or f"https://www.youtube.com/watch?v={video_id}")
        except Exception as error:
            print(f"warning: {video_id}: metadata/chapters unavailable: {error}", file=sys.stderr)
        duration = float(metadata.get("duration") or max(item["end"] for item in sentences))
        topic["title"] = metadata.get("title") or topic.get("title") or f"YouTube video {video_id}"
        topic["channelTitle"] = metadata.get("uploader") or metadata.get("channel") or topic.get("channelTitle")
        topic["thumbnail"] = metadata.get("thumbnail") or topic.get("thumbnail")
        topic["metadataStatus"] = "synced-public-metadata" if metadata else topic.get("metadataStatus", "runtime-oembed")
        topic["transcriptOrigin"] = "youtube-auto-captions" if track.is_generated else "youtube-manual-captions"
        topic["captionLanguage"] = track.language_code
        topic["captionSyncedAt"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        topic["chapters"] = normalize_chapters(metadata.get("chapters"), duration, sentences)
        synced += 1
        print(f"synced {video_id}: {len(topic['chapters'])} chapter(s), {len(sentences)} sentence(s), {topic['transcriptOrigin']}")
    if not synced:
        raise RuntimeError("No YouTube topics were found in the catalog")
    catalog["updatedAt"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    catalog.setdefault("source", {})["captionPolicy"] = "Public YouTube caption tracks only; no video or audio downloaded."
    catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return catalog


def self_test() -> None:
    raw = [
        {"text": "Hello and welcome", "start": 0, "duration": 1.5},
        {"text": "welcome to this lesson.", "start": 1.4, "duration": 1.6},
        {"text": "Today we practice speaking", "start": 3.2, "duration": 2},
        {"text": "with confidence!", "start": 5.1, "duration": 1.5},
    ]
    translated = [
        {"text": "你好，欢迎", "start": 0, "duration": 1.5},
        {"text": "欢迎来到本课。", "start": 1.4, "duration": 1.6},
        {"text": "今天我们练习口语", "start": 3.2, "duration": 2},
        {"text": "充满自信！", "start": 5.1, "duration": 1.5},
    ]
    sentences = segment_captions(raw, translated)
    assert len(sentences) == 2, sentences
    assert sentences[0]["en"] == "Hello and welcome to this lesson.", sentences[0]
    assert sentences[0]["end"] <= sentences[1]["start"]
    chapters = normalize_chapters([{"title": "Intro", "start_time": 0, "end_time": 4}, {"title": "Practice", "start_time": 4, "end_time": 8}], 8, sentences)
    assert len(chapters) == 2 and sum(len(chapter["sentences"]) for chapter in chapters) == 2
    print("caption-sync: segmentation, de-duplication and chapter assignment valid")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", default="data/catalog.json")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return 0
    try:
        sync_catalog(Path(args.catalog))
        return 0
    except Exception as error:
        message = re.sub(r"[\r\n]+", " ", str(error)).strip()
        print(f"caption sync failed ({type(error).__name__}): {message}", file=sys.stderr)
        if os.environ.get("GITHUB_ACTIONS") == "true":
            annotation = message.replace("%", "%25").replace(":", "%3A").replace(",", "%2C")
            print(f"::error title=YouTube caption sync failed::{type(error).__name__}: {annotation}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
