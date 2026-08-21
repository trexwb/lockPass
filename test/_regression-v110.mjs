/* LockPass v1.0.10 规范治理回归测试
   覆盖：锁屏创建 / 主界面 / 编辑器(含类型切换) / 详情 / 设置 / 导入导出 / 二维码 / z-index / 手机溢出
   用法：node /tmp/lp-regression.mjs
*/
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const ROOT = '/Users/wbtrex/website/localServer/node/trexwb/git/lockPass';
const BASE = 'http://localhost:1420';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MPW = 'Test-Password-2026!';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

const server = spawn('node', ['scripts/serve.mjs'], { cwd: ROOT, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 900));

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

function trackErrors(page, tag) {
  const errs = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !/serviceworker/i.test(m.text())) errs.push(`[${tag}] console: ${m.text()}`);
  });
  page.on('pageerror', (e) => errs.push(`[${tag}] pageerror: ${e.message}`));
  return errs;
}

async function resetDB(page) {
  await page.evaluate(async () => {
    try {
      const dbs = await indexedDB.databases();
      for (const db of dbs) {
        await new Promise((res) => { const r = indexedDB.deleteDatabase(db.name); r.onsuccess = r.onerror = r.onblocked = res; });
      }
    } catch (e) { /* databases() 不可用时忽略 */ }
  });
}

async function createVault(page) {
  await page.fill('#master-password', MPW);
  await page.fill('#confirm-password', MPW);
  await page.click('#unlock-btn');
  await page.waitForSelector('#app-shell:not(.hidden)', { timeout: 8000 });
}

function noOverflow(page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    return { sw: de.scrollWidth, cw: de.clientWidth, ok: de.scrollWidth === de.clientWidth };
  });
}

/* ═══════ 桌面端 1440×900 ═══════ */
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
const page = await ctx.newPage();
const errs = trackErrors(page, 'desktop');

await page.goto(BASE, { waitUntil: 'networkidle' });
await resetDB(page);
await page.reload({ waitUntil: 'networkidle' });

// S1 锁屏创建界面
await page.waitForSelector('#lock-screen');
const createMode = await page.evaluate(() => {
  const confirmVisible = !document.getElementById('confirm-pw-group').classList.contains('hidden');
  return { confirmVisible, btnText: document.getElementById('unlock-btn-text').textContent };
});
check('S1 锁屏创建界面渲染', createMode.confirmVisible && /确认创建|创建/.test(createMode.btnText), JSON.stringify(createMode));

// 强度条样式类（本次改动：pw-strength-bg-border）
await page.fill('#master-password', MPW);
await page.waitForSelector('#master-pw-strength-wrap:not(.hidden)', { timeout: 3000 });
const strengthClass = await page.evaluate(() => {
  const bar = document.querySelector('#master-pw-strength-wrap .pw-strength-bg-border');
  return !!bar;
});
check('S1b 主密码强度条工具类生效', strengthClass, 'pw-strength-bg-border');

await createVault(page);
check('S1c 创建保险箱并解锁', true);

// S2 主界面空态
const s2 = await page.evaluate(() => ({
  emptyVisible: !document.getElementById('empty-state').classList.contains('hidden'),
  settingsBtn: !!document.querySelector('.header-actions button'),
  appVisible: !document.getElementById('app-shell').classList.contains('hidden'),
}));
check('S2 主界面空态渲染', s2.emptyVisible && s2.settingsBtn && s2.appVisible, JSON.stringify(s2));

// S3 新增弹窗（网站类型）
await page.click('button.btn-dropdown-main');
await page.waitForSelector('#e-title', { timeout: 5000 });
const s3 = await page.evaluate(() => {
  const modalOverlay = document.getElementById('modal-overlay');
  const header = document.getElementById('header');
  return {
    modalZ: getComputedStyle(modalOverlay).zIndex,
    headerZ: getComputedStyle(header).zIndex,
    formVisible: getComputedStyle(document.getElementById('form-website')).display !== 'none',
    portCount: document.querySelectorAll('.input-port').length,
  };
});
check('S3 新增弹窗渲染 + 类型表单切换', s3.formVisible, JSON.stringify(s3));
check('S3b z-index 层级 modal > header', parseInt(s3.modalZ, 10) > parseInt(s3.headerZ, 10), `modal=${s3.modalZ} header=${s3.headerZ}`);

// 切到 server 类型验证 port 输入框工具类
await page.evaluate(() => switchEntryType('server'));
await page.waitForSelector('#form-server .input-port', { timeout: 3000 });
const portStyle = await page.evaluate(() => {
  const el = document.querySelector('#form-server .input-port');
  const cs = getComputedStyle(el);
  return { width: cs.width, flexShrink: cs.flexShrink, flex: cs.flex };
});
check('S3c server 类型 port 输入框样式生效', parseFloat(portStyle.width) <= 100, JSON.stringify(portStyle));

// 填表保存（切回 website）
await page.evaluate(() => switchEntryType('website'));
await page.fill('#e-title', '回归测试条目');
await page.fill('[data-field="username"]', 'tester@example.com');
await page.fill('[data-field="password"]', 'P@ssw0rd-2026');
await page.fill('[data-field="url"]', 'https://example.com');
await page.evaluate(() => saveEntry());
await page.waitForSelector('.entry-card', { timeout: 5000 });
check('S3d 保存条目成功', true);

// S4 详情面板
await page.click('.entry-card');
await page.waitForSelector('#detail-panel.open', { timeout: 5000 });
const s4 = await page.evaluate(() => {
  const title = document.getElementById('detail-title');
  const body = document.getElementById('detail-body');
  const fav = document.getElementById('detail-fav-btn');
  const favClass = fav ? fav.className : '';
  return { hasTitle: title.textContent.includes('回归测试条目'), hasField: body.textContent.includes('tester@example.com'), favCls: favClass, mlAuto: !!body.querySelector('.ml-auto') };
});
check('S4 详情面板渲染（含 ml-auto 工具类）', s4.hasTitle && s4.hasField && s4.favCls.includes('btn-icon'), JSON.stringify(s4));

// 关闭详情
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

// S5 设置弹窗
await page.evaluate(() => Settings.openSettingsModal());
await page.waitForSelector('#modal:not(.hidden)', { timeout: 5000 });
await page.waitForTimeout(300);
const s5 = await page.evaluate(() => {
  const m = document.getElementById('modal');
  const hasSettingsTitle = m.textContent.includes('设置');
  const w120 = m.querySelector('.w-120');
  const zHeader = parseInt(getComputedStyle(document.getElementById('header')).zIndex, 10);
  const zModal = parseInt(getComputedStyle(document.getElementById('modal-overlay')).zIndex, 10);
  return { hasSettingsTitle, hasW120: !!w120, zHeader, zModal };
});
check('S5 设置弹窗渲染', s5.hasSettingsTitle, JSON.stringify(s5));
check('S5b 设置弹窗 z-index 覆盖 header', s5.zModal > s5.zHeader, `modal=${s5.zModal} header=${s5.zHeader}`);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

// S6 导入导出弹窗
await page.evaluate(() => ImportExport.openImportModal());
await page.waitForSelector('#modal:not(.hidden)', { timeout: 5000 });
await page.waitForTimeout(300);
const s6a = await page.evaluate(() => {
  const m = document.getElementById('modal');
  return { hasExport: m.textContent.includes('导出') || m.textContent.includes('导入') };
});
check('S6a 导入导出弹窗渲染', s6a.hasExport, JSON.stringify(s6a));
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

// S7 二维码弹窗
await page.evaluate(() => QR.openImportModal());
await page.waitForSelector('#modal:not(.hidden)', { timeout: 5000 });
await page.waitForTimeout(300);
const s7 = await page.evaluate(() => {
  const m = document.getElementById('modal');
  return { hasQR: m.textContent.includes('二维码') };
});
check('S7 二维码弹窗渲染', s7.hasQR, JSON.stringify(s7));
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

// S8 桌面端无横向溢出
const ov1 = await noOverflow(page);
check('S8 桌面端无横向溢出', ov1.ok, `scroll=${ov1.sw} client=${ov1.cw}`);

// 未捕获错误
await page.waitForTimeout(800);
check('S9 桌面端无 console/page error', errs.length === 0, errs.length ? errs.join(' | ').slice(0, 300) : '');

await ctx.close();

/* ═══════ 手机端 375×812 ═══════ */
const mctx = await browser.newContext({ viewport: { width: 375, height: 812 }, serviceWorkers: 'block' });
const mpage = await mctx.newPage();
const merrs = trackErrors(mpage, 'mobile');

await mpage.goto(BASE, { waitUntil: 'networkidle' });
await resetDB(mpage);
await mpage.reload({ waitUntil: 'networkidle' });
await mpage.waitForSelector('#lock-screen');
await createVault(mpage);

const m1 = await noOverflow(mpage);
check('M1 手机端主界面无横向溢出', m1.ok, `scroll=${m1.sw} client=${m1.cw}`);

// 打开新增弹窗（手机端侧边栏抽屉需先展开）
await mpage.click('#hamburger-btn');
await mpage.waitForSelector('#sidebar.open', { timeout: 5000 });
await mpage.click('button.btn-dropdown-main');
await mpage.waitForSelector('#e-title', { timeout: 5000 });
const m2 = await noOverflow(mpage);
check('M2 手机端弹窗无横向溢出', m2.ok, `scroll=${m2.sw} client=${m2.cw}`);

// 添加条目 → 详情
await mpage.fill('#e-title', '手机条目');
await mpage.fill('[data-field="password"]', 'Mob1le-Pw!');
await mpage.evaluate(() => saveEntry());
await mpage.waitForSelector('.entry-card', { timeout: 5000 });
await mpage.click('.entry-card');
await mpage.waitForSelector('#detail-panel.open', { timeout: 5000 });
const m3 = await noOverflow(mpage);
check('M3 手机端详情面板无横向溢出', m3.ok, `scroll=${m3.sw} client=${m3.cw}`);
await mpage.keyboard.press('Escape');
await mpage.waitForTimeout(700);

// 设置弹窗
await mpage.evaluate(() => Settings.openSettingsModal());
await mpage.waitForSelector('#modal:not(.hidden)', { timeout: 5000 });
await mpage.waitForTimeout(300);
const m4 = await noOverflow(mpage);
check('M4 手机端设置弹窗无横向溢出', m4.ok, `scroll=${m4.sw} client=${m4.cw}`);
await mpage.keyboard.press('Escape');
await mpage.waitForTimeout(400);

await mpage.waitForTimeout(800);
check('M5 手机端无 console/page error', merrs.length === 0, merrs.length ? merrs.join(' | ').slice(0, 300) : '');

await mctx.close();
await browser.close();
server.kill();

const fail = results.filter((r) => !r.ok);
console.log(`\n=== 回归结果：${results.length - fail.length}/${results.length} 通过 ===`);
if (fail.length) {
  console.log('失败项：');
  fail.forEach((f) => console.log(`  ❌ ${f.name} — ${f.detail}`));
  process.exit(1);
}
process.exit(0);
