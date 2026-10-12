import { getVideoDetails } from 'youtube-caption-extractor';
import OpenCC from 'opencc-js/t2cn';

const traditionalToSimplified = OpenCC.Converter({ from: 'twp', to: 'cn' });

const STOP_WORDS = new Set([
  'about', 'after', 'again', 'also', 'and', 'are', 'because', 'been', 'before', 'being', 'but', 'can', 'could',
  'did', 'does', 'doing', 'for', 'from', 'get', 'got', 'had', 'has', 'have', 'her', 'here', 'him', 'his', 'how',
  'into', 'its', 'just', 'like', 'more', 'most', 'not', 'now', 'of', 'off', 'on', 'one', 'only', 'or', 'our', 'out',
  'over', 'really', 'said', 'she', 'should', 'some', 'than', 'that', 'the', 'their', 'them', 'then', 'there', 'these',
  'they', 'this', 'those', 'through', 'too', 'very', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'who', 'why',
  'will', 'with', 'would', 'you', 'your',
]);

function decodeCaptionEntities(value) {
  return String(value || '')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

function cleanCaption(value) {
  return decodeCaptionEntities(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[(?:music|applause|laughter|foreign|silence)\]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function mergeTranslation(left, right) {
  if (!left) return right;
  if (!right) return left;
  if (/[\u3400-\u9fff]/.test(left + right)) return left + right;
  return mergeText(left, right);
}

function mergeText(left, right) {
  if (!left) return right;
  if (!right) return left;
  const leftWords = left.split(/\s+/);
  const rightWords = right.split(/\s+/);
  let overlap = 0;
  for (let size = Math.min(12, leftWords.length, rightWords.length); size > 0; size -= 1) {
    const tail = leftWords.slice(-size).map((word) => word.toLowerCase());
    const head = rightWords.slice(0, size).map((word) => word.toLowerCase());
    if (tail.every((word, index) => word === head[index])) { overlap = size; break; }
  }
  return [...leftWords, ...rightWords.slice(overlap)].join(' ');
}

function translatedTextAt(start, translations) {
  let nearest = null;
  for (const row of translations) {
    const distance = Math.abs(row.start - start);
    if (!nearest || distance < nearest.distance) nearest = { distance, text: row.text };
    if (row.start > start + 0.5) break;
  }
  return nearest && nearest.distance <= 0.5 ? nearest.text : '';
}

export function segmentSubtitleRows(subtitles = [], translatedSubtitles = []) {
  const translations = translatedSubtitles
    .map((row) => ({ start: Number(row.start), text: cleanCaption(row.text) }))
    .filter((row) => Number.isFinite(row.start) && row.text)
    .sort((left, right) => left.start - right.start);
  const rows = subtitles
    .map((row) => {
      const start = Number(row.start);
      const duration = Math.max(0.08, Number(row.dur ?? row.duration));
      return { start, end: start + duration, en: cleanCaption(row.text), zh: translatedTextAt(start, translations) };
    })
    .filter((row) => Number.isFinite(row.start) && Number.isFinite(row.end) && row.en)
    .sort((left, right) => left.start - right.start);

  const grouped = [];
  let current = null;
  for (const row of rows) {
    if (current) {
      const gap = row.start - current.end;
      const projectedDuration = Math.max(current.end, row.end) - current.start;
      const hardBreak = gap > 1.15 || projectedDuration > 12 || current.en.length + row.en.length > 170;
      const sentenceBreak = /[.!?]["'’”)]?$/.test(current.en) && current.end - current.start >= 1;
      if (hardBreak || sentenceBreak) { grouped.push(current); current = null; }
    }
    if (!current) current = { ...row };
    else {
      current.en = mergeText(current.en, row.en);
      current.zh = mergeTranslation(current.zh, row.zh);
      current.end = Math.max(current.end, row.end);
    }
  }
  if (current) grouped.push(current);

  return grouped.map((sentence, index) => {
    const nextStart = grouped[index + 1]?.start;
    const end = Math.max(sentence.start + 0.08, Number.isFinite(nextStart) ? Math.min(sentence.end, nextStart) : sentence.end);
    return {
      id: 'sentence-' + String(index + 1).padStart(3, '0'),
      start: Number(sentence.start.toFixed(3)),
      end: Number(end.toFixed(3)),
      en: sentence.en,
      zh: sentence.zh || '',
      words: [],
    };
  });
}

function secondsFromTimestamp(value) {
  const parts = String(value).split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return null;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

export function chaptersFromDescription(description = '', duration = 0) {
  const matches = [];
  const pattern = /(?:^|\n)\s*((?:\d{1,2}:)?\d{1,2}:\d{2})\s+([^\n]+)/g;
  for (const match of String(description).matchAll(pattern)) {
    const start = secondsFromTimestamp(match[1]);
    const title = cleanCaption(match[2]).replace(/^[-–—|·]+\s*/, '');
    if (start !== null && title && start <= duration + 5 && !matches.some((item) => item.start === start)) matches.push({ start, title });
  }
  matches.sort((left, right) => left.start - right.start);
  return matches.length >= 2 && matches[0].start <= 1 ? matches : [{ start: 0, title: 'Full video' }];
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(seconds));
  return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
}

function previewWords(sentences, limit = 10) {
  const counts = new Map();
  const tokens = sentences.flatMap((sentence) => sentence.en.toLowerCase().match(/[a-z][a-z'-]{3,}/g) || []);
  for (const word of tokens) if (!STOP_WORDS.has(word)) counts.set(word, (counts.get(word) || 0) + 1);
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([word]) => word);
}

export function buildTopicFromVideoDetails(topic, details, syncedAt = new Date().toISOString()) {
  const sentences = segmentSubtitleRows(details?.subtitles, details?.translatedSubtitles);
  if (!sentences.length) throw new Error('No usable public English captions were returned');
  const duration = Math.max(...sentences.map((sentence) => sentence.end));
  const chapterSeeds = chaptersFromDescription(details?.description, duration);
  const chapters = chapterSeeds.map((seed, index) => {
    const nextStart = chapterSeeds[index + 1]?.start ?? duration;
    const items = sentences.filter((sentence) => sentence.start >= seed.start && (index + 1 === chapterSeeds.length || sentence.start < nextStart));
    return {
      id: 'chapter-' + String(index + 1).padStart(2, '0'),
      index: index + 1,
      title: seed.title,
      titleZh: seed.title === 'Full video' ? '完整视频' : seed.title,
      start: Number(seed.start.toFixed(3)),
      durationSeconds: Number(Math.max(0, nextStart - seed.start).toFixed(3)),
      durationLabel: formatDuration(nextStart - seed.start),
      previewWords: previewWords(items),
      sentences: items,
    };
  });
  return {
    ...topic,
    title: cleanCaption(details?.title) || topic.title,
    metadataStatus: 'server-synced-public-metadata',
    transcriptOrigin: details.captionTrackKind === 'manual'
      ? 'youtube-manual-captions'
      : details.captionTrackKind === 'auto'
        ? 'youtube-auto-captions'
        : 'youtube-public-captions',
    captionLanguage: details.captionLanguage || 'en',
    captionSchemaVersion: 5,
    captionTranslationLanguage: details.translationLanguage || '',
    captionTranslationSourceLanguage: details.translationSourceLanguage || '',
    translatedSentenceCount: sentences.filter((sentence) => sentence.zh).length,
    captionTranslationStatus: details.translationStatus || (sentences.some((sentence) => sentence.zh) ? 'synced' : 'unavailable'),
    ...(details.translationError ? { captionTranslationError: details.translationError } : {}),
    captionSyncedAt: syncedAt,
    chapters,
  };
}

function translationLanguageCandidates(language) {
  const candidates = [language];
  if (/^zh(?:-|$)/i.test(language)) candidates.push('zh-CN', 'zh-Hans', 'zh', 'zh-Hant');
  return [...new Set(candidates.filter(Boolean).map((candidate) => candidate.toLowerCase()))];
}

function directTranslationTrack(tracks, language) {
  const candidates = translationLanguageCandidates(language);
  return tracks.find((track) => candidates.includes(String(track.languageCode || '').toLowerCase()))
    || tracks.find((track) => candidates.some((candidate) => String(track.vssId || '').toLowerCase().endsWith(`.${candidate}`)))
    || null;
}

function availableTranslationLanguage(languages, language) {
  const available = new Map(languages.map((item) => [String(item.languageCode || '').toLowerCase(), String(item.languageCode || '')]));
  for (const candidate of translationLanguageCandidates(language)) if (available.has(candidate)) return available.get(candidate);
  return language;
}

function parseJson3Captions(body) {
  let events = [];
  try { events = JSON.parse(body).events || []; } catch { return []; }
  return events.flatMap((event) => {
    if (!event.segs || event.aAppend === 1) return [];
    const text = cleanCaption(event.segs.map((segment) => segment.utf8 || '').join(''));
    if (!text) return [];
    return [{ start: String(Number(event.tStartMs || 0) / 1000), dur: String(Number(event.dDurationMs || 0) / 1000), text }];
  });
}

function parseXmlCaptions(body) {
  const rows = [];
  for (const match of body.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/gi)) {
    const start = match[1].match(/\bstart="([^"]+)"/i)?.[1];
    const dur = match[1].match(/\bdur="([^"]+)"/i)?.[1] || '0';
    const text = cleanCaption(match[2]);
    if (Number.isFinite(Number(start)) && text) rows.push({ start, dur, text });
  }
  for (const match of body.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi)) {
    const startMs = match[1].match(/\bt="([^"]+)"/i)?.[1];
    const durationMs = match[1].match(/\bd="([^"]+)"/i)?.[1] || '0';
    const text = cleanCaption(match[2].replace(/<\/s>\s*<s\b[^>]*>/gi, ' '));
    if (Number.isFinite(Number(startMs)) && text) rows.push({ start: String(Number(startMs) / 1000), dur: String(Number(durationMs) / 1000), text });
  }
  return rows.sort((left, right) => Number(left.start) - Number(right.start));
}

function vttTimestampSeconds(value) {
  const parts = String(value).split(':').map(Number);
  return parts.some((part) => !Number.isFinite(part)) ? NaN : parts.reduce((total, part) => total * 60 + part, 0);
}

function parseVttCaptions(body) {
  const rows = [];
  const blocks = String(body).replace(/\r/g, '').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n').filter(Boolean);
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex < 0) continue;
    const [startValue, endValue] = lines[timingIndex].split('-->').map((value) => value.trim().split(/\s+/)[0]);
    const start = vttTimestampSeconds(startValue); const end = vttTimestampSeconds(endValue);
    const text = cleanCaption(lines.slice(timingIndex + 1).join(' '));
    if (Number.isFinite(start) && Number.isFinite(end) && text) rows.push({ start: String(start), dur: String(Math.max(0, end - start)), text });
  }
  return rows;
}

async function fetchTranslatedSubtitles(track, language, timedFetch, direct = false) {
  if (!language || !track?.baseUrl || (!direct && track.isTranslatable === false)) return [];
  const attempts = [
    { name: 'json3', format: 'json3', parse: parseJson3Captions },
    { name: 'srv3', format: 'srv3', parse: parseXmlCaptions },
    { name: 'xml', format: '', parse: parseXmlCaptions },
    { name: 'vtt', format: 'vtt', parse: parseVttCaptions },
  ];
  const diagnostics = [];
  for (const attempt of attempts) {
    const url = new URL(track.baseUrl);
    if (attempt.format) url.searchParams.set('fmt', attempt.format); else url.searchParams.delete('fmt');
    if (!direct) url.searchParams.set('tlang', language);
    const response = await timedFetch(url);
    const body = await response.text();
    const rows = response.ok && body.trim() ? attempt.parse(body) : [];
    diagnostics.push(`${attempt.name}=${response.status}/${String(response.headers.get('content-type') || 'unknown').split(';')[0]}/${body.length}`);
    if (rows.length) return rows;
  }
  throw new Error(`No translated caption rows (${diagnostics.join(', ')})`);
}

export async function fetchYouTubeTopic(topic, { timeoutMs = 10_000, translationLanguage = 'zh-Hans' } = {}) {
  if (!/^[\w-]{11}$/.test(topic?.videoId || '')) throw new Error('Invalid YouTube video ID');
  let captionTrack = null;
  let captionTracks = [];
  let translationLanguages = [];
  const timedFetch = async (input, init = {}) => {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
    const response = await fetch(input, {
      ...init,
      signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Shy2Speak/1.0; +https://github.com/chaoclaw/shy2speak)',
        ...(init.headers || {}),
      },
    });
    if (String(input).includes('youtubei.googleapis.com/youtubei/v1/player') && response.ok) {
      try {
        const data = await response.clone().json();
        const captionRenderer = data?.captions?.playerCaptionsTracklistRenderer || {};
        const tracks = captionRenderer.captionTracks || [];
        if (tracks.length) captionTracks = tracks;
        if (captionRenderer.translationLanguages?.length) translationLanguages = captionRenderer.translationLanguages;
        captionTrack = tracks.find((track) => {
          const language = String(track.languageCode || '').toLowerCase();
          const vssId = String(track.vssId || '').toLowerCase();
          return language === 'en' || language.startsWith('en-') || /^a?\.en(?:-|$)/.test(vssId);
        }) || captionTrack;
      } catch { /* The extractor will report malformed player responses. */ }
    }
    return response;
  };
  const details = await getVideoDetails({ videoID: topic.videoId, lang: 'en', fetch: timedFetch });
  if (!captionTrack) throw new Error('No public English caption track is available');
  let translatedSubtitles = [];
  let translationError = '';
  const translatedTrack = directTranslationTrack(captionTracks, translationLanguage);
  const translationSourceLanguage = translatedTrack?.languageCode
    || availableTranslationLanguage(translationLanguages, translationLanguage);
  try {
    translatedSubtitles = await fetchTranslatedSubtitles(translatedTrack || captionTrack, translationSourceLanguage, timedFetch, Boolean(translatedTrack));
    if (/^zh-(?:hant|tw|hk)/i.test(translationSourceLanguage)) {
      translatedSubtitles = translatedSubtitles.map((row) => ({ ...row, text: traditionalToSimplified(row.text) }));
    }
  }
  catch (error) { translationError = error.message; console.warn('YouTube translated captions unavailable:', topic.videoId, error.message); }
  const vssId = String(captionTrack.vssId || '');
  return buildTopicFromVideoDetails(topic, {
    ...details,
    translatedSubtitles,
    translationLanguage,
    translationSourceLanguage: translatedSubtitles.length ? translationSourceLanguage : '',
    translationStatus: translatedSubtitles.length ? 'synced' : 'unavailable',
    translationError,
    captionLanguage: captionTrack.languageCode || 'en',
    captionTrackKind: vssId.startsWith('a.') ? 'auto' : 'manual',
  });
}
