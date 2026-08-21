/**
 * LockPass 粒子网络动效
 * 纯原生 Canvas 实现，无任何外部依赖
 * 支持多个实例：锁屏 #lock-bg + 工作区 #workspace-bg
 * 暴露 window.LockParticles = { start, stop } 供 app.js 启停（语义与单实例版兼容）
 *
 * 性能优化：
 * 1. 用 dx²+dy² 替代 Math.hypot，避免每帧 O(n²) 次开方运算
 * 2. 按透明度分组批量绘制连线，减少 strokeStyle 切换次数
 * 3. 容器不可见时暂停 RAF，可见时恢复
 */
(function () {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /**
   * 创建单 canvas 粒子实例
   * @param {HTMLCanvasElement} canvas
   * @param {Object} [opts] 可选覆盖：linkDist/mouseDist/baseCount/linkOpaqueMax/mouseOpaqueMax/linkColor/particleColor
   * @returns {{ start: Function, stop: Function, resize: Function }|null}
   */
  function createParticles(canvas, opts) {
    if (!canvas || !canvas.getContext) return null;
    opts = opts || {};
    const ctx = canvas.getContext('2d');
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    const LINK_DIST = opts.linkDist || 130;
    const LINK_DIST_SQ = LINK_DIST * LINK_DIST;
    const MOUSE_DIST = opts.mouseDist || 190;
    const MOUSE_DIST_SQ = MOUSE_DIST * MOUSE_DIST;
    const BASE_COUNT = opts.baseCount || 78;
    const LINK_OPAQUE_MAX = opts.linkOpaqueMax != null ? opts.linkOpaqueMax : 0.16;
    const MOUSE_OPAQUE_MAX = opts.mouseOpaqueMax != null ? opts.mouseOpaqueMax : 0.3;
    const BATCH_STEPS = 8;
    const linkColor = opts.linkColor || '88,166,255';
    const particleColor = opts.particleColor || '170,205,255';

    let particles = [];
    let rafId = null;
    let running = false;
    let width = 0;
    let height = 0;
    const mouse = { x: -9999, y: -9999, active: false };

    function seed() {
      const count = Math.min(BASE_COUNT, Math.max(26, Math.round((width * height) / 21000)));
      particles = [];
      for (let i = 0; i < count; i++) {
        particles.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 0.35,
          vy: (Math.random() - 0.5) * 0.35,
          r: Math.random() * 1.6 + 0.8,
          tw: Math.random() * Math.PI * 2
        });
      }
    }

    function resize() {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return; // 容器隐藏时不重置
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * DPR);
      canvas.height = Math.round(height * DPR);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      seed();
    }

    function step() {
      ctx.clearRect(0, 0, width, height);

      // 更新粒子位置
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.tw += 0.02;
        if (p.x < -20) p.x = width + 20;
        if (p.x > width + 20) p.x = -20;
        if (p.y < -20) p.y = height + 20;
        if (p.y > height + 20) p.y = -20;
      }

      // ── 连线：按透明度分组批量绘制 ──
      const batches = [];
      for (let b = 0; b < BATCH_STEPS; b++) batches.push([]);

      ctx.lineWidth = 1;
      for (let i = 0; i < particles.length; i++) {
        const a = particles[i];
        for (let j = i + 1; j < particles.length; j++) {
          const c = particles[j];
          const dx = a.x - c.x;
          const dy = a.y - c.y;
          const distSq = dx * dx + dy * dy;
          if (distSq < LINK_DIST_SQ) {
            const ratio = 1 - distSq / LINK_DIST_SQ;
            const bucket = Math.min(BATCH_STEPS - 1, Math.floor(ratio * BATCH_STEPS));
            batches[bucket].push(a.x, a.y, c.x, c.y);
          }
        }
        // 鼠标连线
        if (mouse.active) {
          const mdx = a.x - mouse.x;
          const mdy = a.y - mouse.y;
          const mDistSq = mdx * mdx + mdy * mdy;
          if (mDistSq < MOUSE_DIST_SQ) {
            const mRatio = 1 - mDistSq / MOUSE_DIST_SQ;
            const mOpaque = mRatio * MOUSE_OPAQUE_MAX;
            ctx.strokeStyle = 'rgba(' + linkColor + ',' + mOpaque.toFixed(3) + ')';
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(mouse.x, mouse.y);
            ctx.stroke();
          }
        }
      }

      // 批量绘制连线（每组只设一次 strokeStyle）
      for (let b = 0; b < BATCH_STEPS; b++) {
        const group = batches[b];
        if (group.length === 0) continue;
        const avgRatio = (b + 0.5) / BATCH_STEPS;
        ctx.strokeStyle = 'rgba(' + linkColor + ',' + (avgRatio * LINK_OPAQUE_MAX).toFixed(3) + ')';
        ctx.beginPath();
        for (let k = 0; k < group.length; k += 4) {
          ctx.moveTo(group[k], group[k + 1]);
          ctx.lineTo(group[k + 2], group[k + 3]);
        }
        ctx.stroke();
      }

      // ── 粒子（呼吸闪烁）──
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const alpha = 0.35 + Math.sin(p.tw) * 0.25;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(' + particleColor + ',' + alpha.toFixed(3) + ')';
        ctx.fill();
      }

      rafId = requestAnimationFrame(step);
    }

    function start() {
      if (running || reduceMotion) return;
      if (width === 0 || height === 0) resize();
      running = true;
      rafId = requestAnimationFrame(step);
    }

    function stop() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
    }

    function onMouseMove(e) {
      const rect = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
      mouse.active = true;
    }

    function onMouseLeave() {
      mouse.active = false;
    }

    window.addEventListener('resize', resize);
    window.addEventListener('load', resize);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseleave', onMouseLeave);

    resize();

    return { start: start, stop: stop, resize: resize };
  }

  function isLockVisible() {
    const lock = document.getElementById('lock-screen');
    return lock && !lock.classList.contains('hidden');
  }

  const lockInst = createParticles(document.getElementById('lock-bg'));
  const wsInst = createParticles(document.getElementById('workspace-bg'), {
    baseCount: 56,          // 工作区比锁屏略少，避免抢内容视觉焦点
    linkOpaqueMax: 0.13,
    mouseOpaqueMax: 0.26
  });

  // 按锁屏可见性同步两个实例的启停
  function syncAll() {
    if (!lockInst && !wsInst) return;
    const lockVisible = isLockVisible();
    if (lockInst) lockVisible ? lockInst.start() : lockInst.stop();
    if (wsInst) {
      if (lockVisible) {
        wsInst.stop();
      } else {
        wsInst.resize(); // 解锁后容器从 display:none 恢复，需重新取尺寸
        wsInst.start();
      }
    }
  }

  // 兼容 app.js 既有语义：
  // start = 锁屏粒子启动（工作区停止）；stop = 锁屏停止（工作区启动）
  window.LockParticles = {
    start: function () {
      if (lockInst) lockInst.start();
      if (wsInst) wsInst.stop();
    },
    stop: function () {
      if (lockInst) lockInst.stop();
      if (wsInst) { wsInst.resize(); wsInst.start(); }
    }
  };

  function onVisibility() {
    if (document.hidden) {
      if (lockInst) lockInst.stop();
      if (wsInst) wsInst.stop();
    } else {
      syncAll();
    }
  }

  document.addEventListener('visibilitychange', onVisibility);

  // 初始状态：按当前锁屏可见性启动对应实例
  if (!document.hidden) syncAll();
})();
