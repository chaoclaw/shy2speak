import assert from 'node:assert/strict';

const base = process.env.SHYG_API_BASE || 'http://127.0.0.1:8080/api';
const account = process.env.SHYG_TEST_ACCOUNT || 'docker.verify@example.test';
const password = process.env.SHYG_TEST_PASSWORD || 'DockerVerifyPassword2026!';
const nickname = process.env.SHYG_TEST_NICKNAME || 'NasVerify';

async function request(path, { method = 'GET', token, body, expected = 200 } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  assert.equal(response.status, expected, `${method} ${path}: ${response.status} ${text}`);
  return payload;
}

const health = await request('/health');
assert.equal(health.database, 'postgresql');
await request('/profile', { expected: 401 });

let session;
const registration = await fetch(`${base}/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ method: 'email', account, password, nickname }),
});
if (registration.status === 201) session = await registration.json();
else {
  assert.equal(registration.status, 409, `registration failed unexpectedly: ${registration.status} ${await registration.text()}`);
  session = await request('/auth/login', { method: 'POST', body: { method: 'email', account, password } });
}
assert.ok(session.access_token && session.refresh_token && session.user?.id);

const profile = await request('/profile', { token: session.access_token });
assert.equal(profile.nickname, nickname);
const updatedProfile = await request('/profile', {
  method: 'PUT', token: session.access_token,
  body: { nickname, signature: 'Persistent NAS profile', avatar: '🚀', locale: 'zh' },
});
assert.equal(updatedProfile.signature, 'Persistent NAS profile');

const updatedAt = new Date().toISOString();
const payload = {
  version: 1,
  updatedAt,
  analytics: {
    topics: { topicA: { practiceSeconds: 90, practiceCount: 2, recordings: 1, scores: [] } },
    chapters: { 'topicA:chapterA': { practiceSeconds: 60, practiceCount: 2, recordings: 1, scores: [{ total: 88 }] } },
    sentences: { 'topicA:chapterA:sentenceA': { practiceSeconds: 25, practiceCount: 3, recordings: 2, scores: [{ total: 91 }], lastPracticedAt: updatedAt } },
  },
};
const synced = await request('/learning-state', { method: 'PUT', token: session.access_token, body: { payload, client_updated_at: updatedAt } });
assert.equal(synced.snapshotCount, 3);
const restored = await request('/learning-state', { token: session.access_token });
assert.equal(restored.payload.analytics.sentences['topicA:chapterA:sentenceA'].scores[0].total, 91);

const rotated = await request('/auth/refresh', { method: 'POST', body: { refresh_token: session.refresh_token } });
assert.ok(rotated.access_token && rotated.refresh_token !== session.refresh_token);
await request('/auth/logout', { method: 'POST', token: rotated.access_token, expected: 204 });
const relogged = await request('/auth/login', { method: 'POST', body: { method: 'email', account, password } });
const persistentProfile = await request('/profile', { token: relogged.access_token });
assert.equal(persistentProfile.signature, 'Persistent NAS profile');

const vocabulary = await request('/vocabulary', { token: relogged.access_token });
assert.equal(vocabulary.version, 2);
assert.deepEqual(vocabulary.items, []);

console.log('api-integration: auth, profile, learning history and empty real vocabulary state valid');
