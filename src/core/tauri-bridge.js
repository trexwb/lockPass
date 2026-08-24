/* ═══════════════════════════════════════════════════════════════════
   LockPass — Tauri 桥接层（条件加载）
   ───────────────────────────────────────────────────────────────────
   仅在 Tauri 桌面环境（window.__TAURI__ 存在）下生效：
     • 导出文件：改用系统「保存」对话框 + fs 写真实文件
     • 复制密码：改用 clipboard-manager 插件
     • 从系统拖入文件：通过 webview 拖放事件喂给导入流程
   浏览器环境下本文件自动降级为原生 API，完全不影响 Web 版运行。
   ═══════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const T = window.__TAURI__;
  const isTauri = !!(T && T.core && typeof T.core.invoke === 'function');

  /* ── 1. 导出文件：统一包装为返回 boolean ───────────────────────
     浏览器：走原生下载，返回 true。
     Tauri：dialog 保存框 + fs 写文件；用户取消返回 false。 */
  const originalDownload = Utils.downloadFile;
  Utils.downloadFile = async function (filename, content, type) {
    if (!isTauri) {
      originalDownload(filename, content, type);
      return true;
    }
    try {
      const isCsv = /\.csv($|\?)/i.test(filename);
      const savePath = await T.core.invoke('plugin:dialog|save', {
        options: {
          defaultPath: filename,
          filters: isCsv
            ? [{ name: 'CSV 明文备份', extensions: ['csv'] }]
            : [{ name: 'LockPass 加密备份', extensions: ['vault'] }]
        }
      });
      if (!savePath) return false; // 用户取消
      await T.core.invoke('export_text_file', {
        path: savePath,
        contents: content
      });
      return true;
    } catch (e) {
      console.error('[LockPass/Tauri] 导出失败:', e);
      if (typeof Utils !== 'undefined' && Utils.showToast) {
        Utils.showToast('导出失败：' + (e && e.message ? e.message : e), 'error');
      }
      return false;
    }
  };

  // 以下仅桌面环境需要
  if (!isTauri) return;

  const invoke = T.core.invoke;

  /* ── 2. 剪贴板：覆盖 navigator.clipboard.writeText ────────────── */
  try {
    const ClipboardShim = {
      writeText: function (text) {
        return invoke('plugin:clipboard-manager|write_text', { content: String(text == null ? '' : text) });
      },
      readText: function () {
        return invoke('plugin:clipboard-manager|read_text');
      }
    };
    Object.defineProperty(navigator, 'clipboard', {
      value: ClipboardShim,
      configurable: true,
      writable: true
    });
  } catch (e) {
    console.warn('[LockPass/Tauri] 无法覆盖 navigator.clipboard:', e);
  }

  /* ── 3. 从系统拖入文件 → 导入流程 ────────────────────────────────
     注：Tauri 的 HTML5 ondrop 仅对 webview 内部有效，
         从操作系统拖入需监听 webview 级拖放事件。 */
  try {
    if (T.webview && T.webview.getCurrentWebview) {
      const webview = T.webview.getCurrentWebview();
      webview.onDragDropEvent(function (event) {
        const payload = event.payload;
        if (!payload || payload.type !== 'drop') return;
        const paths = payload.paths || [];
        // R3 修复：读取前先将拖放路径写入 Rust 白名单（与 Rust 窗口事件双保险）
        invoke('file_store_grant_read', { paths: paths }).catch(function (err) {
          console.warn('[LockPass/Tauri] 拖放路径授权失败:', err);
        });
        paths.forEach(async function (p) {
          try {
            const text = await invoke('read_text_file_any', { path: p });
            const name = p.split(/[\\/]/).pop();
            if (window.ImportExport && window.ImportExport.processFile) {
              await window.ImportExport.processFile({
                name: name,
                text: function () { return Promise.resolve(text); }
              });
            }
          } catch (e) {
            console.error('[LockPass/Tauri] 拖入文件读取失败:', p, e);
          }
        });
      });
    }
  } catch (e) {
    console.warn('[LockPass/Tauri] 拖放事件注册失败（不影响按钮导入）:', e);
  }

  /* ── 4. 外部链接：拦截 target=_blank，交由系统浏览器打开 ────────
     Tauri webview 中 target=_blank 默认不调起系统浏览器（点击静默失败），
     这里全局拦截后调用 open_url 命令，用系统默认浏览器打开。 */
  try {
    document.addEventListener('click', function (e) {
      const el = e.target;
      if (!el || typeof el.closest !== 'function') return;
      const a = el.closest('a[target="_blank"]');
      if (!a || !a.href) return;
      e.preventDefault();
      invoke('open_url', { url: a.href }).catch(function (err) {
        console.error('[LockPass/Tauri] 打开外部链接失败:', err);
        if (typeof Utils !== 'undefined' && Utils.showToast) {
          Utils.showToast('打开链接失败：' + (err && err.message ? err.message : err), 'error');
        }
      });
    });
  } catch (e) {
    console.warn('[LockPass/Tauri] 外部链接点击委托注册失败:', e);
  }
})();
