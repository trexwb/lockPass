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
// 注入事件日志
await page.addInitScript(() => {
  window.__evLog = [];
  document.addEventListener('input', (e) => {
    window.__evLog.push({ t: 'input', id: e.target.id, v: e.target.value, at: performance.now().toFixed(0) });
  });
  document.addEventListener('focusin', (e) => {
    window.__evLog.push({ t: 'focus', id: e.target.id, at: performance.now().toFixed(0) });
  });
});
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(async () => { const dbs = await indexedDB.databases(); for (const db of dbs) await new Promise(res => { const r = indexedDB.deleteDatabase(db.name); r.onsuccess = r.onerror = r.onblocked = res; }); });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('#lock-screen');
// 记录 init 完成时刻（unlock-btn-text 变为「创建」时）
await page.waitForFunction(() => document.getElementById('unlock-btn-text').textContent === '创建');
await page.fill('#master-password', 'Test-Password-2026!');
await page.fill('#confirm-password', 'Test-Password-2026!');
await page.evaluate(() => window.__evLog.push({ t: 'beforeClick', m: document.getElementById('master-password').value, c: document.getElementById('confirm-password').value, active: document.activeElement.id, at: performance.now().toFixed(0) }));
await page.click('#unlock-btn');
await page.evaluate(() => window.__evLog.push({ t: 'afterClick', m: document.getElementById('master-password').value, c: document.getElementById('confirm-password').value, at: performance.now().toFixed(0) }));
await page.waitForTimeout(1500);
const log = await page.evaluate(() => window.__evLog);
console.log(JSON.stringify(log, null, 1));
const err = await page.textContent('#lock-error');
console.log('lock-error:', err.trim());
await browser.close(); server.kill(); process.exit(0);
