const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const port = 4174;
const origin = `http://127.0.0.1:${port}`;
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
  await page.click('[data-auth-method="phone"]');
  assert.equal(await page.locator('#authAccount').getAttribute('type'), 'tel', 'phone auth must use a separate tel input');
  await page.locator('#appModal').evaluate((dialog) => dialog.close());

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
  console.log('ui-smoke: 8 views, responsive layouts, YouTube adapter, auth split, AI status and PWA offline reload passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); server.kill('SIGTERM'); });
