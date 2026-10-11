import assert from 'node:assert/strict';
import { buildTopicFromVideoDetails, chaptersFromDescription, fetchYouTubeTopic, segmentSubtitleRows } from '../server/youtube-catalog.js';

const subtitles = [
  { start: '0.20', dur: '1.60', text: 'Hello and welcome' },
  { start: '1.50', dur: '1.80', text: 'welcome to this lesson.' },
  { start: '3.50', dur: '2.00', text: 'Today we practice speaking' },
  { start: '5.40', dur: '1.60', text: 'with confidence!' },
  { start: '10.00', dur: '2.00', text: 'Now repeat after me.' },
];

const sentences = segmentSubtitleRows(subtitles);
assert.equal(sentences.length, 3);
assert.equal(sentences[0].en, 'Hello and welcome to this lesson.');
assert.ok(sentences.every((sentence, index) => index === 0 || sentence.start >= sentences[index - 1].end), 'sentences must not overlap');

const chapterSeeds = chaptersFromDescription('0:00 Introduction\n0:10 Repeat after me', 12);
assert.deepEqual(chapterSeeds, [{ start: 0, title: 'Introduction' }, { start: 10, title: 'Repeat after me' }]);

const topic = buildTopicFromVideoDetails(
  { id: 'youtube-vfe7ap1kfk0', provider: 'youtube', videoId: 'VFe7Ap1kfk0', title: 'Pending title' },
  { title: 'Real public video title', description: '0:00 Introduction\n0:10 Repeat after me', subtitles },
  '2026-10-11T00:00:00.000Z',
);
assert.equal(topic.title, 'Real public video title');
assert.equal(topic.transcriptOrigin, 'youtube-public-captions');
assert.equal(topic.captionLanguage, 'en');
assert.equal(topic.chapters.length, 2);
assert.equal(topic.chapters.flatMap((chapter) => chapter.sentences).length, 3);

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  if (String(input).includes('/youtubei/v1/player')) {
    return Response.json({
      playabilityStatus: { status: 'OK' },
      videoDetails: { title: 'Fetched title', shortDescription: '0:00 Full lesson' },
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [{ baseUrl: 'https://www.youtube.com/api/timedtext?v=VFe7Ap1kfk0', vssId: 'a.en', languageCode: 'en' }],
        },
      },
    });
  }
  if (String(input).includes('/api/timedtext')) {
    return Response.json({
      events: [
        { tStartMs: 0, dDurationMs: 1800, segs: [{ utf8: 'This is the real caption.' }] },
        { tStartMs: 1800, dDurationMs: 2200, segs: [{ utf8: 'Practice it clearly.' }] },
      ],
    });
  }
  return new Response('not found', { status: 404 });
};
try {
  const fetched = await fetchYouTubeTopic({ id: 'youtube-vfe7ap1kfk0', provider: 'youtube', videoId: 'VFe7Ap1kfk0', title: 'Pending' });
  assert.equal(fetched.title, 'Fetched title');
  assert.equal(fetched.transcriptOrigin, 'youtube-auto-captions');
  assert.equal(fetched.chapters[0].sentences.length, 2);
} finally {
  globalThis.fetch = originalFetch;
}

console.log('youtube-catalog: public caption segmentation and description chapters valid');
