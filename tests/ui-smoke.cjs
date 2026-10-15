const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const port = 4174;
const origin = `http://127.0.0.1:${port}`;
const catalogFixture = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'catalog.json'), 'utf8'));
const vocabularyFixture = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'vocabulary.json'), 'utf8'));
function silentWav(seconds = 260) {
  const sampleRate = 8000; const dataSize = sampleRate * seconds; const buffer = Buffer.alloc(44 + dataSize, 128);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + dataSize, 4); buffer.write('WAVEfmt ', 8); buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate, 28);
  buffer.writeUInt16LE(1, 32); buffer.writeUInt16LE(8, 34); buffer.write('data', 36); buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}
const audioFixture = silentWav();
catalogFixture.topics[0].transcriptOrigin = 'youtube-public-captions';
catalogFixture.topics[0].chapters = [
  {
    id: 'chapter-01', index: 1, title: 'Verified captions', titleZh: '已验证字幕', start: 0, durationLabel: '0:08', previewWords: ['welcome'],
    sentences: [
      { id: 'sentence-001', start: 0, end: 3.5, en: 'Welcome back to this verified test lesson.', zh: '欢迎回到已验证的测试课程。', words: ['welcome'] },
      { id: 'sentence-002', start: 3.5, end: 8, en: 'Repeat this sentence clearly.', zh: '请清晰地跟读这句话。', words: [] },
    ],
  },
  { id: 'chapter-02', index: 2, title: 'Pending section', titleZh: '待同步小节', start: 8, durationLabel: '待同步', previewWords: [], sentences: [] },
];
catalogFixture.topics[0].chapters.push({
  id: 'chapter-03', index: 3, title: 'Long transcript', titleZh: '长字幕测试', start: 20, durationLabel: '4:00', previewWords: [],
  sentences: Array.from({ length: 80 }, (_, index) => ({ id: `long-sentence-${index + 1}`, start: 20 + index * 3, end: 23 + index * 3, en: `Long listening sentence ${index + 1}.`, zh: `长字幕测试第 ${index + 1} 句。`, words: [] })),
});
catalogFixture.topics = Array.from({ length: 85 }, (_, index) => {
  if (index === 0) return catalogFixture.topics[0];
  const videoId = `TEST${String(index).padStart(7, '0')}`;
  return {
    id: `youtube-${videoId.toLowerCase()}`, provider: 'youtube', videoId, playlistId: catalogFixture.source.playlistId,
    title: `English Lesson ${index + 1}`, localizedTitles: { en: `English Lesson ${index + 1}`, zh: `英语课程 ${index + 1}` },
    channelTitle: 'Verified channel', thumbnail: `${origin}/icons/icon.svg`, transcriptOrigin: 'pending',
    chapters: [{ id: 'chapter-01', index: 1, title: 'Full video', titleZh: '完整视频', start: 0, durationLabel: '待同步', previewWords: [], sentences: [] }],
  };
});
const cloudState = {
  payload: {
    version: 1,
    updatedAt: '2099-10-11T00:00:00Z',
    analytics: {
      version: 1, updatedAt: '2099-10-11T00:00:00Z', events: [], days: {}, topics: {}, chapters: {},
      views: { practice: { practiceSeconds: 600, practiceCount: 1, recordings: 0, scores: [], lastPracticedAt: '2099-10-11T00:00:00Z' } },
      sentences: { 'youtube-vfe7ap1kfk0:chapter-01:sentence-01': { practiceSeconds: 30, practiceCount: 2, recordings: 1, lastPracticedAt: '2099-10-11T00:00:00Z', scores: [{ total: 91, pronunciation: 92, fluency: 89, completeness: 93, words: [], createdAt: '2099-10-11T00:00:00Z' }] } },
    },
    profile: { nickname: 'CloudSnapshot', signature: '', avatar: 'S' }, customTopics: [], prompts: null,
    preferences: { mode: 'light', theme: 'forest', language: 'zh', definitionLanguage: 'zh' },
  },
  client_updated_at: '2099-10-11T00:00:00Z',
};
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: __dirname + '/..', stdio: 'ignore' });
let browser;
let savedProfile = null;
let textCapabilityCalls = 0;
let speechCapabilityCalls = 0;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  await wait(350);
  browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.includes('/data/catalog.json')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(catalogFixture) });
    if (url.includes('/api/youtube/audio/')) return route.fulfill({ status: 200, headers: { 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes' }, body: audioFixture });
    if (url.includes('youtube.com/oembed')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ title: 'Live YouTube lesson', author_name: 'Verified channel', thumbnail_url: `${origin}/icons/icon.svg` }) });
    if (url.includes('youtube-nocookie.com/embed/')) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>YouTube fixture</title>' });
    if (url.includes('i.ytimg.com')) return route.fulfill({ status: 204 });
    if (url === 'https://text-ai.test/v1/models') { textCapabilityCalls += 1; return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [{ id: 'deepseek-chat' }] }) }); }
    if (url === 'https://text-ai.test/v1/chat/completions') { textCapabilityCalls += 1; return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: '{"translation":"购物中心","html":"<section>Lesson</section>"}' } }] }) }); }
    if (url === 'https://speech-ai.test/v1/models') { speechCapabilityCalls += 1; return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [{ id: 'whisper-1' }] }) }); }
    if (url === 'https://speech-ai.test/v1/audio/transcriptions') { speechCapabilityCalls += 1; return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ text: '' }) }); }
    if (url === `${origin}/api/health`) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, database: 'postgresql', auth: { email: true, phone: true, emailOtp: false, phoneOtp: false, passwordRecovery: false } }) });
    if (url === `${origin}/api/auth/login`) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 900, user: { id: '00000000-0000-4000-8000-000000000001', email: 'learner@example.com' } }) });
    if (url === `${origin}/api/learning-state` && route.request().method() === 'GET') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(cloudState) });
    if (url === `${origin}/api/learning-state`) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ syncedAt: '2099-10-11T00:00:00Z', snapshotCount: 1 }) });
    if (url === `${origin}/api/profile/nickname/check`) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ available: true }) });
    if (url === `${origin}/api/profile` && route.request().method() === 'GET') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: '00000000-0000-4000-8000-000000000001', nickname: 'NasLearner', signature: 'Synced profile', avatar: '🚀', locale: 'zh', updated_at: '2026-10-11T00:00:00Z' }) });
    if (url === `${origin}/api/profile` && route.request().method() === 'PUT') { savedProfile = route.request().postDataJSON(); return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: '00000000-0000-4000-8000-000000000001', ...savedProfile, updated_at: '2026-10-11T00:00:00Z' }) }); }
    if (url === `${origin}/api/vocabulary` && route.request().method() === 'GET') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(vocabularyFixture) });
    if (url === `${origin}/api/vocabulary/delete-everywhere`) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ deletedIds: [], deletedCount: 0 }) });
    return route.continue();
  });

  await page.goto(`${origin}/#/practice`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('html.app-ready');
  assert.notEqual(await page.locator('#welcomeNickname').textContent(), 'Lin', 'the welcome card must never expose the legacy placeholder nickname');
  await page.waitForSelector('#topicSelect option', { state: 'attached' });
  assert.equal(await page.locator('#topicSelect option').count(), 85, 'all 85 playlist topics should render');
  assert.match(await page.locator('#topicSelect option').first().textContent(), /^1\. /, 'video topics should be numbered from one');
  assert.match(await page.locator('#topicSelect option').last().textContent(), /^85\. /, 'the complete video topic list should end at 85');
  assert.equal(await page.locator('.top-avatar').textContent(), '登录', 'anonymous users should see a neutral sign-in affordance');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const anonymousMobileOverflow = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth,
    offenders: [...document.querySelectorAll('body *')].filter((node) => node.getBoundingClientRect().right > innerWidth + 1).slice(0, 8).map((node) => `${node.tagName}.${node.className}`),
  }));
  assert.equal(anonymousMobileOverflow.overflow, false, `anonymous sign-in affordance must not overflow the mobile header: ${JSON.stringify(anonymousMobileOverflow)}`);
  await page.setViewportSize({ width: 1440, height: 900 });
  assert.ok((await page.locator('#topicSelect option').first().textContent()).includes('商场英语词汇'), 'topic picker should show English and the current-language title');
  assert.equal(await page.locator('.chapters-card .chapter').count(), 3, 'catalog chapters should render');
  assert.equal(await page.locator('#practiceLyrics .lyric-line').count(), 2, 'server-synced sentence lyrics should render');
  assert.equal(await page.locator('#keyExpressionCount').textContent(), '1', 'key-expression count should come from the current real caption text');
  await page.click('[data-practice-mode="expressions"]');
  assert.equal(await page.locator('#practiceLyrics .expression-line').count(), 1, 'key expressions should render as a real caption-derived learning view');
  assert.equal(await page.locator('#practiceLyrics .expression-line strong').textContent(), 'welcome back to');
  assert.ok((await page.locator('#practiceLyrics .expression-line q').textContent()).includes('Welcome back to this verified test lesson.'));
  await page.click('[data-practice-mode="transcript"]');
  assert.equal(await page.locator('#practiceLyrics .transcript-line').count(), 2, 'full transcript should render every caption sentence');
  await page.click('[data-practice-mode="sentences"]');
  await page.selectOption('#topicSelect', { index: 1 });
  assert.equal(await page.locator('#continuePracticeLabel').textContent(), '继续 · 2. 英语课程 2', 'overview continuation should name the last selected video instead of a fixed chapter');
  await page.evaluate(() => window.navigate('overview'));
  await page.click('#continuePracticeButton');
  assert.equal(await page.locator('#view-practice').evaluate((node) => node.classList.contains('active')), true, 'continuation should open video practice');
  assert.equal(await page.locator('#topicSelect').inputValue(), 'youtube-test0000001', 'continuation should preserve the last selected video');
  await page.selectOption('#topicSelect', { index: 0 });

  await page.locator('.side-nav .nav-item').first().hover();
  await page.waitForSelector('#globalHoverToast.visible');
  assert.equal(await page.locator('#globalHoverToast').textContent(), '学习概览', 'sidebar buttons should show hover guidance');
  await page.locator('.top-actions .share-page').hover();
  await page.waitForFunction(() => document.querySelector('#globalHoverToast')?.textContent === '分享当前页面');
  await page.click('#sidebarCollapse');
  assert.equal(await page.locator('html').getAttribute('data-sidebar-collapsed'), 'true', 'desktop sidebar should collapse on demand');
  await page.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().width < 100);
  assert.ok((await page.locator('.sidebar').boundingBox()).width < 100, 'collapsed sidebar should use icon-only width');
  await page.click('#sidebarCollapse');
  assert.equal(await page.locator('html').getAttribute('data-sidebar-collapsed'), 'false', 'desktop sidebar should expand again');

  await page.evaluate(() => localStorage.setItem('shy-language', 'en'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('html.app-ready');
  assert.equal(await page.locator('html').getAttribute('lang'), 'en', 'saved English should apply before the app becomes visible');
  assert.equal(await page.locator('body').evaluate((node) => getComputedStyle(node).opacity), '1', 'the app should become visible after applying the saved language');
  assert.equal(await page.locator('#pageTitle').textContent(), 'Video practice', 'refresh should restore the English interface');
  assert.equal(await page.locator('.top-avatar').textContent(), 'Sign in', 'anonymous account affordance should follow the interface language');
  await page.locator('#languageToggle').hover();
  await page.waitForFunction(() => document.querySelector('#globalHoverToast')?.textContent === 'Switch interface language to Chinese');
  assert.equal(await page.locator('#languageToggle').getAttribute('aria-label'), 'Switch interface language to Chinese', 'top-right language guidance should follow the interface language');
  const englishHeadings = { overview: 'Welcome back', vocabulary: 'My vocabulary', listening: 'Listening', ai: 'Unified AI configuration and scoring prompts', settings: 'Settings' };
  for (const [view, heading] of Object.entries(englishHeadings)) {
    await page.evaluate((next) => window.navigate(next), view);
    await page.waitForFunction(({ id, text }) => document.querySelector(`#view-${id} .page-heading h1, #view-${id} .welcome-card h1`)?.textContent.includes(text), { id: view, text: heading });
  }
  const englishChromeSelectors = ['#goalMessage', '#streakStatus', '#learningInsight', '#vocabularySummary', '#cleanupBannerTitle', '#cleanupBannerMeta', '#detailBookStatus', '#detailMediaMeta', '#accountAction', '#promptTabs'];
  for (const selector of englishChromeSelectors) {
    const value = await page.locator(selector).textContent();
    assert.equal(/[\u3400-\u9fff]/.test(value), false, `${selector} should translate dynamic interface text to English`);
  }
  await page.evaluate(() => window.navigate('practice'));
  await page.evaluate(() => localStorage.setItem('shy-language', 'zh'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#topicSelect option', { state: 'attached' });

  const desktopLayout = await page.evaluate(() => {
    const video = document.querySelector('.practice-learning .video-card').getBoundingClientRect();
    const lyrics = document.querySelector('.practice-learning .lyrics-card').getBoundingClientRect();
    return { sameTop: Math.abs(video.top - lyrics.top) < 2, adjacent: Math.abs(video.right - lyrics.left) < 2, overflow: document.documentElement.scrollWidth > innerWidth };
  });
  assert.deepEqual(desktopLayout, { sameTop: true, adjacent: true, overflow: false }, 'desktop learning workspace must stay side by side');

  await page.click('#youtubePlay');
  await page.waitForSelector('.youtube-frame');
  assert.equal(await page.locator('#practiceTopicTitle').textContent(), '1. Live YouTube lesson', 'runtime YouTube metadata should update the numbered title');
  assert.equal(await page.locator('.youtube-frame').count(), 1, 'official YouTube player should be mounted');
  const initialPracticeFrame = page.frames().find((frame) => frame.url().includes('youtube-nocookie.com/embed/'));
  assert.ok(initialPracticeFrame, 'the practice player should be available');
  await initialPracticeFrame.evaluate(() => parent.postMessage(JSON.stringify({ event: 'onStateChange', info: 1 }), '*'));
  await page.waitForFunction(() => document.querySelector('.youtube-frame')?.dataset.playbackState === 'playing');
  assert.equal(await page.locator('.youtube-frame').getAttribute('data-playback-state'), 'playing', 'a real video-playing event should mark practice playback active');

  await page.locator('.chapter').nth(1).click();
  assert.ok((await page.locator('.lyrics-empty').textContent()).includes('尚未同步'), 'chapter without transcript should show an honest empty state');

  assert.equal(await page.locator('#view-downloads').count(), 0, 'offline content view should be removed');
  assert.equal(await page.locator('[data-view-link="downloads"]').count(), 0, 'offline content navigation should be removed');
  await page.evaluate(() => window.navigate('downloads'));
  assert.ok(await page.locator('#view-overview').evaluate((node) => node.classList.contains('active')), 'legacy offline route should fall back to overview');
  assert.equal(await page.locator('.youtube-frame').getAttribute('data-playback-state'), 'paused', 'leaving video practice must pause the video');

  assert.equal(await page.locator('#view-studio').count(), 0, 'content studio view should be removed');
  assert.equal(await page.locator('[data-view-link="studio"]').count(), 0, 'content studio navigation should be removed');
  await page.evaluate(() => window.navigate('studio'));
  assert.ok(await page.locator('#view-overview').evaluate((node) => node.classList.contains('active')), 'legacy content studio route should fall back to overview');

  const views = ['overview', 'vocabulary', 'listening', 'ai', 'settings'];
  for (const view of views) {
    await page.evaluate((next) => window.navigate(next), view);
    assert.ok(await page.locator(`#view-${view}`).evaluate((node) => node.classList.contains('active')), `${view} must be navigable`);
  }

  await page.evaluate(() => window.navigate('vocabulary'));
  await page.waitForFunction(() => document.querySelector('#vocabularySummary')?.textContent.includes('0'));
  assert.equal(await page.locator('.word-list-item').count(), 0, 'the unauthenticated vocabulary view must not ship demo words');
  assert.equal(await page.locator('.vocabulary-empty').count(), 1, 'an honest vocabulary empty state should render');
  assert.equal(await page.locator('#cleanupOpen').isDisabled(), true, 'cleanup should be disabled when there are no saved words');
  assert.equal(await page.locator('#navVocabularyCount').textContent(), '0', 'the vocabulary badge should reflect the real empty library');
  assert.equal(await page.locator('#navVocabularyCount').evaluate((node) => node.classList.contains('hidden')), true, 'a zero vocabulary count must hide the navigation badge');

  await page.evaluate(() => window.navigate('settings'));
  await page.locator('#reduceMotion').check({ force: true }); await page.locator('#highContrast').check({ force: true });
  assert.equal(await page.locator('html').getAttribute('data-reduce-motion'), 'true', 'reduce motion setting should apply');
  assert.equal(await page.locator('html').getAttribute('data-high-contrast'), 'true', 'high contrast setting should apply');
  await page.click('#authPreview');
  assert.ok((await page.locator('#modalTitle').textContent()).includes('绿联 NAS'), 'unconfigured auth must request the self-hosted NAS address');
  await page.fill('#backendUrl', origin);
  await page.locator('#modalActions .primary-btn').click();
  await page.waitForFunction(() => !document.querySelector('#appModal').open);
  assert.ok((await page.locator('#backendStatus').textContent()).includes('已配置'), 'successful real health check should update backend state');
  await page.click('#authPreview');
  await page.click('[data-auth-method="phone"]');
  assert.equal(await page.locator('#authAccount').getAttribute('type'), 'tel', 'phone auth must use a separate tel input');
  assert.ok((await page.locator('#modalBody').textContent()).includes('真实账号服务已连接'), 'auth dialog must no longer be a demo flow');
  await page.click('[data-auth-method="email"]');
  await page.focus('#authAccount');
  const authInputLayout = await page.evaluate(() => {
    const input = document.querySelector('#authAccount').getBoundingClientRect();
    const body = document.querySelector('#modalBody').getBoundingClientRect();
    return { leftClearance: input.left - body.left, rightClearance: body.right - input.right, width: input.width, bodyWidth: body.width, boxShadow: getComputedStyle(document.querySelector('#authAccount')).boxShadow };
  });
  assert.ok(authInputLayout.leftClearance >= 5 && authInputLayout.rightClearance >= 5 && authInputLayout.width <= authInputLayout.bodyWidth, 'focused auth inputs need enough horizontal clearance for their outer focus ring');
  assert.notEqual(authInputLayout.boxShadow, 'none', 'focused email input should render an unclipped outer focus ring');
  await page.focus('#authPassword');
  const passwordClearance = await page.evaluate(() => {
    const input = document.querySelector('#authPassword').getBoundingClientRect(); const body = document.querySelector('#modalBody').getBoundingClientRect();
    return { left: input.left - body.left, right: body.right - input.right, shadow: getComputedStyle(document.querySelector('#authPassword')).boxShadow };
  });
  assert.ok(passwordClearance.left >= 5 && passwordClearance.right >= 5 && passwordClearance.shadow !== 'none', 'password focus ring should remain visible on both sides');
  await page.fill('#authAccount', 'learner@example.com');
  await page.fill('#authPassword', 'correct-password');
  await page.locator('#modalActions .primary-btn').click();
  await page.waitForFunction(() => !document.querySelector('#appModal').open);
  await page.waitForFunction(() => document.querySelector('#backendStatus').textContent.includes('已登录'));
  assert.notEqual(await page.locator('.top-avatar').textContent(), '登录', 'authenticated users should see their profile avatar');
  assert.equal(await page.locator('#nicknameInput').inputValue(), 'NasLearner', 'authenticated profile should hydrate from the self-hosted backend adapter');
  assert.equal(await page.locator('#welcomeNickname').textContent(), 'NasLearner', 'the welcome card should use the authenticated nickname');
  assert.ok((await page.locator('#syncStateTitle').textContent()).includes('同步'), 'login must run a learning-state synchronization');
  assert.equal(await page.locator('#metricAverageScore').textContent(), '91', 'newer cloud learning history should hydrate locally');
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'forest', 'newer cloud preferences should hydrate locally');

  await page.evaluate(() => window.navigate('overview'));
  await page.click('#skillReportButton');
  assert.equal(await page.locator('[data-report-state="scored"]').count(), 1, 'skill report button should open a report backed by verified scores');
  assert.equal(await page.locator('#skillReportScoreCount').textContent(), '1 次真实评分', 'skill report should expose the real verified-score count');
  assert.ok((await page.locator('#modalBody').textContent()).includes('91'), 'skill report should display the synchronized real score');
  await page.locator('#modalActions .secondary-btn').click();

  await page.evaluate(() => window.navigate('vocabulary'));
  await page.waitForFunction(() => document.querySelector('#vocabularySummary')?.textContent.includes('0'));
  assert.equal(await page.locator('.word-list-item').count(), 0, 'authenticated accounts must start without seeded demo words');
  assert.equal((await page.locator('#view-vocabulary').textContent()).includes('shopping mall'), false, 'legacy demo vocabulary must not remain in the page');
  assert.equal(await page.locator('#cleanupCount').textContent(), '0', 'the cleanup count should be zero after demo removal');
  assert.equal(await page.locator('#reviewCount').textContent(), '0', 'the overview review count should use the real vocabulary total');

  await page.evaluate(() => { Object.defineProperty(window, '__SHY2SPEAK_CONFIG__', { configurable: true, value: { apiBase: '/api' } }); window.navigate('listening'); });
  assert.equal(await page.locator('#listeningQueue .queue-track').count(), 85, 'all real course videos should populate the listening audio queue');
  assert.equal(await page.locator('#listeningQueue .queue-track .drag-handle').first().textContent(), '1', 'audio tracks should be numbered from one');
  assert.equal(await page.locator('#listeningQueue .queue-track .drag-handle').last().textContent(), '85', 'the complete audio queue should end at 85');
  assert.equal(await page.locator('#listeningPlaylistList .playlist-item').count(), 1, 'legacy listening test playlists must be removed');
  assert.equal((await page.locator('#view-listening').textContent()).includes('测试集'), false, 'listening UI must not expose legacy test data');
  const firstListeningTitle = await page.locator('#listeningQueue .queue-track strong').first().textContent();
  await page.click('#editPlaylist');
  await page.locator('#listeningQueue .queue-track').first().dragTo(page.locator('#listeningQueue .queue-track').nth(1));
  assert.notEqual(await page.locator('#listeningQueue .queue-track strong').first().textContent(), firstListeningTitle, 'dragging must persistently reorder listening tracks');
  assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem('shy-listening-course-order-v1') || '[]').length)), 85, 'edited course order must be persisted');
  await page.locator('#listeningQueue .queue-track').first().click();
  assert.equal(await page.locator('.listening-youtube-frame').count(), 0, 'clicking a queue item in edit mode should not start playback');
  await page.click('#editPlaylist');
  await page.click('#newPlaylist');
  const playlistSelectLayout = await page.evaluate(() => {
    const input = document.querySelector('#newListeningPlaylistName').getBoundingClientRect();
    const select = document.querySelector('#newListeningPlaylistSort');
    const selectRect = select.getBoundingClientRect(); const body = document.querySelector('#modalBody').getBoundingClientRect();
    return { fieldsFit: input.right <= body.right && selectRect.right <= body.right, arrowPosition: getComputedStyle(select).backgroundPosition };
  });
  assert.ok(playlistSelectLayout.fieldsFit, 'new-playlist fields must remain inside the modal');
  assert.ok(playlistSelectLayout.arrowPosition.includes('12px'), 'select arrow should have comfortable right-edge spacing');
  await page.locator('#appModal').evaluate((dialog) => dialog.close());
  await page.locator('#listeningQueue .queue-track').nth(1).click();
  await page.waitForSelector('.listening-audio-engine', { state: 'attached' });
  assert.equal(await page.locator('#audioPlay').textContent(), 'Ⅱ', 'clicking a listening queue item should start playback');
  assert.equal(await page.locator('.listening-youtube-frame').count(), 0, 'self-hosted listening should prefer an audio-only stream');
  assert.equal(await page.locator('.youtube-frame').getAttribute('data-playback-state'), 'paused', 'listening playback must pause the practice video');
  assert.equal(await page.locator('#listeningLines .listen-line').count(), 82, 'long listening transcripts should render inside the lyrics card');
  const listeningLayout = await page.evaluate(() => {
    const playerCard = document.querySelector('.audio-player').getBoundingClientRect();
    const audio = document.querySelector('.listening-audio-engine');
    const cover = document.querySelector('.cover-orbit');
    const lyrics = document.querySelector('#listeningLines');
    return { playerHeight: playerCard.height, audioOnly: getComputedStyle(audio).display === 'none', coverVisible: getComputedStyle(cover).display !== 'none' && cover.getBoundingClientRect().height > 0, lyricsScrollable: lyrics.scrollHeight > lyrics.clientHeight };
  });
  assert.ok(listeningLayout.playerHeight <= 760 && listeningLayout.audioOnly && listeningLayout.coverVisible, `listening must use an audio-only music-player presentation: ${JSON.stringify(listeningLayout)}`);
  assert.equal(listeningLayout.lyricsScrollable, true, 'long lyrics should scroll inside their card');
  await page.locator('#listeningLines .listen-line').filter({ hasText: 'Long listening sentence 35.' }).click();
  await page.waitForFunction(() => Number(document.querySelector('#listeningLines .listen-line.active')?.dataset.start || 0) >= 119);
  await page.waitForFunction(() => document.querySelector('#listeningLines').scrollTop > 0);
  await page.click('#nextAudio');
  assert.ok((await page.locator('#listeningTrackMeta').textContent()).includes('/ 85'), 'listening next-track control should move through the 85-video queue');
  await page.evaluate(() => window.navigate('practice'));
  assert.equal(await page.locator('.listening-audio-engine').count(), 1, 'opening video practice without playing video must keep listening audio mounted');
  assert.equal(await page.locator('#audioPlay').textContent(), 'Ⅱ', 'opening video practice without playing video must keep audio playing');
  assert.equal(await page.locator('.listening-audio-engine').evaluate((audio) => audio.paused), false, 'audio media must continue while merely viewing the video tab');
  const practiceFrame = page.frames().find((frame) => frame.url().includes('youtube-nocookie.com/embed/'));
  assert.ok(practiceFrame, 'the paused practice player should remain available for resume');
  await practiceFrame.evaluate(() => parent.postMessage(JSON.stringify({ event: 'onStateChange', info: 1 }), '*'));
  await page.waitForFunction(() => document.querySelector('#audioPlay')?.textContent === '▶');
  assert.equal(await page.locator('#audioPlay').textContent(), '▶', 'starting video must pause listening audio');
  assert.equal(await page.locator('.listening-audio-engine').evaluate((audio) => audio.paused), true, 'the audio media element must pause only after video starts');
  assert.equal(await page.locator('.youtube-frame').getAttribute('data-playback-state'), 'playing', 'video should play after taking over from audio');
  await page.setViewportSize({ width: 1440, height: 400 });
  await page.locator('#view-practice .history-card').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelector('.youtube-frame')?.dataset.playbackState === 'paused');
  assert.equal(await page.locator('.youtube-frame').getAttribute('data-playback-state'), 'paused', 'video must pause after leaving the viewport');
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.click('#notificationButton');
  assert.ok((await page.locator('#modalTitle').textContent()).includes('通知'), 'notification button should open the notification center');
  await page.locator('#modalActions .primary-btn').click();
  assert.ok(await page.locator('#notificationDot').evaluate((node) => node.classList.contains('hidden')), 'opening notifications should clear the unread dot');

  await page.evaluate(() => window.navigate('settings'));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  await page.locator('#avatarFileInput').setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: png });
  await page.waitForFunction(() => document.querySelector('#profileAvatar').style.backgroundImage.includes('data:image/webp'));
  await page.click('#saveProfile');
  await page.waitForFunction(() => document.querySelector('#toastContainer')?.textContent.includes('个人资料已保存'));
  assert.ok(savedProfile?.avatar?.startsWith('data:image/webp;base64,'), 'custom avatar should be compressed and sent through the profile API');

  await page.evaluate(() => window.navigate('ai'));
  assert.equal(await page.locator('.provider-card[data-provider]').count(), 1, 'AI services should use one unified configuration');
  assert.ok((await page.locator('[data-provider="primary"] .provider-status').textContent()).includes('待配置'), 'AI must not claim a fake connection');
  await page.locator('[data-provider="primary"] .test-model').click();
  assert.ok((await page.locator('#modalTitle').textContent()).includes('统一 AI'), 'real unified provider configuration dialog should open');
  await page.fill('#providerTextBaseUrl', '');
  await page.locator('#modalActions .primary-btn').click();
  await page.waitForFunction(() => document.querySelector('#toastContainer')?.textContent.includes('文本 API 地址'));
  assert.equal(await page.locator('#appModal').evaluate((dialog) => dialog.open), true, 'validation feedback should keep the dialog open');
  assert.equal(await page.locator('#toastContainer').evaluate((node) => node.parentElement?.id), 'appModal', 'toast feedback triggered by a dialog must render inside the browser top layer');
  const modalToastVisible = await page.evaluate(() => {
    const toast = document.querySelector('#toastContainer .toast');
    const rect = toast.getBoundingClientRect();
    const topmost = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return rect.width > 0 && rect.height > 0 && (toast === topmost || toast.contains(topmost));
  });
  assert.equal(modalToastVisible, true, 'dialog toast must be visible and above the modal surface and backdrop');
  await page.fill('#providerTextBaseUrl', 'https://text-ai.test/v1/');
  await page.fill('#providerTextModel', 'deepseek-chat');
  await page.fill('#providerTextApiKey', 'text-test-key');
  await page.fill('#providerSpeechBaseUrl', 'https://speech-ai.test/v1/');
  await page.fill('#providerSpeechModel', 'whisper-1');
  await page.fill('#providerSpeechApiKey', 'speech-test-key');
  await page.locator('#modalActions .primary-btn').click();
  await page.waitForFunction(() => !document.querySelector('#appModal').open);
  await page.waitForFunction(() => document.querySelector('#toastContainer')?.parentElement === document.body);
  assert.equal(textCapabilityCalls, 2, 'text capability validation should use the text provider for models and chat');
  assert.equal(speechCapabilityCalls, 2, 'speech capability validation should use the speech provider for models and transcription');
  assert.ok((await page.locator('.provider-status').textContent()).includes('三项能力已验证'), 'the unified card should report both channels as verified');
  assert.equal(await page.locator('[data-model-role="speech"]').textContent(), 'whisper-1', 'speech capability should display the speech model');
  assert.equal(await page.locator('[data-model-role="text"]').first().textContent(), 'deepseek-chat', 'text capabilities should display the text model');
  const storedProvider = await page.evaluate(() => JSON.parse(localStorage.getItem('shy-ai-providers-v1')).primary);
  assert.equal(storedProvider.textBaseUrl, 'https://text-ai.test/v1/');
  assert.equal(storedProvider.speechBaseUrl, 'https://speech-ai.test/v1/');
  assert.equal(Object.keys(storedProvider).some((key) => /apiKey|key/i.test(key)), false, 'API keys must never be persisted with the unified configuration');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.navigate('practice'));
  const mobileLayout = await page.evaluate(() => {
    const video = document.querySelector('.practice-learning .video-card').getBoundingClientRect();
    const lyrics = document.querySelector('.practice-learning .lyrics-card').getBoundingClientRect();
    const chapter = document.querySelector('.chapters-card').getBoundingClientRect();
    const preview = document.querySelector('.preview-card').getBoundingClientRect();
    return { stacked: Math.abs(video.bottom - lyrics.top) < 2, prereqsFirst: chapter.top < preview.top && preview.bottom < video.top, overflow: document.documentElement.scrollWidth > innerWidth };
  });
  assert.deepEqual(mobileLayout, { stacked: true, prereqsFirst: true, overflow: false }, 'mobile practice ordering must match the learning flow');
  assert.ok((await page.locator('.mobile-nav button').first().boundingBox()).height >= 44, 'mobile tab targets must be at least 44px tall');

  await page.evaluate(() => window.navigate('overview'));
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.context().setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  assert.ok(await page.locator('#view-overview').isVisible(), 'PWA shell should reload offline');
  assert.equal(await page.locator('#topicSelect option').count(), 85, 'complete course catalog should be cached offline');
  await page.context().setOffline(false);

  assert.deepEqual(errors, [], `browser console errors: ${errors.join(' | ')}`);
  await browser.close(); browser = null;
  console.log('ui-smoke: 6 views, responsive layouts, YouTube, self-hosted auth/sync, AI status and PWA offline reload passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); server.kill('SIGTERM'); });
