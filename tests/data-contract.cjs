const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'data/catalog.json'), 'utf8'));
const topicTitleTranslations = JSON.parse(fs.readFileSync(path.join(root, 'data/topic-title-translations.json'), 'utf8'));
const vocabulary = JSON.parse(fs.readFileSync(path.join(root, 'data/vocabulary.json'), 'utf8'));

assert.equal(catalog.schemaVersion, 1, 'catalog schemaVersion must be 1');
assert.match(catalog.source.playlistId, /^PL[\w-]+$/, 'playlist id is invalid');
assert.equal(catalog.source.expectedVideoCount, 85, 'the configured course must reject incomplete playlist syncs');
assert.equal(catalog.source.topicOrder, 'oldest-first', 'the course must begin with its earliest lesson');
assert.equal(topicTitleTranslations.playlistId, catalog.source.playlistId, 'title translations must belong to the configured playlist');
assert.equal(Object.keys(topicTitleTranslations.titles).length, 85, 'all 85 topics need localized titles');
for (const [videoId, localizedTitles] of Object.entries(topicTitleTranslations.titles)) {
  assert.match(videoId, /^[\w-]{11}$/, `invalid translated YouTube id: ${videoId}`);
  assert.ok(localizedTitles.zh?.trim(), `${videoId} needs a Chinese title`);
}
assert.equal(topicTitleTranslations.titles.VFe7Ap1kfk0.zh, '商场英语词汇', 'the first lesson needs its verified Chinese title');
assert.ok(catalog.topics.length > 0, 'at least one topic is required');
assert.equal(catalog.topics[0].videoId, 'VFe7Ap1kfk0', 'the requested first YouTube video must be the default topic');
assert.equal(catalog.topics[0].playlistId, 'PL50GkV3cQyq7MzhHP2R-9H84p-cUrYskQ', 'the requested playlist must remain configured');
assert.ok(catalog.topics.every((topic) => topic.transcriptOrigin !== 'curated-sample'), 'unverified sample copy must not be presented as video captions');
assert.equal(vocabulary.version, 2, 'vocabulary data must use the post-demo schema version');
assert.deepEqual(vocabulary.items, [], 'the application must not ship demo vocabulary');

const topicIds = new Set();
for (const topic of catalog.topics) {
  assert.ok(!topicIds.has(topic.id), `duplicate topic id: ${topic.id}`);
  topicIds.add(topic.id);
  assert.match(topic.videoId, /^[\w-]{11}$/, `invalid YouTube id: ${topic.videoId}`);
  assert.ok(topic.chapters.length > 0, `${topic.id} must contain a chapter`);
  if (topic.transcriptOrigin?.startsWith('youtube-')) {
    assert.match(topic.captionLanguage || '', /^en(?:-|$)/i, `${topic.id} must use an English caption track`);
    assert.ok(!Number.isNaN(Date.parse(topic.captionSyncedAt)), `${topic.id} must record caption sync time`);
  }
  const chapterIds = new Set();
  for (const chapter of topic.chapters) {
    assert.ok(!chapterIds.has(chapter.id), `duplicate chapter id: ${chapter.id}`);
    chapterIds.add(chapter.id);
    let previousEnd = -1;
    const sentenceIds = new Set();
    for (const sentence of chapter.sentences) {
      assert.ok(!sentenceIds.has(sentence.id), `duplicate sentence id: ${sentence.id}`);
      sentenceIds.add(sentence.id);
      assert.ok(sentence.en.trim(), `${sentence.id} needs English text`);
      assert.ok(sentence.start >= previousEnd, `${sentence.id} overlaps the previous sentence`);
      assert.ok(sentence.end > sentence.start, `${sentence.id} has an invalid time range`);
      previousEnd = sentence.end;
    }
  }
}

console.log(`data-contract: ${catalog.topics.length} topic(s), ${catalog.topics.reduce((sum, topic) => sum + topic.chapters.length, 0)} chapter(s), valid`);
