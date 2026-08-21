import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
const ROOT = '/Users/wbtrex/website/localServer/node/trexwb/git/lockPass';
const BASE = 'http://localhost:1420';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const server = spawn('node', ['scripts/serve.mjs'], { cwd: ROOT, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 900));
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('PAGEERROR:', e.message));
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(async () => { const dbs = await indexedDB.databases(); for (const db of dbs) await new Promise(res => { const r = indexedDB.deleteDatabase(db.name); r.onsuccess = r.onerror = r.onblocked = res; }); });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => document.getElementById('unlock-btn-text').textContent === '创建');
await page.fill('#master-password', 'Test-Password-2026!');
await page.fill('#confirm-password', 'Test-Password-2026!');
await page.click('#unlock-btn');
await page.waitForSelector('#app-shell:not(.hidden)', { timeout: 8000 });
await page.click('button.btn-dropdown-main');
await page.waitForSelector('#e-title', { timeout: 5000 });
await page.fill('#e-title', '回归测试条目');
await page.fill('[data-field="username"]', 'tester@example.com');
await page.fill('[data-field="password"]', 'P@ssw0rd-2026');
await page.fill('[data-field="url"]', 'https://example.com');
await page.evaluate(() => saveEntry());
await page.waitForSelector('.entry-card', { timeout: 5000 });
console.log('card title:', await page.textContent('.entry-card'));
await page.click('.entry-card');
await page.waitForSelector('#detail-panel.open', { timeout: 5000 });
await page.waitForTimeout(300);
const body = await page.evaluate(() => ({
  detailTitle: document.getElementById('detail-title').textContent,
  bodyText: document.getElementById('detail-body').textContent.slice(0, 200),
  bodyHTML: document.getElementById('detail-body').innerHTML.slice(0, 300),
}));
console.log(JSON.stringify(body, null, 1));
await browser.close(); server.kill(); process.exit(0);
