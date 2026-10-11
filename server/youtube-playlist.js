import axios from 'axios';
import youtubeSearchApi from 'youtube-search-api';
import { Innertube } from 'youtubei.js';

const { GetPlaylistData } = youtubeSearchApi;
axios.defaults.timeout = 20_000;
axios.defaults.headers.common['User-Agent'] = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Shy2Speak/1.0';
axios.defaults.headers.common['Accept-Language'] = 'en-US,en;q=0.9';

function timedFetch(timeoutMs) {
  return (input, init = {}) => {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
    return fetch(input, { ...init, signal });
  };
}

async function getPlaylistWithInnertube(playlistId, timeoutMs) {
  const client = await Innertube.create({
    lang: 'en',
    location: 'US',
    retrieve_player: false,
    generate_session_locally: true,
    enable_session_cache: false,
    fetch: timedFetch(timeoutMs),
  });
  let page = await client.getPlaylist(playlistId);
  const title = String(page.info?.title || '').trim();
  const items = [];
  for (let continuation = 0; continuation < 10; continuation += 1) {
    for (const item of page.items || []) {
      items.push({
        id: item?.id,
        title: String(item?.title || '').trim(),
        channelTitle: item?.author?.name || '',
        thumbnail: { thumbnails: item?.thumbnails || [] },
        length: item?.duration?.text || '',
      });
    }
    if (!page.has_continuation || items.length >= 500) break;
    page = await page.getContinuation();
  }
  return { items, metadata: { title } };
}

function textValue(value) {
  if (typeof value === 'string') return value.trim();
  if (value?.simpleText) return String(value.simpleText).trim();
  if (Array.isArray(value?.runs)) return value.runs.map((run) => run?.text || '').join('').trim();
  return '';
}

function bestThumbnail(value, videoId) {
  const thumbnails = Array.isArray(value?.thumbnails) ? value.thumbnails : [];
  const resolved = thumbnails
    .map((thumbnail) => String(thumbnail?.url || '').replace(/^\/\//, 'https://'))
    .filter(Boolean)
    .at(-1);
  return resolved || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

function fallbackChapter() {
  return {
    id: 'chapter-01',
    index: 1,
    title: 'Full video',
    titleZh: '完整视频',
    start: 0,
    durationLabel: '待同步',
    previewWords: [],
    sentences: [],
  };
}

export function normalizePlaylistItem(item, playlistId) {
  const videoId = String(item?.id || '').trim();
  if (!/^[\w-]{11}$/.test(videoId)) return null;
  const title = textValue(item?.title) || `YouTube video ${videoId}`;
  return {
    id: `youtube-${videoId.toLowerCase()}`,
    provider: 'youtube',
    serverManaged: true,
    videoId,
    playlistId,
    sourceUrl: `https://www.youtube.com/watch?v=${videoId}&list=${playlistId}`,
    title,
    localizedTitles: { en: title },
    channelTitle: textValue(item?.channelTitle) || textValue(item?.shortBylineText) || 'YouTube',
    thumbnail: bestThumbnail(item?.thumbnail, videoId),
    durationLabel: textValue(item?.length) || '',
    metadataStatus: 'playlist-synced-public-metadata',
    transcriptOrigin: 'pending',
    transcriptSyncMode: 'nas-public-captions-on-demand',
    chapters: [fallbackChapter()],
  };
}

export function normalizePlaylistResult(result, playlistId, seedTopics = []) {
  if (!/^PL[\w-]+$/.test(playlistId || '')) throw new Error('Invalid YouTube playlist ID');
  const topics = [];
  const seen = new Set();
  for (const item of result?.items || []) {
    const topic = normalizePlaylistItem(item, playlistId);
    if (!topic || seen.has(topic.videoId)) continue;
    seen.add(topic.videoId);
    const seed = seedTopics.find((candidate) => candidate.videoId === topic.videoId);
    topics.push(seed ? {
      ...topic,
      ...seed,
      serverManaged: true,
      title: topic.title,
      localizedTitles: { ...(topic.localizedTitles || {}), ...(seed.localizedTitles || {}) },
      channelTitle: topic.channelTitle,
      thumbnail: topic.thumbnail,
      metadataStatus: topic.metadataStatus,
      transcriptOrigin: seed.transcriptOrigin?.startsWith('youtube-') ? seed.transcriptOrigin : 'pending',
      transcriptSyncMode: 'nas-public-captions-on-demand',
      chapters: seed.transcriptOrigin?.startsWith('youtube-') ? seed.chapters : topic.chapters,
    } : topic);
  }
  for (const seed of seedTopics) {
    if (!/^[\w-]{11}$/.test(seed?.videoId || '') || seen.has(seed.videoId)) continue;
    seen.add(seed.videoId);
    topics.push({ ...seed, serverManaged: true, localizedTitles: { en: seed.title, ...(seed.localizedTitles || {}) } });
  }
  if (!topics.length) throw new Error('No public videos were returned for this playlist');
  return {
    playlistId,
    title: textValue(result?.metadata?.title),
    videoCount: topics.length,
    topics,
  };
}

export async function fetchYouTubePlaylist(playlistId, seedTopics = [], {
  timeoutMs = 20_000,
  getInnertubeData = getPlaylistWithInnertube,
  getPlaylistData = GetPlaylistData,
} = {}) {
  if (!/^PL[\w-]+$/.test(playlistId || '')) throw new Error('Invalid YouTube playlist ID');
  const runWithTimeout = async (operation) => {
    let timer;
    try {
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('YouTube playlist request timed out')), timeoutMs);
      });
      return await Promise.race([operation(), timeout]);
    } finally {
      clearTimeout(timer);
    }
  };
  let innertubeError;
  try {
    const result = await runWithTimeout(() => getInnertubeData(playlistId, timeoutMs));
    return normalizePlaylistResult(result, playlistId, seedTopics);
  } catch (error) {
    innertubeError = error;
  }
  try {
    const result = await runWithTimeout(() => getPlaylistData(playlistId, 100));
    return normalizePlaylistResult(result, playlistId, seedTopics);
  } catch (fallbackError) {
    throw new Error(`YouTube playlist APIs unavailable (Innertube: ${innertubeError?.message || 'unknown'}; page fallback: ${fallbackError.message})`);
  }
}
