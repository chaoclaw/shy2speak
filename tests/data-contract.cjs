const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'data/catalog.json'), 'utf8'));

assert.equal(catalog.schemaVersion, 1, 'catalog schemaVersion must be 1');
assert.match(catalog.source.playlistId, /^PL[\w-]+$/, 'playlist id is invalid');
assert.ok(catalog.topics.length > 0, 'at least one topic is required');

const topicIds = new Set();
for (const topic of catalog.topics) {
  assert.ok(!topicIds.has(topic.id), `duplicate topic id: ${topic.id}`);
  topicIds.add(topic.id);
  assert.match(topic.videoId, /^[\w-]{11}$/, `invalid YouTube id: ${topic.videoId}`);
  assert.ok(topic.chapters.length > 0, `${topic.id} must contain a chapter`);
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
