import assert from 'node:assert/strict';
import { extractYouTubeInitialData, fetchYouTubePlaylist, normalizePlaylistResult, playlistResultFromInitialData } from '../server/youtube-playlist.js';

const playlistId = 'PL50GkV3cQyq7MzhHP2R-9H84p-cUrYskQ';
const result = {
  metadata: { title: 'English lessons' },
  items: [
    { id: 'VFe7Ap1kfk0', title: 'Mall Vocabulary In English', channelTitle: 'English Channel', thumbnail: { thumbnails: [{ url: '//i.ytimg.com/vi/VFe7Ap1kfk0/default.jpg' }] }, length: { simpleText: '17:52' } },
    { id: 'abcdefghijk', title: 'Ordering Coffee In English', shortBylineText: { runs: [{ text: 'English Channel' }] }, thumbnail: { thumbnails: [] }, length: '08:04' },
    { id: 'abcdefghijk', title: 'Duplicate video' },
  ],
};
const seed = [{
  id: 'youtube-vfe7ap1kfk0', provider: 'youtube', videoId: 'VFe7Ap1kfk0', playlistId,
  title: 'Pending', localizedTitles: { zh: '商场英语词汇' }, transcriptOrigin: 'pending', chapters: [],
}];

const normalized = normalizePlaylistResult(result, playlistId, seed);
assert.equal(normalized.videoCount, 2, 'duplicate playlist entries must be removed');
assert.equal(normalized.discoveredVideoCount, 2, 'provider items must be counted separately from local seeds');
assert.deepEqual(normalized.topics.map((topic) => topic.videoId), ['VFe7Ap1kfk0', 'abcdefghijk'], 'playlist order must be retained');
assert.equal(normalized.topics[0].title, 'Mall Vocabulary In English');
assert.equal(normalized.topics[0].localizedTitles.zh, '商场英语词汇', 'known localized titles must survive playlist refreshes');
assert.equal(normalized.topics[0].serverManaged, true);
assert.equal(normalized.topics[1].thumbnail, 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg');
assert.equal(normalized.topics[1].chapters[0].title, 'Full video');

let call;
const fetched = await fetchYouTubePlaylist(playlistId, seed, {
  getInnertubeData: async () => { throw new Error('simulated Innertube outage'); },
  getPlaylistData: async (...args) => { call = args; return result; },
});
assert.deepEqual(call, [playlistId, 100], 'playlist discovery must request enough entries for the 85-video course');
assert.equal(fetched.topics.length, 2);

let innertubeCall;
const innertubeFetched = await fetchYouTubePlaylist(playlistId, seed, {
  getInnertubeData: async (...args) => { innertubeCall = args; return result; },
  getPlaylistData: async () => { throw new Error('page fallback should not run'); },
});
assert.deepEqual(innertubeCall, [playlistId, 20_000]);
assert.equal(innertubeFetched.topics.length, 2, 'Innertube should be the primary playlist source');

let fallbackAfterEmptyPrimary = false;
const recoveredFromEmptyPrimary = await fetchYouTubePlaylist(playlistId, seed, {
  minimumVideoCount: 2,
  getInnertubeData: async () => ({ metadata: { title: 'Empty response' }, items: [] }),
  getPlaylistData: async () => { fallbackAfterEmptyPrimary = true; return result; },
});
assert.equal(fallbackAfterEmptyPrimary, true, 'an empty primary response must fall through instead of treating seed topics as a successful sync');
assert.equal(recoveredFromEmptyPrimary.discoveredVideoCount, 2);

await assert.rejects(
  fetchYouTubePlaylist(playlistId, seed, {
    minimumVideoCount: 85,
    getInnertubeData: async () => result,
    getPlaylistData: async () => result,
    getPageData: async () => result,
  }),
  /only 2 of 85 expected videos/,
  'an incomplete playlist must not replace a known complete catalog',
);

const pageFixture = `<html><script>var ytInitialData = ${JSON.stringify({
  metadata: { playlistMetadataRenderer: { title: 'Changed layout playlist' } },
  contents: { futureYouTubeLayout: { arbitraryNesting: [
    { playlistVideoRenderer: { ...result.items[0], videoId: result.items[0].id } },
    { anotherWrapper: { playlistVideoRenderer: { ...result.items[1], videoId: result.items[1].id } } },
  ] } },
})};</script></html>`;
const pageResult = playlistResultFromInitialData(extractYouTubeInitialData(pageFixture));
assert.equal(pageResult.metadata.title, 'Changed layout playlist');
assert.deepEqual(pageResult.items.map((item) => item.id), ['VFe7Ap1kfk0', 'abcdefghijk'], 'page parsing must not rely on YouTube’s fixed contents path');

const pageRecovered = await fetchYouTubePlaylist(playlistId, seed, {
  minimumVideoCount: 2,
  getInnertubeData: async () => { throw new Error('empty Innertube'); },
  getPlaylistData: async () => { throw new Error('outdated library parser'); },
  getPageData: async () => pageResult,
});
assert.equal(pageRecovered.discoveredVideoCount, 2, 'the resilient page parser must be a working final fallback');

console.log('youtube-playlist: ordered playlist discovery and topic normalization valid');
