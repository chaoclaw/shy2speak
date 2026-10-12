import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import express from 'express';
import nodemailer from 'nodemailer';
import pg from 'pg';
import { fetchYouTubeTopic } from './youtube-catalog.js';
import { fetchYouTubePlaylist, preparePlaylistTopics } from './youtube-playlist.js';

const { Pool } = pg;
const scrypt = promisify(crypto.scrypt);
const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.resolve(serverDirectory, '..');
const catalogPath = path.join(publicDirectory, 'data', 'catalog.json');
const vocabularyPath = path.join(publicDirectory, 'data', 'vocabulary.json');
const topicTitleTranslationsPath = path.join(publicDirectory, 'data', 'topic-title-translations.json');
const PORT = Number(process.env.PORT || 8080);
const DATABASE_URL = process.env.DATABASE_URL || '';
const AUTH_SECRET = process.env.AUTH_SECRET || '';
const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_DAYS = 30;
const CODE_TTL_MINUTES = 10;
const YOUTUBE_CAPTIONS_ENABLED = process.env.YOUTUBE_CAPTIONS_ENABLED !== 'false';
const YOUTUBE_CAPTION_TRANSLATION_LANGUAGE = String(process.env.YOUTUBE_CAPTION_TRANSLATION_LANGUAGE || 'zh-Hans').trim();
const YOUTUBE_PLAYLIST_SYNC_ENABLED = process.env.YOUTUBE_PLAYLIST_SYNC_ENABLED !== 'false';
const captionCacheHours = Number(process.env.YOUTUBE_CAPTION_CACHE_HOURS || 168);
const YOUTUBE_CAPTION_CACHE_HOURS = Number.isFinite(captionCacheHours) ? Math.max(1, captionCacheHours) : 168;
const playlistCacheHours = Number(process.env.YOUTUBE_PLAYLIST_CACHE_HOURS || 24);
const YOUTUBE_PLAYLIST_CACHE_HOURS = Number.isFinite(playlistCacheHours) ? Math.max(1, playlistCacheHours) : 24;

if (!DATABASE_URL && !process.env.PGHOST) throw new Error('DATABASE_URL or PostgreSQL PG* variables are required');
if (AUTH_SECRET.length < 32) throw new Error('AUTH_SECRET must contain at least 32 characters');

const pool = new Pool({ ...(DATABASE_URL ? { connectionString: DATABASE_URL } : {}), max: Number(process.env.DB_POOL_SIZE || 10) });
pool.on('error', (error) => console.error('Unexpected PostgreSQL pool error:', error.message));

const smtpEnabled = Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
const smsEnabled = Boolean(process.env.SMS_WEBHOOK_URL);
const mailer = smtpEnabled ? nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true',
  auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD || '' } : undefined,
}) : null;

class HttpError extends Error {
  constructor(status, message, code = 'request_error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function signAccessToken(userId, sessionId) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ sub: userId, sid: sessionId, iat: now, exp: now + ACCESS_TTL_SECONDS }));
  const signature = crypto.createHmac('sha256', AUTH_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

function verifyAccessToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new HttpError(401, '登录状态无效，请重新登录。', 'invalid_token');
  const expected = crypto.createHmac('sha256', AUTH_SECRET).update(`${parts[0]}.${parts[1]}`).digest();
  let supplied;
  try { supplied = Buffer.from(parts[2], 'base64url'); }
  catch { throw new HttpError(401, '登录状态无效，请重新登录。', 'invalid_token'); }
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) throw new HttpError(401, '登录状态无效，请重新登录。', 'invalid_token');
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); }
  catch { throw new HttpError(401, '登录状态无效，请重新登录。', 'invalid_token'); }
  if (!payload.sub || !payload.sid || Number(payload.exp || 0) <= Math.floor(Date.now() / 1000)) throw new HttpError(401, '登录已过期，请重新登录。', 'expired_token');
  return payload;
}

function tokenHash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

async function passwordHash(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64url')}$${Buffer.from(derived).toString('base64url')}`;
}

async function passwordMatches(password, encoded) {
  const [algorithm, saltValue, hashValue] = String(encoded || '').split('$');
  if (algorithm !== 'scrypt' || !saltValue || !hashValue) return false;
  const expected = Buffer.from(hashValue, 'base64url');
  const actual = Buffer.from(await scrypt(password, Buffer.from(saltValue, 'base64url'), expected.length));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function normalizeIdentity(method, account) {
  if (method === 'email') {
    const value = String(account || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.length > 254) throw new HttpError(400, '请输入有效的邮箱地址。', 'invalid_email');
    return value;
  }
  if (method === 'phone') {
    const value = String(account || '').replace(/[\s()-]/g, '');
    if (!/^\+?[1-9]\d{6,14}$/.test(value)) throw new HttpError(400, '请输入包含国家区号的有效手机号。', 'invalid_phone');
    return value;
  }
  throw new HttpError(400, '账号方式必须是邮箱或手机号。', 'invalid_method');
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) throw new HttpError(400, '密码长度需要为 8–128 位。', 'invalid_password');
}

function validateNickname(nickname) {
  const value = String(nickname || '').trim();
  if ([...value].length < 2 || [...value].length > 24) throw new HttpError(400, '昵称长度需要为 2–24 个字符。', 'invalid_nickname');
  if (/^(admin|administrator|system|root|shy2speak)$/i.test(value)) throw new HttpError(400, '该昵称为保留名称。', 'reserved_nickname');
  return value;
}

function validateAvatar(avatar) {
  const value = String(avatar || 'S').trim();
  if (/^data:image\/(?:png|jpeg|webp);base64,/i.test(value)) {
    if (value.length > 250_000) throw new HttpError(413, '头像图片过大，请选择更小的图片。', 'avatar_too_large');
    const encoded = value.slice(value.indexOf(',') + 1);
    if (!/^[A-Za-z0-9+/]+=*$/.test(encoded)) throw new HttpError(400, '头像图片格式无效。', 'invalid_avatar');
    return value;
  }
  if ([...value].length < 1 || [...value].length > 8) throw new HttpError(400, '默认头像内容无效。', 'invalid_avatar');
  return value;
}

function userView(row) {
  return { id: row.id, email: row.email || null, phone: row.phone || null, email_verified: Boolean(row.email_verified), phone_verified: Boolean(row.phone_verified) };
}

async function userById(client, userId) {
  const result = await client.query('select id, email, phone, email_verified, phone_verified from users where id = $1', [userId]);
  if (!result.rows[0]) throw new HttpError(401, '账号不存在或已停用。', 'user_not_found');
  return result.rows[0];
}

async function issueSession(client, user) {
  const sessionId = crypto.randomUUID();
  const refreshToken = crypto.randomBytes(48).toString('base64url');
  await client.query(
    `insert into refresh_sessions(id, user_id, token_hash, expires_at)
     values ($1, $2, $3, now() + ($4::text || ' days')::interval)`,
    [sessionId, user.id, tokenHash(refreshToken), String(REFRESH_TTL_DAYS)],
  );
  return {
    access_token: signAccessToken(user.id, sessionId),
    refresh_token: refreshToken,
    token_type: 'bearer',
    expires_in: ACCESS_TTL_SECONDS,
    user: userView(user),
  };
}

async function authenticate(request, _response, next) {
  try {
    const authorization = request.get('authorization') || '';
    if (!authorization.startsWith('Bearer ')) throw new HttpError(401, '请先登录。', 'authentication_required');
    request.auth = verifyAccessToken(authorization.slice(7));
    const session = await pool.query('select 1 from refresh_sessions where id = $1 and user_id = $2 and revoked_at is null and expires_at > now()', [request.auth.sid, request.auth.sub]);
    if (!session.rowCount) throw new HttpError(401, '登录状态已失效，请重新登录。', 'session_revoked');
    next();
  } catch (error) { next(error); }
}

const rateBuckets = new Map();
function rateLimit(windowMs, limit) {
  return (request, _response, next) => {
    const now = Date.now();
    const key = `${request.ip}:${request.path}`;
    const bucket = rateBuckets.get(key);
    if (!bucket || bucket.resetAt <= now) rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    else {
      bucket.count += 1;
      if (bucket.count > limit) return next(new HttpError(429, '请求过于频繁，请稍后再试。', 'rate_limited'));
    }
    next();
  };
}

function codeHash(method, account, purpose, code) {
  return crypto.createHmac('sha256', AUTH_SECRET).update(`${method}:${account}:${purpose}:${code}`).digest('hex');
}

async function storeCode(method, account, purpose, code) {
  const id = crypto.randomUUID();
  await pool.query(
    `insert into one_time_codes(id, method, account, purpose, code_hash, expires_at)
     values ($1, $2, $3, $4, $5, now() + ($6::text || ' minutes')::interval)`,
    [id, method, account, purpose, codeHash(method, account, purpose, code), String(CODE_TTL_MINUTES)],
  );
  return id;
}

async function consumeCode(client, method, account, purpose, code) {
  const result = await client.query(
    `select id, code_hash, attempts from one_time_codes
     where method = $1 and account = $2 and purpose = $3 and used_at is null and expires_at > now()
     order by created_at desc limit 1 for update`,
    [method, account, purpose],
  );
  const record = result.rows[0];
  if (!record || record.attempts >= 5) throw new HttpError(400, '验证码无效或已过期。', 'invalid_code');
  const expected = Buffer.from(record.code_hash, 'hex');
  const actual = Buffer.from(codeHash(method, account, purpose, String(code || '')), 'hex');
  if (!crypto.timingSafeEqual(expected, actual)) {
    await client.query('update one_time_codes set attempts = attempts + 1 where id = $1', [record.id]);
    throw new HttpError(400, '验证码无效或已过期。', 'invalid_code');
  }
  await client.query('update one_time_codes set used_at = now() where id = $1', [record.id]);
}

async function deliverCode(method, account, purpose, code) {
  const labels = { login: '登录', register: '注册', recovery: '密码重置' };
  if (method === 'email') {
    if (!mailer) throw new HttpError(503, '管理员尚未配置 SMTP 邮件服务。', 'email_delivery_unavailable');
    await mailer.sendMail({
      from: process.env.SMTP_FROM,
      to: account,
      subject: `Shy2Speak ${labels[purpose]}验证码`,
      text: `你的 Shy2Speak ${labels[purpose]}验证码是 ${code}，${CODE_TTL_MINUTES} 分钟内有效。若非本人操作，请忽略此邮件。`,
    });
    return;
  }
  if (!smsEnabled) throw new HttpError(503, '管理员尚未配置短信服务。', 'sms_delivery_unavailable');
  const response = await fetch(process.env.SMS_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(process.env.SMS_WEBHOOK_TOKEN ? { Authorization: `Bearer ${process.env.SMS_WEBHOOK_TOKEN}` } : {}) },
    body: JSON.stringify({ to: account, purpose, message: `Shy2Speak 验证码：${code}，${CODE_TTL_MINUTES} 分钟内有效。` }),
  });
  if (!response.ok) throw new HttpError(502, '短信服务发送失败，请稍后重试。', 'sms_delivery_failed');
}

async function createAndDeliverCode(method, account, purpose) {
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const id = await storeCode(method, account, purpose, code);
  try { await deliverCode(method, account, purpose, code); }
  catch (error) {
    await pool.query('delete from one_time_codes where id = $1', [id]);
    throw error;
  }
}

function snapshotsFromPayload(payload) {
  const rows = [];
  for (const bucket of ['topics', 'chapters', 'sentences']) {
    for (const [scopeId, item] of Object.entries(payload?.analytics?.[bucket] || {})) {
      rows.push({
        type: bucket.slice(0, -1),
        id: String(scopeId).slice(0, 400),
        seconds: Math.max(0, Math.trunc(Number(item.practiceSeconds || 0))),
        count: Math.max(0, Math.trunc(Number(item.practiceCount || 0))),
        recordings: Math.max(0, Math.trunc(Number(item.recordings || 0))),
        scores: Array.isArray(item.scores) ? item.scores.slice(-100) : [],
        lastPracticedAt: item.lastPracticedAt || null,
      });
    }
  }
  return rows.slice(0, 5000);
}

const captionSyncPromises = new Map();
const captionFailureCooldowns = new Map();
const playlistSyncPromises = new Map();
const playlistFailureCooldowns = new Map();

async function baseCatalog() {
  const contents = await fs.readFile(catalogPath, 'utf8');
  const catalog = JSON.parse(contents);
  if (!Array.isArray(catalog.topics)) throw new Error('Course catalog topics are missing');
  return catalog;
}

let topicTitleTranslationsCache;
async function topicTitleTranslations() {
  if (!topicTitleTranslationsCache) {
    const parsed = JSON.parse(await fs.readFile(topicTitleTranslationsPath, 'utf8'));
    if (!parsed.titles || typeof parsed.titles !== 'object' || Array.isArray(parsed.titles)) {
      throw new Error('Topic title translations are invalid');
    }
    topicTitleTranslationsCache = parsed;
  }
  return topicTitleTranslationsCache;
}

async function hydratedYouTubeTopic(topic) {
  if (topic.provider !== 'youtube' || !topic.videoId) return topic;
  const cachedResult = await pool.query(
    'select payload, expires_at from youtube_catalog_cache where video_id = $1',
    [topic.videoId],
  );
  const cached = cachedResult.rows[0];
  const cachedHasCurrentTranslation = !YOUTUBE_CAPTION_TRANSLATION_LANGUAGE
    || cached?.payload?.captionTranslationLanguage === YOUTUBE_CAPTION_TRANSLATION_LANGUAGE;
  if (cached && cachedHasCurrentTranslation && new Date(cached.expires_at).getTime() > Date.now()) return cached.payload;
  if (!YOUTUBE_CAPTIONS_ENABLED || Number(captionFailureCooldowns.get(topic.videoId) || 0) > Date.now()) {
    return cached?.payload || topic;
  }
  if (captionSyncPromises.has(topic.videoId)) return captionSyncPromises.get(topic.videoId);

  const sync = (async () => {
    try {
      const payload = await fetchYouTubeTopic(topic, { translationLanguage: YOUTUBE_CAPTION_TRANSLATION_LANGUAGE });
      await pool.query(
        'insert into youtube_catalog_cache(video_id, payload, fetched_at, expires_at) values ($1, $2, now(), now() + ($3::text || \' hours\')::interval) on conflict (video_id) do update set payload = excluded.payload, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at',
        [topic.videoId, payload, String(YOUTUBE_CAPTION_CACHE_HOURS)],
      );
      captionFailureCooldowns.delete(topic.videoId);
      console.log('YouTube captions synced:', topic.videoId, payload.chapters.reduce((sum, chapter) => sum + chapter.sentences.length, 0), 'sentences');
      return payload;
    } catch (error) {
      captionFailureCooldowns.set(topic.videoId, Date.now() + 10 * 60 * 1000);
      console.warn('YouTube caption sync unavailable:', topic.videoId, error.message);
      return cached?.payload || { ...topic, transcriptOrigin: 'pending', transcriptSyncStatus: 'temporarily-unavailable' };
    } finally {
      captionSyncPromises.delete(topic.videoId);
    }
  })();
  captionSyncPromises.set(topic.videoId, sync);
  return sync;
}

function fallbackPlaylist(catalog, playlistId, syncError = '') {
  const topics = catalog.topics.map((topic) => ({
    ...topic,
    serverManaged: true,
    localizedTitles: { en: topic.title, ...(topic.localizedTitles || {}) },
  }));
  return { playlistId, topics, videoCount: topics.length, syncStatus: 'fallback', syncError: String(syncError).slice(0, 500) };
}

async function syncedPlaylist(catalog) {
  const playlistId = catalog?.source?.playlistId;
  if (!/^PL[\w-]+$/.test(playlistId || '')) return { topics: catalog.topics, videoCount: catalog.topics.length };
  const expectedVideoCount = Math.max(1, Math.trunc(Number(catalog.source.expectedVideoCount) || 1));
  const cachedResult = await pool.query(
    'select payload, expires_at from youtube_playlist_cache where playlist_id = $1',
    [playlistId],
  );
  const cached = cachedResult.rows[0];
  const cachedIsComplete = Array.isArray(cached?.payload?.topics) && cached.payload.topics.length >= expectedVideoCount;
  if (cachedIsComplete && new Date(cached.expires_at).getTime() > Date.now()) return cached.payload;
  if (!YOUTUBE_PLAYLIST_SYNC_ENABLED || Number(playlistFailureCooldowns.get(playlistId) || 0) > Date.now()) {
    return cachedIsComplete ? cached.payload : fallbackPlaylist(catalog, playlistId, YOUTUBE_PLAYLIST_SYNC_ENABLED ? 'Retry cooldown active' : 'Playlist sync disabled');
  }
  if (playlistSyncPromises.has(playlistId)) return playlistSyncPromises.get(playlistId);

  const sync = (async () => {
    try {
      const payload = { ...(await fetchYouTubePlaylist(playlistId, catalog.topics, { minimumVideoCount: expectedVideoCount })), syncStatus: 'synced' };
      await pool.query(
        'insert into youtube_playlist_cache(playlist_id, payload, fetched_at, expires_at) values ($1, $2, now(), now() + ($3::text || \' hours\')::interval) on conflict (playlist_id) do update set payload = excluded.payload, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at',
        [playlistId, payload, String(YOUTUBE_PLAYLIST_CACHE_HOURS)],
      );
      playlistFailureCooldowns.delete(playlistId);
      console.log('YouTube playlist synced:', playlistId, payload.topics.length, 'topics');
      return payload;
    } catch (error) {
      playlistFailureCooldowns.set(playlistId, Date.now() + 10 * 60 * 1000);
      console.warn('YouTube playlist sync unavailable:', playlistId, error.message);
      return cachedIsComplete ? cached.payload : fallbackPlaylist(catalog, playlistId, error.message);
    } finally {
      playlistSyncPromises.delete(playlistId);
    }
  })();
  playlistSyncPromises.set(playlistId, sync);
  return sync;
}

async function playlistCatalog() {
  const catalog = await baseCatalog();
  const playlist = await syncedPlaylist(catalog);
  const translations = await topicTitleTranslations();
  const topics = preparePlaylistTopics(playlist.topics, translations.titles, catalog.source.topicOrder);
  return {
    ...catalog,
    updatedAt: new Date().toISOString(),
    source: {
      ...catalog.source,
      playlistRuntime: 'NAS server public YouTube playlist with PostgreSQL cache',
      captionRuntime: 'NAS server public YouTube captions on demand with PostgreSQL cache',
      videoCount: topics.length,
      playlistSyncStatus: playlist.syncStatus || 'cached',
      ...(playlist.syncError ? { playlistSyncError: playlist.syncError } : {}),
    },
    topics,
  };
}

let vocabularySeedCache;
async function vocabularySeed() {
  if (!vocabularySeedCache) {
    const parsed = JSON.parse(await fs.readFile(vocabularyPath, 'utf8'));
    if (!Array.isArray(parsed.items) || !parsed.source?.videoId) throw new Error('Vocabulary seed data is invalid');
    vocabularySeedCache = parsed;
  }
  return vocabularySeedCache;
}

async function seedVocabularyForUser(client, userId) {
  const seed = await vocabularySeed();
  const claimed = await client.query(
    `insert into user_content_seeds(user_id, content_type, version) values ($1, 'mall-vocabulary', $2)
     on conflict (user_id, content_type) do nothing returning user_id`,
    [userId, Number(seed.version || 1)],
  );
  if (!claimed.rowCount) return seed;
  for (const item of seed.items) {
    const payload = { ...item };
    delete payload.books;
    delete payload.removedFromDefault;
    await client.query(
      `insert into user_vocabulary_items(user_id, word_id, payload, removed_from_default)
       values ($1, $2, $3, $4) on conflict (user_id, word_id) do nothing`,
      [userId, item.id, JSON.stringify(payload), Boolean(item.removedFromDefault)],
    );
    for (const book of item.books || []) {
      await client.query(
        `insert into user_vocabulary_memberships(user_id, word_id, book_id, book_name)
         values ($1, $2, $3, $4) on conflict do nothing`,
        [userId, item.id, String(book.id).slice(0, 80), String(book.name).slice(0, 120)],
      );
    }
  }
  return seed;
}

async function vocabularyForUser(client, userId) {
  const seed = await seedVocabularyForUser(client, userId);
  const result = await client.query(
    `select item.word_id, item.payload, item.removed_from_default,
       coalesce(jsonb_agg(jsonb_build_object('id', membership.book_id, 'name', membership.book_name)
         order by membership.created_at) filter (where membership.book_id is not null), '[]'::jsonb) as books
     from user_vocabulary_items item
     left join user_vocabulary_memberships membership
       on membership.user_id = item.user_id and membership.word_id = item.word_id
     where item.user_id = $1
     group by item.user_id, item.word_id, item.payload, item.removed_from_default, item.created_at
     order by item.created_at, item.word_id`,
    [userId],
  );
  return {
    version: seed.version,
    source: seed.source,
    wordbooks: seed.wordbooks,
    items: result.rows.map((row) => ({ ...row.payload, id: row.word_id, removedFromDefault: row.removed_from_default, books: row.books })),
  };
}

async function migrate() {
  const migrationDirectory = path.join(serverDirectory, 'migrations');
  const migrationFiles = (await fs.readdir(migrationDirectory)).filter((file) => /^\d+_.+\.sql$/.test(file)).sort();
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      for (const file of migrationFiles) await pool.query(await fs.readFile(path.join(migrationDirectory, file), 'utf8'));
      return;
    } catch (error) {
      if (attempt === 30) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

const app = express();
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use((request, response, next) => {
  response.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), geolocation=(), microphone=(self)',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://i.ytimg.com; media-src 'self' blob: https:; frame-src https://www.youtube-nocookie.com; connect-src 'self' https:; worker-src 'self' blob:; manifest-src 'self'",
  });
  const allowed = String(process.env.ALLOWED_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean);
  const origin = request.get('origin');
  if (origin && allowed.includes(origin)) {
    response.set('Access-Control-Allow-Origin', origin);
    response.set('Vary', 'Origin');
    response.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    response.set('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  }
  if (request.method === 'OPTIONS') return response.sendStatus(204);
  next();
});

app.get('/api/health', asyncRoute(async (_request, response) => {
  await pool.query('select 1');
  response.json({
    ok: true,
    service: 'shy2speak-self-hosted',
    release: 'v24',
    database: 'postgresql',
    auth: { email: true, phone: true, emailOtp: smtpEnabled, phoneOtp: smsEnabled, passwordRecovery: smtpEnabled },
  });
}));

app.get('/api/catalog', rateLimit(60 * 1000, 60), asyncRoute(async (_request, response) => {
  response.set('Cache-Control', 'private, max-age=300');
  response.json(await playlistCatalog());
}));

app.get('/api/catalog/topics/:videoId', rateLimit(60 * 1000, 30), asyncRoute(async (request, response) => {
  const videoId = String(request.params.videoId || '');
  if (!/^[\w-]{11}$/.test(videoId)) throw new HttpError(400, '无效的 YouTube 视频 ID。', 'invalid_video_id');
  const catalog = await playlistCatalog();
  const topic = catalog.topics.find((candidate) => candidate.videoId === videoId && candidate.serverManaged);
  if (!topic) throw new HttpError(404, '该视频不在已配置的播放列表中。', 'topic_not_found');
  response.set('Cache-Control', 'private, max-age=300');
  response.json(await hydratedYouTubeTopic(topic));
}));

const authLimiter = rateLimit(15 * 60 * 1000, 30);

app.post('/api/auth/register', authLimiter, asyncRoute(async (request, response) => {
  const method = request.body?.method;
  const account = normalizeIdentity(method, request.body?.account);
  const nickname = validateNickname(request.body?.nickname);
  validatePassword(request.body?.password);
  const client = await pool.connect();
  try {
    await client.query('begin');
    const id = crypto.randomUUID();
    const hash = await passwordHash(request.body.password);
    const email = method === 'email' ? account : null;
    const phone = method === 'phone' ? account : null;
    const created = await client.query(
      'insert into users(id, email, phone, password_hash) values ($1, $2, $3, $4) returning id, email, phone, email_verified, phone_verified',
      [id, email, phone, hash],
    );
    await client.query('insert into profiles(user_id, nickname) values ($1, $2)', [id, nickname]);
    const session = await issueSession(client, created.rows[0]);
    await client.query('commit');
    response.status(201).json(session);
  } catch (error) {
    await client.query('rollback');
    if (error.code === '23505') throw new HttpError(409, String(error.constraint || '').includes('nickname') ? '昵称已被使用。' : '该邮箱或手机号已注册。', 'already_exists');
    throw error;
  } finally { client.release(); }
}));

app.post('/api/auth/login', authLimiter, asyncRoute(async (request, response) => {
  const method = request.body?.method;
  const account = normalizeIdentity(method, request.body?.account);
  const field = method === 'email' ? 'email' : 'phone';
  const result = await pool.query(`select id, email, phone, password_hash, email_verified, phone_verified from users where ${field} = $1`, [account]);
  const user = result.rows[0];
  if (!user || !(await passwordMatches(String(request.body?.password || ''), user.password_hash))) throw new HttpError(401, '账号或密码不正确。', 'invalid_credentials');
  response.json(await issueSession(pool, user));
}));

app.post('/api/auth/refresh', authLimiter, asyncRoute(async (request, response) => {
  const refreshToken = String(request.body?.refresh_token || '');
  if (!refreshToken) throw new HttpError(401, '刷新凭据无效。', 'invalid_refresh_token');
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await client.query(
      `select s.id as session_id, u.id, u.email, u.phone, u.email_verified, u.phone_verified
       from refresh_sessions s join users u on u.id = s.user_id
       where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now() for update`,
      [tokenHash(refreshToken)],
    );
    if (!result.rows[0]) throw new HttpError(401, '刷新凭据已过期，请重新登录。', 'invalid_refresh_token');
    await client.query('update refresh_sessions set revoked_at = now() where id = $1', [result.rows[0].session_id]);
    const session = await issueSession(client, result.rows[0]);
    await client.query('commit');
    response.json(session);
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally { client.release(); }
}));

app.post('/api/auth/logout', authenticate, asyncRoute(async (request, response) => {
  await pool.query('update refresh_sessions set revoked_at = now() where id = $1 and user_id = $2', [request.auth.sid, request.auth.sub]);
  response.sendStatus(204);
}));

app.get('/api/auth/me', authenticate, asyncRoute(async (request, response) => response.json(userView(await userById(pool, request.auth.sub)))));

app.post('/api/auth/otp', authLimiter, asyncRoute(async (request, response) => {
  const method = request.body?.method;
  const account = normalizeIdentity(method, request.body?.account);
  const field = method === 'email' ? 'email' : 'phone';
  const found = await pool.query(`select id from users where ${field} = $1`, [account]);
  const purpose = found.rowCount ? 'login' : 'register';
  if (!found.rowCount && request.body?.create_user === false) throw new HttpError(404, '未找到该账号。', 'user_not_found');
  await createAndDeliverCode(method, account, purpose);
  response.status(202).json({ delivered: true, method, purpose, expires_in: CODE_TTL_MINUTES * 60 });
}));

app.post('/api/auth/verify-otp', authLimiter, asyncRoute(async (request, response) => {
  const method = request.body?.method;
  const account = normalizeIdentity(method, request.body?.account);
  const field = method === 'email' ? 'email' : 'phone';
  const client = await pool.connect();
  try {
    await client.query('begin');
    let result = await client.query(`select id, email, phone, email_verified, phone_verified from users where ${field} = $1 for update`, [account]);
    const purpose = result.rowCount ? 'login' : 'register';
    await consumeCode(client, method, account, purpose, request.body?.token);
    if (!result.rowCount) {
      const id = crypto.randomUUID();
      result = await client.query(
        `insert into users(id, email, phone, ${method === 'email' ? 'email_verified' : 'phone_verified'}) values ($1, $2, $3, true)
         returning id, email, phone, email_verified, phone_verified`,
        [id, method === 'email' ? account : null, method === 'phone' ? account : null],
      );
      await client.query('insert into profiles(user_id, nickname) values ($1, $2)', [id, `learner_${id.replaceAll('-', '').slice(0, 8)}`]);
    } else {
      await client.query(`update users set ${method === 'email' ? 'email_verified' : 'phone_verified'} = true, updated_at = now() where id = $1`, [result.rows[0].id]);
      result.rows[0][method === 'email' ? 'email_verified' : 'phone_verified'] = true;
    }
    const session = await issueSession(client, result.rows[0]);
    await client.query('commit');
    response.json(session);
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally { client.release(); }
}));

app.post('/api/auth/recover', authLimiter, asyncRoute(async (request, response) => {
  const email = normalizeIdentity('email', request.body?.email);
  if (!smtpEnabled) throw new HttpError(503, '管理员尚未配置 SMTP，暂时无法发送密码重置邮件。', 'email_delivery_unavailable');
  const found = await pool.query('select id from users where email = $1', [email]);
  if (found.rowCount) await createAndDeliverCode('email', email, 'recovery');
  response.status(202).json({ delivered: true, expires_in: CODE_TTL_MINUTES * 60 });
}));

app.post('/api/auth/reset-password', authLimiter, asyncRoute(async (request, response) => {
  const email = normalizeIdentity('email', request.body?.email);
  validatePassword(request.body?.password);
  const client = await pool.connect();
  try {
    await client.query('begin');
    await consumeCode(client, 'email', email, 'recovery', request.body?.token);
    const result = await client.query('select id from users where email = $1 for update', [email]);
    if (!result.rows[0]) throw new HttpError(400, '验证码无效或已过期。', 'invalid_code');
    await client.query('update users set password_hash = $1, updated_at = now() where id = $2', [await passwordHash(request.body.password), result.rows[0].id]);
    await client.query('update refresh_sessions set revoked_at = now() where user_id = $1 and revoked_at is null', [result.rows[0].id]);
    await client.query('commit');
    response.json({ updated: true });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally { client.release(); }
}));

app.put('/api/auth/password', authenticate, asyncRoute(async (request, response) => {
  validatePassword(request.body?.password);
  await pool.query('update users set password_hash = $1, updated_at = now() where id = $2', [await passwordHash(request.body.password), request.auth.sub]);
  response.json({ updated: true });
}));

app.get('/api/profile', authenticate, asyncRoute(async (request, response) => {
  const result = await pool.query('select user_id as id, nickname, signature, avatar, locale, updated_at from profiles where user_id = $1', [request.auth.sub]);
  response.json(result.rows[0] || null);
}));

app.post('/api/profile/nickname/check', authenticate, asyncRoute(async (request, response) => {
  const nickname = validateNickname(request.body?.nickname);
  const result = await pool.query('select 1 from profiles where nickname = $1 and user_id <> $2', [nickname, request.auth.sub]);
  response.json({ available: !result.rowCount });
}));

app.put('/api/profile', authenticate, asyncRoute(async (request, response) => {
  const nickname = validateNickname(request.body?.nickname);
  const signature = String(request.body?.signature || '').slice(0, 160);
  const avatar = validateAvatar(request.body?.avatar);
  const locale = String(request.body?.locale || 'zh').slice(0, 20);
  try {
    const result = await pool.query(
      `update profiles set nickname = $1, signature = $2, avatar = $3, locale = $4, updated_at = now()
       where user_id = $5 returning user_id as id, nickname, signature, avatar, locale, updated_at`,
      [nickname, signature, avatar, locale, request.auth.sub],
    );
    response.json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') throw new HttpError(409, '昵称已被使用。', 'nickname_taken');
    throw error;
  }
}));

app.get('/api/learning-state', authenticate, asyncRoute(async (request, response) => {
  const result = await pool.query('select payload, client_updated_at from learning_states where user_id = $1', [request.auth.sub]);
  response.json(result.rows[0] || null);
}));

app.put('/api/learning-state', authenticate, asyncRoute(async (request, response) => {
  const payload = request.body?.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new HttpError(400, '学习数据格式无效。', 'invalid_learning_state');
  const date = new Date(request.body?.client_updated_at || payload.updatedAt || Date.now());
  if (Number.isNaN(date.getTime())) throw new HttpError(400, '学习数据时间无效。', 'invalid_learning_state');
  const clientUpdatedAt = date.toISOString();
  const snapshots = snapshotsFromPayload(payload);
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(
      `insert into learning_states(user_id, payload, client_updated_at) values ($1, $2, $3)
       on conflict (user_id) do update set payload = excluded.payload, client_updated_at = excluded.client_updated_at, updated_at = now()
       where learning_states.client_updated_at <= excluded.client_updated_at`,
      [request.auth.sub, payload, clientUpdatedAt],
    );
    for (const item of snapshots) {
      await client.query(
        `insert into practice_snapshots(user_id, scope_type, scope_id, practice_seconds, practice_count, recording_count, scores, last_practiced_at, client_updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         on conflict (user_id, scope_type, scope_id) do update set
           practice_seconds = excluded.practice_seconds, practice_count = excluded.practice_count,
           recording_count = excluded.recording_count, scores = excluded.scores,
           last_practiced_at = excluded.last_practiced_at, client_updated_at = excluded.client_updated_at, updated_at = now()
         where practice_snapshots.client_updated_at <= excluded.client_updated_at`,
        [request.auth.sub, item.type, item.id, item.seconds, item.count, item.recordings, JSON.stringify(item.scores), item.lastPracticedAt, clientUpdatedAt],
      );
    }
    await client.query('commit');
    response.json({ syncedAt: new Date().toISOString(), snapshotCount: snapshots.length });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally { client.release(); }
}));

app.get('/api/vocabulary', authenticate, asyncRoute(async (request, response) => {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const vocabulary = await vocabularyForUser(client, request.auth.sub);
    await client.query('commit');
    response.json(vocabulary);
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally { client.release(); }
}));

app.post('/api/vocabulary/delete-everywhere', authenticate, asyncRoute(async (request, response) => {
  const wordIds = [...new Set((Array.isArray(request.body?.word_ids) ? request.body.word_ids : []).map((id) => String(id)))];
  if (!wordIds.length || wordIds.length > 100 || wordIds.some((id) => !/^[a-z0-9-]{1,80}$/.test(id))) {
    throw new HttpError(400, '请选择有效的待清理生词。', 'invalid_vocabulary_selection');
  }
  const result = await pool.query(
    `delete from user_vocabulary_items where user_id = $1 and word_id = any($2::text[])
     returning word_id`,
    [request.auth.sub, wordIds],
  );
  const deletedIds = result.rows.map((row) => row.word_id);
  response.json({ deletedIds, deletedCount: deletedIds.length });
}));

app.get('/runtime-config.js', (_request, response) => {
  response.type('application/javascript').set('Cache-Control', 'no-store').send(`window.__SHY2SPEAK_CONFIG__ = Object.freeze(${JSON.stringify({ apiBase: '/api', deployment: 'self-hosted' })});\n`);
});
const staticOptions = { etag: true, maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 };
app.use('/data', express.static(path.join(publicDirectory, 'data'), staticOptions));
app.use('/icons', express.static(path.join(publicDirectory, 'icons'), staticOptions));
for (const file of ['boot.js', 'i18n.js', 'app.js', 'backend.js', 'styles.css', 'sw.js', 'manifest.webmanifest']) {
  app.get(`/${file}`, (_request, response) => response.sendFile(path.join(publicDirectory, file), staticOptions));
}
app.get(['/', '/index.html'], (_request, response) => response.sendFile(path.join(publicDirectory, 'index.html')));
app.use('/api', (_request, _response, next) => next(new HttpError(404, '接口不存在。', 'not_found')));
app.use((error, _request, response, _next) => {
  const status = Number(error.status || 500);
  if (status >= 500) console.error(error);
  response.status(status).json({ error: error.code || 'internal_error', message: status >= 500 ? '服务器暂时不可用，请稍后重试。' : error.message });
});

await migrate();
const server = app.listen(PORT, '0.0.0.0', () => console.log(`Shy2Speak listening on 0.0.0.0:${PORT}`));
const cleanupTimer = setInterval(() => {
  pool.query("delete from one_time_codes where expires_at < now() - interval '1 day' or used_at is not null").catch(() => {});
  pool.query("delete from refresh_sessions where expires_at < now() - interval '1 day' or revoked_at < now() - interval '7 days'").catch(() => {});
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) if (bucket.resetAt <= now) rateBuckets.delete(key);
}, 60 * 60 * 1000);
cleanupTimer.unref();

async function shutdown() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
