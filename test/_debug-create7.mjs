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
// 全局 value setter 探针（含调用栈）
await page.addInitScript(() => {
  window.__writes = [];
  const proto = HTMLInputElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  Object.defineProperty(proto, 'value', {
    configurable: true,
    enumerable: true,
    get() { return desc.get.call(this); },
    set(v) {
      if (this.id === 'master-password' || this.id === 'confirm-password') {
        const stk = new Error().stack.split('\n').slice(1, 5).map(s => s.trim().replace(/^at /, '')).join(' <- ');
        window.__writes.push({ t: performance.now().toFixed(1), id: this.id, v: String(v).slice(0, 12), stk });
      }
      return desc.set.call(this, v);
    }
  });
});
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(async () => { const dbs = await indexedDB.databases(); for (const db of dbs) await new Promise(res => { const r = indexedDB.deleteDatabase(db.name); r.onsuccess = r.onerror = r.onblocked = res; }); });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => document.getElementById('unlock-btn-text').textContent === '创建');
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
const writes = await page.evaluate(() => window.__writes);
console.log('writes (' + writes.length + '):');
writes.forEach(w => console.log(`  ${w.t}ms ${w.id} = ${w.v}\n      ${w.stk}`));
const st = await page.evaluate(() => ({ appVisible: !document.getElementById('app-shell').classList.contains('hidden'), err: document.getElementById('lock-error').textContent }));
console.log('final:', JSON.stringify(st));
await browser.close(); server.kill(); process.exit(0);
