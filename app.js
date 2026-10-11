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
  definitionLanguage: 'zh',
  vocabularyRemoved: false,
  cleanupReminder: 1,
};

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
  en: {
    confidence: ['confidence; trust', "a feeling of trust in one's ability or qualities"], approach: ['method; come near', 'a way of dealing with a situation or problem'], appreciate: ['value; be grateful', 'to recognize the value of something'], conversation: ['conversation; dialogue', 'an informal exchange of ideas by spoken words'], 'build-confidence': ['build confidence', 'to gradually become more certain of your ability'],
  },
  ja: {
    confidence: ['自信；信頼', '自分の能力や資質を信じる気持ち。'], approach: ['方法；近づく', '問題や状況に対処する方法。'], appreciate: ['感謝する；評価する', '価値を理解し、感謝すること。'], conversation: ['会話；対話', '複数の人による言葉のやり取り。'], 'build-confidence': ['自信をつける', '練習によって徐々に自信を高める。'],
  },
  es: {
    confidence: ['confianza; seguridad', 'la sensación de confiar en la propia capacidad'], approach: ['enfoque; acercarse', 'una forma de afrontar una situación'], appreciate: ['apreciar; agradecer', 'reconocer el valor de algo'], conversation: ['conversación; diálogo', 'intercambio de ideas mediante palabras'], 'build-confidence': ['ganar confianza', 'aumentar gradualmente la seguridad personal'],
  },
};

const viewTitles = {
  overview: ['学习概览', 'Learning overview'], practice: ['视频学习', 'Video practice'], vocabulary: ['生词本', 'Vocabulary'], listening: ['磨耳朵', 'Immersive listening'], downloads: ['离线内容', 'Offline content'], studio: ['内容工作台', 'Content studio'], ai: ['AI 服务', 'AI services'], settings: ['个人设置', 'Settings'],
};

function applyAppearance() {
  const resolvedMode = state.mode === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : state.mode;
  document.documentElement.dataset.mode = resolvedMode;
  document.documentElement.dataset.theme = state.theme;
  $('#modeIcon').textContent = resolvedMode === 'dark' ? '☾' : '☼';
  $('.control-label').textContent = resolvedMode === 'dark' ? '夜间' : '日间';
  const themeColor = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
  $('meta[name="theme-color"]').setAttribute('content', themeColor);
  $$('.mode-choices button').forEach((button) => button.classList.toggle('active', button.dataset.modeChoice === state.mode));
  $$('.palette').forEach((button) => button.classList.toggle('active', button.dataset.themeChoice === state.theme));
  const modeNames = { light: '日间', dark: '夜间', system: '跟随系统' };
  const themeNames = { violet: '经典紫', ocean: '海洋蓝', forest: '森林绿', sunset: '日落橙', sakura: '樱花粉' };
  if ($('#appearanceLabel')) $('#appearanceLabel').textContent = `${modeNames[state.mode]} · ${themeNames[state.theme]}`;
}

function applyLanguage() {
  document.documentElement.lang = state.language === 'zh' ? 'zh-CN' : 'en';
  $$('[data-i18n]').forEach((node) => {
    const value = copy[state.language][node.dataset.i18n];
    if (value) node.textContent = value;
  });
  $('#languageToggle').textContent = state.language === 'zh' ? '中 / EN' : 'EN / 中';
  $('#siteLanguage').value = state.language;
  updatePageTitle();
}

function updatePageTitle() {
  const title = viewTitles[state.view] || viewTitles.overview;
  $('#pageTitle').textContent = state.language === 'zh' ? title[0] : title[1];
  document.title = `${$('#pageTitle').textContent} · Shy2Speak`;
}

function navigate(view, push = true) {
  if (!viewTitles[view]) view = 'overview';
  state.view = view;
  $$('.view').forEach((section) => section.classList.toggle('active', section.id === `view-${view}`));
  $$('[data-view-link]').forEach((button) => button.classList.toggle('active', button.dataset.viewLink === view && (button.classList.contains('nav-item') || button.closest('.mobile-nav'))));
  $('.sidebar').classList.remove('open');
  updatePageTitle();
  if (push && location.hash !== `#/${view}`) history.pushState(null, '', `#/${view}`);
  scrollTo({ top: 0, behavior: 'smooth' });
}

function toast(message, actionText, action) {
  const node = document.createElement('div');
  node.className = 'toast';
  node.innerHTML = `<span>✓</span><p>${message}</p>${actionText ? `<button>${actionText}</button>` : ''}`;
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
    button.addEventListener('click', () => {
      const close = onClick?.() !== false;
      if (close) modal.close();
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

function setupPractice() {
  $$('.lyric-line').forEach((line) => line.addEventListener('click', () => {
    $$('.lyric-line').forEach((item) => item.classList.remove('active'));
    line.classList.add('active');
  }));
  let recording = false;
  $('#recordButton').addEventListener('click', () => {
    recording = !recording;
    $('#recordButton').classList.toggle('recording', recording);
    $('#recordLabel').textContent = recording ? '正在录音 · 点击结束' : '按住跟读';
    if (!recording) setTimeout(() => toast('录音已完成，模拟评分结果为 86 分。'), 250);
  });
  $('#micDeviceButton').addEventListener('click', () => showModal({
    eyebrow: 'MICROPHONE', title: '麦克风设备与声道',
    body: `<div class="modal-field"><label>输入设备</label><select><option>MacBook Pro 麦克风（系统默认）</option><option>Blue Yeti USB</option><option>OBS Virtual Microphone</option></select></div><div class="modal-field"><label>输入声道</label><select><option>Mono · Ch 1（推荐）</option><option>Stereo · Ch 1–2</option></select></div><div class="warning-box"><span>♩</span><p><strong>输入状态正常</strong><br><small>48 kHz · 实时音量 -18 dB。录音结束后会立即释放麦克风。</small></p></div>`,
    actions: [{ label: '进入权限管理', onClick: () => navigate('settings') }, { label: '播放测试音', style: 'primary', onClick: () => toast('麦克风测试通过。') }],
  }));
  $('mark[data-word="confidence"]', $('#practiceLyrics')).addEventListener('click', (event) => {
    event.stopPropagation();
    navigate('vocabulary');
  });
}

function updateDefinitions(language) {
  state.definitionLanguage = language;
  $$('[data-definition]').forEach((node) => {
    const entry = definitions[language][node.dataset.definition];
    if (entry) node.textContent = entry[0];
  });
  const active = $('.word-list-item.active');
  const id = active?.dataset.wordId || 'confidence';
  const entry = definitions[language][id];
  if (entry) {
    $('#primaryDefinition').textContent = entry[0];
    $('#definitionText').textContent = entry[1];
  }
  toast(`生词释义已切换为 ${$('#definitionLanguage').selectedOptions[0].textContent}。`);
}

function setupVocabulary() {
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
  $('#demoDownload').addEventListener('click', () => showModal({
    eyebrow: 'CELLULAR DATA', title: '将使用较多移动数据',
    body: `<div class="warning-box"><span>⚠</span><p><strong>本次预计使用约 286 MB 移动数据</strong><br><small>包含 2 个视频、3 个音频和双语字幕。建议连接 Wi-Fi 后继续。</small></p></div><p>只有在你手动确认后，下载才会开始。</p>`,
    actions: [{ label: '取消下载' }, { label: '等待 Wi-Fi', onClick: () => toast('任务已加入队列，将在连接 Wi-Fi 后自动开始。') }, { label: '仍然下载', style: 'primary', onClick: () => toast('已确认使用移动数据，下载任务开始。') }],
  }));
  $('#downloadSettings').addEventListener('click', () => showModal({ eyebrow: 'DOWNLOAD SETTINGS', title: '下载设置', body: `<div class="modal-field"><label>网络策略</label><select><option>移动数据超过 50 MB 时询问</option><option>仅 Wi-Fi 下载</option><option>禁止移动数据下载</option></select></div><div class="modal-field"><label>默认视频质量</label><select><option>720p（推荐）</option><option>360p</option><option>1080p</option></select></div><div class="modal-field"><label>最大缓存空间</label><select><option>10 GB</option><option>5 GB</option><option>无限制</option></select></div>`, actions: [{ label: '取消' }, { label: '保存设置', style: 'primary', onClick: () => toast('下载设置已保存。') }] }));
  $$('.redownload').forEach((button) => button.addEventListener('click', () => toast('正在重新下载最新媒体版本，个人设置将保留。')));
  $$('.pause-download').forEach((button) => button.addEventListener('click', () => { button.textContent = button.textContent === 'Ⅱ' ? '▶' : 'Ⅱ'; toast(button.textContent === '▶' ? '下载已暂停。' : '下载已继续。'); }));
  $$('.download-more').forEach((button) => button.addEventListener('click', () => showModal({ eyebrow: 'OFFLINE ITEM', title: '管理离线内容', body: `<p>删除媒体不会删除学习进度、生词、历史成绩或个人歌词时间轴。</p>`, actions: [{ label: '重新下载', onClick: () => toast('重新下载任务已创建。') }, { label: '删除本地文件', style: 'primary', onClick: () => toast('本地媒体已删除，可随时重新下载。') }] })));
  $('#selectAllDownloads').addEventListener('change', (event) => $$('.download-row input[type="checkbox"]').forEach((checkbox) => checkbox.checked = event.target.checked));
}

function setupStudio() {
  $('#inspectAudio').addEventListener('click', () => { $('#sourceCheck').style.display = 'flex'; toast('在线音频检查完成：格式、Range 请求和授权信息正常。'); });
  $('#generatePpt').addEventListener('click', () => {
    const button = $('#generatePpt');
    button.disabled = true; button.textContent = '✦ 正在生成大纲与 Slide…';
    setTimeout(() => { button.textContent = '✓ 已生成 8 页 · 预览右侧结果'; toast('HTML PPT 已生成，音频时间轴同步完成。'); }, 1300);
    setTimeout(() => { button.disabled = false; button.textContent = '✦ 重新生成 HTML PPT'; }, 3000);
  });
}

function setupAI() {
  $$('.test-model').forEach((button) => button.addEventListener('click', () => {
    const original = button.textContent; button.textContent = '测试中…'; button.disabled = true;
    setTimeout(() => { button.textContent = original; button.disabled = false; toast('连接成功 · 延迟 642 ms · 语音能力已验证。'); }, 900);
  }));
  const providerModal = () => showModal({ eyebrow: 'AI PROVIDER', title: '添加 API 厂商', body: `<div class="modal-field"><label>厂商类型</label><select><option>OpenAI-compatible</option><option>Azure OpenAI</option><option>Azure Speech</option><option>Google / Gemini</option></select></div><div class="modal-field"><label>API Base URL</label><input value="https://api.example.com/v1"></div><div class="modal-field"><label>API Key</label><input type="password" value="sk-placeholder"></div>`, actions: [{ label: '取消' }, { label: '测试并保存', style: 'primary', onClick: () => toast('API 连接测试成功，密钥已加密保存。') }] });
  $('#addProvider').addEventListener('click', providerModal); $('#configureProvider').addEventListener('click', providerModal);
  $('#restorePrompt').addEventListener('click', () => {
    $('#promptEditor').value = '你是一位耐心、准确的英语发音教练。根据语音服务返回的逐词与音素分数，为学习者提供简洁、可执行的反馈。不要修改原始分数。';
    toast('已恢复系统默认提示词，尚未保存。');
  });
  $('#testPrompt').addEventListener('click', () => showModal({ eyebrow: 'PROMPT A/B TEST', title: '提示词对比测试', body: `<div class="warning-box"><span>86</span><p><strong>新模板输出通过验证</strong><br><small>发音 89 · 流利度 82 · 完整度 91<br>建议：重读 con-FI-dence 的第一音节。</small></p></div><p>响应时间 1.2 秒 · 估算费用 ¥0.03 · JSON Schema 完整。</p>`, actions: [{ label: '保留旧模板' }, { label: '启用新版本', style: 'primary', onClick: () => toast('鼓励型反馈 v4 已启用。') }] }));
  $('#savePrompt').addEventListener('click', () => toast('提示词已保存为 v4 并启用，历史评分仍使用原版本。'));
  $('#newPrompt').addEventListener('click', () => toast('已复制当前模板，可编辑后另存为新模板。'));
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
  $('#siteLanguage').addEventListener('change', (event) => { state.language = event.target.value; localStorage.setItem('shy-language', state.language); applyLanguage(); });
  $$('.avatar-options .avatar').forEach((button) => button.addEventListener('click', () => {
    $$('.avatar-options .avatar').forEach((item) => item.classList.remove('selected'));
    button.classList.add('selected'); $('#profileAvatar').textContent = button.dataset.avatar;
  }));
  const reserved = ['admin', 'shy2speak', 'system', 'support', 'linspeak1'];
  let nicknameTimer;
  $('#nicknameInput').addEventListener('input', (event) => {
    clearTimeout(nicknameTimer); $('#nicknameStatus').textContent = '检查中…'; $('#nicknameStatus').style.color = 'var(--muted)';
    nicknameTimer = setTimeout(() => {
      const normalized = event.target.value.trim().toLowerCase().replace(/\s+/g, ' ');
      const available = normalized.length >= 2 && !reserved.includes(normalized);
      $('#nicknameStatus').textContent = available ? '✓ 可用' : '已被使用 · 试试 LinSpeak_27';
      $('#nicknameStatus').style.color = available ? 'var(--green)' : 'var(--red)';
    }, 420);
  });
  $('#signatureInput').addEventListener('input', (event) => $('#signatureCount').textContent = [...event.target.value].length);
  $('#saveProfile').addEventListener('click', () => toast('个人资料已保存，昵称唯一性验证通过。'));
  $('#testMic').addEventListener('click', () => toast('麦克风测试通过 · Mono Ch 1 · 48 kHz。'));
  $('#authPreview').addEventListener('click', () => showModal({ eyebrow: 'WELCOME TO SHY2SPEAK', title: '登录或创建账号', body: `<div class="auth-tabs"><button class="active" type="button">登录</button><button type="button">注册</button></div><div class="modal-field"><label>邮箱或手机号</label><input placeholder="name@example.com / +86 手机号"></div><div class="modal-field"><label>密码</label><input type="password" placeholder="输入密码"></div><p><button class="text-btn" type="button">使用验证码登录</button> · <button class="text-btn" type="button">找回密码</button></p>`, actions: [{ label: '取消' }, { label: '登录', style: 'primary', onClick: () => toast('这是登录流程的交互预览。') }] }));
}

function setupPWA() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});
  let installPrompt;
  addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); installPrompt = event; });
  window.installShy2Speak = async () => { if (installPrompt) { installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; } else toast('请使用浏览器菜单中的“安装应用”或“添加到主屏幕”。'); };
}

function init() {
  applyAppearance(); applyLanguage(); setupNavigation(); setupGlobalControls(); setupPractice(); setupVocabulary(); setupListening(); setupDownloads(); setupStudio(); setupAI(); setupSettings(); setupPWA(); renderAudioTime(); navigate(state.view, false);
}

init();
