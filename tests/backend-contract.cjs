const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const backend = fs.readFileSync(path.join(root, 'backend.js'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/pages.yml'), 'utf8');

for (const route of ['/auth/v1/signup', '/auth/v1/token?grant_type=password', '/auth/v1/otp', '/auth/v1/verify', '/auth/v1/recover', '/auth/v1/logout']) {
  assert.ok(backend.includes(route), `missing real auth route: ${route}`);
}
for (const api of ['saveProfile', 'checkNickname', 'pushLearningState', 'pullLearningState']) {
  assert.match(backend, new RegExp(`\\b${api}\\b`), `missing backend capability: ${api}`);
}
for (const table of ['profiles', 'learning_states', 'practice_snapshots']) {
  assert.match(schema, new RegExp(`create table if not exists public\\.${table}`), `missing table: ${table}`);
  assert.match(schema, new RegExp(`alter table public\\.${table} enable row level security`), `RLS must be enabled for ${table}`);
}
assert.match(schema, /nickname citext not null unique/, 'nickname must be globally unique, case-insensitively');
assert.match(schema, /save_my_profile/, 'profile save RPC must exist');
assert.match(workflow, /vars\.SUPABASE_URL/, 'deployment must support a public Supabase URL variable');
assert.match(workflow, /vars\.SUPABASE_PUBLISHABLE_KEY/, 'deployment must support a public publishable key variable');
assert.doesNotMatch(backend, /service_role/i, 'browser adapter must not request a service-role key');

console.log('backend-contract: auth, unique profile, RLS learning sync and Pages runtime config valid');
