const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const browserAdapter = fs.readFileSync(path.join(root, 'backend.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server/index.js'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'server/migrations/001_init.sql'), 'utf8');
const compose = fs.readFileSync(path.join(root, 'compose.ugreen.yml'), 'utf8');
const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/docker.yml'), 'utf8');

for (const route of ['/api/auth/register', '/api/auth/login', '/api/auth/refresh', '/api/auth/otp', '/api/auth/verify-otp', '/api/auth/recover', '/api/auth/reset-password', '/api/auth/logout']) {
  assert.ok(server.includes(route), `missing self-hosted auth route: ${route}`);
}
for (const api of ['saveProfile', 'checkNickname', 'pushLearningState', 'pullLearningState', 'resetPasswordWithCode']) {
  assert.match(browserAdapter, new RegExp(`\\b${api}\\b`), `missing browser backend capability: ${api}`);
}
for (const table of ['users', 'profiles', 'refresh_sessions', 'one_time_codes', 'learning_states', 'practice_snapshots']) {
  assert.match(schema, new RegExp(`create table if not exists ${table}`), `missing PostgreSQL table: ${table}`);
}
assert.match(schema, /nickname citext not null unique/, 'nickname must be globally unique, case-insensitively');
assert.match(server, /scrypt/, 'passwords must use a memory-hard hash');
assert.match(server, /timingSafeEqual/, 'credential comparisons must be timing safe');
assert.match(server, /token_hash/, 'refresh tokens must be stored as hashes');
assert.match(compose, /postgres:17-alpine/, 'UGREEN compose must include PostgreSQL');
assert.match(compose, /ghcr\.io\/chaoclaw\/shy2speak:edge/, 'UGREEN compose must use the published image');
assert.match(dockerfile, /USER node/, 'application image must run as a non-root user');
assert.match(workflow, /linux\/amd64,linux\/arm64/, 'image workflow must publish both common NAS architectures');
assert.doesNotMatch(browserAdapter, /supabase/i, 'browser backend must not depend on Supabase');

console.log('backend-contract: self-hosted auth, PostgreSQL sync and multi-architecture NAS image valid');
