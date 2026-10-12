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

const translatedSentences = segmentSubtitleRows(subtitles, [
  { start: '0.20', dur: '1.60', text: '你好，欢迎' },
  { start: '1.50', dur: '1.80', text: '来到本课。' },
  { start: '3.50', dur: '2.00', text: '今天我们练习口语' },
  { start: '5.40', dur: '1.60', text: '并建立自信！' },
  { start: '10.00', dur: '2.00', text: '现在请跟我读。' },
]);
assert.equal(translatedSentences[0].zh, '你好，欢迎来到本课。');
assert.ok(translatedSentences.every((sentence) => sentence.zh), 'translated captions should align with every segmented English sentence');

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
          captionTracks: [
            { baseUrl: 'https://www.youtube.com/api/timedtext?v=VFe7Ap1kfk0&lang=zh', vssId: '.zh', languageCode: 'zh', isTranslatable: true },
            { baseUrl: 'https://www.youtube.com/api/timedtext?v=VFe7Ap1kfk0&lang=en', vssId: 'a.en', languageCode: 'en', isTranslatable: true },
          ],
        },
      },
    });
  }
  if (String(input).includes('/api/timedtext')) {
    if (String(input).includes('lang=zh')) {
      return Response.json({
        events: [
          { tStartMs: 0, dDurationMs: 1800, segs: [{ utf8: '这是真实字幕。' }] },
          { tStartMs: 1800, dDurationMs: 2200, segs: [{ utf8: '请清楚地练习。' }] },
        ],
      });
    }
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
  assert.equal(fetched.captionTranslationLanguage, 'zh-Hans');
  assert.equal(fetched.captionTranslationSourceLanguage, 'zh');
  assert.equal(fetched.translatedSentenceCount, 2);
  assert.equal(fetched.chapters[0].sentences[0].zh, '这是真实字幕。');
} finally {
  globalThis.fetch = originalFetch;
}

console.log('youtube-catalog: public caption segmentation and description chapters valid');
