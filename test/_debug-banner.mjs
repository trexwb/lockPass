import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
const ROOT = '/Users/wbtrex/website/localServer/node/trexwb/git/lockPass';
const BASE = 'http://localhost:1420';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const server = spawn('node', ['scripts/serve.mjs'], { cwd: ROOT, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 900));
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, serviceWorkers: 'block' });
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(async () => { const dbs = await indexedDB.databases(); for (const db of dbs) await new Promise(res => { const r = indexedDB.deleteDatabase(db.name); r.onsuccess = r.onerror = r.onblocked = res; }); });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => document.getElementById('unlock-btn-text').textContent === '创建');
await page.fill('#master-password', 'Test-Password-2026!');
await page.fill('#confirm-password', 'Test-Password-2026!');
await page.click('#unlock-btn');
await page.waitForSelector('#app-shell:not(.hidden)', { timeout: 8000 });
await page.waitForTimeout(500);
const banner = await page.evaluate(() => {
  const b = document.getElementById('lp-bind-banner');
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { display: getComputedStyle(b).display, top: r.top, height: r.height, bottom: r.bottom, z: getComputedStyle(b).zIndex, pos: getComputedStyle(b).position };
});
console.log('banner:', JSON.stringify(banner));
await page.click('#hamburger-btn');
await page.waitForSelector('#sidebar.open', { timeout: 5000 });
await page.waitForTimeout(700); // 等抽屉动画结束
const rects = await page.evaluate(() => {
  const sb = document.getElementById('sidebar').getBoundingClientRect();
  const btn = document.querySelector('button.btn-dropdown-main').getBoundingClientRect();
  const b = document.getElementById('lp-bind-banner');
  const br = b ? b.getBoundingClientRect() : null;
  return {
    sidebar: { top: sb.top, left: sb.left, width: sb.width },
    btn: { top: btn.top, bottom: btn.bottom, left: btn.left, width: btn.width },
    banner: br ? { top: br.top, bottom: br.bottom, height: br.height, z: getComputedStyle(b).zIndex } : null,
    btnUnderBanner: br ? (btn.top < br.bottom && btn.bottom > br.top) : false,
    appPaddingTop: getComputedStyle(document.getElementById('app')).paddingTop,
  };
});
console.log('rects:', JSON.stringify(rects, null, 1));
await browser.close(); server.kill(); process.exit(0);
