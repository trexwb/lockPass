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
// 在输入框 value 上装探针（在 fill 之前执行）
await page.evaluate(() => {
  window.__writes = [];
  ['master-password', 'confirm-password'].forEach((id) => {
    const el = document.getElementById(id);
    const proto = Object.getPrototypeOf(el); // HTMLInputElement.prototype
    // 用 defineProperty 在元素上遮蔽 value（需 configurable）
    Object.defineProperty(el, 'value', {
      configurable: true,
      enumerable: true,
      get() { return this.getAttribute('data-real'); },
      set(v) {
        window.__writes.push({ t: performance.now().toFixed(1), id, v });
        this.setAttribute('data-real', v);
        // 触发原生 setter（绕过节流）
        const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        desc.set.call(this, v);
      }
    });
  });
});
await page.fill('#master-password', 'Test-Password-2026!');
await page.fill('#confirm-password', 'Test-Password-2026!');
await page.click('#unlock-btn');
await page.waitForTimeout(2000);
const writes = await page.evaluate(() => window.__writes);
const st = await page.evaluate(() => ({
  m: document.getElementById('master-password').value,
  c: document.getElementById('confirm-password').value,
  appVisible: !document.getElementById('app-shell').classList.contains('hidden'),
  err: document.getElementById('lock-error').textContent,
}));
console.log('value writes:', JSON.stringify(writes, null, 1));
console.log('final state:', JSON.stringify(st));
await browser.close(); server.kill(); process.exit(0);
