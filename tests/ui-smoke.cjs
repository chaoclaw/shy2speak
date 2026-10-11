const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const port = 4174;
const origin = `http://127.0.0.1:${port}`;
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
    if (url.includes('youtube.com/oembed')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ title: 'Live YouTube lesson', author_name: 'Verified channel', thumbnail_url: `${origin}/icons/icon.svg` }) });
    if (url.includes('youtube-nocookie.com/embed/')) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>YouTube fixture</title>' });
    if (url.includes('i.ytimg.com')) return route.fulfill({ status: 204 });
    if (url === 'https://demo.supabase.co/auth/v1/settings') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ external: { email: true, phone: true } }) });
    if (url.includes('demo.supabase.co/auth/v1/token?grant_type=password')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 3600, user: { id: '00000000-0000-4000-8000-000000000001', email: 'learner@example.com' } }) });
    if (url.includes('demo.supabase.co/rest/v1/learning_states') && route.request().method() === 'GET') return route.fulfill({ contentType: 'application/json', body: JSON.stringify([cloudState]) });
    if (url.includes('demo.supabase.co/rest/v1/learning_states')) return route.fulfill({ status: 201, contentType: 'application/json', body: '' });
    if (url.includes('demo.supabase.co/rest/v1/practice_snapshots')) return route.fulfill({ status: 201, contentType: 'application/json', body: '' });
    if (url.includes('demo.supabase.co/rest/v1/profiles')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ id: '00000000-0000-4000-8000-000000000001', nickname: 'CloudLearner', signature: 'Synced profile', avatar: '🚀', locale: 'zh', updated_at: '2026-10-11T00:00:00Z' }]) });
    return route.continue();
  });

  await page.goto(`${origin}/#/practice`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#topicSelect option', { state: 'attached' });
  assert.equal(await page.locator('#topicSelect option').count(), 1, 'real catalog topic should render');
  assert.equal(await page.locator('.chapters-card .chapter').count(), 2, 'catalog chapters should render');
  assert.equal(await page.locator('#practiceLyrics .lyric-line').count(), 5, 'sentence lyrics should render');

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

  const views = ['overview', 'vocabulary', 'listening', 'downloads', 'studio', 'ai', 'settings'];
  for (const view of views) {
    await page.evaluate((next) => window.navigate(next), view);
    assert.ok(await page.locator(`#view-${view}`).evaluate((node) => node.classList.contains('active')), `${view} must be navigable`);
  }

  await page.evaluate(() => window.navigate('settings'));
  await page.locator('#reduceMotion').check({ force: true }); await page.locator('#highContrast').check({ force: true });
  assert.equal(await page.locator('html').getAttribute('data-reduce-motion'), 'true', 'reduce motion setting should apply');
  assert.equal(await page.locator('html').getAttribute('data-high-contrast'), 'true', 'high contrast setting should apply');
  await page.click('#authPreview');
  assert.ok((await page.locator('#modalTitle').textContent()).includes('账号服务'), 'unconfigured auth must request concrete service settings without another provider choice');
  await page.fill('#backendUrl', 'https://demo.supabase.co');
  await page.fill('#backendKey', 'sb_publishable_browser_test');
  await page.locator('#modalActions .primary-btn').click();
  await page.waitForFunction(() => !document.querySelector('#appModal').open);
  assert.ok((await page.locator('#backendStatus').textContent()).includes('已配置'), 'successful real health check should update backend state');
  await page.click('#authPreview');
  await page.click('[data-auth-method="phone"]');
  assert.equal(await page.locator('#authAccount').getAttribute('type'), 'tel', 'phone auth must use a separate tel input');
  assert.ok((await page.locator('#modalBody').textContent()).includes('真实账号服务已连接'), 'auth dialog must no longer be a demo flow');
  await page.click('[data-auth-method="email"]');
  await page.fill('#authAccount', 'learner@example.com');
  await page.fill('#authPassword', 'correct-password');
  await page.locator('#modalActions .primary-btn').click();
  await page.waitForFunction(() => !document.querySelector('#appModal').open);
  await page.waitForFunction(() => document.querySelector('#backendStatus').textContent.includes('已登录'));
  assert.equal(await page.locator('#nicknameInput').inputValue(), 'CloudLearner', 'authenticated profile should hydrate from the real backend adapter');
  assert.ok((await page.locator('#syncStateTitle').textContent()).includes('同步'), 'login must run a learning-state synchronization');
  assert.equal(await page.locator('#metricAverageScore').textContent(), '91', 'newer cloud learning history should hydrate locally');
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'forest', 'newer cloud preferences should hydrate locally');

  await page.evaluate(() => window.navigate('ai'));
  assert.ok((await page.locator('[data-provider="openai"] .provider-status').textContent()).includes('待配置'), 'AI must not claim a fake connection');
  await page.locator('[data-provider="openai"] .test-model').click();
  assert.ok((await page.locator('#modalTitle').textContent()).includes('OpenAI'), 'real provider configuration dialog should open');
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
  assert.equal(await page.locator('#topicSelect option').count(), 1, 'course catalog should be cached offline');
  await page.context().setOffline(false);

  assert.deepEqual(errors, [], `browser console errors: ${errors.join(' | ')}`);
  await browser.close(); browser = null;
  console.log('ui-smoke: 8 views, responsive layouts, YouTube, Supabase auth/sync, AI status and PWA offline reload passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); server.kill('SIGTERM'); });
