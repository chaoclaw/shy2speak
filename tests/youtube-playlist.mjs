import assert from 'node:assert/strict';
import { fetchYouTubePlaylist, normalizePlaylistResult } from '../server/youtube-playlist.js';

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

console.log('youtube-playlist: ordered playlist discovery and topic normalization valid');
