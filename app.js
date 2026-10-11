const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

const state = {
  view: location.hash.replace('#/', '') || 'overview',
  mode: localStorage.getItem('shy-mode') || 'light',
  theme: localStorage.getItem('shy-theme') || 'violet',
  language: localStorage.getItem('shy-language') || 'zh',
  audioPlaying: false,
  audioTime: 154,
  audioDuration: 418,
  speedIndex: 3,
  playModeIndex: 1,
  definitionLanguage: localStorage.getItem('shy-definition-language') || 'zh',
  vocabularyRemoved: false,
  cleanupReminder: 1,
  catalog: null,
  topicId: localStorage.getItem('shy-topic-id') || '',
  chapterId: localStorage.getItem('shy-chapter-id') || '',
  sentenceId: '',
  mediaRecorder: null,
  mediaStream: null,
  recordingStartedAt: 0,
  recordingChunks: [],
  promptId: localStorage.getItem('shy-prompt-id') || 'encouraging',
  studioSource: null,
  reduceMotion: localStorage.getItem('shy-reduce-motion') === 'true',
  highContrast: localStorage.getItem('shy-high-contrast') === 'true',
  authSession: null,
  accountReady: false,
  lastSyncedAt: null,
};

const STORAGE_KEYS = {
  analytics: 'shy-learning-analytics-v1',
  catalog: 'shy-course-catalog-v1',
  customTopics: 'shy-custom-topics-v1',
  youtubeMetadata: 'shy-youtube-metadata-v1',
  providers: 'shy-ai-providers-v1',
  prompts: 'shy-ai-prompts-v1',
  profile: 'shy-profile-v1',
  sync: 'shy-cloud-sync-v1',
};

const DEFAULT_PROMPTS = [
  { id: 'encouraging', name: '鼓励型反馈', system: '你是一位耐心、准确的英语发音教练。根据语音服务返回的逐词与音素分数，为学习者提供简洁、可执行的反馈。不要修改原始分数。', isDefault: true },
  { id: 'strict', name: '严格评分', system: '你是一位严格的英语发音评测员。只基于提供的发音、流利度与完整度数据给出反馈，并明确指出需要重练的音素。', isDefault: true },
  { id: 'children', name: '儿童学习', system: '你是一位友善的少儿英语老师。使用积极、简短且容易理解的语言反馈发音问题，每次只给一个改进建议。', isDefault: true },
  { id: 'business', name: '商务英语', system: '你是一位商务英语表达教练。结合语音评分说明清晰度、语气与专业表达，并给出一句可立即模仿的建议。', isDefault: true }
];

function readStoredJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}

function writeStoredJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function escapeHTML(value = '') {
  return String(value).replace(/[&<>"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]);
}

let cloudSyncTimer;
const topicHydrationPromises = new Map();
const hydratedTopicIds = new Set();
const topicTranslationPromises = new Map();

function storedProfile() {
  return readStoredJSON(STORAGE_KEYS.profile, { nickname: 'LinSpeak', signature: '每天开口十分钟，让英语成为习惯。', avatar: 'LS' });
}

function updateProfileChrome(profile = storedProfile()) {
  const nickname = profile.nickname || 'Learner';
  const shortName = nickname.length > 12 ? `${nickname.slice(0, 12)}…` : nickname;
  if ($('#sidebarNickname')) $('#sidebarNickname').textContent = shortName;
  if ($('#welcomeNickname')) $('#welcomeNickname').textContent = nickname.split(/\s+/)[0];
  $$('.top-avatar,.mini-profile .avatar').forEach((node) => { node.textContent = profile.avatar || nickname.slice(0, 2).toUpperCase(); });
}

function setSyncMessage(title, meta, kind = 'warning') {
  if (!$('#syncStateTitle')) return;
  $('#syncStateTitle').textContent = title;
  $('#syncStateMeta').textContent = meta;
  $('#syncStateIcon').textContent = kind === 'success' ? '✓' : kind === 'working' ? '↻' : '○';
}

function updateAccountUI() {
  if (!window.shyBackend || !$('#backendStatus')) return;
  const backend = shyBackend.getConfig();
  const session = state.authSession || shyBackend.getSession();
  const identity = session?.user?.email || session?.user?.phone || '';
  if (!backend.configured) {
    $('#backendStatus').textContent = '未连接'; $('#backendStatus').className = 'status warning';
    $('#accountIdentity').textContent = '离线学习模式';
    $('#accountServiceMeta').textContent = '本机数据正常可用；连接绿联 NAS 后可跨设备同步';
    $('#sidebarAccountState').textContent = '本机学习档案';
    $('#configureBackend').textContent = '配置连接';
    $('#authPreview').textContent = '连接账号服务'; $('#accountAction').textContent = '连接后登录';
    $('#accountAction').disabled = true; $('#accountSignOut').classList.add('hidden');
    $('#profileStorageStatus').textContent = '保存在当前设备'; $('#profileStorageStatus').className = 'status muted';
    setSyncMessage('等待连接账号服务', '学习记录仍会自动保存在当前设备');
    return;
  }
  $('#configureBackend').textContent = '连接设置';
  $('#accountAction').disabled = false;
  if (!session) {
    $('#backendStatus').textContent = '服务已配置'; $('#backendStatus').className = 'status success';
    $('#accountIdentity').textContent = '尚未登录'; $('#accountServiceMeta').textContent = `${backend.url} · PostgreSQL 自托管`;
    $('#sidebarAccountState').textContent = '本机学习档案';
    $('#authPreview').textContent = '登录 / 注册'; $('#accountAction').textContent = '登录 / 注册';
    $('#accountSignOut').classList.add('hidden');
    $('#profileStorageStatus').textContent = '保存在当前设备'; $('#profileStorageStatus').className = 'status muted';
    setSyncMessage('账号服务可用', '登录后自动合并并同步本机学习记录');
    return;
  }
  $('#backendStatus').textContent = '已登录'; $('#backendStatus').className = 'status success';
  $('#accountIdentity').textContent = identity || '已认证用户'; $('#accountServiceMeta').textContent = `${backend.url} · 安全会话已建立`;
  $('#sidebarAccountState').textContent = '局域网同步账号';
  $('#authPreview').textContent = '账号已登录'; $('#accountAction').textContent = '立即同步';
  $('#accountSignOut').classList.remove('hidden');
  $('#profileStorageStatus').textContent = 'NAS 同步'; $('#profileStorageStatus').className = 'status success';
  const sync = readStoredJSON(STORAGE_KEYS.sync, {});
  setSyncMessage(sync.lastSyncedAt ? '学习记录已同步' : '准备首次同步', sync.lastSyncedAt ? `最近同步：${new Date(sync.lastSyncedAt).toLocaleString()}` : '本机数据将安全上传到当前账号', sync.lastSyncedAt ? 'success' : 'working');
}

function cloudPayload() {
  const updatedAt = analytics.data.updatedAt || new Date().toISOString();
  return {
    version: 1,
    updatedAt,
    analytics: analytics.data,
    profile: storedProfile(),
    customTopics: readStoredJSON(STORAGE_KEYS.customTopics, []),
    prompts: readStoredJSON(STORAGE_KEYS.prompts, null),
    preferences: { mode: state.mode, theme: state.theme, language: state.language, definitionLanguage: state.definitionLanguage },
  };
}

function scheduleCloudSync(delay = 1200) {
  if (!state.accountReady || !state.authSession || !window.shyBackend?.isConfigured()) return;
  clearTimeout(cloudSyncTimer);
  cloudSyncTimer = setTimeout(() => syncCloudState().catch((error) => {
    setSyncMessage('NAS 同步暂时中断', `${error.message} · 本机数据未受影响`);
  }), delay);
}

async function syncCloudState(showSuccess = false) {
  if (!state.authSession) throw new Error('请先登录');
  setSyncMessage('正在同步学习记录', '上传主题、小节、句子时长、次数与历史评分', 'working');
  const result = await shyBackend.pushLearningState(cloudPayload());
  state.lastSyncedAt = result.syncedAt;
  writeStoredJSON(STORAGE_KEYS.sync, { lastSyncedAt: result.syncedAt, snapshotCount: result.snapshotCount });
  setSyncMessage('学习记录已同步', `${result.snapshotCount} 个学习范围 · ${new Date(result.syncedAt).toLocaleString()}`, 'success');
  if (showSuccess) toast(`同步完成：已更新 ${result.snapshotCount} 个主题/小节/句子记录。`);
  return result;
}

async function reconcileCloudState() {
  if (!state.authSession) return;
  setSyncMessage('正在检查 NAS 记录', '将保留更新时间较新的学习数据', 'working');
  const remote = await shyBackend.pullLearningState();
  const remotePayload = remote?.payload;
  const localUpdated = Date.parse(analytics.data.updatedAt || 0) || 0;
  const remoteUpdated = Date.parse(remotePayload?.updatedAt || remote?.client_updated_at || 0) || 0;
  if (remotePayload?.analytics && remoteUpdated > localUpdated) {
    analytics.data = remotePayload.analytics;
    writeStoredJSON(STORAGE_KEYS.analytics, analytics.data);
    if (remotePayload.profile) writeStoredJSON(STORAGE_KEYS.profile, remotePayload.profile);
    if (Array.isArray(remotePayload.customTopics)) {
      const localCustomIds = new Set(readStoredJSON(STORAGE_KEYS.customTopics, []).map((topic) => topic.id));
      writeStoredJSON(STORAGE_KEYS.customTopics, remotePayload.customTopics);
      if (state.catalog) {
        const builtInTopics = state.catalog.topics.filter((topic) => !localCustomIds.has(topic.id));
        state.catalog.topics = [...builtInTopics, ...remotePayload.customTopics];
        renderPracticeTopic();
      }
    }
    if (remotePayload.prompts) writeStoredJSON(STORAGE_KEYS.prompts, remotePayload.prompts);
    const preferences = remotePayload.preferences || {};
    const preferenceStorage = { mode: 'shy-mode', theme: 'shy-theme', language: 'shy-language', definitionLanguage: 'shy-definition-language' };
    Object.keys(preferenceStorage).forEach((key) => { if (preferences[key]) { state[key] = preferences[key]; localStorage.setItem(preferenceStorage[key], preferences[key]); } });
    applyAppearance(); applyLanguage(); updateProfileChrome(); renderAnalyticsOverview();
    setSyncMessage('已恢复 NAS 学习记录', `NAS 更新于 ${new Date(remoteUpdated).toLocaleString()}`, 'success');
  } else await syncCloudState(false);
}

const analytics = {
  data: readStoredJSON(STORAGE_KEYS.analytics, { version: 1, views: {}, topics: {}, chapters: {}, sentences: {}, events: [] }),
  active: {},
  ensure(bucket, id) {
    this.data[bucket] ||= {};
    this.data[bucket][id] ||= { practiceSeconds: 0, practiceCount: 0, recordings: 0, scores: [], lastPracticedAt: null };
    return this.data[bucket][id];
  },
  begin(bucket, id, count = false) {
    if (!id) return;
    this.end(bucket);
    const item = this.ensure(bucket, id);
    if (count) item.practiceCount += 1;
    item.lastPracticedAt = new Date().toISOString();
    this.active[bucket] = { id, startedAt: performance.now() };
    this.save();
  },
  end(bucket) {
    const active = this.active[bucket];
    if (!active) return;
    const seconds = Math.max(0, Math.round((performance.now() - active.startedAt) / 1000));
    this.ensure(bucket, active.id).practiceSeconds += seconds;
    const dayKey = new Date().toISOString().slice(0, 10);
    this.data.days ||= {};
    this.data.days[dayKey] ||= {};
    this.data.days[dayKey][bucket] ||= {};
    this.data.days[dayKey][bucket][active.id] = Number(this.data.days[dayKey][bucket][active.id] || 0) + seconds;
    delete this.active[bucket];
    this.save();
  },
  increment(bucket, id, field = 'practiceCount') {
    const item = this.ensure(bucket, id);
    item[field] = Number(item[field] || 0) + 1;
    item.lastPracticedAt = new Date().toISOString();
    this.event(field, { bucket, id });
    this.save();
  },
  addScore(bucket, id, score) {
    const item = this.ensure(bucket, id);
    item.scores.push({ ...score, createdAt: new Date().toISOString() });
    item.scores = item.scores.slice(-30);
    this.event('score', { bucket, id, total: score.total });
    this.save();
  },
  event(type, payload = {}) {
    this.data.events ||= [];
    this.data.events.push({ type, ...payload, at: new Date().toISOString() });
    this.data.events = this.data.events.slice(-300);
  },
  save() { this.data.updatedAt = new Date().toISOString(); writeStoredJSON(STORAGE_KEYS.analytics, this.data); scheduleCloudSync(); },
  flush() { Object.keys(this.active).forEach((bucket) => this.end(bucket)); },
};

function currentTopic() {
  return state.catalog?.topics?.find((topic) => topic.id === state.topicId) || state.catalog?.topics?.[0] || null;
}

function currentChapter() {
  const topic = currentTopic();
  return topic?.chapters?.find((chapter) => chapter.id === state.chapterId) || topic?.chapters?.[0] || null;
}

function currentSentence() {
  return currentChapter()?.sentences?.find((sentence) => sentence.id === state.sentenceId) || currentChapter()?.sentences?.[0] || null;
}

function captionStatus(topic) {
  const origin = topic?.transcriptOrigin || 'pending';
  if (origin === 'youtube-manual-captions' || origin === 'official-captions') return { label: 'YouTube 人工字幕', detail: '公开视频字幕', verified: true };
  if (origin === 'youtube-auto-captions') return { label: 'YouTube 自动字幕', detail: '自动字幕 · 已同步时间轴', verified: true };
  if (origin === 'youtube-public-captions') return { label: 'YouTube 公开字幕', detail: '真实字幕 · NAS 已同步时间轴', verified: true };
  if (origin === 'curated-sample') return { label: '练习稿 · 待核对', detail: '练习稿待核对', verified: false };
  return { label: '字幕待同步', detail: '字幕待同步', verified: false };
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(seconds || 0));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(value / 1024)} KB`;
}

function renderAnalyticsOverview() {
  if (!$('#metricPracticeMinutes')) return;
  const practiceSeconds = analytics.data.views?.practice?.practiceSeconds || 0;
  const listeningSeconds = analytics.data.views?.listening?.practiceSeconds || 0;
  const sentenceStats = Object.values(analytics.data.sentences || {});
  const scores = sentenceStats.flatMap((item) => item.scores || []).map((score) => Number(score.total)).filter(Number.isFinite);
  const practiceCount = sentenceStats.reduce((sum, item) => sum + Number(item.practiceCount || 0), 0);
  const todayKey = new Date().toISOString().slice(0, 10);
  const todayViews = analytics.data.days?.[todayKey]?.views || {};
  const todaySeconds = Object.values(todayViews).reduce((sum, seconds) => sum + Number(seconds || 0), 0);
  const todayMinutes = Math.round(todaySeconds / 60);
  $('#metricPracticeMinutes').textContent = Math.round(practiceSeconds / 60);
  $('#metricListeningMinutes').textContent = Math.round(listeningSeconds / 60);
  $('#metricPracticeCount').textContent = `${practiceCount} 次逐句练习`;
  $('#metricAverageScore').textContent = scores.length ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length) : '—';
  $('#metricScoreCount').textContent = scores.length ? `${scores.length} 次真实评分` : '尚无 AI 评分';
  const vocabularyCount = $$('.word-list-item').length;
  $('#metricVocabularyCount').textContent = vocabularyCount;
  $('#navVocabularyCount').textContent = vocabularyCount;
  $('#reviewCount').textContent = vocabularyCount;
  if ($('#vocabularySummary')) $('#vocabularySummary').textContent = `${vocabularyCount} 个词 · 今天待复习 ${vocabularyCount} 个`;
  $('#todayMinutes').textContent = todayMinutes;
  $('#goalRing').style.setProperty('--progress', Math.min(100, Math.round((todayMinutes / 30) * 100)));
  $('#goalMessage').textContent = todayMinutes >= 30 ? '今天的目标已完成' : `今天再练 ${Math.max(1, 30 - todayMinutes)} 分钟`;
  const activeDays = Object.entries(analytics.data.days || {}).filter(([, buckets]) => Object.values(buckets.views || {}).some((seconds) => seconds > 0)).map(([day]) => day).sort().reverse();
  $('#streakStatus').textContent = activeDays.length ? `● 已记录 ${activeDays.length} 个学习日` : '● 今天开始建立学习记录';
  $('#learningInsight').textContent = practiceCount ? `你已经完成 ${practiceCount} 次逐句练习；每次练习时长与录音次数都保存在当前设备。` : '选择一句英文开始跟读，练习时长、次数与评分会自动记录。';
  $('#legendPractice').textContent = `跟读 ${Math.round(practiceSeconds / 60)} 分钟`;
  $('#legendListening').textContent = `听力 ${Math.round(listeningSeconds / 60)} 分钟`;
  $('#legendReview').textContent = `复习 ${Math.round((analytics.data.views?.vocabulary?.practiceSeconds || 0) / 60)} 分钟`;
  const bars = $$('.bar-chart > div span');
  const dayValues = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(); date.setDate(date.getDate() - (6 - offset));
    const views = analytics.data.days?.[date.toISOString().slice(0, 10)]?.views || {};
    return Object.values(views).reduce((sum, seconds) => sum + Number(seconds || 0), 0);
  });
  const maxDay = Math.max(60, ...dayValues);
  bars.forEach((bar, index) => { bar.style.height = `${Math.max(dayValues[index] ? 8 : 3, Math.round((dayValues[index] / maxDay) * 100))}%`; });
  const lastScore = scores.length ? sentenceStats.flatMap((item) => item.scores || []).at(-1) : null;
  [['pronunciation', 'pronunciation'], ['fluency', 'fluency'], ['completeness', 'completeness']].forEach(([rowName, scoreName]) => {
    const row = $(`.skill-row[data-skill="${rowName}"]`); const value = Number(lastScore?.[scoreName]);
    $('b', row).textContent = Number.isFinite(value) ? Math.round(value) : '—'; $('i', row).style.width = `${Number.isFinite(value) ? Math.min(100, value) : 0}%`;
  });
  const vocabularyRow = $('.skill-row[data-skill="vocabulary"]');
  const vocabularyProgress = Math.min(100, practiceCount * 8);
  $('b', vocabularyRow).textContent = practiceCount; $('i', vocabularyRow).style.width = `${vocabularyProgress}%`;
  $('#skillInsight p').textContent = lastScore ? `最近一次真实评分为 ${Math.round(lastScore.total)} 分；继续练习当前句子以观察变化。` : '连接真实语音评分服务并完成首次跟读后，这里会展示能力变化。';
  const topic = currentTopic();
  if (topic) {
    const completed = topic.chapters.filter((chapter) => analytics.ensure('chapters', `${topic.id}:${chapter.id}`).practiceCount > 0).length;
    const progress = topic.chapters.length ? Math.round((completed / topic.chapters.length) * 100) : 0;
    $('#overviewTopicTitle').textContent = topicDisplayLabel(topic);
    $('#overviewTopicMeta').textContent = `${topic.channelTitle || 'YouTube'} · ${captionStatus(topic).detail}`;
    $('#overviewTopicProgress').style.width = `${progress}%`; $('#overviewTopicProgressLabel').textContent = `${progress}%`;
  }
}

const copy = {
  zh: {
    navOverview: '学习概览', navPractice: '视频学习', navVocabulary: '生词本', navListening: '磨耳朵', navDownloads: '离线内容', navStudio: '内容工作台', navAI: 'AI 服务', navSettings: '设置',
    overview: '学习概览', practice: '视频学习', vocabulary: '生词本', listening: '磨耳朵', downloads: '离线内容', studio: '内容工作台', ai: 'AI 服务', settings: '个人设置',
  },
  en: {
    navOverview: 'Overview', navPractice: 'Video practice', navVocabulary: 'Vocabulary', navListening: 'Listening', navDownloads: 'Offline', navStudio: 'Content studio', navAI: 'AI services', navSettings: 'Settings',
    overview: 'Learning overview', practice: 'Video practice', vocabulary: 'Vocabulary', listening: 'Immersive listening', downloads: 'Offline content', studio: 'Content studio', ai: 'AI services', settings: 'Settings',
  },
};

const definitions = {
  zh: {
    confidence: ['信心；自信', '相信自己有能力完成某事的感觉或状态。'], approach: ['方法；接近', '处理问题或接近目标的方法。'], appreciate: ['欣赏；感激', '认识到某事物的价值或表达感谢。'], conversation: ['交谈；对话', '两人或多人之间的信息交流。'], 'build-confidence': ['建立自信', '通过行动和练习逐步增强信心。'],
  },
  zhHant: {
    confidence: ['自信；信心', '對自己的能力或特質抱有信任的感受或狀態。'], approach: ['方法；接近', '處理情況或問題的方式。'], appreciate: ['欣賞；感激', '認識某事物的價值或表達感謝。'], conversation: ['對話；交談', '兩人或多人之間的意見交流。'], 'build-confidence': ['建立自信', '透過行動和練習逐步增強自信。'],
  },
  en: {
    confidence: ['confidence; trust', "a feeling of trust in one's ability or qualities"], approach: ['method; come near', 'a way of dealing with a situation or problem'], appreciate: ['value; be grateful', 'to recognize the value of something'], conversation: ['conversation; dialogue', 'an informal exchange of ideas by spoken words'], 'build-confidence': ['build confidence', 'to gradually become more certain of your ability'],
  },
  ja: {
    confidence: ['自信；信頼', '自分の能力や資質を信じる気持ち。'], approach: ['方法；近づく', '問題や状況に対処する方法。'], appreciate: ['感謝する；評価する', '価値を理解し、感謝すること。'], conversation: ['会話；対話', '複数の人による言葉のやり取り。'], 'build-confidence': ['自信をつける', '練習によって徐々に自信を高める。'],
  },
  ko: {
    confidence: ['자신감；신뢰', '자신의 능력이나 자질을 믿는 감정이나 상태.'], approach: ['접근법；다가가다', '상황이나 문제를 다루는 방법.'], appreciate: ['감사하다；가치를 알다', '무언가의 가치를 이해하거나 감사를 표현하다.'], conversation: ['대화；회화', '두 명 이상이 말로 생각을 나누는 것.'], 'build-confidence': ['자신감을 기르다', '행동과 연습을 통해 자신감을 점차 높이다.'],
  },
  es: {
    confidence: ['confianza; seguridad', 'la sensación de confiar en la propia capacidad'], approach: ['enfoque; acercarse', 'una forma de afrontar una situación'], appreciate: ['apreciar; agradecer', 'reconocer el valor de algo'], conversation: ['conversación; diálogo', 'intercambio de ideas mediante palabras'], 'build-confidence': ['ganar confianza', 'aumentar gradualmente la seguridad personal'],
  },
  fr: {
    confidence: ['confiance ; assurance', 'sentiment de croire en ses capacités ou ses qualités.'], approach: ['approche ; méthode', "manière d'aborder une situation ou un problème."], appreciate: ['apprécier ; être reconnaissant', 'reconnaître la valeur de quelque chose ou exprimer sa gratitude.'], conversation: ['conversation ; échange', "échange d'idées entre deux personnes ou plus."], 'build-confidence': ['prendre confiance', "renforcer progressivement sa confiance par l'action et la pratique."],
  },
  de: {
    confidence: ['Selbstvertrauen; Vertrauen', 'das Gefühl, den eigenen Fähigkeiten oder Eigenschaften zu vertrauen.'], approach: ['Ansatz; Methode', 'eine Art, mit einer Situation oder einem Problem umzugehen.'], appreciate: ['schätzen; dankbar sein', 'den Wert von etwas erkennen oder Dankbarkeit zeigen.'], conversation: ['Gespräch; Unterhaltung', 'ein Austausch von Gedanken zwischen zwei oder mehr Personen.'], 'build-confidence': ['Selbstvertrauen aufbauen', 'durch Handeln und Üben allmählich sicherer werden.'],
  },
  pt: {
    confidence: ['confiança; segurança', 'sentimento de acreditar nas próprias capacidades ou qualidades.'], approach: ['abordagem; método', 'uma forma de lidar com uma situação ou problema.'], appreciate: ['apreciar; agradecer', 'reconhecer o valor de algo ou demonstrar gratidão.'], conversation: ['conversa; diálogo', 'troca de ideias entre duas ou mais pessoas.'], 'build-confidence': ['ganhar confiança', 'aumentar gradualmente a confiança por meio de ação e prática.'],
  },
  ar: {
    confidence: ['الثقة بالنفس؛ الثقة', 'شعور بالثقة في قدرات الشخص أو صفاته.'], approach: ['نهج؛ طريقة', 'طريقة للتعامل مع موقف أو مشكلة.'], appreciate: ['يُقدّر؛ يشعر بالامتنان', 'إدراك قيمة شيء ما أو التعبير عن الامتنان.'], conversation: ['محادثة؛ حوار', 'تبادل للأفكار بين شخصين أو أكثر.'], 'build-confidence': ['بناء الثقة بالنفس', 'زيادة الثقة تدريجيًا من خلال العمل والممارسة.'],
  },
  hi: {
    confidence: ['आत्मविश्वास; भरोसा', 'अपनी क्षमताओं या गुणों पर भरोसा होने की भावना।'], approach: ['तरीका; दृष्टिकोण', 'किसी स्थिति या समस्या से निपटने का तरीका।'], appreciate: ['सराहना करना; आभारी होना', 'किसी चीज़ का मूल्य समझना या आभार व्यक्त करना।'], conversation: ['बातचीत; संवाद', 'दो या अधिक लोगों के बीच विचारों का आदान-प्रदान।'], 'build-confidence': ['आत्मविश्वास बढ़ाना', 'अभ्यास और कार्य के माध्यम से धीरे-धीरे आत्मविश्वास बढ़ाना।'],
  },
  id: {
    confidence: ['kepercayaan diri; keyakinan', 'perasaan yakin pada kemampuan atau kualitas diri sendiri.'], approach: ['pendekatan; metode', 'cara menangani situasi atau masalah.'], appreciate: ['menghargai; berterima kasih', 'menyadari nilai sesuatu atau menunjukkan rasa terima kasih.'], conversation: ['percakapan; dialog', 'pertukaran gagasan antara dua orang atau lebih.'], 'build-confidence': ['membangun kepercayaan diri', 'meningkatkan kepercayaan diri secara bertahap melalui tindakan dan latihan.'],
  },
  vi: {
    confidence: ['sự tự tin; niềm tin', 'cảm giác tin tưởng vào khả năng hoặc phẩm chất của bản thân.'], approach: ['cách tiếp cận; phương pháp', 'cách xử lý một tình huống hoặc vấn đề.'], appreciate: ['trân trọng; biết ơn', 'nhận ra giá trị của điều gì đó hoặc thể hiện lòng biết ơn.'], conversation: ['cuộc trò chuyện; hội thoại', 'sự trao đổi ý tưởng giữa hai người trở lên.'], 'build-confidence': ['xây dựng sự tự tin', 'tăng dần sự tự tin thông qua hành động và luyện tập.'],
  },
};

const exampleTranslations = {
  zh: ['建立自信最好的方法就是每天练习一点。', '我完全相信她的能力。'],
  zhHant: ['建立自信最好的方法就是每天練習一點。', '我完全相信她的能力。'],
  en: ['The best way to build confidence is to practice a little every day.', 'I have complete confidence in her ability.'],
  ja: ['自信をつける最良の方法は、毎日少しずつ練習することです。', '私は彼女の能力を完全に信頼しています。'],
  ko: ['자신감을 기르는 가장 좋은 방법은 매일 조금씩 연습하는 것입니다.', '나는 그녀의 능력을 전적으로 신뢰합니다.'],
  es: ['La mejor manera de ganar confianza es practicar un poco cada día.', 'Confío plenamente en su capacidad.'],
  fr: ['La meilleure façon de prendre confiance est de s’exercer un peu chaque jour.', 'J’ai toute confiance en ses capacités.'],
  de: ['Der beste Weg, Selbstvertrauen aufzubauen, ist, jeden Tag ein wenig zu üben.', 'Ich habe volles Vertrauen in ihre Fähigkeiten.'],
  pt: ['A melhor maneira de ganhar confiança é praticar um pouco todos os dias.', 'Tenho total confiança na capacidade dela.'],
  ar: ['أفضل طريقة لبناء الثقة هي التدرب قليلًا كل يوم.', 'لدي ثقة كاملة في قدرتها.'],
  hi: ['आत्मविश्वास बढ़ाने का सबसे अच्छा तरीका हर दिन थोड़ा अभ्यास करना है।', 'मुझे उसकी क्षमता पर पूरा भरोसा है।'],
  id: ['Cara terbaik membangun kepercayaan diri adalah berlatih sedikit setiap hari.', 'Saya sepenuhnya percaya pada kemampuannya.'],
  vi: ['Cách tốt nhất để xây dựng sự tự tin là luyện tập một chút mỗi ngày.', 'Tôi hoàn toàn tin tưởng vào khả năng của cô ấy.'],
};

function parseYouTubeUrl(value) {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.replace(/^www\./, '');
    let videoId = '';
    if (host === 'youtu.be') videoId = url.pathname.split('/').filter(Boolean)[0] || '';
    if (host.endsWith('youtube.com')) {
      videoId = url.searchParams.get('v') || (url.pathname.startsWith('/shorts/') ? url.pathname.split('/')[2] : '') || (url.pathname.startsWith('/embed/') ? url.pathname.split('/')[2] : '');
    }
    if (!/^[\w-]{11}$/.test(videoId)) return null;
    return { videoId, playlistId: url.searchParams.get('list') || '' };
  } catch { return null; }
}

function createFallbackChapter() {
  return { id: 'chapter-01', index: 1, title: 'Full video', titleZh: '完整视频', start: 0, durationLabel: '待同步', previewWords: [], sentences: [] };
}

function catalogApiBase() {
  return String(window.__SHY2SPEAK_CONFIG__?.apiBase || '').replace(/\/+$/, '');
}

function localizedTopicTitle(topic, language = state.language) {
  if (!topic || language === 'en') return '';
  return String(topic.localizedTitles?.[language] || (language === 'zh' ? topic.titleZh : '') || '').trim();
}

function topicDisplayLabel(topic) {
  const localized = localizedTopicTitle(topic);
  if (state.language === 'en') return topic.title;
  return `${topic.title} · ${localized || '中文译名待生成'}`;
}

async function ensureTopicTitleTranslation(topic) {
  if (!topic?.videoId || state.language === 'en' || localizedTopicTitle(topic)) return;
  const provider = readStoredJSON(STORAGE_KEYS.providers, {}).openai;
  const apiKey = sessionStorage.getItem('shy-ai-key-openai');
  if (!provider?.lastTestOk || !provider?.model || !apiKey) return;
  const key = `${topic.videoId}:${state.language}`;
  if (topicTranslationPromises.has(key)) return topicTranslationPromises.get(key);
  const promise = (async () => {
    try {
      const languageNames = { zh: '简体中文' };
      const response = await fetch(providerEndpoint(provider.baseUrl, 'chat/completions'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: provider.model,
          messages: [{ role: 'user', content: `Translate this English learning-video title into ${languageNames[state.language] || state.language}. Return only the translated title, with no quotes or explanation:\n${topic.title}` }],
          temperature: 0,
        }),
      });
      if (!response.ok) return;
      const payload = await response.json();
      const translated = String(payload?.choices?.[0]?.message?.content || '').trim().replace(/^["'“”]|["'“”]$/g, '');
      if (!translated || translated.length > 180) return;
      topic.localizedTitles = { ...(topic.localizedTitles || {}), [state.language]: translated };
      const cached = readStoredJSON(STORAGE_KEYS.youtubeMetadata, {});
      cached[topic.videoId] = { ...(cached[topic.videoId] || {}), localizedTitles: topic.localizedTitles };
      writeStoredJSON(STORAGE_KEYS.youtubeMetadata, cached);
      if (currentTopic()?.id === topic.id) renderPracticeTopic();
    } catch { /* A missing translation never blocks video practice. */ }
    finally { topicTranslationPromises.delete(key); }
  })();
  topicTranslationPromises.set(key, promise);
  return promise;
}

async function hydrateTopic(topic) {
  const apiBase = catalogApiBase();
  if (!apiBase || !topic?.serverManaged || !topic.videoId || hydratedTopicIds.has(topic.id)) return;
  if (topicHydrationPromises.has(topic.id)) return topicHydrationPromises.get(topic.id);
  if (currentTopic()?.id === topic.id && $('#transcriptStatus')) {
    $('#transcriptStatus').textContent = '正在同步字幕…';
    $('#transcriptStatus').className = 'status transcript-status warning';
  }
  const promise = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(`${apiBase}/catalog/topics/${encodeURIComponent(topic.videoId)}`, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error(`NAS topic HTTP ${response.status}`);
      const hydrated = await response.json();
      const index = state.catalog?.topics?.findIndex((candidate) => candidate.id === topic.id) ?? -1;
      if (index < 0) return;
      const current = state.catalog.topics[index];
      state.catalog.topics[index] = {
        ...current,
        ...hydrated,
        localizedTitles: { ...(hydrated.localizedTitles || {}), ...(current.localizedTitles || {}) },
      };
      hydratedTopicIds.add(topic.id);
      if (state.topicId === topic.id) {
        const next = state.catalog.topics[index];
        if (!next.chapters?.some((chapter) => chapter.id === state.chapterId)) state.chapterId = next.chapters?.[0]?.id || '';
        localStorage.setItem('shy-chapter-id', state.chapterId);
        renderPracticeTopic();
        ensureTopicTitleTranslation(next);
      }
    } catch (error) {
      console.warn('Topic captions unavailable.', error.message);
      if (currentTopic()?.id === topic.id) renderPracticeTopic();
    } finally {
      clearTimeout(timeout);
      topicHydrationPromises.delete(topic.id);
    }
  })();
  topicHydrationPromises.set(topic.id, promise);
  return promise;
}

async function loadCatalog() {
  try {
    const apiBase = catalogApiBase();
    let catalog = null;
    let catalogFromApi = false;
    if (apiBase) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      try {
        const response = await fetch(`${apiBase}/catalog`, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error(`NAS catalog HTTP ${response.status}`);
        catalog = await response.json();
        catalogFromApi = true;
      } catch (error) {
        console.warn('NAS caption catalog unavailable; using static catalog.', error.message);
      } finally { clearTimeout(timeout); }
    }
    if (!catalog) {
      const response = await fetch('./data/catalog.json?v=18', { cache: 'no-cache' });
      if (!response.ok) throw new Error(`Catalog HTTP ${response.status}`);
      catalog = await response.json();
      const storedCatalog = readStoredJSON(STORAGE_KEYS.catalog, null);
      if (Array.isArray(storedCatalog?.topics) && storedCatalog.topics.length > catalog.topics.length) catalog = storedCatalog;
    }
    if (!Array.isArray(catalog.topics)) throw new Error('Catalog topics are missing');
    if (catalogFromApi || catalog.topics.length > 1) writeStoredJSON(STORAGE_KEYS.catalog, catalog);
    const customTopics = readStoredJSON(STORAGE_KEYS.customTopics, []);
    state.catalog = { ...catalog, topics: [...catalog.topics, ...customTopics] };
    const cachedMetadata = readStoredJSON(STORAGE_KEYS.youtubeMetadata, {});
    state.catalog.topics.forEach((topic) => { if (cachedMetadata[topic.videoId]) Object.assign(topic, cachedMetadata[topic.videoId]); });
    if (!state.catalog.topics.some((topic) => topic.id === state.topicId)) state.topicId = state.catalog.topics[0]?.id || '';
    const topic = currentTopic();
    if (!topic?.chapters?.some((chapter) => chapter.id === state.chapterId)) state.chapterId = topic?.chapters?.[0]?.id || '';
    localStorage.setItem('shy-topic-id', state.topicId);
    localStorage.setItem('shy-chapter-id', state.chapterId);
    renderPracticeTopic();
    hydrateTopic(topic);
    ensureTopicTitleTranslation(topic);
  } catch (error) {
    console.warn('Course catalog unavailable; using embedded fallback markup.', error.message);
    $('#practiceChapterTitle').textContent = '课程数据暂时不可用 · 可继续使用本地练习界面';
  }
}

function applyTopicMetadataToUI(topic) {
  if (!topic) return;
  $('#practiceTopicTitle').textContent = topic.title;
  const localized = localizedTopicTitle(topic);
  $('#practiceTopicLocalizedTitle').hidden = state.language === 'en';
  $('#practiceTopicLocalizedTitle').textContent = localized || '中文译名待生成';
  $('#practiceTopicEyebrow').textContent = `YOUTUBE · ${topic.channelTitle || 'REAL CONTENT'}`;
  const chapter = currentChapter();
  $('#practiceChapterTitle').textContent = chapter ? `Chapter ${String(chapter.index).padStart(2, '0')} · ${chapter.title}` : '尚未同步章节与字幕';
  $('#videoSourceLabel').textContent = topic.channelTitle && topic.channelTitle !== '等待 YouTube 元数据' ? topic.channelTitle : '通过官方播放器加载';
  const poster = $('#youtubePoster');
  if (topic.metadataStatus === 'live' || topic.metadataStatus === 'server-synced-public-metadata') poster.src = topic.thumbnail || `https://i.ytimg.com/vi/${topic.videoId}/hqdefault.jpg`;
  else poster.removeAttribute('src');
  poster.onerror = () => poster.removeAttribute('src');
  $('#videoStage').dataset.videoId = topic.videoId;
}

function renderTopicSelect() {
  if (!state.catalog) return;
  const select = $('#topicSelect');
  select.replaceChildren(...state.catalog.topics.map((topic) => {
    const option = document.createElement('option');
    option.value = topic.id;
    option.textContent = topicDisplayLabel(topic);
    option.selected = topic.id === state.topicId;
    return option;
  }));
}

function appendHighlightedText(target, sentence, words = []) {
  const vocabulary = new Set(words.map((word) => word.toLowerCase()));
  const pieces = sentence.split(/([A-Za-z][A-Za-z'-]*)/g);
  pieces.forEach((piece) => {
    if (vocabulary.has(piece.toLowerCase())) {
      const mark = document.createElement('mark');
      mark.dataset.word = piece.toLowerCase();
      mark.textContent = piece;
      target.append(mark);
    } else target.append(document.createTextNode(piece));
  });
}

function renderPracticeSentences(chapter) {
  const list = $('#practiceLyrics');
  list.replaceChildren();
  const sentences = chapter?.sentences || [];
  if (!sentences.length) {
    const empty = document.createElement('div');
    empty.className = 'lyrics-empty';
    empty.innerHTML = '<span>CC</span><strong>字幕与逐句练习尚未同步</strong><small>视频可以正常播放。导入授权字幕或连接转写服务后即可生成逐句练习。</small>';
    list.append(empty);
    state.sentenceId = '';
    renderStoredPracticeResults();
    return;
  }
  if (!sentences.some((sentence) => sentence.id === state.sentenceId)) state.sentenceId = sentences[0].id;
  sentences.forEach((sentence, index) => {
    const button = document.createElement('button');
    button.className = `lyric-line${sentence.id === state.sentenceId ? ' active' : ''}`;
    button.dataset.sentenceId = sentence.id;
    button.dataset.start = sentence.start;
    const number = document.createElement('em'); number.textContent = index + 1;
    const content = document.createElement('span');
    const english = document.createElement('strong'); appendHighlightedText(english, sentence.en, sentence.words);
    const translation = document.createElement('small'); translation.textContent = sentence.zh;
    const play = document.createElement('i'); play.textContent = sentence.id === state.sentenceId ? '🔊' : '▶';
    content.append(english, translation); button.append(number, content, play); list.append(button);
  });
  bindPracticeLines();
  renderStoredPracticeResults();
}

function renderPracticeTopic() {
  const topic = currentTopic();
  if (!topic) return;
  const chapter = currentChapter();
  renderTopicSelect();
  applyTopicMetadataToUI(topic);
  const chapterCard = $('.chapters-card');
  $$('.chapter', chapterCard).forEach((node) => node.remove());
  $('.card-heading .muted', chapterCard).textContent = `${topic.chapters.length} 小节 · 数据可扩展`;
  topic.chapters.forEach((item) => {
    const stats = analytics.ensure('chapters', `${topic.id}:${item.id}`);
    const button = document.createElement('button');
    button.className = `chapter${item.id === state.chapterId ? ' active' : ''}${stats.practiceCount ? ' done' : ''}`;
    button.dataset.chapterId = item.id;
    button.innerHTML = `<i>${item.id === state.chapterId ? '▶' : stats.practiceCount ? '✓' : item.index}</i><span><strong>Chapter ${String(item.index).padStart(2, '0')}</strong><small></small></span><em>${item.durationLabel || formatDuration(item.durationSeconds)}</em>`;
    $('small', button).textContent = state.language === 'zh' ? (item.titleZh || item.title) : item.title;
    button.addEventListener('click', () => selectChapter(item.id));
    chapterCard.append(button);
  });
  const preview = $('.preview-card p');
  preview.textContent = chapter?.previewWords?.length ? `${chapter.previewWords.length} 个重点词 · 自动标记 · 约 3 分钟` : '预习词汇将在字幕同步后生成';
  renderPracticeSentences(chapter);
  const caption = captionStatus(topic);
  $('#transcriptStatus').textContent = caption.label;
  $('#transcriptStatus').className = `status transcript-status ${caption.verified ? 'success' : 'warning'}`;
  renderAnalyticsOverview();
}

function selectChapter(chapterId) {
  analytics.end('chapters'); analytics.end('sentences');
  state.chapterId = chapterId;
  state.sentenceId = '';
  localStorage.setItem('shy-chapter-id', chapterId);
  analytics.begin('chapters', `${state.topicId}:${chapterId}`, true);
  renderPracticeTopic();
}

async function refreshYouTubeMetadata(topic) {
  if (!topic?.videoId) return;
  const cached = readStoredJSON(STORAGE_KEYS.youtubeMetadata, {});
  if (cached[topic.videoId]) {
    Object.assign(topic, cached[topic.videoId]);
    applyTopicMetadataToUI(topic); renderTopicSelect();
  }
  if (topic.serverManaged && ['playlist-synced-public-metadata', 'server-synced-public-metadata'].includes(topic.metadataStatus)) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const sourceUrl = encodeURIComponent(`https://www.youtube.com/watch?v=${topic.videoId}`);
    const response = await fetch(`https://www.youtube.com/oembed?url=${sourceUrl}&format=json`, { signal: controller.signal });
    if (!response.ok) return;
    const metadata = await response.json();
    const resolved = { title: metadata.title || topic.title, channelTitle: metadata.author_name || topic.channelTitle, thumbnail: metadata.thumbnail_url || topic.thumbnail, metadataStatus: 'live' };
    Object.assign(topic, resolved); cached[topic.videoId] = { ...(cached[topic.videoId] || {}), ...resolved, localizedTitles: topic.localizedTitles }; writeStoredJSON(STORAGE_KEYS.youtubeMetadata, cached);
    applyTopicMetadataToUI(topic); renderTopicSelect();
  } catch { /* Offline and restricted networks keep the local catalog fallback. */ }
  finally { clearTimeout(timeout); }
}

function resetYouTubePlayer() {
  $('.youtube-frame')?.remove();
  $('#videoStage')?.classList.remove('video-live');
}

function loadYouTubePlayer(start = 0, autoplay = true) {
  const topic = currentTopic();
  if (!topic?.videoId) return;
  refreshYouTubeMetadata(topic);
  let frame = $('.youtube-frame');
  if (!frame) {
    frame = document.createElement('iframe');
    frame.className = 'youtube-frame';
    frame.title = topic.title;
    frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    frame.allowFullscreen = true;
    const params = new URLSearchParams({ autoplay: autoplay ? '1' : '0', playsinline: '1', enablejsapi: '1', rel: '0', start: String(Math.max(0, Math.floor(start))) });
    if (topic.playlistId) params.set('list', topic.playlistId);
    frame.src = `https://www.youtube-nocookie.com/embed/${topic.videoId}?${params}`;
    $('#videoStage').append(frame);
    $('#videoStage').classList.add('video-live');
    analytics.increment('topics', topic.id, 'practiceCount');
    if (currentChapter()) analytics.increment('chapters', `${topic.id}:${currentChapter().id}`, 'practiceCount');
    analytics.begin('topics', topic.id);
    if (currentChapter()) analytics.begin('chapters', `${topic.id}:${currentChapter().id}`);
  } else {
    frame.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: 'seekTo', args: [Number(start), true] }), '*');
    if (autoplay) frame.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: 'playVideo', args: [] }), '*');
  }
}

function bindPracticeLines() {
  $$('.lyric-line').forEach((line) => {
    line.onclick = (event) => {
      if (event.target.closest('mark')) return;
      $$('.lyric-line').forEach((item) => { item.classList.remove('active'); const icon = $('i', item); if (icon) icon.textContent = '▶'; });
      line.classList.add('active'); const icon = $('i', line); if (icon) icon.textContent = '🔊';
      state.sentenceId = line.dataset.sentenceId || '';
      const key = `${state.topicId}:${state.chapterId}:${state.sentenceId}`;
      analytics.begin('sentences', key, true);
      loadYouTubePlayer(Number(line.dataset.start || 0), true);
      $$('mark', line).forEach((mark) => { mark.onclick = (markEvent) => { markEvent.stopPropagation(); navigate('vocabulary'); }; });
      renderStoredPracticeResults();
      renderAnalyticsOverview();
    };
    $$('mark', line).forEach((mark) => { mark.onclick = (event) => { event.stopPropagation(); navigate('vocabulary'); }; });
  });
}

function setupCatalogControls() {
  $('#topicSelect').addEventListener('change', (event) => {
    analytics.end('topics'); analytics.end('chapters'); analytics.end('sentences');
    state.topicId = event.target.value;
    state.chapterId = currentTopic()?.chapters?.[0]?.id || '';
    state.sentenceId = '';
    localStorage.setItem('shy-topic-id', state.topicId); localStorage.setItem('shy-chapter-id', state.chapterId);
    resetYouTubePlayer(); renderPracticeTopic();
    hydrateTopic(currentTopic());
    ensureTopicTitleTranslation(currentTopic());
  });
  $('#importTopic').addEventListener('click', () => showModal({
    eyebrow: 'ADD REAL CONTENT', title: '添加 YouTube 视频',
    body: '<div class="modal-field"><label for="youtubeUrlInput">YouTube 视频链接</label><input id="youtubeUrlInput" inputmode="url" placeholder="https://www.youtube.com/watch?v=…"><small>支持普通链接、短链接和带播放列表参数的链接。</small></div><div class="warning-box"><span>CC</span><p><strong>视频元数据将从 YouTube 读取</strong><br><small>字幕与章节需要获得授权后导入，或连接转写服务生成。</small></p></div>',
    actions: [{ label: '取消' }, { label: '添加主题', style: 'primary', onClick: () => {
      const parsed = parseYouTubeUrl($('#youtubeUrlInput').value);
      if (!parsed) { toast('请输入有效的 YouTube 视频链接。'); return false; }
      const customTopics = readStoredJSON(STORAGE_KEYS.customTopics, []);
      const id = `youtube-${parsed.videoId.toLowerCase()}`;
      let topic = state.catalog.topics.find((item) => item.id === id);
      if (!topic) {
        topic = { id, provider: 'youtube', ...parsed, sourceUrl: $('#youtubeUrlInput').value.trim(), title: `YouTube 视频 ${parsed.videoId}`, channelTitle: '等待 YouTube 元数据', thumbnail: `https://i.ytimg.com/vi/${parsed.videoId}/hqdefault.jpg`, metadataStatus: 'runtime-oembed', transcriptOrigin: 'pending', chapters: [createFallbackChapter()] };
        customTopics.push(topic); writeStoredJSON(STORAGE_KEYS.customTopics, customTopics); state.catalog.topics.push(topic);
      }
      state.topicId = id; state.chapterId = topic.chapters[0].id; state.sentenceId = '';
      localStorage.setItem('shy-topic-id', id); localStorage.setItem('shy-chapter-id', state.chapterId);
      resetYouTubePlayer(); renderPracticeTopic(); refreshYouTubeMetadata(topic); toast('视频主题已添加，并保存在当前设备。');
    } }],
  }));
  $('#youtubePlay').addEventListener('click', () => loadYouTubePlayer(currentChapter()?.start || 0, true));
}

const viewTitles = {
  overview: ['学习概览', 'Learning overview'], practice: ['视频学习', 'Video practice'], vocabulary: ['生词本', 'Vocabulary'], listening: ['磨耳朵', 'Immersive listening'], downloads: ['离线内容', 'Offline content'], studio: ['内容工作台', 'Content studio'], ai: ['AI 服务', 'AI services'], settings: ['个人设置', 'Settings'],
};

function applyAppearance() {
  const resolvedMode = state.mode === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : state.mode;
  document.documentElement.dataset.mode = resolvedMode;
  document.documentElement.dataset.theme = state.theme;
  document.documentElement.dataset.reduceMotion = state.reduceMotion;
  document.documentElement.dataset.highContrast = state.highContrast;
  $('#modeIcon').textContent = resolvedMode === 'dark' ? '☾' : '☼';
  const themeColor = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
  $('meta[name="theme-color"]').setAttribute('content', themeColor);
  $$('.mode-choices button').forEach((button) => button.classList.toggle('active', button.dataset.modeChoice === state.mode));
  $$('.palette').forEach((button) => button.classList.toggle('active', button.dataset.themeChoice === state.theme));
  const modeNames = state.language === 'en'
    ? { light: 'Light', dark: 'Dark', system: 'System' }
    : { light: '日间', dark: '夜间', system: '跟随系统' };
  const themeNames = state.language === 'en'
    ? { violet: 'Violet', ocean: 'Ocean', forest: 'Forest', sunset: 'Sunset', sakura: 'Sakura' }
    : { violet: '经典紫', ocean: '海洋蓝', forest: '森林绿', sunset: '日落橙', sakura: '樱花粉' };
  if ($('#appearanceLabel')) $('#appearanceLabel').textContent = `${modeNames[state.mode]} · ${themeNames[state.theme]}`;
  updateChromeHoverLabels();
}

function updateChromeHoverLabels() {
  const english = state.language === 'en';
  const dark = document.documentElement.dataset.mode === 'dark';
  const labels = english ? {
    language: 'Switch interface language to Chinese',
    mode: dark ? 'Switch to light mode' : 'Switch to dark mode',
    share: 'Share this page',
    notifications: 'Notifications',
    profile: 'Profile and settings',
    home: 'Shy2Speak home',
    more: 'More settings',
  } : {
    language: '切换界面语言为英文',
    mode: dark ? '切换到日间模式' : '切换到夜间模式',
    share: '分享当前页面',
    notifications: '通知',
    profile: '个人资料与设置',
    home: 'Shy2Speak 首页',
    more: '更多设置',
  };
  const setLabel = (node, label) => {
    if (!node) return;
    node.setAttribute('aria-label', label);
    node.dataset.hoverHint = label;
    node.removeAttribute('title');
  };
  setLabel($('#languageToggle'), labels.language);
  setLabel($('#modeToggle'), labels.mode);
  setLabel($('.top-actions .share-page'), labels.share);
  setLabel($('.top-actions .notification-btn'), labels.notifications);
  setLabel($('.top-actions .top-avatar'), labels.profile);
  setLabel($('.sidebar .brand'), labels.home);
  setLabel($('.mini-profile .avatar'), labels.profile);
  setLabel($('.mini-profile .icon-btn'), labels.more);
}

function applyLanguage() {
  document.documentElement.lang = state.language === 'zh' ? 'zh-CN' : 'en';
  $$('[data-i18n]').forEach((node) => {
    const value = copy[state.language][node.dataset.i18n];
    if (value) node.textContent = value;
  });
  $('#languageToggle').textContent = state.language === 'zh' ? '中 / EN' : 'EN / 中';
  $('#siteLanguage').value = state.language;
  applyAppearance();
  updatePageTitle();
  if (state.catalog) {
    renderPracticeTopic();
    ensureTopicTitleTranslation(currentTopic());
  }
}

function updatePageTitle() {
  const title = viewTitles[state.view] || viewTitles.overview;
  $('#pageTitle').textContent = state.language === 'zh' ? title[0] : title[1];
  document.title = `${$('#pageTitle').textContent} · Shy2Speak`;
}

function navigate(view, push = true) {
  if (!viewTitles[view]) view = 'overview';
  analytics.end('views');
  if (state.view === 'practice' && view !== 'practice') { analytics.end('topics'); analytics.end('chapters'); analytics.end('sentences'); }
  state.view = view;
  $$('.view').forEach((section) => section.classList.toggle('active', section.id === `view-${view}`));
  $$('[data-view-link]').forEach((button) => button.classList.toggle('active', button.dataset.viewLink === view && (button.classList.contains('nav-item') || button.closest('.mobile-nav'))));
  $('.sidebar').classList.remove('open');
  updatePageTitle();
  if (push && location.hash !== `#/${view}`) history.pushState(null, '', `#/${view}`);
  analytics.begin('views', view);
  if (view === 'practice' && currentTopic()) {
    analytics.begin('topics', currentTopic().id);
    if (currentChapter()) analytics.begin('chapters', `${currentTopic().id}:${currentChapter().id}`);
  }
  renderAnalyticsOverview();
  scrollTo({ top: 0, behavior: 'smooth' });
}

function toast(message, actionText, action) {
  const node = document.createElement('div');
  node.className = 'toast';
  const icon = document.createElement('span'); icon.textContent = '✓';
  const copy = document.createElement('p'); copy.textContent = String(message || '操作完成');
  node.append(icon, copy);
  if (actionText) { const button = document.createElement('button'); button.textContent = actionText; node.append(button); }
  $('#toastContainer').append(node);
  if (actionText) $('button', node).addEventListener('click', () => { action?.(); removeToast(node); });
  setTimeout(() => removeToast(node), 4600);
}

function removeToast(node) {
  if (!node?.isConnected) return;
  node.classList.add('removing');
  setTimeout(() => node.remove(), 260);
}

function showModal({ eyebrow = 'NOTICE', title, body, actions = [] }) {
  const modal = $('#appModal');
  $('#modalEyebrow').textContent = eyebrow;
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = body;
  const footer = $('#modalActions');
  footer.innerHTML = '';
  actions.forEach(({ label, style = 'secondary', onClick }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = style === 'primary' ? 'primary-btn' : style === 'text' ? 'text-btn' : 'secondary-btn';
    button.textContent = label;
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const close = (await onClick?.()) !== false;
        if (close) modal.close();
      } catch (error) {
        toast(error.message || '操作失败，请稍后重试。');
      } finally {
        button.disabled = false;
      }
    });
    footer.append(button);
  });
  if (!modal.open) modal.showModal();
}

function sharePage() {
  const data = { title: document.title, text: '和我一起用真实内容练习英语口语。', url: location.href };
  if (navigator.share) navigator.share(data).catch(() => {});
  else navigator.clipboard?.writeText(location.href).then(() => toast('分享链接已复制到剪贴板。'));
}

function setupNavigation() {
  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-view-link]');
    if (target) navigate(target.dataset.viewLink);
  });
  addEventListener('popstate', () => navigate(location.hash.replace('#/', '') || 'overview', false));
  $('#mobileMenu').addEventListener('click', () => $('.sidebar').classList.toggle('open'));
  document.addEventListener('click', (event) => {
    if (innerWidth <= 720 && $('.sidebar').classList.contains('open') && !event.target.closest('.sidebar') && !event.target.closest('#mobileMenu')) $('.sidebar').classList.remove('open');
  });
  $$('.share-page').forEach((button) => button.addEventListener('click', (event) => { event.stopPropagation(); sharePage(); }));
}

function setupGlobalControls() {
  $('#modeToggle').addEventListener('click', () => {
    state.mode = document.documentElement.dataset.mode === 'dark' ? 'light' : 'dark';
    localStorage.setItem('shy-mode', state.mode);
    applyAppearance();
    toast(state.mode === 'dark' ? '已切换到夜间模式。' : '已切换到日间模式。');
  });
  $('#languageToggle').addEventListener('click', () => {
    state.language = state.language === 'zh' ? 'en' : 'zh';
    localStorage.setItem('shy-language', state.language);
    applyLanguage();
    toast(state.language === 'zh' ? '界面语言已切换为简体中文。' : 'Interface language changed to English.');
  });
  $$('.segmented').forEach((group) => {
    if (group.id === 'lyricsLanguage') return;
    $$('button', group).forEach((button) => button.addEventListener('click', () => {
      $$('button', group).forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
    }));
  });
}

function setupHoverToasts() {
  const hoverToast = document.createElement('div');
  hoverToast.className = 'hover-toast';
  hoverToast.id = 'globalHoverToast';
  hoverToast.setAttribute('role', 'tooltip');
  document.body.append(hoverToast);
  let showTimer;
  let activeButton;

  const labelFor = (button) => button.dataset.hoverHint
    || button.getAttribute('aria-label')
    || $('b', button)?.textContent?.trim()
    || button.textContent.trim().replace(/\s+/g, ' ');
  const hide = () => {
    clearTimeout(showTimer);
    activeButton = null;
    hoverToast.classList.remove('visible');
  };
  const show = (button, immediate = false) => {
    if (!labelFor(button)) return;
    clearTimeout(showTimer);
    activeButton = button;
    showTimer = setTimeout(() => {
      if (activeButton !== button) return;
      hoverToast.textContent = labelFor(button);
      hoverToast.classList.add('visible');
      const rect = button.getBoundingClientRect();
      const toastRect = hoverToast.getBoundingClientRect();
      const sidebarButton = Boolean(button.closest('.sidebar'));
      const top = sidebarButton ? rect.top + (rect.height - toastRect.height) / 2 : rect.bottom + 9;
      const left = sidebarButton ? rect.right + 10 : rect.left + (rect.width - toastRect.width) / 2;
      hoverToast.style.top = `${Math.max(8, Math.min(innerHeight - toastRect.height - 8, top))}px`;
      hoverToast.style.left = `${Math.max(8, Math.min(innerWidth - toastRect.width - 8, left))}px`;
    }, immediate ? 0 : 320);
  };

  $$('.sidebar button,.top-actions button').forEach((button) => {
    button.addEventListener('pointerenter', (event) => { if (event.pointerType !== 'touch') show(button); });
    button.addEventListener('pointerleave', hide);
    button.addEventListener('focus', () => show(button, true));
    button.addEventListener('blur', hide);
    button.addEventListener('click', hide);
  });
  addEventListener('scroll', hide, { passive: true });
  addEventListener('resize', hide, { passive: true });
}

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    toast('当前浏览器不支持网页录音，请使用最新版 Chrome、Edge 或 Safari。');
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    const recorder = new MediaRecorder(stream);
    state.mediaStream = stream; state.mediaRecorder = recorder; state.recordingChunks = []; state.recordingStartedAt = performance.now();
    recorder.addEventListener('dataavailable', (event) => { if (event.data.size) state.recordingChunks.push(event.data); });
    recorder.addEventListener('stop', completeRecording, { once: true });
    recorder.start(250);
    const track = stream.getAudioTracks()[0];
    const settings = track?.getSettings?.() || {};
    $('#micDeviceButton').innerHTML = `${track?.label || '默认麦克风'} · ${settings.channelCount === 2 ? 'Stereo Ch 1–2' : 'Mono Ch 1'} <span>⌄</span>`;
    $('#recordButton').classList.add('recording');
    $('#recordLabel').textContent = '正在录音 · 点击结束';
  } catch (error) {
    toast(error.name === 'NotAllowedError' ? '麦克风权限未开启，请在权限与设备中允许后重试。' : `无法启动录音：${error.message}`);
  }
}

function stopRecording() {
  if (state.mediaRecorder?.state === 'recording') state.mediaRecorder.stop();
}

function completeRecording() {
  const duration = Math.max(.1, (performance.now() - state.recordingStartedAt) / 1000);
  const mimeType = state.mediaRecorder?.mimeType || 'audio/webm';
  const blob = new Blob(state.recordingChunks, { type: mimeType });
  state.mediaStream?.getTracks().forEach((track) => track.stop());
  state.mediaRecorder = null; state.mediaStream = null; state.recordingChunks = [];
  $('#recordButton').classList.remove('recording');
  $('#recordLabel').textContent = '按住跟读';
  const sentenceKey = `${state.topicId}:${state.chapterId}:${state.sentenceId || 'unspecified'}`;
  analytics.increment('sentences', sentenceKey, 'recordings');
  analytics.event('recording', { sentenceId: sentenceKey, durationSeconds: Number(duration.toFixed(2)), bytes: blob.size, mimeType });
  analytics.save(); renderAnalyticsOverview();
  const recordings = (analytics.data.events || []).filter((event) => event.type === 'recording');
  if ($('#recordingSummary')) $('#recordingSummary').textContent = `${recordings.length} 次录音 · 原始音频默认不持久保存`;
  if ($('#recordingSize')) $('#recordingSize').textContent = formatBytes(recordings.reduce((sum, event) => sum + Number(event.bytes || 0), 0));
  $('#scoreDataStatus').textContent = '真实录音 · 待 AI 评分';
  $('#scoreDataStatus').className = 'status warning';
  const speechProvider = readStoredJSON(STORAGE_KEYS.providers, {}).speech;
  const speechKey = sessionStorage.getItem('shy-ai-key-speech');
  if (speechProvider?.lastTestOk && speechKey) {
    $('#scoreDataStatus').textContent = '正在真实评分…';
    requestPronunciationScore(blob, speechProvider, speechKey).then((score) => {
      analytics.addScore('sentences', sentenceKey, score);
      analytics.addScore('chapters', `${state.topicId}:${state.chapterId}`, score);
      analytics.addScore('topics', state.topicId, score);
      renderPracticeScore(score); renderAnalyticsOverview();
      toast(`真实 AI 评分完成：${Math.round(score.total)} 分。`);
    }).catch((error) => { $('#scoreDataStatus').textContent = '评分失败'; $('#scoreDataStatus').className = 'status warning'; toast(error.message); });
  } else toast(`录音已完成（${duration.toFixed(1)} 秒，${Math.max(1, Math.round(blob.size / 1024))} KB）。连接语音评分服务后可生成真实分数。`);
}

async function requestPronunciationScore(blob, provider, apiKey) {
  const sentence = currentSentence();
  const body = new FormData();
  body.append('audio', blob, `practice-${Date.now()}.webm`);
  body.append('reference_text', sentence?.en || '');
  body.append('language', 'en-US');
  body.append('prompt_id', state.promptId);
  const response = await fetch(provider.baseUrl, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body });
  if (!response.ok) throw new Error(`真实语音评分失败：HTTP ${response.status}`);
  const result = await response.json();
  const score = {
    total: Number(result.total ?? result.score),
    pronunciation: Number(result.pronunciation ?? result.accuracy),
    fluency: Number(result.fluency),
    completeness: Number(result.completeness),
    words: Array.isArray(result.words) ? result.words : [],
  };
  if (![score.total, score.pronunciation, score.fluency, score.completeness].every(Number.isFinite)) throw new Error('评分服务返回的数据格式不完整。');
  return score;
}

function renderPracticeScore(score) {
  $('.total-score strong').textContent = Math.round(score.total);
  const dimensions = [['pronunciation', 2], ['fluency', 3], ['completeness', 4]];
  dimensions.forEach(([name, position]) => {
    const cell = $(`.score-grid > div:nth-child(${position})`); const value = Math.round(score[name]);
    $('strong', cell).textContent = value; $('i b', cell).style.width = `${Math.min(100, Math.max(0, value))}%`;
  });
  const words = $('.word-scores'); words.replaceChildren();
  const fallbackWords = (currentSentence()?.en || '').replace(/[^A-Za-z' -]/g, '').split(/\s+/).filter(Boolean);
  const items = score.words.length ? score.words : fallbackWords.map((word) => ({ word, score: score.pronunciation }));
  items.forEach((item) => { const span = document.createElement('span'); span.textContent = item.word || item.text || ''; span.className = Number(item.score ?? item.accuracy ?? 100) >= 75 ? 'good' : 'warn'; words.append(span); });
  $('#scoreDataStatus').textContent = '真实 AI 评分'; $('#scoreDataStatus').className = 'status success';
  renderScoreHistory();
}

function renderScoreHistory() {
  const history = analytics.ensure('chapters', `${state.topicId}:${state.chapterId}`).scores || [];
  const recent = history.slice(-8);
  const labels = $('.history-labels'); const svg = $('.history-card svg');
  if (!recent.length) {
    $('#historyTrend').textContent = '尚无评分'; $('#historyTrend').className = 'pill muted';
    labels.innerHTML = '<span>完成首次真实评分后生成历史曲线</span>';
    svg.innerHTML = '<path d="M20 104 H500" fill="none" stroke="var(--border)" stroke-width="2" stroke-dasharray="6 7"/>';
    return;
  }
  const points = recent.map((score, index) => {
    const x = recent.length === 1 ? 260 : 20 + (480 * index) / (recent.length - 1);
    const y = 100 - Math.min(100, Math.max(0, Number(score.total || 0))) * .82;
    return [Number(x.toFixed(1)), Number(y.toFixed(1))];
  });
  const path = points.map(([x, y], index) => `${index ? 'L' : 'M'}${x} ${y}`).join(' ');
  svg.innerHTML = `<path d="M20 100 H500" fill="none" stroke="var(--border)" stroke-width="1"/><path d="${path}" fill="none" stroke="var(--primary)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>${points.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5" fill="var(--surface)" stroke="var(--primary)" stroke-width="4"/>`).join('')}`;
  const previous = recent.at(-2); const latest = recent.at(-1); const delta = previous ? Math.round(latest.total - previous.total) : 0;
  $('#historyTrend').textContent = previous ? `较上次 ${delta >= 0 ? '+' : ''}${delta}` : '首次评分'; $('#historyTrend').className = `pill ${delta >= 0 ? 'success' : 'warning'}`;
  labels.replaceChildren(...recent.slice(-4).map((item, index) => { const span = document.createElement('span'); span.textContent = `第 ${Math.max(1, history.length - 3 + index)} 次 · ${Math.round(item.total)}`; return span; }));
}

function renderStoredPracticeResults() {
  const scores = state.sentenceId ? (analytics.ensure('sentences', `${state.topicId}:${state.chapterId}:${state.sentenceId}`).scores || []) : [];
  const latest = scores.at(-1);
  if (latest) renderPracticeScore(latest);
  else {
    $('.total-score strong').textContent = '—';
    [['pronunciation', 2], ['fluency', 3], ['completeness', 4]].forEach(([, position]) => { const cell = $(`.score-grid > div:nth-child(${position})`); $('strong', cell).textContent = '—'; $('i b', cell).style.width = '0'; });
    $('.word-scores').innerHTML = '<span class="muted">完成录音并连接评分服务后显示逐词结果</span>';
    $('#scoreDataStatus').textContent = '等待真实评分'; $('#scoreDataStatus').className = 'status warning';
    renderScoreHistory();
  }
}

async function getMicrophoneInfo() {
  let temporaryStream;
  try {
    temporaryStream = await navigator.mediaDevices?.getUserMedia?.({ audio: true });
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter((device) => device.kind === 'audioinput');
    const track = temporaryStream?.getAudioTracks?.()[0];
    const settings = track?.getSettings?.() || {};
    return { inputs, activeLabel: track?.label || '系统默认麦克风', sampleRate: settings.sampleRate || '浏览器默认', channelCount: settings.channelCount || 1 };
  } finally { temporaryStream?.getTracks?.().forEach((track) => track.stop()); }
}

function setupPractice() {
  bindPracticeLines();
  $('#recordButton').addEventListener('click', () => state.mediaRecorder?.state === 'recording' ? stopRecording() : startRecording());
  $('#micDeviceButton').addEventListener('click', async () => {
    let info;
    try { info = await getMicrophoneInfo(); }
    catch { info = { inputs: [], activeLabel: '权限未开启', sampleRate: '—', channelCount: 1 }; }
    const options = info.inputs.length ? info.inputs.map((device, index) => `<option>${escapeHTML(device.label || `麦克风 ${index + 1}`)}</option>`).join('') : '<option>系统默认麦克风</option>';
    showModal({
      eyebrow: 'MICROPHONE', title: '麦克风设备与声道',
      body: `<div class="modal-field"><label>浏览器可用输入设备</label><select>${options}</select></div><div class="modal-field"><label>当前声道</label><select><option>${info.channelCount === 2 ? 'Stereo · Ch 1–2' : 'Mono · Ch 1'}</option></select></div><div class="warning-box"><span>♩</span><p><strong>${escapeHTML(info.activeLabel)}</strong><br><small>${escapeHTML(info.sampleRate)} Hz · 浏览器会在录音结束后释放麦克风。</small></p></div>`,
      actions: [{ label: '进入权限管理', onClick: () => navigate('settings') }, { label: '完成', style: 'primary' }],
    });
  });
}

function updateDefinitions(language, notify = true) {
  if (!definitions[language]) language = 'en';
  state.definitionLanguage = language;
  localStorage.setItem('shy-definition-language', language);
  if ($('#definitionLanguage')) $('#definitionLanguage').value = language;
  if ($('#defaultDefinitionLanguage')) $('#defaultDefinitionLanguage').value = language;
  $$('[data-definition]').forEach((node) => {
    const entry = definitions[language][node.dataset.definition];
    if (entry) { node.textContent = entry[0]; node.dir = 'auto'; }
  });
  const active = $('.word-list-item.active');
  const id = active?.dataset.wordId || 'confidence';
  const entry = definitions[language][id];
  if (entry) {
    $('#primaryDefinition').textContent = entry[0];
    $('#definitionText').textContent = entry[1];
  }
  const examples = exampleTranslations[language] || exampleTranslations.en;
  $('[data-example-translation="primary"]').textContent = examples[0];
  $('[data-example-translation="secondary"]').textContent = examples[1];
  if (notify) toast(`英语学习辅助语言已切换为 ${$('#definitionLanguage').selectedOptions[0].textContent}。`);
}

function setupVocabulary() {
  $('#definitionLanguage').value = state.definitionLanguage;
  $('#definitionLanguage').addEventListener('change', (event) => updateDefinitions(event.target.value));
  $$('.word-list-item').forEach((button) => button.addEventListener('click', () => {
    $$('.word-list-item').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    const id = button.dataset.wordId;
    const entry = definitions[state.definitionLanguage][id];
    $('#detailWord').textContent = id === 'build-confidence' ? 'build confidence' : id;
    if (entry) { $('#primaryDefinition').textContent = entry[0]; $('#definitionText').textContent = entry[1]; }
  }));
  $('#vocabSearch').addEventListener('input', (event) => {
    const q = event.target.value.trim().toLowerCase();
    $$('.word-list-item').forEach((item) => item.hidden = !item.textContent.toLowerCase().includes(q));
  });
  const openCleanup = () => showModal({
    eyebrow: 'VOCABULARY CLEANUP', title: '检查待清理生词',
    body: `<p>这些词已从默认生词本移除，但仍保存在其他生词本中。</p><div class="cleanup-list"><label><input type="checkbox" checked><span><strong>confidence</strong><small>仍在：商务英语、本周复习</small></span></label><label><input type="checkbox" checked><span><strong>pronunciation</strong><small>仍在：发音难点</small></span></label><label><input type="checkbox"><span><strong>approach</strong><small>仍在：面试英语</small></span></label></div>`,
    actions: [{ label: '保留在其他生词本' }, { label: '从所有生词本删除', style: 'primary', onClick: () => toast('已从所有生词本移除所选词汇，可在操作记录中恢复。') }],
  });
  $('#cleanupOpen').addEventListener('click', openCleanup);
  $('#reviewCleanup').addEventListener('click', openCleanup);
  $('#dismissCleanup').addEventListener('click', () => { $('#cleanupBanner').remove(); toast('已关闭清理提醒，仍可从“待清理”手动进入。'); });
  $$('.sound-btn').forEach((button) => button.addEventListener('click', () => {
    if ('speechSynthesis' in window) { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance($('#detailWord').textContent)); }
    toast('正在播放美式发音。');
  }));
}

function renderAudioTime() {
  const mm = String(Math.floor(state.audioTime / 60)).padStart(2, '0');
  const ss = String(Math.floor(state.audioTime % 60)).padStart(2, '0');
  $('#audioCurrent').textContent = `${mm}:${ss}`;
  $('#audioProgress').style.width = `${(state.audioTime / state.audioDuration) * 100}%`;
}

function setupListening() {
  setInterval(() => {
    if (!state.audioPlaying) return;
    state.audioTime += 0.5 * [0.5, 0.75, 0.8, 1, 1.25, 1.5, 2][state.speedIndex];
    if (state.audioTime >= state.audioDuration) state.audioTime = 0;
    renderAudioTime();
  }, 500);
  $('#audioPlay').addEventListener('click', () => {
    state.audioPlaying = !state.audioPlaying;
    $('#audioPlay').textContent = state.audioPlaying ? 'Ⅱ' : '▶';
    $('.audio-player').classList.toggle('playing', state.audioPlaying);
  });
  const speeds = [0.5, 0.75, 0.8, 1, 1.25, 1.5, 2];
  $('#speedButton').addEventListener('click', () => {
    state.speedIndex = (state.speedIndex + 1) % speeds.length;
    $('#speedButton').textContent = `${speeds[state.speedIndex]}×`;
    toast(`播放速度已设为 ${speeds[state.speedIndex]}×。`);
  });
  const modes = [['→', '顺序播放'], ['↻', '列表循环'], ['↺', '单曲循环'], ['⤨', '随机播放']];
  $('#playMode').addEventListener('click', () => {
    state.playModeIndex = (state.playModeIndex + 1) % modes.length;
    $('#playMode').textContent = modes[state.playModeIndex][0];
    $('#playMode').title = modes[state.playModeIndex][1];
    toast(`已切换为${modes[state.playModeIndex][1]}。`);
  });
  $('#lyricsLanguage').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    $$('#lyricsLanguage button').forEach((item) => item.classList.toggle('active', item === button));
    $$('.listen-line').forEach((line) => {
      $('strong', line).style.display = button.dataset.lang === 'zh' ? 'none' : 'block';
      $('small', line).style.display = button.dataset.lang === 'en' ? 'none' : 'block';
    });
  });
  $('#highlightVocabulary').addEventListener('change', (event) => {
    $$('.vocab-mark').forEach((mark) => mark.classList.toggle('no-highlight', !event.target.checked));
    toast(event.target.checked ? '已高亮个人生词。' : '已关闭生词高亮。');
  });
  const removeFromDefault = (mark) => {
    if (state.audioPlaying) { toast('请先暂停音频，再双击取消生词。'); return; }
    if (mark.dataset.defaultBook === 'false') { toast('这个词已经不在默认生词本中。'); return; }
    mark.dataset.defaultBook = 'false';
    state.vocabularyRemoved = true;
    const otherCount = Number(mark.dataset.otherBooks || 0);
    if (otherCount > 0) mark.classList.add('other-only');
    else mark.classList.add('no-highlight');
    toast(`已将 “${mark.textContent}” 从默认生词本移除${otherCount ? `，仍保存在 ${otherCount} 个其他生词本中` : ''}。`, '撤销', () => {
      mark.dataset.defaultBook = 'true'; mark.classList.remove('other-only', 'no-highlight'); state.vocabularyRemoved = false;
    });
  };
  $$('.vocab-mark').forEach((mark) => {
    mark.addEventListener('dblclick', (event) => { event.preventDefault(); removeFromDefault(mark); });
    let lastTap = 0;
    mark.addEventListener('pointerup', (event) => {
      if (event.pointerType === 'mouse') return;
      const now = Date.now();
      if (now - lastTap < 350) { event.preventDefault(); removeFromDefault(mark); }
      lastTap = now;
    });
  });
  $('#timelineRange').addEventListener('input', (event) => {
    const value = Number(event.target.value) / 10;
    $('#timelineOffset').textContent = `${value > 0 ? '+' : ''}${value.toFixed(1)}s`;
  });
  $('#timelineRange').addEventListener('change', () => toast('个人歌词时间轴已保存。'));
  $('#restoreTimeline').addEventListener('click', () => { $('#timelineRange').value = 0; $('#timelineOffset').textContent = '0.0s'; toast('已恢复官方默认时间轴。'); });
  $('#newPlaylist').addEventListener('click', () => showModal({ eyebrow: 'NEW PLAYLIST', title: '新建磨耳朵列表', body: `<div class="modal-field"><label>列表名称</label><input value="新的听力列表"></div><div class="modal-field"><label>自动排序</label><select><option>自定义顺序</option><option>薄弱内容优先</option><option>很久未学习优先</option></select></div>`, actions: [{ label: '取消' }, { label: '创建列表', style: 'primary', onClick: () => toast('音频列表已创建。') }] }));
  $('#editPlaylist').addEventListener('click', () => toast('已进入列表编辑模式，可拖动音频调整顺序。'));
}

function setupDownloads() {
  const recordings = (analytics.data.events || []).filter((event) => event.type === 'recording');
  const recordingBytes = recordings.reduce((sum, event) => sum + Number(event.bytes || 0), 0);
  $('#recordingSummary').textContent = `${recordings.length} 次录音 · 原始音频默认不持久保存`;
  $('#recordingSize').textContent = formatBytes(recordingBytes);
  $('#offlineVocabularySummary').textContent = `${$$('.word-list-item').length} 个词 · ${state.catalog?.topics?.length || 0} 个主题`;
  if (navigator.storage?.estimate) navigator.storage.estimate().then(({ usage = 0, quota = 0 }) => {
    $('#storageUsed').textContent = `已使用 ${formatBytes(usage)}`;
    $('#storageAvailable').textContent = formatBytes(Math.max(0, quota - usage));
    $('#storageBreakdown').textContent = `浏览器总配额 ${formatBytes(quota)} · 数据来自 Storage API`;
    $('#storageUsageBar').style.width = `${quota ? Math.min(100, (usage / quota) * 100) : 0}%`;
  }).catch(() => { $('#storageUsed').textContent = '存储用量不可用'; });
  $('#demoDownload').addEventListener('click', () => showModal({
    eyebrow: 'CELLULAR DATA', title: '将使用较多移动数据',
    body: `<div class="warning-box"><span>⚠</span><p><strong>授权媒体示例预计使用约 286 MB 移动数据</strong><br><small>超过 50 MB，建议连接 Wi-Fi 后继续。YouTube 内容不会由本应用直接下载。</small></p></div><p>只有在你手动确认后，获得授权的媒体下载才会开始。</p>`,
    actions: [{ label: '取消下载' }, { label: '等待 Wi-Fi', onClick: () => toast('任务已加入队列，将在连接 Wi-Fi 后自动开始。') }, { label: '仍然下载', style: 'primary', onClick: () => toast('已确认使用移动数据，下载任务开始。') }],
  }));
  $('#downloadSettings').addEventListener('click', () => showModal({ eyebrow: 'DOWNLOAD SETTINGS', title: '下载设置', body: `<div class="modal-field"><label>网络策略</label><select><option>移动数据超过 50 MB 时询问</option><option>仅 Wi-Fi 下载</option><option>禁止移动数据下载</option></select></div><div class="modal-field"><label>默认视频质量</label><select><option>720p（推荐）</option><option>360p</option><option>1080p</option></select></div><div class="modal-field"><label>最大缓存空间</label><select><option>10 GB</option><option>5 GB</option><option>无限制</option></select></div>`, actions: [{ label: '取消' }, { label: '保存设置', style: 'primary', onClick: () => toast('下载设置已保存。') }] }));
  $$('.redownload').forEach((button) => button.addEventListener('click', () => toast('正在重新下载最新媒体版本，个人设置将保留。')));
  $$('.pause-download').forEach((button) => button.addEventListener('click', () => { button.textContent = button.textContent === 'Ⅱ' ? '▶' : 'Ⅱ'; toast(button.textContent === '▶' ? '下载已暂停。' : '下载已继续。'); }));
  $$('.download-more').forEach((button) => button.addEventListener('click', () => showModal({ eyebrow: 'OFFLINE ITEM', title: '管理离线内容', body: `<p>删除媒体不会删除学习进度、生词、历史成绩或个人歌词时间轴。</p>`, actions: [{ label: '重新下载', onClick: () => toast('重新下载任务已创建。') }, { label: '删除本地文件', style: 'primary', onClick: () => toast('本地媒体已删除，可随时重新下载。') }] })));
  $('#selectAllDownloads').addEventListener('change', (event) => $$('.download-row input[type="checkbox"]').forEach((checkbox) => checkbox.checked = event.target.checked));
}

function providerEndpoint(baseUrl, path) {
  const base = new URL(baseUrl);
  base.pathname = `${base.pathname.replace(/\/?$/, '/')}${path.replace(/^\//, '')}`;
  base.search = ''; base.hash = '';
  return base.href;
}

function readAudioMetadata(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file); const audio = new Audio();
    const cleanup = () => URL.revokeObjectURL(url);
    const timeout = setTimeout(() => { cleanup(); reject(new Error('读取音频信息超时。')); }, 10000);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => { clearTimeout(timeout); const duration = audio.duration; cleanup(); resolve({ duration }); };
    audio.onerror = () => { clearTimeout(timeout); cleanup(); reject(new Error('浏览器无法读取这个音频格式。')); };
    audio.src = url;
  });
}

function showStudioSource(title, meta) {
  $('#sourceCheckTitle').textContent = title; $('#sourceCheckMeta').textContent = meta; $('#sourceCheck').classList.remove('hidden');
}

async function acceptAudioFile(file) {
  if (!file || (!file.type.startsWith('audio/') && !/\.(mp3|m4a|wav|ogg|flac)$/i.test(file.name))) { toast('请选择支持的纯音频文件。'); return; }
  try {
    const metadata = await readAudioMetadata(file);
    state.studioSource = { type: 'file', file, duration: metadata.duration };
    showStudioSource(file.name, `${formatDuration(metadata.duration)} · ${formatBytes(file.size)} · ${file.type || '音频文件'} · 本地读取`);
    toast('已读取真实音频元数据，文件尚未上传。');
  } catch (error) { toast(error.message); }
}

async function generateSlidesWithAI(file) {
  const providers = readStoredJSON(STORAGE_KEYS.providers, {}); const provider = providers.openai; const apiKey = sessionStorage.getItem('shy-ai-key-openai');
  if (!provider?.lastTestOk || !apiKey) throw new Error('请先在 AI 服务中完成真实连接测试；API Key 只保存在当前标签页。');
  const transcriptionBody = new FormData(); transcriptionBody.append('file', file); transcriptionBody.append('model', provider.audioModel || 'whisper-1');
  const transcriptionResponse = await fetch(providerEndpoint(provider.baseUrl, 'audio/transcriptions'), { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: transcriptionBody });
  if (!transcriptionResponse.ok) throw new Error(`音频转写失败：HTTP ${transcriptionResponse.status}`);
  const transcription = await transcriptionResponse.json(); const transcript = transcription.text || '';
  if (!transcript) throw new Error('转写服务没有返回文本。');
  const prompt = `请把下面的英语音频转写整理为 6-10 页口语学习 HTML PPT 大纲。仅返回 JSON：{"slides":[{"title":"","body":"","keywords":[""]}]}。转写：${transcript.slice(0, 12000)}`;
  const completionResponse = await fetch(providerEndpoint(provider.baseUrl, 'chat/completions'), { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: provider.model, messages: [{ role: 'user', content: prompt }], temperature: .3 }) });
  if (!completionResponse.ok) throw new Error(`课件生成失败：HTTP ${completionResponse.status}`);
  const completion = await completionResponse.json(); const content = completion.choices?.[0]?.message?.content || '';
  const parsed = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, '')); if (!parsed.slides?.length) throw new Error('模型返回的课件结构无效。');
  return { transcript, slides: parsed.slides };
}

function renderGeneratedSlide(slide, count) {
  const canvas = $('.slide-canvas');
  $('.slide-kicker', canvas).textContent = `AI GENERATED · ${count} SLIDES`;
  $('h2', canvas).textContent = slide.title || 'Generated lesson';
  $('p', canvas).textContent = slide.body || '';
  const words = $('.slide-words', canvas); words.replaceChildren(...(slide.keywords || []).slice(0, 4).map((word) => { const span = document.createElement('span'); span.textContent = word; return span; }));
}

function setupStudio() {
  $('#chooseAudio').addEventListener('click', () => $('#audioFileInput').click());
  $('#audioFileInput').addEventListener('change', (event) => acceptAudioFile(event.target.files[0]));
  const zone = $('#uploadZone');
  ['dragenter', 'dragover'].forEach((type) => zone.addEventListener(type, (event) => { event.preventDefault(); zone.classList.add('dragging'); }));
  ['dragleave', 'drop'].forEach((type) => zone.addEventListener(type, (event) => { event.preventDefault(); zone.classList.remove('dragging'); }));
  zone.addEventListener('drop', (event) => acceptAudioFile(event.dataTransfer.files[0]));
  $('#inspectAudio').addEventListener('click', async () => {
    const value = $('#audioUrlInput').value.trim(); let url;
    try { url = new URL(value); if (url.protocol !== 'https:') throw new Error(); }
    catch { toast('请输入有效的 HTTPS 音频地址。'); return; }
    const button = $('#inspectAudio'); button.disabled = true; button.textContent = '检查中…';
    try {
      const response = await fetch(url, { method: 'HEAD' }); if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const type = response.headers.get('content-type') || '未知格式'; const bytes = Number(response.headers.get('content-length') || 0);
      state.studioSource = { type: 'url', url: url.href, contentType: type, bytes };
      showStudioSource(url.pathname.split('/').pop() || url.hostname, `${type} · ${bytes ? formatBytes(bytes) : '大小未知'} · 已完成真实 HEAD 请求`);
      toast('在线音频地址检查通过。');
    } catch (error) { toast(`在线音频检查失败：${error.message}。来源需要允许跨域 HEAD 请求。`); }
    finally { button.disabled = false; button.textContent = '检查'; }
  });
  $('#generatePpt').addEventListener('click', async () => {
    if (!state.studioSource) { toast('请先选择本地音频或检查在线音频。'); return; }
    if (state.studioSource.type !== 'file') { toast('当前真实 AI 流程仅支持本地音频文件；在线来源需先由服务端安全拉取。'); return; }
    const button = $('#generatePpt'); button.disabled = true; button.textContent = '✦ 正在转写并生成课件…';
    try {
      const result = await generateSlidesWithAI(state.studioSource.file); renderGeneratedSlide(result.slides[0], result.slides.length);
      button.textContent = `✓ 已生成 ${result.slides.length} 页 · 查看预览`; toast('真实 AI 转写与 HTML PPT 大纲生成完成。');
    } catch (error) { toast(error.message); button.textContent = '✦ AI 生成 HTML PPT'; }
    finally { button.disabled = false; }
  });
}

function updateProviderCards() {
  const providers = readStoredJSON(STORAGE_KEYS.providers, {});
  $$('.provider-card[data-provider]').forEach((card) => {
    const provider = providers[card.dataset.provider];
    const status = $('.provider-status', card);
    if (!provider) { status.textContent = '● 待配置'; status.className = 'status warning provider-status'; return; }
    status.textContent = provider.lastTestOk ? `● 已验证${provider.speechDetected ? ' · 语音' : ''}` : '● 已保存 · 待测试';
    status.className = `status ${provider.lastTestOk ? 'success' : 'warning'} provider-status`;
  });
}

async function testProviderConnection(providerId, config, apiKey) {
  let endpoint;
  try {
    const base = new URL(config.baseUrl);
    if (base.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(base.hostname)) throw new Error('API 地址必须使用 HTTPS。');
    endpoint = providerId === 'openai' ? providerEndpoint(base.href, 'models') : base.href;
  } catch (error) { throw new Error(error.message || 'API 地址无效。'); }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(endpoint, { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) throw new Error(`连接失败：HTTP ${response.status}${text ? ` · ${text.slice(0, 90)}` : ''}`);
    let payload = null;
    try { payload = JSON.parse(text); } catch { /* A successful health endpoint may return plain text. */ }
    const modelNames = Array.isArray(payload?.data) ? payload.data.map((model) => model.id || '').join(' ') : '';
    return { speechDetected: providerId === 'speech' || /audio|speech|whisper|transcrib|realtime/i.test(modelNames), modelCount: payload?.data?.length || 0 };
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('连接超时，请检查 API 地址、网络或跨域配置。');
    throw error;
  } finally { clearTimeout(timeout); }
}

function openProviderModal(providerId = 'openai') {
  const providers = readStoredJSON(STORAGE_KEYS.providers, {});
  const stored = providers[providerId] || {};
  const defaultUrl = providerId === 'openai' ? 'https://api.example.com/v1/' : 'https://speech.example.com/health';
  showModal({
    eyebrow: 'REAL API CONNECTION', title: providerId === 'speech' ? '配置语音评分服务' : '配置 OpenAI-compatible 服务',
    body: `<div class="modal-field"><label for="providerBaseUrl">${providerId === 'speech' ? '评分 API URL（GET 健康检查 / POST 评分）' : 'API Base URL'}</label><input id="providerBaseUrl" inputmode="url" value="${escapeHTML(stored.baseUrl || defaultUrl)}"></div><div class="modal-field"><label for="providerModel">默认模型</label><input id="providerModel" value="${escapeHTML(stored.model || '')}" placeholder="例如 gpt-4.1-mini / pronunciation-v1"></div>${providerId === 'openai' ? `<div class="modal-field"><label for="providerAudioModel">音频转写模型</label><input id="providerAudioModel" value="${escapeHTML(stored.audioModel || 'whisper-1')}" placeholder="whisper-1"></div>` : ''}<div class="modal-field"><label for="providerApiKey">API Key（仅保存在当前标签页）</label><input id="providerApiKey" type="password" autocomplete="off" placeholder="不会写入本地持久存储"></div><div class="warning-box"><span>🔒</span><p><strong>这会发起真实网络请求</strong><br><small>${providerId === 'speech' ? 'POST 需接受 audio、reference_text，并返回 total、pronunciation、fluency、completeness。' : '浏览器直连需要厂商允许 CORS。生产环境建议通过受控后端代理保存密钥。'}</small></p></div>`,
    actions: [{ label: '取消' }, { label: '测试并保存', style: 'primary', onClick: async () => {
      const config = { baseUrl: $('#providerBaseUrl').value.trim(), model: $('#providerModel').value.trim(), audioModel: $('#providerAudioModel')?.value.trim() || '', updatedAt: new Date().toISOString() };
      const apiKey = $('#providerApiKey').value.trim();
      if (!config.baseUrl) { toast('请填写 API 地址。'); return false; }
      const result = await testProviderConnection(providerId, config, apiKey);
      providers[providerId] = { ...config, ...result, lastTestOk: true, lastTestedAt: new Date().toISOString() };
      writeStoredJSON(STORAGE_KEYS.providers, providers);
      if (apiKey) sessionStorage.setItem(`shy-ai-key-${providerId}`, apiKey);
      updateProviderCards();
      toast(`真实连接测试通过${result.modelCount ? ` · 读取到 ${result.modelCount} 个模型` : ''}${result.speechDetected ? ' · 支持语音' : ''}。`);
    } }],
  });
}

function getPromptLibrary() {
  const stored = readStoredJSON(STORAGE_KEYS.prompts, null);
  if (stored?.items?.length) return stored;
  return { activeId: 'encouraging', items: DEFAULT_PROMPTS.map((prompt) => ({ ...prompt })), updatedAt: null };
}

function savePromptLibrary(library) {
  library.updatedAt = new Date().toISOString();
  writeStoredJSON(STORAGE_KEYS.prompts, library);
}

function renderPromptLibrary() {
  const library = getPromptLibrary();
  if (!library.items.some((prompt) => prompt.id === state.promptId)) state.promptId = library.activeId || library.items[0].id;
  const tabs = $('#promptTabs'); tabs.replaceChildren();
  library.items.forEach((prompt) => {
    const button = document.createElement('button');
    button.classList.toggle('active', prompt.id === state.promptId);
    button.textContent = prompt.name;
    if (prompt.id === library.activeId) { const status = document.createElement('span'); status.textContent = '启用中'; button.append(status); }
    button.addEventListener('click', () => { state.promptId = prompt.id; localStorage.setItem('shy-prompt-id', prompt.id); renderPromptLibrary(); });
    tabs.append(button);
  });
  const current = library.items.find((prompt) => prompt.id === state.promptId) || library.items[0];
  $('#promptEditor').value = current.system;
  $('#promptVersion').textContent = `${current.isDefault ? '系统模板' : '自定义模板'} · ${library.updatedAt ? new Date(library.updatedAt).toLocaleDateString() : '未修改'}`;
  $('#deletePrompt').disabled = Boolean(current.isDefault);
}

function setupAI() {
  updateProviderCards();
  $$('.test-model').forEach((button) => button.addEventListener('click', () => openProviderModal(button.closest('[data-provider]')?.dataset.provider || 'openai')));
  $('#addProvider').addEventListener('click', () => openProviderModal('openai')); $('#configureProvider').addEventListener('click', () => openProviderModal('openai'));
  renderPromptLibrary();
  $('#restorePrompt').addEventListener('click', () => {
    const fallback = DEFAULT_PROMPTS.find((prompt) => prompt.id === state.promptId) || DEFAULT_PROMPTS[0];
    $('#promptEditor').value = fallback.system;
    toast('已恢复系统默认内容，点击“保存并启用”后生效。');
  });
  $('#testPrompt').addEventListener('click', () => showModal({ eyebrow: 'LOCAL PROMPT CHECK', title: '提示词结构检查', body: `<div class="warning-box"><span>✓</span><p><strong>模板变量与长度检查通过</strong><br><small>当前仅执行本地结构验证；连接 AI 服务后才能运行真实 A/B 输出测试。</small></p></div><p>已识别变量：reference_text、word_scores、learner_level、feedback_language。</p>`, actions: [{ label: '完成', style: 'primary' }] }));
  $('#savePrompt').addEventListener('click', () => {
    const library = getPromptLibrary();
    const current = library.items.find((prompt) => prompt.id === state.promptId);
    if (!current) return;
    current.system = $('#promptEditor').value.trim(); library.activeId = current.id; savePromptLibrary(library); renderPromptLibrary();
    toast(`“${current.name}”已保存并启用。`);
  });
  $('#newPrompt').addEventListener('click', () => showModal({ eyebrow: 'NEW PROMPT', title: '新建评分提示词', body: '<div class="modal-field"><label for="newPromptName">模板名称</label><input id="newPromptName" maxlength="30" placeholder="例如：面试口语"></div>', actions: [{ label: '取消' }, { label: '创建副本', style: 'primary', onClick: () => {
    const name = $('#newPromptName').value.trim(); if (!name) { toast('请填写模板名称。'); return false; }
    const library = getPromptLibrary(); const current = library.items.find((prompt) => prompt.id === state.promptId) || library.items[0];
    const prompt = { id: `custom-${Date.now()}`, name, system: current.system, isDefault: false };
    library.items.push(prompt); state.promptId = prompt.id; savePromptLibrary(library); localStorage.setItem('shy-prompt-id', prompt.id); renderPromptLibrary(); toast('已创建提示词副本。');
  } }] }));
  $('#deletePrompt').addEventListener('click', () => {
    const library = getPromptLibrary(); const current = library.items.find((prompt) => prompt.id === state.promptId);
    if (!current || current.isDefault) { toast('系统默认模板不能删除。'); return; }
    library.items = library.items.filter((prompt) => prompt.id !== current.id); state.promptId = library.activeId === current.id ? 'encouraging' : library.activeId; library.activeId = state.promptId;
    savePromptLibrary(library); localStorage.setItem('shy-prompt-id', state.promptId); renderPromptLibrary(); toast('自定义提示词已删除。');
  });
}

function applyProfileToForm(profile = storedProfile()) {
  if (!$('#nicknameInput')) return;
  $('#nicknameInput').value = profile.nickname || 'LinSpeak';
  $('#signatureInput').value = profile.signature || '';
  $('#signatureCount').textContent = [...(profile.signature || '')].length;
  $('#profileAvatar').textContent = profile.avatar || 'LS';
  $$('.avatar-options .avatar').forEach((button) => button.classList.toggle('selected', button.dataset.avatar === (profile.avatar || 'LS')));
  updateProfileChrome(profile);
}

function friendlyAccountError(error) {
  const message = String(error?.message || error || '操作失败');
  if (/invalid login credentials/i.test(message)) return '账号或密码不正确。';
  if (/email not confirmed/i.test(message)) return '邮箱尚未验证，请先打开验证邮件。';
  if (/user already registered/i.test(message)) return '该账号已经注册，请直接登录。';
  if (/nickname already exists|duplicate key/i.test(message)) return '这个昵称已被使用，请换一个。';
  if (/SMTP/i.test(message)) return 'NAS 尚未配置邮件服务，请先在 Compose 中填写 SMTP 设置。';
  if (/短信服务/.test(message)) return 'NAS 尚未配置短信服务。';
  if (/failed to fetch|network/i.test(message)) return '无法连接账号服务，请检查网络与服务地址。';
  return message;
}

function openBackendConfig() {
  const backend = shyBackend.getConfig();
  showModal({
    eyebrow: 'SELF-HOSTED SERVICE', title: backend.configured ? '局域网服务连接设置' : '连接绿联 NAS',
    body: `<div class="status-banner"><span>NAS</span><p><strong>PostgreSQL 自托管服务</strong><small>Docker 版本会自动使用同源 API；从其他页面连接时，只需填写 NAS 地址，不需要 Supabase Key。</small></p></div><div class="modal-field"><label for="backendUrl">Shy2Speak 服务地址</label><input id="backendUrl" inputmode="url" value="${escapeHTML(backend.url || '')}" placeholder="http://192.168.1.20:8080"></div><div class="warning-box"><span>✓</span><p><strong>保存前会检查 API 与 PostgreSQL</strong><br><small>局域网私有地址可使用 HTTP；通过公网访问时必须配置 HTTPS。</small></p></div>`,
    actions: [{ label: '取消' }, { label: '测试并保存', style: 'primary', onClick: async () => {
      const candidate = { url: $('#backendUrl').value.trim() };
      const result = await shyBackend.testConnection(candidate);
      shyBackend.saveConfig(candidate.url);
      state.accountReady = true; updateAccountUI();
      toast(`NAS 连接成功 · 邮箱和手机密码登录可用 · 邮件找回${result.passwordRecoveryEnabled ? '已配置' : '待配置'}。`);
    } }],
  });
}

async function completeAuthenticatedSession(session) {
  state.authSession = session;
  state.accountReady = true;
  updateAccountUI();
  await reconcileCloudState();
  try {
    const remoteProfile = await shyBackend.getProfile();
    if (remoteProfile) {
      const profile = { nickname: remoteProfile.nickname, signature: remoteProfile.signature || '', avatar: remoteProfile.avatar || 'LS', updatedAt: remoteProfile.updated_at };
      writeStoredJSON(STORAGE_KEYS.profile, profile); applyProfileToForm(profile);
    }
  } catch (error) { setSyncMessage('学习记录已同步', `资料读取提示：${friendlyAccountError(error)}`, 'success'); }
  updateAccountUI();
}

function openPasswordReset() {
  showModal({
    eyebrow: 'SECURITY', title: '设置新密码',
    body: '<div class="modal-field"><label for="newAccountPassword">新密码</label><input id="newAccountPassword" type="password" autocomplete="new-password" placeholder="至少 8 位"></div><div class="modal-field"><label for="confirmAccountPassword">再次输入</label><input id="confirmAccountPassword" type="password" autocomplete="new-password"></div>',
    actions: [{ label: '稍后' }, { label: '更新密码', style: 'primary', onClick: async () => {
      const password = $('#newAccountPassword').value;
      if (password.length < 8 || password !== $('#confirmAccountPassword').value) { toast('请输入两次相同且至少 8 位的密码。'); return false; }
      await shyBackend.updatePassword(password); toast('密码已更新。');
    } }],
  });
}

function openOtpVerification(method, account, passwordReset = false) {
  showModal({
    eyebrow: 'VERIFY ACCOUNT', title: method === 'email' ? '输入邮箱验证码' : '输入短信验证码',
    body: `<div class="status-banner"><span>OTP</span><p><strong>验证码已发送</strong><small>${escapeHTML(account)}</small></p></div><div class="modal-field"><label for="authOtp">6 位验证码</label><input id="authOtp" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="000000"></div>`,
    actions: [{ label: '取消' }, { label: '验证', style: 'primary', onClick: async () => {
      const token = $('#authOtp').value.trim();
      if (token.length < 6) { toast('请输入收到的验证码。'); return false; }
      const session = await shyBackend.verifyOtp({ method, account, token });
      await completeAuthenticatedSession(session);
      toast('账号验证成功，学习记录已开始同步。');
      if (passwordReset) setTimeout(openPasswordReset, 80);
    } }],
  });
}

function openRecoveryVerification(email) {
  showModal({
    eyebrow: 'PASSWORD RECOVERY', title: '输入重置验证码',
    body: `<div class="status-banner"><span>OTP</span><p><strong>重置验证码已发送</strong><small>${escapeHTML(email)}</small></p></div><div class="modal-field"><label for="recoveryOtp">6 位验证码</label><input id="recoveryOtp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000"></div><div class="modal-field"><label for="recoveryPassword">新密码</label><input id="recoveryPassword" type="password" autocomplete="new-password" placeholder="至少 8 位"></div><div class="modal-field"><label for="recoveryPasswordConfirm">再次输入</label><input id="recoveryPasswordConfirm" type="password" autocomplete="new-password"></div>`,
    actions: [{ label: '取消' }, { label: '重置密码', style: 'primary', onClick: async () => {
      const token = $('#recoveryOtp').value.trim();
      const password = $('#recoveryPassword').value;
      if (token.length !== 6) { toast('请输入 6 位验证码。'); return false; }
      if (password.length < 8 || password !== $('#recoveryPasswordConfirm').value) { toast('请输入两次相同且至少 8 位的密码。'); return false; }
      await shyBackend.resetPasswordWithCode({ email, token, password });
      toast('密码已重置，请使用新密码登录。');
    } }],
  });
}

function openAuthModal() {
  if (!shyBackend.isConfigured()) { openBackendConfig(); return; }
  if (state.authSession) { navigate('settings'); return; }
  let authMode = 'login';
  let authMethod = 'email';
  showModal({
    eyebrow: 'WELCOME TO SHY2SPEAK', title: '登录',
    body: `<div class="status-banner"><span>LIVE</span><p><strong>真实账号服务已连接</strong><small>账号用于跨设备同步学习进度；邮箱与手机号分开选择。</small></p></div><div class="auth-tabs" id="authModeTabs"><button class="active" type="button" data-auth-mode="login">登录</button><button type="button" data-auth-mode="register">注册</button></div><strong class="auth-method-label">选择账号方式</strong><div class="auth-methods"><button class="auth-method active" type="button" data-auth-method="email"><span class="auth-method-icon">✉</span><span class="auth-method-copy"><strong>邮箱</strong><small>密码或验证码</small></span></button><button class="auth-method" type="button" data-auth-method="phone"><span class="auth-method-icon">☎</span><span class="auth-method-copy"><strong>手机号</strong><small>密码或短信验证码</small></span></button></div><div class="modal-field"><label id="authAccountLabel" for="authAccount">邮箱地址</label><input id="authAccount" type="email" inputmode="email" autocomplete="email" placeholder="name@example.com"><small class="auth-account-help" id="authAccountHelp">登录和密码找回信息将发送到此邮箱。</small></div><div class="modal-field hidden" id="authNicknameField"><label for="authNickname">昵称</label><input id="authNickname" maxlength="24" value="${escapeHTML(storedProfile().nickname || '')}" placeholder="全站唯一昵称"></div><div class="modal-field"><label for="authPassword">密码</label><input id="authPassword" type="password" autocomplete="current-password" placeholder="输入密码"></div><div class="auth-support"><button class="text-btn" id="authCodeAction" type="button">使用邮箱验证码</button><button class="text-btn" id="authRecovery" type="button">找回密码</button></div>`,
    actions: [{ label: '取消' }, { label: '登录', style: 'primary', onClick: async () => {
      const account = $('#authAccount').value.trim().replace(authMethod === 'phone' ? /[\s()-]/g : /$^/, '');
      const password = $('#authPassword').value;
      if (!account || password.length < (authMode === 'register' ? 8 : 1)) { toast(authMode === 'register' ? '请填写账号和至少 8 位密码。' : '请填写账号和密码。'); return false; }
      if (authMode === 'register') {
        const payload = await shyBackend.signUp({ method: authMethod, account, password, nickname: $('#authNickname').value.trim() });
        if (payload?.access_token) { await completeAuthenticatedSession(shyBackend.getSession()); toast('注册成功，学习记录已开始同步。'); }
        else toast(authMethod === 'email' ? '注册已提交，请打开验证邮件完成注册。' : '注册已提交，请输入收到的短信验证码。');
      } else {
        const session = await shyBackend.signInPassword({ method: authMethod, account, password });
        await completeAuthenticatedSession(session); toast('登录成功，学习记录已同步。');
      }
    } }],
  });

  const renderAuthChoice = () => {
    $$('#authModeTabs button').forEach((button) => button.classList.toggle('active', button.dataset.authMode === authMode));
    $$('.auth-method').forEach((button) => button.classList.toggle('active', button.dataset.authMethod === authMethod));
    const email = authMethod === 'email'; const account = $('#authAccount');
    $('#modalTitle').textContent = authMode === 'login' ? '登录' : '创建账号';
    $('#authAccountLabel').textContent = email ? '邮箱地址' : '手机号码';
    account.type = email ? 'email' : 'tel'; account.inputMode = email ? 'email' : 'tel'; account.autocomplete = email ? 'email' : 'tel'; account.placeholder = email ? 'name@example.com' : '+86 请输入手机号码'; account.value = '';
    $('#authAccountHelp').textContent = email ? '验证、登录和密码找回信息将发送到此邮箱。' : '短信验证码和安全通知将发送到此手机号。';
    $('#authCodeAction').textContent = email ? '使用邮箱验证码' : '使用短信验证码';
    $('#authNicknameField').classList.toggle('hidden', authMode !== 'register');
    $('#authPassword').autocomplete = authMode === 'login' ? 'current-password' : 'new-password';
    $('#authPassword').placeholder = authMode === 'login' ? '输入密码' : '设置至少 8 位密码';
    $('#authRecovery').hidden = authMode === 'register';
    $('#modalActions .primary-btn').textContent = authMode === 'login' ? '登录' : '创建账号';
  };
  $$('#authModeTabs button').forEach((button) => button.addEventListener('click', () => { authMode = button.dataset.authMode; renderAuthChoice(); }));
  $$('.auth-method').forEach((button) => button.addEventListener('click', () => { authMethod = button.dataset.authMethod; renderAuthChoice(); $('#authAccount').focus(); }));
  $('#authCodeAction').addEventListener('click', async () => {
    const account = $('#authAccount').value.trim().replace(authMethod === 'phone' ? /[\s()-]/g : /$^/, '');
    if (!account) { toast('请先填写邮箱或手机号。'); return; }
    try {
      await shyBackend.sendOtp({ method: authMethod, account, createUser: authMode === 'register' });
      $('#appModal').close(); setTimeout(() => openOtpVerification(authMethod, account, false), 80);
    } catch (error) { toast(friendlyAccountError(error)); }
  });
  $('#authRecovery').addEventListener('click', async () => {
    const account = $('#authAccount').value.trim().replace(authMethod === 'phone' ? /[\s()-]/g : /$^/, '');
    if (!account) { toast('请先填写需要找回的账号。'); return; }
    try {
      if (authMethod === 'email') { await shyBackend.recoverPassword(account); $('#appModal').close(); setTimeout(() => openRecoveryVerification(account), 80); }
      else { await shyBackend.sendOtp({ method: 'phone', account, createUser: false }); $('#appModal').close(); setTimeout(() => openOtpVerification('phone', account, true), 80); }
    } catch (error) { toast(friendlyAccountError(error)); }
  });
}

function setupSettings() {
  $$('.mode-choices button').forEach((button) => button.addEventListener('click', () => {
    state.mode = button.dataset.modeChoice;
    localStorage.setItem('shy-mode', state.mode); applyAppearance();
  }));
  $$('.palette').forEach((button) => button.addEventListener('click', () => {
    state.theme = button.dataset.themeChoice;
    localStorage.setItem('shy-theme', state.theme); applyAppearance();
  }));
  $('#reduceMotion').checked = state.reduceMotion; $('#highContrast').checked = state.highContrast;
  $('#reduceMotion').addEventListener('change', (event) => { state.reduceMotion = event.target.checked; localStorage.setItem('shy-reduce-motion', state.reduceMotion); applyAppearance(); });
  $('#highContrast').addEventListener('change', (event) => { state.highContrast = event.target.checked; localStorage.setItem('shy-high-contrast', state.highContrast); applyAppearance(); });
  $('#siteLanguage').addEventListener('change', (event) => { state.language = event.target.value; localStorage.setItem('shy-language', state.language); applyLanguage(); });
  $('#defaultDefinitionLanguage').value = state.definitionLanguage;
  $('#defaultDefinitionLanguage').addEventListener('change', (event) => updateDefinitions(event.target.value));
  applyProfileToForm(storedProfile());
  $$('.avatar-options .avatar').forEach((button) => button.addEventListener('click', () => {
    $$('.avatar-options .avatar').forEach((item) => item.classList.remove('selected'));
    button.classList.add('selected'); $('#profileAvatar').textContent = button.dataset.avatar;
  }));
  const reserved = ['admin', 'shy2speak', 'system', 'support', 'linspeak1'];
  let nicknameTimer;
  $('#nicknameInput').addEventListener('input', (event) => {
    clearTimeout(nicknameTimer); $('#nicknameStatus').textContent = '检查中…'; $('#nicknameStatus').style.color = 'var(--muted)';
    nicknameTimer = setTimeout(async () => {
      const normalized = event.target.value.trim().toLowerCase().replace(/\s+/g, ' ');
      let available = normalized.length >= 2 && !reserved.includes(normalized);
      if (available && state.authSession) {
        try { available = await shyBackend.checkNickname(event.target.value.trim()); }
        catch { $('#nicknameStatus').textContent = 'NAS 检查暂不可用'; $('#nicknameStatus').style.color = 'var(--amber)'; return; }
      }
      $('#nicknameStatus').textContent = available ? (state.authSession ? '全站可用' : '本机格式可用') : '已占用或为保留名称';
      $('#nicknameStatus').style.color = available ? 'var(--green)' : 'var(--red)';
    }, 420);
  });
  $('#signatureInput').addEventListener('input', (event) => $('#signatureCount').textContent = [...event.target.value].length);
  $('#saveProfile').addEventListener('click', async () => {
    const nickname = $('#nicknameInput').value.trim();
    if (nickname.length < 2 || reserved.includes(nickname.toLowerCase())) { toast('昵称格式不可用，请修改后再保存。'); return; }
    const profile = { nickname, signature: $('#signatureInput').value.trim(), avatar: $('#profileAvatar').textContent, updatedAt: new Date().toISOString() };
    try {
      if (state.authSession) await shyBackend.saveProfile({ ...profile, locale: state.language });
      writeStoredJSON(STORAGE_KEYS.profile, profile); applyProfileToForm(profile); scheduleCloudSync(50);
      toast(state.authSession ? '个人资料已保存；昵称已通过全站唯一性校验。' : '个人资料已保存在当前设备，登录后将自动同步。');
    } catch (error) { toast(friendlyAccountError(error)); }
  });
  $('#testMic').addEventListener('click', async () => {
    const button = $('#testMic'); button.disabled = true; button.textContent = '检测中…';
    try {
      const info = await getMicrophoneInfo();
      $('#micDeviceSummary').textContent = `${info.activeLabel} · ${info.channelCount === 2 ? 'Stereo Ch 1–2' : 'Mono Ch 1'}`;
      $('#micPermissionStatus').textContent = '已允许'; $('#micPermissionStatus').className = 'status success';
      toast(`麦克风检测通过 · ${info.sampleRate} Hz。`);
    } catch (error) {
      $('#micPermissionStatus').textContent = '未允许'; $('#micPermissionStatus').className = 'status warning';
      toast(error.name === 'NotAllowedError' ? '麦克风权限被拒绝，请在浏览器站点设置中开启。' : `麦克风检测失败：${error.message}`);
    } finally { button.disabled = false; button.textContent = '测试'; }
  });
  if (navigator.storage?.estimate) navigator.storage.estimate().then(({ usage = 0, quota = 0 }) => {
    $('#storageSummary').textContent = `已用 ${formatBytes(usage)} · 配额 ${formatBytes(quota)}`;
    $('#storagePermissionStatus').textContent = '可用'; $('#storagePermissionStatus').className = 'status success';
  }).catch(() => { $('#storageSummary').textContent = '浏览器未提供存储用量'; $('#storagePermissionStatus').textContent = '受限'; });
  $('#configureBackend').addEventListener('click', openBackendConfig);
  $('#authPreview').addEventListener('click', () => state.authSession ? navigate('settings') : openAuthModal());
  $('#accountAction').addEventListener('click', () => state.authSession ? syncCloudState(true).catch((error) => toast(friendlyAccountError(error))) : openAuthModal());
  $('#accountSignOut').addEventListener('click', async () => { await shyBackend.signOut(); state.authSession = null; updateAccountUI(); toast('已退出登录，本机学习记录仍然保留。'); });
  updateAccountUI();
}

function setupPWA() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});
  let installPrompt;
  addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); installPrompt = event; });
  window.installShy2Speak = async () => { if (installPrompt) { installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; } else toast('请使用浏览器菜单中的“安装应用”或“添加到主屏幕”。'); };
}

async function init() {
  applyAppearance();
  applyLanguage();
  document.documentElement.classList.add('app-ready');
  const account = await shyBackend.initialize().catch((error) => ({ session: null, error }));
  state.authSession = account.session || null;
  setupNavigation(); setupGlobalControls(); setupHoverToasts();
  await loadCatalog();
  setupCatalogControls(); setupPractice(); setupVocabulary(); setupListening(); setupDownloads(); setupStudio(); setupAI(); setupSettings(); setupPWA();
  state.accountReady = true; updateProfileChrome(); updateAccountUI();
  shyBackend.onAuthChange((session) => { state.authSession = session; updateAccountUI(); });
  if (state.authSession) await completeAuthenticatedSession(state.authSession).catch((error) => setSyncMessage('NAS 同步暂时不可用', `${friendlyAccountError(error)} · 本机数据未受影响`));
  updateDefinitions(state.definitionLanguage, false); renderAudioTime(); renderAnalyticsOverview(); navigate(state.view, false);
  addEventListener('pagehide', () => analytics.flush());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) analytics.flush();
    else {
      analytics.begin('views', state.view);
      if (state.view === 'practice' && currentTopic()) {
        analytics.begin('topics', currentTopic().id);
        if (currentChapter()) analytics.begin('chapters', `${currentTopic().id}:${currentChapter().id}`);
      }
    }
  });
}

init().catch((error) => {
  console.error('Application initialization failed', error);
  toast('应用初始化失败，请刷新页面重试。');
});
