(() => {
  const CONFIG_KEY = 'shy-backend-config-v2';
  const SESSION_KEY = 'shy-auth-session-v2';
  const listeners = new Set();
  const runtime = window.__SHY2SPEAK_CONFIG__ || {};

  let config = readJSON(CONFIG_KEY, {});
  if (runtime.apiBase) config = { type: 'self-hosted', url: normalizeUrl(runtime.apiBase), source: 'deployment' };
  let session = readJSON(SESSION_KEY, null);

  function readJSON(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  }

  function isPrivateHostname(hostname) {
    if (['localhost', '127.0.0.1', '::1'].includes(hostname) || hostname.endsWith('.local') || !hostname.includes('.')) return true;
    const parts = hostname.split('.').map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    return parts[0] === 10 || parts[0] === 127 || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
  }

  function normalizeUrl(value) {
    const raw = String(value || '').trim().replace(/\/+$/, '');
    if (raw.startsWith('/')) return raw || '/api';
    const url = new URL(raw);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isPrivateHostname(url.hostname))) {
      throw new Error('公网账号服务必须使用 HTTPS；局域网私有地址可使用 HTTP。');
    }
    const path = url.pathname.replace(/\/+$/, '');
    return `${url.origin}${path && path !== '/' ? path : '/api'}`;
  }

  function isConfigured() { return Boolean(config.url); }

  function saveConfig(url) {
    config = { type: 'self-hosted', url: normalizeUrl(url), source: 'device', updatedAt: new Date().toISOString() };
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    return getConfig();
  }

  function getConfig() {
    return { type: 'self-hosted', url: config.url || '', source: config.source || 'none', configured: isConfigured() };
  }

  function persistSession(next) {
    session = next?.access_token ? next : null;
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
    listeners.forEach((listener) => listener(getSession()));
    return getSession();
  }

  function getSession() { return session ? { ...session, user: session.user ? { ...session.user } : null } : null; }

  function sessionFromPayload(payload) {
    if (!payload?.access_token) return null;
    const expiresIn = Number(payload.expires_in || 900);
    return { ...payload, expires_at: payload.expires_at || Math.floor(Date.now() / 1000) + expiresIn };
  }

  async function request(path, { method = 'GET', body, accessToken, retry = true } = {}) {
    if (!isConfigured()) throw new Error('局域网账号服务尚未配置。');
    const response = await fetch(`${config.url}${path}`, {
      method,
      headers: { ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 401 && retry && session?.refresh_token && accessToken) {
      await refreshSession();
      return request(path, { method, body, accessToken: session?.access_token, retry: false });
    }
    const text = await response.text();
    let payload = null;
    if (text) {
      try { payload = JSON.parse(text); }
      catch { payload = { message: text }; }
    }
    if (!response.ok) {
      const error = new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
      error.status = response.status;
      error.code = payload?.error;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  async function testConnection(candidate) {
    const previous = config;
    if (candidate) config = { type: 'self-hosted', url: normalizeUrl(candidate.url) };
    try {
      if (!isConfigured()) throw new Error('请填写 Shy2Speak 服务地址。');
      const health = await request('/health');
      if (!health?.ok || health?.database !== 'postgresql') throw new Error('服务响应无效或数据库未就绪。');
      return {
        ok: true,
        emailEnabled: health.auth?.email !== false,
        phoneEnabled: health.auth?.phone !== false,
        emailOtpEnabled: health.auth?.emailOtp === true,
        phoneOtpEnabled: health.auth?.phoneOtp === true,
        passwordRecoveryEnabled: health.auth?.passwordRecovery === true,
      };
    } finally { if (candidate) config = previous; }
  }

  async function signInPassword({ method, account, password }) {
    const payload = await request('/auth/login', { method: 'POST', body: { method, account, password } });
    return persistSession(sessionFromPayload(payload));
  }

  async function signUp({ method, account, password, nickname }) {
    const payload = await request('/auth/register', { method: 'POST', body: { method, account, password, nickname } });
    if (payload?.access_token) persistSession(sessionFromPayload(payload));
    return payload;
  }

  async function sendOtp({ method, account, createUser = true }) {
    return request('/auth/otp', { method: 'POST', body: { method, account, create_user: createUser } });
  }

  async function verifyOtp({ method, account, token }) {
    const payload = await request('/auth/verify-otp', { method: 'POST', body: { method, account, token } });
    return persistSession(sessionFromPayload(payload));
  }

  async function recoverPassword(email) { return request('/auth/recover', { method: 'POST', body: { email } }); }
  async function resetPasswordWithCode({ email, token, password }) { return request('/auth/reset-password', { method: 'POST', body: { email, token, password } }); }

  async function updatePassword(password) {
    const active = await ensureSession();
    return request('/auth/password', { method: 'PUT', accessToken: active.access_token, body: { password } });
  }

  async function refreshSession() {
    if (!session?.refresh_token) return persistSession(null);
    try {
      const payload = await request('/auth/refresh', { method: 'POST', body: { refresh_token: session.refresh_token }, retry: false });
      return persistSession(sessionFromPayload(payload));
    } catch (error) {
      persistSession(null);
      throw error;
    }
  }

  async function ensureSession() {
    if (!session) throw new Error('请先登录。');
    if (Number(session.expires_at || 0) <= Math.floor(Date.now() / 1000) + 60) await refreshSession();
    return session;
  }

  async function signOut() {
    if (session?.access_token) {
      try { await request('/auth/logout', { method: 'POST', accessToken: session.access_token, retry: false }); }
      catch { /* Local sign-out must still succeed while the NAS is offline. */ }
    }
    persistSession(null);
  }

  async function getProfile() {
    const active = await ensureSession();
    return request('/profile', { accessToken: active.access_token });
  }

  async function getUser() {
    const active = await ensureSession();
    const user = await request('/auth/me', { accessToken: active.access_token });
    session.user = user;
    persistSession(session);
    return user;
  }

  async function saveProfile({ nickname, signature, avatar, locale }) {
    const active = await ensureSession();
    return request('/profile', { method: 'PUT', accessToken: active.access_token, body: { nickname, signature, avatar, locale } });
  }

  async function checkNickname(nickname) {
    const active = await ensureSession();
    const result = await request('/profile/nickname/check', { method: 'POST', accessToken: active.access_token, body: { nickname } });
    return result?.available === true;
  }

  async function pushLearningState(payload) {
    const active = await ensureSession();
    return request('/learning-state', { method: 'PUT', accessToken: active.access_token, body: { payload, client_updated_at: payload.updatedAt || new Date().toISOString() } });
  }

  async function pullLearningState() {
    const active = await ensureSession();
    return request('/learning-state', { accessToken: active.access_token });
  }

  async function initialize() {
    if (session && Number(session.expires_at || 0) <= Math.floor(Date.now() / 1000) + 60) {
      try { await refreshSession(); }
      catch { /* Session listeners already received signed-out state. */ }
    }
    if (session?.access_token && !session.user) {
      try { await getUser(); }
      catch { persistSession(null); }
    }
    return { config: getConfig(), session: getSession() };
  }

  window.shyBackend = Object.freeze({
    initialize, getConfig, saveConfig, testConnection, isConfigured, getSession,
    onAuthChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    signInPassword, signUp, sendOtp, verifyOtp, recoverPassword, resetPasswordWithCode,
    updatePassword, refreshSession, signOut, getUser, getProfile, saveProfile,
    checkNickname, pushLearningState, pullLearningState,
  });
})();
