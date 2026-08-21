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
page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE:', m.text()); });
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(async () => { const dbs = await indexedDB.databases(); for (const db of dbs) await new Promise(res => { const r = indexedDB.deleteDatabase(db.name); r.onsuccess = r.onerror = r.onblocked = res; }); });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('#lock-screen');
console.log('title:', await page.textContent('#lock-title'));
console.log('btnText:', await page.textContent('#unlock-btn-text'));
console.log('subtitle:', await page.textContent('#lock-subtitle'));
await page.fill('#master-password', 'Test-Password-2026!');
await page.fill('#confirm-password', 'Test-Password-2026!');
await page.click('#unlock-btn');
await page.waitForTimeout(3000);
const st = await page.evaluate(() => ({
  lockVisible: !document.getElementById('lock-screen').classList.contains('hidden'),
  appVisible: !document.getElementById('app-shell').classList.contains('hidden'),
  error: document.getElementById('lock-error').textContent,
  errorHidden: document.getElementById('lock-error').classList.contains('hidden'),
  subtitle: document.getElementById('lock-subtitle').textContent,
  btnText: document.getElementById('unlock-btn-text').textContent,
}));
console.log('state:', JSON.stringify(st));
await browser.close(); server.kill(); process.exit(0);
