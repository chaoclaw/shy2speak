(() => {
  const CONFIG_KEY = 'shy-backend-config-v1';
  const SESSION_KEY = 'shy-auth-session-v1';
  const listeners = new Set();
  const runtime = window.__SHY2SPEAK_CONFIG__ || {};

  let config = readJSON(CONFIG_KEY, {});
  if (runtime.supabaseUrl && runtime.supabasePublishableKey) {
    config = {
      type: 'supabase',
      url: runtime.supabaseUrl,
      publishableKey: runtime.supabasePublishableKey,
      source: 'deployment',
    };
  }
  let session = readJSON(SESSION_KEY, null);

  function readJSON(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  }

  function normalizeUrl(value) {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('账号服务地址必须使用 HTTPS。');
    return url.origin;
  }

  function isConfigured() {
    return Boolean(config.url && config.publishableKey);
  }

  function saveConfig(url, publishableKey) {
    const next = {
      type: 'supabase',
      url: normalizeUrl(url),
      publishableKey: String(publishableKey || config.publishableKey || '').trim(),
      source: 'device',
      updatedAt: new Date().toISOString(),
    };
    if (!next.publishableKey) throw new Error('请填写 Publishable Key（或兼容的 anon key）。');
    config = next;
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    return getConfig();
  }

  function getConfig() {
    return { type: config.type || 'supabase', url: config.url || '', source: config.source || 'none', configured: isConfigured() };
  }

  function persistSession(next) {
    session = next?.access_token ? next : null;
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
    listeners.forEach((listener) => listener(getSession()));
    return getSession();
  }

  function getSession() {
    return session ? { ...session, user: session.user ? { ...session.user } : null } : null;
  }

  function sessionFromPayload(payload) {
    if (!payload?.access_token) return null;
    const expiresIn = Number(payload.expires_in || 3600);
    return { ...payload, expires_at: payload.expires_at || Math.floor(Date.now() / 1000) + expiresIn };
  }

  async function request(path, { method = 'GET', body, accessToken, headers = {}, retry = true } = {}) {
    if (!isConfigured()) throw new Error('账号服务尚未配置。');
    const response = await fetch(`${config.url}${path}`, {
      method,
      headers: {
        apikey: config.publishableKey,
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 401 && retry && session?.refresh_token && accessToken) {
      await refreshSession();
      return request(path, { method, body, accessToken: session?.access_token, headers, retry: false });
    }
    const text = await response.text();
    let payload = null;
    if (text) {
      try { payload = JSON.parse(text); }
      catch { payload = { message: text }; }
    }
    if (!response.ok) {
      const message = payload?.msg || payload?.message || payload?.error_description || payload?.error || `HTTP ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  async function testConnection(candidate) {
    const previous = config;
    if (candidate) config = { type: 'supabase', url: normalizeUrl(candidate.url), publishableKey: String(candidate.publishableKey || config.publishableKey || '').trim() };
    try {
      if (!isConfigured()) throw new Error('请填写账号服务 URL 和 Publishable Key。');
      const settings = await request('/auth/v1/settings');
      return { ok: true, emailEnabled: settings?.external?.email !== false, phoneEnabled: settings?.external?.phone === true };
    } finally {
      if (candidate) config = previous;
    }
  }

  async function signInPassword({ method, account, password }) {
    const identity = method === 'phone' ? { phone: account } : { email: account };
    const payload = await request('/auth/v1/token?grant_type=password', { method: 'POST', body: { ...identity, password } });
    return persistSession(sessionFromPayload(payload));
  }

  async function signUp({ method, account, password, nickname }) {
    const identity = method === 'phone' ? { phone: account } : { email: account };
    const redirectTo = `${location.origin}${location.pathname}?auth_callback=1`;
    const payload = await request(`/auth/v1/signup?redirect_to=${encodeURIComponent(redirectTo)}`, { method: 'POST', body: { ...identity, password, data: { nickname: nickname || '' } } });
    if (payload?.access_token) persistSession(sessionFromPayload(payload));
    return payload;
  }

  async function sendOtp({ method, account, createUser = true }) {
    const identity = method === 'phone' ? { phone: account } : { email: account };
    const redirectTo = `${location.origin}${location.pathname}?auth_callback=1`;
    return request(`/auth/v1/otp?redirect_to=${encodeURIComponent(redirectTo)}`, { method: 'POST', body: { ...identity, create_user: createUser } });
  }

  async function verifyOtp({ method, account, token }) {
    const identity = method === 'phone' ? { phone: account, type: 'sms' } : { email: account, type: 'email' };
    const payload = await request('/auth/v1/verify', { method: 'POST', body: { ...identity, token } });
    return persistSession(sessionFromPayload(payload));
  }

  async function recoverPassword(email) {
    const redirectTo = `${location.origin}${location.pathname}?auth_callback=1`;
    return request(`/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`, { method: 'POST', body: { email } });
  }

  async function updatePassword(password) {
    const active = await ensureSession();
    const payload = await request('/auth/v1/user', { method: 'PUT', accessToken: active.access_token, body: { password } });
    session.user = payload;
    persistSession(session);
    return payload;
  }

  async function refreshSession() {
    if (!session?.refresh_token) return persistSession(null);
    try {
      const payload = await request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refresh_token }, retry: false });
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
      try { await request('/auth/v1/logout', { method: 'POST', accessToken: session.access_token, retry: false }); }
      catch { /* Local sign-out must still succeed while offline. */ }
    }
    persistSession(null);
  }

  async function getProfile() {
    const active = await ensureSession();
    const rows = await request(`/rest/v1/profiles?select=id,nickname,signature,avatar,locale,updated_at&id=eq.${encodeURIComponent(active.user.id)}&limit=1`, { accessToken: active.access_token });
    return rows?.[0] || null;
  }

  async function getUser() {
    const active = await ensureSession();
    const user = await request('/auth/v1/user', { accessToken: active.access_token });
    session.user = user;
    persistSession(session);
    return user;
  }

  async function saveProfile({ nickname, signature, avatar, locale }) {
    const active = await ensureSession();
    return request('/rest/v1/rpc/save_my_profile', {
      method: 'POST',
      accessToken: active.access_token,
      body: { p_nickname: nickname, p_signature: signature || '', p_avatar: avatar || 'S', p_locale: locale || 'zh' },
    });
  }

  async function checkNickname(nickname) {
    const active = await ensureSession();
    const result = await request('/rest/v1/rpc/is_nickname_available', {
      method: 'POST', accessToken: active.access_token, body: { p_nickname: nickname },
    });
    return result === true;
  }

  function scopeSnapshots(payload) {
    const rows = [];
    ['topics', 'chapters', 'sentences'].forEach((bucket) => {
      Object.entries(payload?.analytics?.[bucket] || {}).forEach(([scopeId, item]) => rows.push({
        user_id: session.user.id,
        scope_type: bucket.slice(0, -1),
        scope_id: scopeId,
        practice_seconds: Number(item.practiceSeconds || 0),
        practice_count: Number(item.practiceCount || 0),
        recording_count: Number(item.recordings || 0),
        scores: item.scores || [],
        last_practiced_at: item.lastPracticedAt || null,
        client_updated_at: payload.updatedAt || new Date().toISOString(),
      }));
    });
    return rows;
  }

  async function pushLearningState(payload) {
    const active = await ensureSession();
    const stateRow = { user_id: active.user.id, payload, client_updated_at: payload.updatedAt || new Date().toISOString() };
    await request('/rest/v1/learning_states?on_conflict=user_id', {
      method: 'POST', accessToken: active.access_token, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: stateRow,
    });
    const snapshots = scopeSnapshots(payload);
    if (snapshots.length) await request('/rest/v1/practice_snapshots?on_conflict=user_id,scope_type,scope_id', {
      method: 'POST', accessToken: active.access_token, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: snapshots,
    });
    return { syncedAt: new Date().toISOString(), snapshotCount: snapshots.length };
  }

  async function pullLearningState() {
    const active = await ensureSession();
    const rows = await request(`/rest/v1/learning_states?select=payload,client_updated_at&user_id=eq.${encodeURIComponent(active.user.id)}&limit=1`, { accessToken: active.access_token });
    return rows?.[0] || null;
  }

  function parseAuthCallback() {
    const fragment = location.hash.startsWith('#') ? new URLSearchParams(location.hash.slice(1)) : null;
    if (!fragment?.get('access_token')) return false;
    persistSession(sessionFromPayload({
      access_token: fragment.get('access_token'),
      refresh_token: fragment.get('refresh_token'),
      expires_in: fragment.get('expires_in'),
      token_type: fragment.get('token_type') || 'bearer',
      user: fragment.get('user') ? JSON.parse(fragment.get('user')) : null,
    }));
    history.replaceState(null, '', `${location.pathname}#/settings`);
    return true;
  }

  async function initialize() {
    try { parseAuthCallback(); }
    catch { history.replaceState(null, '', `${location.pathname}#/settings`); }
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
    signInPassword, signUp, sendOtp, verifyOtp, recoverPassword, updatePassword,
    refreshSession, signOut, getUser, getProfile, saveProfile, checkNickname,
    pushLearningState, pullLearningState,
  });
})();
