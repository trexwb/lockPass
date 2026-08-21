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
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(async () => { const dbs = await indexedDB.databases(); for (const db of dbs) await new Promise(res => { const r = indexedDB.deleteDatabase(db.name); r.onsuccess = r.onerror = r.onblocked = res; }); });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => document.getElementById('unlock-btn-text').textContent === '创建');
await page.fill('#master-password', 'Test-Password-2026!');
await page.fill('#confirm-password', 'Test-Password-2026!');
// patch handleUnlock 记录 await 前后状态
await page.evaluate(() => {
  const orig = window.App.handleUnlock;
  window.__probe = [];
  window.App.handleUnlock = async function (autoPassword) {
    window.__probe.push({ at: 'enter', m: document.getElementById('master-password').value, c: document.getElementById('confirm-password').value });
    const r = await orig.apply(this, arguments);
    window.__probe.push({ at: 'exit', m: document.getElementById('master-password').value, c: document.getElementById('confirm-password').value });
    return r;
  };
});
await page.click('#unlock-btn');
await page.waitForTimeout(2000);
const probe = await page.evaluate(() => window.__probe);
const st = await page.evaluate(() => ({
  appVisible: !document.getElementById('app-shell').classList.contains('hidden'),
  err: document.getElementById('lock-error').textContent,
}));
console.log('probe:', JSON.stringify(probe));
console.log('state:', JSON.stringify(st));
await browser.close(); server.kill(); process.exit(0);
