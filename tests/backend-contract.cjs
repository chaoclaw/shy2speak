const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const browserAdapter = fs.readFileSync(path.join(root, 'backend.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server/index.js'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'server/migrations/001_init.sql'), 'utf8');
const vocabularySchema = fs.readFileSync(path.join(root, 'server/migrations/002_vocabulary.sql'), 'utf8');
const compose = fs.readFileSync(path.join(root, 'compose.ugreen.yml'), 'utf8');
const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/docker.yml'), 'utf8');

for (const route of ['/api/auth/register', '/api/auth/login', '/api/auth/refresh', '/api/auth/otp', '/api/auth/verify-otp', '/api/auth/recover', '/api/auth/reset-password', '/api/auth/logout']) {
  assert.ok(server.includes(route), `missing self-hosted auth route: ${route}`);
}
for (const api of ['saveProfile', 'checkNickname', 'pushLearningState', 'pullLearningState', 'resetPasswordWithCode', 'getVocabulary', 'deleteVocabularyEverywhere']) {
  assert.match(browserAdapter, new RegExp(`\\b${api}\\b`), `missing browser backend capability: ${api}`);
}
for (const table of ['user_content_seeds', 'user_vocabulary_items', 'user_vocabulary_memberships']) {
  assert.match(vocabularySchema, new RegExp(`create table if not exists ${table}`), `missing PostgreSQL vocabulary table: ${table}`);
}
for (const table of ['users', 'profiles', 'refresh_sessions', 'one_time_codes', 'learning_states', 'practice_snapshots', 'youtube_catalog_cache', 'youtube_playlist_cache']) {
  assert.match(schema, new RegExp(`create table if not exists ${table}`), `missing PostgreSQL table: ${table}`);
}
assert.match(schema, /nickname citext not null unique/, 'nickname must be globally unique, case-insensitively');
assert.match(server, /scrypt/, 'passwords must use a memory-hard hash');
assert.match(server, /timingSafeEqual/, 'credential comparisons must be timing safe');
assert.match(server, /token_hash/, 'refresh tokens must be stored as hashes');
assert.match(server, /\/api\/catalog/, 'NAS API must expose its hydrated caption catalog');
assert.match(server, /fetchYouTubeTopic/, 'NAS API must sync public YouTube captions server-side');
assert.match(server, /fetchYouTubePlaylist/, 'NAS API must discover all public playlist topics server-side');
assert.match(server, /\/api\/catalog\/topics\/:videoId/, 'NAS API must hydrate one topic on demand');
assert.match(server, /\/api\/youtube\/audio\/:videoId/, 'NAS API must expose low-data course audio streaming');
assert.match(server, /worstaudio\[acodec!=none\]\[vcodec=none\]/, 'course audio must ask yt-dlp for a bandwidth-efficient audio-only format');
assert.match(server, /audio_resolver_unavailable/, 'course audio resolver failures must produce an actionable API error');
assert.match(server, /\/api\/vocabulary/, 'NAS API must expose account vocabulary');
assert.match(server, /\/api\/vocabulary\/delete-everywhere/, 'NAS API must persist cleanup across every wordbook');
assert.match(server, /validateAvatar/, 'profile API must validate uploaded avatars');
assert.match(compose, /postgres:17-alpine/, 'UGREEN compose must include PostgreSQL');
assert.match(compose, /ghcr\.io\/chaoclaw\/shy2speak:edge/, 'UGREEN compose must use the published image');
assert.doesNotMatch(compose, /\$\{/, 'UGREEN compose must not require external environment interpolation');
assert.match(compose, /&postgres-password/, 'UGREEN compose must define its database password in one place');
assert.match(compose, /&auth-secret/, 'UGREEN compose must define its auth secret in one place');
assert.match(dockerfile, /USER node/, 'application image must run as a non-root user');
assert.match(dockerfile, /yt-dlp_musllinux/, 'application image must include the maintained yt-dlp audio resolver');
assert.match(dockerfile, /sha256sum -c/, 'yt-dlp binary must be checksum-verified during the image build');
assert.match(workflow, /linux\/amd64,linux\/arm64/, 'image workflow must publish both common NAS architectures');
assert.doesNotMatch(browserAdapter, /supabase/i, 'browser backend must not depend on Supabase');

console.log('backend-contract: self-hosted auth, PostgreSQL sync and multi-architecture NAS image valid');
