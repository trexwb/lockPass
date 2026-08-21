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
// 原生 DOM 赋值 + 原生 click，全在页面上下文
await page.evaluate(() => {
  const m = document.getElementById('master-password');
  const c = document.getElementById('confirm-password');
  m.value = 'Test-Password-2026!';
  c.value = 'Test-Password-2026!';
  m.dispatchEvent(new Event('input', { bubbles: true }));
  c.dispatchEvent(new Event('input', { bubbles: true }));
  document.getElementById('unlock-btn').click();
});
await page.waitForTimeout(2500);
const st = await page.evaluate(() => ({
  m: document.getElementById('master-password').value,
  c: document.getElementById('confirm-password').value,
  appVisible: !document.getElementById('app-shell').classList.contains('hidden'),
  err: document.getElementById('lock-error').textContent,
  errHidden: document.getElementById('lock-error').classList.contains('hidden'),
}));
console.log('native result:', JSON.stringify(st));
await browser.close(); server.kill(); process.exit(0);
