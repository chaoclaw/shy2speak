const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const port = 4174;
const origin = `http://127.0.0.1:${port}`;
const catalogFixture = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'catalog.json'), 'utf8'));
const vocabularyFixture = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'vocabulary.json'), 'utf8'));
catalogFixture.topics[0].transcriptOrigin = 'youtube-public-captions';
catalogFixture.topics[0].chapters = [
  {
    id: 'chapter-01', index: 1, title: 'Verified captions', titleZh: '已验证字幕', start: 0, durationLabel: '0:08', previewWords: ['welcome'],
    sentences: [
      { id: 'sentence-001', start: 0, end: 3.5, en: 'Welcome to this verified test lesson.', zh: '欢迎来到已验证的测试课程。', words: ['welcome'] },
      { id: 'sentence-002', start: 3.5, end: 8, en: 'Repeat this sentence clearly.', zh: '请清晰地跟读这句话。', words: [] },
    ],
  },
  { id: 'chapter-02', index: 2, title: 'Pending section', titleZh: '待同步小节', start: 8, durationLabel: '待同步', previewWords: [], sentences: [] },
];
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
let vocabularyDeleteCalls = 0;
let savedProfile = null;

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
    if (url.includes('youtube.com/oembed')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ title: 'Live YouTube lesson', author_name: 'Verified channel', thumbnail_url: `${origin}/icons/icon.svg` }) });
    if (url.includes('youtube-nocookie.com/embed/')) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>YouTube fixture</title>' });
    if (url.includes('i.ytimg.com')) return route.fulfill({ status: 204 });
    if (url === `${origin}/api/health`) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, database: 'postgresql', auth: { email: true, phone: true, emailOtp: false, phoneOtp: false, passwordRecovery: false } }) });
    if (url === `${origin}/api/auth/login`) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 900, user: { id: '00000000-0000-4000-8000-000000000001', email: 'learner@example.com' } }) });
    if (url === `${origin}/api/learning-state` && route.request().method() === 'GET') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(cloudState) });
    if (url === `${origin}/api/learning-state`) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ syncedAt: '2099-10-11T00:00:00Z', snapshotCount: 1 }) });
    if (url === `${origin}/api/profile/nickname/check`) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ available: true }) });
    if (url === `${origin}/api/profile` && route.request().method() === 'GET') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: '00000000-0000-4000-8000-000000000001', nickname: 'NasLearner', signature: 'Synced profile', avatar: '🚀', locale: 'zh', updated_at: '2026-10-11T00:00:00Z' }) });
    if (url === `${origin}/api/profile` && route.request().method() === 'PUT') { savedProfile = route.request().postDataJSON(); return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: '00000000-0000-4000-8000-000000000001', ...savedProfile, updated_at: '2026-10-11T00:00:00Z' }) }); }
    if (url === `${origin}/api/vocabulary` && route.request().method() === 'GET') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(vocabularyFixture) });
    if (url === `${origin}/api/vocabulary/delete-everywhere`) {
      vocabularyDeleteCalls += 1;
      const selected = new Set(route.request().postDataJSON().word_ids);
      const deletedIds = vocabularyFixture.items.filter((item) => selected.has(item.id)).map((item) => item.id);
      vocabularyFixture.items = vocabularyFixture.items.filter((item) => !selected.has(item.id));
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ deletedIds, deletedCount: deletedIds.length }) });
    }
    return route.continue();
  });

  await page.goto(`${origin}/#/practice`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#topicSelect option', { state: 'attached' });
  assert.equal(await page.locator('#topicSelect option').count(), 85, 'all 85 playlist topics should render');
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
  assert.equal(await page.locator('.chapters-card .chapter').count(), 2, 'catalog chapters should render');
  assert.equal(await page.locator('#practiceLyrics .lyric-line').count(), 2, 'server-synced sentence lyrics should render');

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
  const englishHeadings = { overview: 'Welcome back', vocabulary: 'My vocabulary', listening: 'Listening', studio: 'Audio and HTML PPT', ai: 'Unified AI configuration and scoring prompts', settings: 'Settings' };
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
  assert.equal(await page.locator('#practiceTopicTitle').textContent(), 'Live YouTube lesson', 'runtime YouTube metadata should update the title');
  assert.equal(await page.locator('.youtube-frame').count(), 1, 'official YouTube player should be mounted');

  await page.locator('.chapter').nth(1).click();
  assert.ok((await page.locator('.lyrics-empty').textContent()).includes('尚未同步'), 'chapter without transcript should show an honest empty state');

  assert.equal(await page.locator('#view-downloads').count(), 0, 'offline content view should be removed');
  assert.equal(await page.locator('[data-view-link="downloads"]').count(), 0, 'offline content navigation should be removed');
  await page.evaluate(() => window.navigate('downloads'));
  assert.ok(await page.locator('#view-overview').evaluate((node) => node.classList.contains('active')), 'legacy offline route should fall back to overview');

  const views = ['overview', 'vocabulary', 'listening', 'studio', 'ai', 'settings'];
  for (const view of views) {
    await page.evaluate((next) => window.navigate(next), view);
    assert.ok(await page.locator(`#view-${view}`).evaluate((node) => node.classList.contains('active')), `${view} must be navigable`);
  }

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
  const authInputLayout = await page.evaluate(() => {
    const input = document.querySelector('#authAccount').getBoundingClientRect();
    const body = document.querySelector('#modalBody').getBoundingClientRect();
    return { insideLeft: input.left >= body.left, insideRight: input.right <= body.right, width: input.width, bodyWidth: body.width };
  });
  assert.ok(authInputLayout.insideLeft && authInputLayout.insideRight && authInputLayout.width <= authInputLayout.bodyWidth, 'auth inputs must remain inside the modal edges');
  await page.fill('#authAccount', 'learner@example.com');
  await page.fill('#authPassword', 'correct-password');
  await page.locator('#modalActions .primary-btn').click();
  await page.waitForFunction(() => !document.querySelector('#appModal').open);
  await page.waitForFunction(() => document.querySelector('#backendStatus').textContent.includes('已登录'));
  assert.notEqual(await page.locator('.top-avatar').textContent(), '登录', 'authenticated users should see their profile avatar');
  assert.equal(await page.locator('#nicknameInput').inputValue(), 'NasLearner', 'authenticated profile should hydrate from the self-hosted backend adapter');
  assert.ok((await page.locator('#syncStateTitle').textContent()).includes('同步'), 'login must run a learning-state synchronization');
  assert.equal(await page.locator('#metricAverageScore').textContent(), '91', 'newer cloud learning history should hydrate locally');
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'forest', 'newer cloud preferences should hydrate locally');

  await page.evaluate(() => window.navigate('vocabulary'));
  await page.waitForFunction(() => document.querySelector('#wordList')?.textContent.includes('shopping mall'));
  assert.equal(await page.locator('.word-list-item').count(), 5, 'topic-linked Mall Vocabulary seed words should render');
  await page.click('#cleanupOpen');
  assert.equal(await page.locator('[data-cleanup-word]').count(), 3, 'three removed words should be pending cleanup');
  assert.equal(await page.locator('[data-cleanup-word]:checked').count(), 3, 'cleanup words should all be selected by default');
  await page.locator('#cleanupSelectAll').uncheck();
  assert.equal(await page.locator('[data-cleanup-word]:checked').count(), 0, 'select-all control should clear the full selection');
  await page.locator('#cleanupSelectAll').check();
  await page.locator('#modalActions .primary-btn').click();
  await page.waitForFunction(() => !document.querySelector('#appModal').open);
  assert.equal(vocabularyDeleteCalls, 1, 'cleanup must call the authenticated delete-everywhere API');
  assert.equal(await page.locator('.word-list-item').count(), 2, 'deleted words should leave every visible wordbook immediately');

  await page.evaluate(() => window.navigate('listening'));
  assert.equal(await page.locator('#listeningQueue .queue-track').count(), 85, 'all real course videos should populate the listening audio queue');
  assert.equal(await page.locator('#listeningPlaylistList .playlist-item').count(), 1, 'legacy listening test playlists must be removed');
  assert.equal((await page.locator('#view-listening').textContent()).includes('测试集'), false, 'listening UI must not expose legacy test data');
  const firstListeningTitle = await page.locator('#listeningQueue .queue-track strong').first().textContent();
  await page.click('#editPlaylist');
  await page.locator('#listeningQueue .queue-track').first().dragTo(page.locator('#listeningQueue .queue-track').nth(1));
  assert.notEqual(await page.locator('#listeningQueue .queue-track strong').first().textContent(), firstListeningTitle, 'dragging must persistently reorder listening tracks');
  assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem('shy-listening-course-order-v1') || '[]').length)), 85, 'edited course order must be persisted');
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
  await page.click('#audioPlay');
  await page.waitForSelector('.listening-youtube-frame');
  assert.equal(await page.locator('.youtube-frame').count(), 0, 'listening playback must not leave the practice player running');
  await page.click('#nextAudio');
  assert.ok((await page.locator('#listeningTrackMeta').textContent()).includes('/ 85'), 'listening next-track control should move through the 85-video queue');
  await page.evaluate(() => window.navigate('practice'));
  assert.equal(await page.locator('.listening-youtube-frame').count(), 0, 'opening video practice must stop listening playback');

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
  await page.locator('#appModal').evaluate((dialog) => dialog.close());

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
  console.log('ui-smoke: 7 views, responsive layouts, YouTube, self-hosted auth/sync, AI status and PWA offline reload passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); server.kill('SIGTERM'); });
