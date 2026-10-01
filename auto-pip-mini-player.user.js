// ==UserScript==
// @name         视频划出视口 · 自动小窗与画中画
// @name:en      Video Mini Player & Auto PiP on Scroll
// @namespace    https://github.com/xcyzj/auto-pip-mini-player
// @version      1.8.0
// @description  视频划出视口时自动变成站内悬浮小窗（类似哔哩哔哩），也可切换为浏览器系统画中画。保留站点自带控制条，整体等比缩放，支持拖动/缩放/位置记忆。
// @description:en When the player scrolls out of view it shrinks into an in-page floating mini player (like Bilibili); optionally it can enter the browser's Picture-in-Picture instead. Keeps the site's own control bar, scales the whole player, draggable and resizable with remembered position.
// @author       xcyzj
// @license      MIT
// @homepageURL  https://github.com/xcyzj/auto-pip-mini-player
// @supportURL   https://github.com/xcyzj/auto-pip-mini-player/issues
// （暂不写 @downloadURL / @updateURL：让油猴按"安装来源"自动检查更新。
//   发布到 GreasyFork 后执行 node tools/setup-metadata.cjs --gf-script <ID> 会自动补上这两行。）
// @match        https://www.miyoushe.com/ys/article*
// @match        https://www.miyoushe.com/sr/article*
// @match        https://www.miyoushe.com/bh3/article*
// @match        https://www.miyoushe.com/zzz/article*
// @match        https://www.taptap.cn/moment*
//
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// @noframes
// ==/UserScript==
//
// ── 说明 ────────────────────────────────────────────────────────────────
// 核心手法是"整体等比缩放"：找到播放器容器后把它 position:fixed 到角落，宽高保持原样，
//  用 transform:scale(s) 整体缩小 —— 站点内部的控制条、字号、图标、视频尺寸会按同一比例
//  一起变小，不需要逐个元素改样式，也不改变播放器内部布局。
//  · 占位元素：容器脱离文档流时在原位置留一个复刻原盒子（display/margin/flex/尺寸）的
//    占位，既撑住版面不跳，也作为"滚回原位"的判定参照。
//  · 几何补偿（geometryShim）：有些播放器用 offsetWidth（布局尺寸）算进度条落点，缩放后
//    "鼠标视觉位置 ÷ 布局宽度"就会偏。停靠期间把容器子树内读到的 offsetWidth/offsetHeight/
//    clientWidth/clientHeight 乘以缩放系数，让它读到视觉尺寸；还原时恢复原型上的原始描述符。
//    （实测 CSS zoom 不改变 offsetWidth，救不了这个问题，所以没用 zoom 方案。）
//  · 找容器时拒绝"明显比视频大"和"多出一大段文字"的祖先，避免把标题正文一起拖进小窗。
//  · 防跳：改版面前后各测一次页面上参照元素的位置，整页位移多少就把滚动位置补回多少。
//  · 不使用覆盖全文档的 MutationObserver（Vue/React 站点滚动时会不断插入节点，逐节点做
//    子树查询会拖慢滚动），改用定时心跳发现晚出现的播放器。
//  · 手动点"回到原位/关闭"之后，要等视频重新回到视野里，滚出去才会再次触发小窗。
//
// ── 想让它作用于别的站点 ──────────────────────────────────────────────
// 脚本改不了自己的 @match（那些元数据存在油猴自己的存储里，只在"要不要注入这个页面"时被读一次，
// 页面脚本没有任何写它的接口）。所以加站点只能在油猴界面里做，但脚本可以帮你把规则复制出来：
//  油猴图标 → 本脚本 → 设置页的「包含/排除」→"用户包含"→ 点「添加…」→ 粘贴 → 确定 → 刷新页面。
// 规则可以用菜单里的「📋 复制包含规则」（面板里也有同样的两个按钮）直接复制：
//  · 整站规则：https://<host>/*
//  · 本页路径规则：https://<host>/<路径前两段>*   ← 更精确，推荐
// 也可以直接在本文件顶部再加一行 @match（改脚本源码）。当前生效的规则：
//  https://www.miyoushe.com/ys/article*   （ys = 原神）
//  https://www.miyoushe.com/sr/article*   （sr = 崩铁）
//  https://www.miyoushe.com/bh3/article*  （bh3 = 崩坏3）
//  https://www.miyoushe.com/zzz/article*  （zzz = 绝区零）
//  https://www.taptap.cn/moment*
//  说明：路径末尾的 * 是前缀匹配，能同时覆盖 ".../article" 和 ".../article/123"；@match 不支持正则，
//  若想更严格（避免命中 .../articlelist 这类），可以改成 "@match .../article/*"，或用正则形式的
//  @include /^https:\/\/www\.miyoushe\.com\/(ys|sr|bh3|zzz)\/article(\/|$)/ 。
//  其它站点示例：https://*.bilibili.com/*  https://*.youtube.com/*  https://v.qq.com/x/*
// 站点适配器（面板里配置，按 host 生效）：videoSelector / containerSelector /
//  nativeMiniPlayer（该站自带小窗，本脚本让位）/ disabled。
// 快捷键：Alt+Shift+V 打开/关闭设置面板（油猴菜单里也有入口）。
//
// ── 系统画中画（面板里"播放方式"切换） ─────────────────────────────────
// 两种模式互斥：站内小窗（默认）或系统画中画。选了画中画就不再出小窗，
// 触发不了也只会"什么都不做"（不做兜底）。
//  · 视频画中画：video.requestPictureInPicture()，必须处在"瞬时的用户激活"窗口里才会成功
//    （Chrome 约 5 秒）。关键点是：**页面上任意一次点击**都会刷新这个窗口，不是非得点脚本的按钮。
//    所以实际体验是：随便点一下页面 → 5 秒内把视频滚出视口 → 直接进系统画中画；
//    已经滚出去之后，点一下页面也会立刻转成画中画。
//  · 切标签自动进入：Media Session 的 navigator.mediaSession.setActionHandler(
//    'enterpictureinpicture', fn)。注册后，浏览器在自身的条件都满足时（页面已获授权、
//    媒体在前台框架、最近两秒有声、持有音频焦点、正在播放）会在焦点离开标签页时
//    替我们调用 fn，不需要手势。授权是"一次性"的：地址栏站点信息里的"自动画中画"，
//    或首次弹窗时选择允许。未授权时切标签不会有任何反应。
//  · 视频滚回视野时自动收起画中画（可关）。

(function () {
  'use strict';

  if (window.top !== window.self) return; // @noframes 的双保险

  /* ================= 0. 常量 ================= */

  const CONFIG_KEY = 'vpip_config_v1';
  const Z_BAR = 2147483002;
  const Z_HOST = 2147483001;

  const DEFAULT_CONFIG = {
    mode: 'mini', // mini = 站内小窗（默认）| pip = 系统画中画；两种互斥，画中画模式下不会再出小窗
    pipOnTabSwitch: false, // 独立开关（默认关闭）：切标签时让浏览器自动进系统画中画，两种模式都可用
    pipExitOnVisible: true, // 视频滚回视野时自动收起画中画（只对"划出视口后进入"的画中画生效）
    geometryShim: true, // 几何补偿：修"用布局尺寸算进度条落点"的播放器
    closeAction: 'pause', // 小窗 ✕：pause（还原并暂停）| undock（仅还原）
    lockAspect: true, // 缩放时锁定比例
    undockOnPause: false, // 暂停时是否自动收起小窗
    reparent: true, // 播放器被 transform 祖先困住时，允许搬到顶层宿主
    dock: { xr: null, yr: null, w: 360 }, // 位置按视口比例记忆，默认右下角
    thresholds: { enter: 0.25, exit: 0.6, delay: 350, cooldown: 1200 },
    adapters: {}, // 按 host 配置：videoSelector / containerSelector / nativeMiniPlayer / disabled
  };

  /* ================= 1. 存储 ================= */

  const hasGM = typeof GM_getValue === 'function' && typeof GM_setValue === 'function';

  function loadRaw() {
    try {
      if (hasGM) return GM_getValue(CONFIG_KEY, null);
      const s = localStorage.getItem(CONFIG_KEY);
      return s ? JSON.parse(s) : null;
    } catch (e) {
      return null;
    }
  }

  function saveRaw(cfg) {
    try {
      if (hasGM) {
        GM_setValue(CONFIG_KEY, cfg);
        return;
      }
      localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
    } catch (e) {
      /* 忽略：存储失败不影响主流程 */
    }
  }

  /* ================= 2. 配置 ================= */

  // 只接受已知字段，顺带清掉旧版本留下的无效键（whitelist / denylist / usePresetSites / mode 等）
  function mergeConfig(raw) {
    const cfg = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    if (!raw || typeof raw !== 'object') return cfg;
    Object.keys(DEFAULT_CONFIG).forEach(function (k) {
      if (k === 'dock' || k === 'thresholds' || k === 'adapters') return;
      if (k in raw) cfg[k] = raw[k];
    });
    if (raw.dock && typeof raw.dock === 'object') Object.assign(cfg.dock, raw.dock);
    if (raw.thresholds && typeof raw.thresholds === 'object') Object.assign(cfg.thresholds, raw.thresholds);
    if (raw.adapters && typeof raw.adapters === 'object') cfg.adapters = raw.adapters;
    // 老配置用的是 pipEnabled 布尔开关，迁移成 mode
    if (!('mode' in raw) && raw.pipEnabled) cfg.mode = 'pip';
    if (cfg.mode !== 'pip') cfg.mode = 'mini';
    return cfg;
  }

  let CONFIG = mergeConfig(loadRaw());

  /* ================= 3. 站点适配器 ================= */

  function parseUrl(url) {
    try {
      return new URL(url);
    } catch (e) {
      return null;
    }
  }

  function normalizePattern(p) {
    return String(p == null ? '' : p)
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/^\/+/, '')
      .replace(/\/+$/, '')
      .replace(/\s+/g, '')
      .toLowerCase();
  }

  function getAdapter(u) {
    const adapters = CONFIG.adapters || {};
    const host = u.host.toLowerCase();
    if (adapters[host]) return adapters[host];
    const keys = Object.keys(adapters);
    for (let i = 0; i < keys.length; i++) {
      const k = normalizePattern(keys[i]);
      if (!k) continue;
      const base = k.indexOf('*.') === 0 ? k.slice(2) : k;
      if (host === base || host.slice(-(base.length + 1)) === '.' + base) return adapters[keys[i]];
    }
    return null;
  }

  /* ================= 4. 小工具 ================= */

  function visibleRatio(el, emptyValue) {
    if (!el || !el.isConnected) return emptyValue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return emptyValue;
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
    const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    return (w * h) / Math.max(1, r.width * r.height);
  }

  function areaOf(el) {
    const r = el.getBoundingClientRect();
    return Math.max(0, r.width) * Math.max(0, r.height);
  }

  function textLength(el) {
    return ((el && el.textContent) || '').trim().length;
  }

  // 浏览器给"用户刚操作过"的时间窗（Chrome 里约 5 秒），画中画这类 API 需要它。
  // 页面上任意一次点击都会刷新这个窗口 —— 这就是"随便点一下就能进画中画"的原理。
  function hasTransientActivation() {
    try {
      return !!(navigator.userActivation && navigator.userActivation.isActive);
    } catch (e) {
      return false;
    }
  }

  // ---- 加站点辅助：把现成的油猴包含规则复制到剪贴板 ----
  // 脚本无法修改自己的 @match，但可以帮用户把规则写好、复制出来，用户只需在油猴界面粘贴一次。

  function copyText(text) {
    try {
      if (typeof GM_setClipboard === 'function') {
        GM_setClipboard(text);
        return true;
      }
    } catch (e) {}
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) {}
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('style', 'position:fixed;top:-1000px;opacity:0');
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand && document.execCommand('copy');
      ta.remove();
      return !!ok;
    } catch (e) {
      return false;
    }
  }

  // depth=0 → 整站规则；depth=2 → 用路径前两段（米游社的 /ys/article、taptap 的 /moment 都在这层）
  function suggestRule(depth) {
    const segs = location.pathname.split('/').filter(Boolean).slice(0, depth || 0);
    const base = location.protocol + '//' + location.host;
    return segs.length ? base + '/' + segs.join('/') + '*' : base + '/*';
  }

  function copyRuleToast(depth) {
    const rule = suggestRule(depth);
    const ok = copyText(rule);
    toast(
      (ok ? '已复制包含规则：' : '请手动复制这条规则：') +
        rule +
        '  →  粘贴到 油猴图标 / 本脚本 / 设置 / 包含-排除 / 用户包含 / 添加…'
    );
  }

  // ---- 防跳工具 ----
  // 停靠会让播放器脱离文档流，如果占位没能完全兜住（或被站点重渲染掉），
  // 文档高度就会变，用户正在看的内容会整体上移/下移。这里用一个"参照元素"实测位移并补回滚动位置。

  function findScroller(el) {
    let n = el && el.parentElement;
    while (n && n !== document.documentElement) {
      let cs = null;
      try {
        cs = getComputedStyle(n);
      } catch (e) {
        cs = null;
      }
      if (cs && /(auto|scroll|overlay)/.test(cs.overflowY || '') && n.scrollHeight > n.clientHeight + 1) return n;
      n = n.parentElement;
    }
    return null; // null 表示由文档滚动
  }

  function getScrollTop(scroller) {
    if (scroller) return scroller.scrollTop || 0;
    return window.scrollY || document.documentElement.scrollTop || 0;
  }

  function setScrollTop(scroller, value) {
    const v = Math.max(0, value);
    try {
      if (scroller) scroller.scrollTop = v;
      else window.scrollTo(window.scrollX || 0, v);
    } catch (e) {
      try {
        if (scroller) scroller.scrollTop = v;
      } catch (e2) {}
    }
  }

  // 找一个仍在文档流里、位于播放器下方的元素：它相对视口的位置变化量 = 版面塌陷量
  function findProbe(el) {
    let node = el;
    for (let i = 0; node && i < 6; i++) {
      const sib = node.nextElementSibling;
      if (sib) {
        let cs = null;
        try {
          cs = getComputedStyle(sib);
        } catch (e) {
          cs = null;
        }
        const pos = cs && cs.position;
        if (pos !== 'fixed' && pos !== 'sticky' && !(cs && cs.display === 'none')) return sib;
      }
      node = node.parentElement;
      if (!node || node === document.body) break;
    }
    return null;
  }

  function hasTrapAncestor(el) {
    // 有 transform / filter / contain 的祖先会成为 fixed 定位的参照物，让小窗跑偏
    let p = el.parentElement;
    while (p && p !== document.documentElement) {
      let cs = null;
      try {
        cs = getComputedStyle(p);
      } catch (e) {
        cs = null;
      }
      if (cs) {
        if (cs.transform && cs.transform !== 'none') return p;
        if (cs.filter && cs.filter !== 'none') return p;
        if (cs.perspective && cs.perspective !== 'none') return p;
        if (cs.backdropFilter && cs.backdropFilter !== 'none') return p;
        if (cs.contain && /paint|layout|strict|content/.test(cs.contain)) return p;
        if (cs.willChange && /transform|filter|perspective/.test(cs.willChange)) return p;
      }
      p = p.parentElement;
    }
    return null;
  }

  let toastEl = null;
  let toastTimer = 0;
  function toast(msg) {
    if (!document.body) return;
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'vpip-toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('vpip-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      if (toastEl) toastEl.classList.remove('vpip-show');
    }, 3200);
  }

  let hostEl = null;
  function ensureHost() {
    if (hostEl && hostEl.isConnected) return hostEl;
    hostEl = document.createElement('div');
    hostEl.id = 'vpip-host';
    hostEl.setAttribute(
      'style',
      'position:static!important;width:0!important;height:0!important;margin:0!important;' +
        'padding:0!important;border:0!important;overflow:visible!important;z-index:auto!important;'
    );
    (document.body || document.documentElement).appendChild(hostEl);
    return hostEl;
  }

  /* ============ 4.5 几何补偿（geometryShim） ============ */
  //
  // 实测发现（米游社播放器）：它算进度条落点用的是 offsetWidth —— 也就是"布局尺寸"。
  // 我们用 transform 缩放时布局尺寸不变（还是 640），而鼠标位置是视觉坐标（0~360），
  // 两者相差一个缩放系数，落点自然就偏。zoom 经实测也不改 offsetWidth，救不了。
  // 所以这里直接对"小窗容器子树内"的元素做读取换算：把 offsetWidth/offsetHeight/
  // clientWidth/clientHeight 乘以缩放系数，让播放器读到的就是视觉尺寸，数学自洽。
  // 只在停靠期间、只对容器子树生效，还原时把原型上的原始描述符装回去。

  const rawDescs = { offsetWidth: null, offsetHeight: null, clientWidth: null, clientHeight: null };
  try {
    if (typeof HTMLElement !== 'undefined') {
      rawDescs.offsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
      rawDescs.offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
    }
    if (typeof Element !== 'undefined') {
      rawDescs.clientWidth = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth');
      rawDescs.clientHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight');
    }
  } catch (e) {}

  const shim = { on: false, applied: false, root: null, sx: 1, sy: 1 };

  // 拿元素真实的布局尺寸（绕过补偿），我们自己的逻辑和诊断都用它
  function rawSize(el, prop) {
    const d = rawDescs[prop];
    if (d && typeof d.get === 'function') {
      try {
        return d.get.call(el) || 0;
      } catch (e) {
        return 0;
      }
    }
    try {
      return el[prop] || 0;
    } catch (e) {
      return 0;
    }
  }

  function shimValue(el, prop, origGet) {
    const v = origGet.call(el);
    if (!shim.on || !shim.root || el.nodeType !== 1) return v;
    if (el !== shim.root && !shim.root.contains(el)) return v;
    const f = prop === 'offsetWidth' || prop === 'clientWidth' ? shim.sx : shim.sy;
    return Math.round(v * f);
  }

  function installShim() {
    if (shim.applied) return;
    const def = function (proto, prop) {
      const d = rawDescs[prop];
      if (!proto || !d || typeof d.get !== 'function') return;
      try {
        Object.defineProperty(proto, prop, {
          configurable: true,
          get: function () {
            return shimValue(this, prop, d.get);
          },
        });
      } catch (e) {}
    };
    const H = typeof HTMLElement !== 'undefined' ? HTMLElement.prototype : null;
    const E = typeof Element !== 'undefined' ? Element.prototype : null;
    def(H, 'offsetWidth');
    def(H, 'offsetHeight');
    def(E, 'clientWidth');
    def(E, 'clientHeight');
    shim.applied = true;
  }

  function enableGeometryShim(root, sx, sy) {
    if (!CONFIG.geometryShim || !root || !rawDescs.offsetWidth) {
      shim.on = false;
      return;
    }
    shim.root = root;
    shim.sx = sx;
    shim.sy = sy;
    shim.on = true;
    if (!shim.applied) installShim();
  }

  function disableGeometryShim() {
    shim.on = false;
    if (!shim.applied) return;
    const H = typeof HTMLElement !== 'undefined' ? HTMLElement.prototype : null;
    const E = typeof Element !== 'undefined' ? Element.prototype : null;
    const restore = function (proto, prop) {
      if (!proto || !rawDescs[prop]) return;
      try {
        Object.defineProperty(proto, prop, rawDescs[prop]);
      } catch (e) {}
    };
    restore(H, 'offsetWidth');
    restore(H, 'offsetHeight');
    restore(E, 'clientWidth');
    restore(E, 'clientHeight');
    shim.applied = false;
  }

  /* ================= 5. 样式 ================= */
  const CSS = [
    '.vpip-bar{position:fixed;display:flex;align-items:center;gap:2px;height:26px;box-sizing:border-box;',
    'padding:0 4px;border-radius:6px;background:rgba(24,24,26,.88);color:#fff;cursor:move;',
    'font:12px/1 -apple-system,"Segoe UI",Roboto,"Microsoft YaHei",sans-serif;user-select:none;',
    'touch-action:none;box-shadow:0 2px 10px rgba(0,0,0,.45);z-index:' + Z_BAR + '}',
    '.vpip-bar .vpip-spacer{flex:1 1 auto;height:100%}',
    '.vpip-bar .vpip-name{opacity:.6;font-size:11px;margin-right:4px;white-space:nowrap;overflow:hidden}',
    '.vpip-btn{all:unset;box-sizing:border-box;cursor:pointer;width:22px;height:20px;line-height:20px;',
    'text-align:center;border-radius:4px;color:#fff;font-size:13px}',
    '.vpip-btn:hover{background:rgba(255,255,255,.2)}',
    '.vpip-btn.vpip-on{background:#2d7ff9}',
    '.vpip-grip{position:fixed;width:14px;height:14px;cursor:nwse-resize;touch-action:none;z-index:' + Z_BAR + ';',
    'background:linear-gradient(135deg,transparent 40%,rgba(255,255,255,.85) 50%,transparent 60%)}',
    '.vpip-toast{position:fixed;left:50%;bottom:36px;transform:translate(-50%,12px);opacity:0;',
    'transition:opacity .18s ease,transform .18s ease;background:rgba(24,24,26,.94);color:#fff;',
    'font:13px/1.5 -apple-system,"Segoe UI",Roboto,"Microsoft YaHei",sans-serif;padding:8px 14px;',
    'border-radius:8px;max-width:70vw;pointer-events:none;z-index:' + (Z_BAR + 10) + '}',
    '.vpip-toast.vpip-show{opacity:1;transform:translate(-50%,0)}',
    '.vpip-panel{position:fixed;right:16px;top:16px;width:440px;max-width:92vw;max-height:86vh;overflow:auto;',
    'background:#1e1f22;color:#e8e8ea;border:1px solid #3a3b3f;border-radius:10px;padding:14px 16px;',
    'font:13px/1.6 -apple-system,"Segoe UI",Roboto,"Microsoft YaHei",sans-serif;z-index:' + (Z_BAR + 20) + ';',
    'box-shadow:0 12px 40px rgba(0,0,0,.55)}',
    '.vpip-panel h3{margin:0 0 10px;font-size:14px;font-weight:600;display:flex;justify-content:space-between;align-items:center}',
    '.vpip-panel .vpip-row{display:flex;align-items:center;gap:8px;margin:6px 0}',
    '.vpip-panel label{flex:0 0 132px;color:#b9babe}',
    '.vpip-panel select,.vpip-panel input[type=text],.vpip-panel textarea{flex:1 1 auto;background:#141518;',
    'color:#e8e8ea;border:1px solid #3a3b3f;border-radius:6px;padding:5px 8px;font:12px/1.5 inherit;box-sizing:border-box}',
    '.vpip-panel textarea{min-height:74px;font-family:ui-monospace,Consolas,monospace;resize:vertical}',
    '.vpip-panel .vpip-hint{color:#8b8d93;font-size:11.5px;margin:-2px 0 8px 0}',
    '.vpip-panel .vpip-actions{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}',
    '.vpip-panel button{cursor:pointer;background:#2d7ff9;color:#fff;border:0;border-radius:6px;padding:6px 12px;font:12px inherit}',
    '.vpip-panel button.vpip-ghost{background:#33353a}',
    '.vpip-panel .vpip-close{all:unset;cursor:pointer;color:#8b8d93;font-size:16px;padding:0 4px}',
    '.vpip-panel .vpip-close:hover{color:#fff}',
  ].join('');

  function injectStyle() {
    if (document.getElementById('vpip-style')) return;
    const style = document.createElement('style');
    style.id = 'vpip-style';
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  /* ================= 6. 核心控制器 ================= */

  class MiniController {
    constructor() {
      const u = parseUrl(location.href);
      this.host = location.host;
      this.adapter = (u && getAdapter(u)) || {};
      this.video = null;
      this.io = null;
      this.ratio = 1;
      this.maxSeen = 0;
      this.docked = false;
      this.manual = false;
      this.dockEl = null;
      this.savedStyleAttr = null;
      this.reparented = false;
      this.sentinel = null; // 停在原位置的占位元素：既撑住版面不跳，也是"滚回去"的判定参照
      this.natural = null; // 停靠目标的原始尺寸（缩放前的），小窗按它等比缩放
      this.awaitingVisible = false; // 手动收起后，需要视频重新回到视野里才允许再次自动进小窗
      this.bar = null;
      this.grip = null;
      this.barBtns = null;
      this.dockBox = null;
      this.lastUndockAt = 0;
      this.dockTimer = 0;
      this.listeners = [];
      this.stopped = false;
      this.pipHandler = null; // Media Session 的 enterpictureinpicture 处理器（切标签自动进画中画用）
      this.pipStartedVisible = false; // 画中画开始时视频是否本来就在视野里（决定要不要自动收起）
      this.lastPipAttempt = 0; // 画中画尝试节流
      this.pipBlockedUntil = 0; // 自动尝试失败后短暂不再尝试，避免反复被拒
      this.onResizeBound = this.onViewportChange.bind(this);
      this.onFullscreenBound = this.onFullscreen.bind(this);
      this.onKeyBound = this.onKey.bind(this);
    }

    start() {
      if (this.adapter.disabled) return;
      if (this.adapter.nativeMiniPlayer) return; // 站点自带小窗，让位
      window.addEventListener('resize', this.onResizeBound, true);
      document.addEventListener('fullscreenchange', this.onFullscreenBound, true);
      window.addEventListener('keydown', this.onKeyBound, true);
      this.setupPiP();
      this.scan();
      // 刻意不使用覆盖全文档的 MutationObserver：在 Vue/React 站点上，
      // 滚动时页面会不断插入节点，逐节点做子树查询会明显拖慢滚动。
      // 视频晚出现的情况由外部的定时心跳兜住。
    }

    stop() {
      this.stopped = true;
      disableGeometryShim();
      if (this.io) {
        try {
          this.io.disconnect();
        } catch (e) {}
        this.io = null;
      }
      if (this.dockTimer) {
        clearTimeout(this.dockTimer);
        this.dockTimer = 0;
      }
      window.removeEventListener('resize', this.onResizeBound, true);
      document.removeEventListener('fullscreenchange', this.onFullscreenBound, true);
      window.removeEventListener('keydown', this.onKeyBound, true);
      this.detachVideo();
      if (this.docked) this.undock('stop');
      this.teardownPiP();
    }

    /* ---- 第二部分：系统画中画 ---- */

    // 切标签自动进画中画：注册 Media Session 的 enterpictureinpicture 处理器。
    // 注册本身不弹任何东西；浏览器在它自己的条件都满足时（页面已获授权、媒体在前台框架、
    // 最近两秒有声、持有音频焦点、正在播放）会在焦点离开标签页时替我们调用它。
    // 这是独立开关，站内小窗模式同样可以开启。
    setupPiP() {
      if (!CONFIG.pipOnTabSwitch) return;
      const ms = navigator.mediaSession;
      if (!ms || typeof ms.setActionHandler !== 'function') return;
      const self = this;
      this.pipHandler = function () {
        const v = self.currentVideo();
        if (!v || typeof v.requestPictureInPicture !== 'function') return;
        v.requestPictureInPicture().catch(function () {});
      };
      try {
        ms.setActionHandler('enterpictureinpicture', this.pipHandler);
      } catch (e) {
        this.pipHandler = null; // 浏览器不认识这个 action
      }
    }

    teardownPiP() {
      if (!this.pipHandler) return;
      this.pipHandler = null;
      try {
        navigator.mediaSession.setActionHandler('enterpictureinpicture', null);
      } catch (e) {}
    }

    currentVideo() {
      return this.video || this.pickVideo();
    }

    // 进入系统画中画。source：
    //  'manual' —— 用户点了工具条 ⧉ / 菜单；
    //  'auto'   —— 划出视口时检测到还有瞬时激活（用户点过页面后约 5 秒内）。
    // 两种模式都能手动进画中画；'auto' 只在画中画模式下由划出视口触发。
    // 画中画模式下没有站内小窗兜底：这里失败就什么都不做，只做短期降噪。
    tryEnterPiP(source) {
      const v = this.currentVideo();
      if (!v || v.paused || v.ended) return false;
      if (document.pictureInPictureElement === v) return false;
      if (!document.pictureInPictureEnabled || typeof v.requestPictureInPicture !== 'function') {
        if (source === 'manual') toast('当前浏览器不支持视频画中画');
        return false;
      }
      if (source !== 'manual' && Date.now() < this.pipBlockedUntil) return false;
      const now = Date.now();
      if (now - this.lastPipAttempt < 600) return false;
      this.lastPipAttempt = now;
      const self = this;
      v.requestPictureInPicture()
        .then(function () {
          if (self.docked) self.undock('pip'); // 站内小窗让位，别叠两个
        })
        .catch(function (err) {
          self.pipBlockedUntil = Date.now() + 4000; // 短期不再自动重试，避免反复被拒
          if (source === 'manual') {
            toast('进入画中画失败：' + ((err && err.name) || '未知错误') + '（系统画中画需要一次真实的页面点击）');
          }
        });
      return true;
    }

    // 手动入口（工具条 ⧉ / 菜单）：本身也是那次"真实点击"
    enterSystemPiP() {
      if (!this.currentVideo()) {
        toast('没有找到正在播放的视频');
        return;
      }
      this.tryEnterPiP('manual');
    }

    /* ---- 定时心跳：由外部 supervisor 调用 ---- */

    tick() {
      if (this.stopped) return;
      this.scan();
      if (!this.docked) return;
      // 站点可能重写内联样式或删掉我们的工具条，这里只做"必要时的修补"，避免每次都写样式触发重排
      if (!this.dockEl || !this.dockEl.isConnected) {
        this.undock('self-heal');
        return;
      }
      this.syncNaturalSize();
      if (this.dockEl.style.position !== 'fixed') {
        this.applyDockStyles(this.dockEl, this.dockBox);
        this.syncChrome();
      }
      if (this.sentinel && !this.sentinel.isConnected && this.dockEl.parentNode) {
        this.dockEl.parentNode.insertBefore(this.sentinel, this.dockEl);
      }
      if (this.bar && !this.bar.isConnected) document.body.appendChild(this.bar);
      if (this.grip && !this.grip.isConnected) document.body.appendChild(this.grip);
    }

    // transform 不影响 layout 尺寸，所以 offsetWidth/Height 就是"没有缩放时的原始尺寸"。
    // 有些播放器会随播放状态改自己的高度（米游社的播放器暂停时 640x563、播放时 640x360），
    // 发现尺寸变了就重算缩放比例，小窗视觉大小保持不变。
    syncNaturalSize() {
      if (!this.dockEl || !this.natural || !this.dockBox) return;
      const nw = rawSize(this.dockEl, 'offsetWidth');
      const nh = rawSize(this.dockEl, 'offsetHeight');
      if (!nw || !nh) return;
      if (Math.abs(nw - this.natural.w) <= 1 && Math.abs(nh - this.natural.h) <= 1) return;
      this.natural = { w: nw, h: nh };
      this.dockBox.h = (this.dockBox.w * nh) / nw;
      this.applyDockStyles(this.dockEl, this.dockBox);
      this.syncChrome();
      // 占位元素跟着改，页面留出来的空间才和站点原来的排版一致
      if (this.sentinel) {
        try {
          this.sentinel.style.setProperty('height', nh + 'px', 'important');
        } catch (e) {}
      }
    }

    // 视口变化（窗口缩放、开关调试面板）时，小窗位置要跟着收进可视区域，
    // 否则工具条会跟着新视口跑、小窗本体却留在旧位置。
    onViewportChange() {
      if (!this.docked || !this.dockBox) return;
      const b = this.dockBox;
      const maxX = Math.max(0, window.innerWidth - b.w);
      const maxY = Math.max(0, window.innerHeight - b.h);
      b.x = Math.min(maxX, Math.max(0, b.x));
      b.y = Math.min(maxY, Math.max(0, b.y));
      this.applyDockStyles(this.dockEl, b);
      this.syncChrome();
    }

    /* ---- 选片与挂载 ---- */

    pickVideo() {
      if (this.adapter.videoSelector) {
        let el = null;
        try {
          el = document.querySelector(this.adapter.videoSelector);
        } catch (e) {
          el = null;
        }
        if (el) {
          if (el.tagName === 'VIDEO') return el;
          const inner = el.querySelector('video');
          if (inner) return inner;
        }
      }
      const all = Array.prototype.slice.call(document.querySelectorAll('video'));
      const live = all.filter(function (v) {
        return (
          v.isConnected &&
          v.readyState >= 2 &&
          !v.ended &&
          v.duration > 0 &&
          v.currentTime > 0 &&
          v.getBoundingClientRect().width >= 120
        );
      });
      if (!live.length) return null;
      const playing = live.filter(function (v) {
        return !v.paused;
      });
      const pool = playing.length ? playing : live;
      pool.sort(function (a, b) {
        return areaOf(b) - areaOf(a);
      });
      return pool[0];
    }

    scan() {
      const v = this.pickVideo();
      if (v !== this.video) this.attach(v);
      this.refreshRatio();
      this.evaluate();
    }

    attach(v) {
      if (this.docked) this.undock('video-changed');
      this.detachVideo();
      if (this.io) {
        try {
          this.io.disconnect();
        } catch (e) {}
        this.io = null;
      }
      this.video = v;
      this.maxSeen = 0;
      this.ratio = v ? visibleRatio(v) : 1;
      if (!v) return;
      const self = this;
      const onMedia = function () {
        self.evaluate();
      };
      ['play', 'playing', 'pause', 'ended', 'emptied', 'seeked'].forEach(function (t) {
        v.addEventListener(t, onMedia);
        self.listeners.push([t, onMedia, v]);
      });
      const onEnterPip = function () {
        // 记录画中画"开始时视频是否本来就在视野里"：
        //  开始时可见（切窗口自动弹、或用户在看着视频时手点 ⧉）→ 不自动收起，交给用户/浏览器；
        //  开始时已划出视口（划出去自动进的）→ 之后滚回来时自动收起。
        self.pipStartedVisible = visibleRatio(v) >= CONFIG.thresholds.exit;
        if (self.docked) self.undock('pip'); // 站内小窗让位，别叠两个
      };
      v.addEventListener('enterpictureinpicture', onEnterPip);
      this.listeners.push(['enterpictureinpicture', onEnterPip, v]);
      const onLeavePip = function () {
        self.pipStartedVisible = false;
        // 画中画结束时（包括点系统悬浮窗上的"返回标签页"按钮）：先要求视频重新回到视野，
        // 之后再划走才允许再次自动触发。否则那次点击留下的瞬时激活会让它立刻又弹出来。
        if (CONFIG.mode === 'pip') self.awaitingVisible = true;
      };
      v.addEventListener('leavepictureinpicture', onLeavePip);
      this.listeners.push(['leavepictureinpicture', onLeavePip, v]);
      try {
        this.io = new IntersectionObserver(
          function () {
            self.refreshRatio();
            self.evaluate();
          },
          { threshold: [0, 0.25, 0.5, 0.75, 1] }
        );
        this.setRatioSource(v);
      } catch (e) {
        this.io = null;
      }
    }

    // 缩放/滚动的参照物：未停靠时是被观测的 video，停靠后换成原位置上的占位元素
    setRatioSource(el) {
      if (!this.io) return;
      try {
        this.io.disconnect();
        if (el) this.io.observe(el);
      } catch (e) {}
    }

    refreshRatio() {
      const src = this.docked && this.sentinel ? this.sentinel : this.video;
      if (!src) return;
      // 占位元素没有面积时视为"不在视野里"，避免刚停靠就误判成滚回原位
      this.ratio = visibleRatio(src, this.docked ? 0 : 1);
      if (!this.docked && this.ratio > this.maxSeen) this.maxSeen = this.ratio;
    }

    detachVideo() {
      this.listeners.forEach(function (l) {
        try {
          l[2].removeEventListener(l[0], l[1]);
        } catch (e) {}
      });
      this.listeners = [];
    }

    /* ---- 进出小窗判定 ---- */

    isPlaying(v) {
      return !!v && !v.paused && !v.ended && v.duration > 0 && v.currentTime > 0;
    }

    evaluate() {
      const v = this.video;
      if (!v) {
        if (this.docked) this.undock('no-video');
        return;
      }
      if (document.fullscreenElement) {
        if (this.docked) this.undock('fullscreen');
        return;
      }
      if (document.pictureInPictureElement) {
        // 已经在系统画中画里了，站内小窗让位
        if (this.docked) this.undock('pip');
        // 只有"划出视口后进入"的画中画才在滚回视野时自动收起；
        // 切窗口自动弹出的那种（开始时视频本来可见）不能收 —— 否则刚弹出就被关掉。
        if (
          CONFIG.pipExitOnVisible &&
          !this.pipStartedVisible &&
          document.pictureInPictureElement === v &&
          this.ratio >= CONFIG.thresholds.exit
        ) {
          try {
            document.exitPictureInPicture();
          } catch (e) {}
        }
        return;
      }
      const playing = this.isPlaying(v);
      if (!this.docked) {
        if (!playing) return;
        // 用户手动收起过、或刚从画中画返回：必须等他先把视频滚回视野里（重新武装），滚出去才会再触发
        if (this.awaitingVisible) {
          if (this.ratio >= CONFIG.thresholds.exit) this.awaitingVisible = false;
          return;
        }
        if (this.ratio > CONFIG.thresholds.enter) return;
        if (this.maxSeen < 0.5) return; // 从没真正露出过（例如页脚自动播放的视频）不接管
        // 画中画模式：只尝试系统画中画，绝不退回站内小窗（触发不了就什么都不做）
        if (CONFIG.mode === 'pip') {
          if (hasTransientActivation()) this.tryEnterPiP('auto');
          return;
        }
        if (Date.now() - this.lastUndockAt < CONFIG.thresholds.cooldown) return;
        if (this.dockTimer) return;
        this.scheduleDock();
      } else {
        if (v.ended) {
          this.undock('ended');
          return;
        }
        if (!playing && CONFIG.undockOnPause) {
          this.undock('paused');
          return;
        }
        if (!this.manual && this.ratio >= CONFIG.thresholds.exit) this.undock('scrolled-back');
      }
    }

    // 延迟去抖后再确认一次，避免快速滚动时误进小窗
    scheduleDock() {
      if (this.dockTimer) return;
      const self = this;
      this.dockTimer = setTimeout(function () {
        self.dockTimer = 0;
        if (self.stopped || self.docked || !self.video) return;
        if (visibleRatio(self.video) > CONFIG.thresholds.enter) return;
        if (!self.isPlaying(self.video)) return;
        self.dock();
      }, CONFIG.thresholds.delay);
    }

    /* ---- DOM 选择 ---- */

    findDockTarget(v) {
      if (this.adapter.containerSelector) {
        let el = null;
        try {
          el = v.closest(this.adapter.containerSelector) || document.querySelector(this.adapter.containerSelector);
        } catch (e) {
          el = null;
        }
        if (el && el.contains(v)) return el;
      }
      const vr = v.getBoundingClientRect();
      let best = v;
      let node = v;
      for (let i = 0; i < 6 && node.parentElement; i++) {
        const p = node.parentElement;
        if (p === document.body || p === document.documentElement) break;
        const r = p.getBoundingClientRect();
        if (r.width < vr.width - 1 || r.height < vr.height - 1) break;
        // 明显比视频大：多半已经把标题、正文之类的兄弟内容包进来了
        const grewBy = Math.max(r.height - vr.height, r.width - vr.width);
        if (grewBy > Math.max(60, vr.height * 0.18)) break;
        if (r.width * r.height > vr.width * vr.height * 2.2 + 40000) break;
        // 尺寸长了但没多出多少文字 → 是播放器自带的控制条/工具栏，可以要；
        // 尺寸长了而且多出一大段文字 → 是"播放器 + 标题正文"的容器，不能要。
        if (grewBy > 24 && textLength(p) - textLength(best) > 120) break;
        if (p.querySelectorAll('video').length > 1) break; // 多个视频，别把别的也框进去
        best = p;
        node = p;
      }
      return best;
    }

    /* ---- 停靠 ---- */

    place(w, h) {
      const maxX = Math.max(0, window.innerWidth - w);
      const maxY = Math.max(0, window.innerHeight - h);
      let xr = CONFIG.dock.xr;
      let yr = CONFIG.dock.yr;
      if (typeof xr !== 'number' || !isFinite(xr)) xr = 1;
      if (typeof yr !== 'number' || !isFinite(yr)) yr = 1;
      xr = Math.min(1, Math.max(0, xr));
      yr = Math.min(1, Math.max(0, yr));
      return { x: Math.round(xr * maxX), y: Math.round(yr * maxY), w: w, h: h, maxX: maxX, maxY: maxY };
    }

    // 关键：不去改容器的宽高（那会把站点内部的控制条、图标、字号留在原尺寸），
    // 而是保持容器原尺寸做整体等比缩放，内部组件随之一起缩小。
    // transform：布局尺寸不变（offsetWidth 仍是原值），视觉尺寸变小；
    // 关键：不去改容器的宽高（那会把站点内部的控制条、图标、字号留在原尺寸），
    // 而是保持容器原尺寸做整体等比缩放，内部组件随之一起缩小。
    // 副作用是"布局尺寸 ≠ 视觉尺寸"，于是配合几何补偿把播放器读到的尺寸换算成视觉尺寸。
    applyDockStyles(el, box) {
      if (!el || !box || !this.natural) return;
      const n = this.natural;
      const sx = box.w / Math.max(1, n.w);
      const sy = box.h / Math.max(1, n.h);
      const s = el.style;
      s.setProperty('position', 'fixed', 'important');
      s.setProperty('left', box.x + 'px', 'important');
      s.setProperty('top', box.y + 'px', 'important');
      s.setProperty('right', 'auto', 'important');
      s.setProperty('bottom', 'auto', 'important');
      s.setProperty('width', Math.round(n.w) + 'px', 'important');
      s.setProperty('height', Math.round(n.h) + 'px', 'important');
      s.setProperty('margin', '0', 'important');
      s.setProperty('transform-origin', '0 0', 'important');
      s.setProperty('transform', 'scale(' + sx + ',' + sy + ')', 'important');
      s.setProperty('z-index', String(Z_HOST), 'important');
      s.setProperty('box-shadow', '0 6px 26px rgba(0,0,0,.5)', 'important');
      // 缩放过的小窗圆角要按比例放大回去，视觉上才是一致的 8px
      s.setProperty('border-radius', Math.round(8 / Math.max(0.01, sx)) + 'px', 'important');
      s.setProperty('overflow', 'hidden', 'important');
      s.setProperty('background', '#000', 'important');
      enableGeometryShim(el, sx, sy);
    }

    dock() {
      const v = this.video;
      if (!v || this.docked) return;
      const target = this.findDockTarget(v);
      if (!target) return;
      const tRect = target.getBoundingClientRect();
      // 小窗比例取"容器"的比例而不是视频本身的比例：这样缩放是等比的，
      // 站点在容器里做的留白/控制条位置都会原样保留，画面不会被拉变形。
      const aspect = tRect.height > 0 ? tRect.width / tRect.height : 16 / 9;
      const w = Math.max(200, Math.min(CONFIG.dock.w || 360, Math.round(window.innerWidth * 0.9)));
      const h = w / (aspect || 16 / 9);

      this.dockEl = target;
      this.savedStyleAttr = target.getAttribute('style');
      this.natural = { w: tRect.width, h: tRect.height };
      const watch = this.beginShiftWatch(target);

      // 原位置留一个占位元素：既避免播放器脱离文档流后页面塌陷跳动，
      // 也是"用户滚回原位"的判定参照（否则小窗里的 video 永远"可见"，会立刻自动还原）。
      // 尽量忠实复刻原元素的盒子：display / margin / flex / box-sizing 都照抄，否则版式会跳。
      this.sentinel = document.createElement('div');
      this.sentinel.className = 'vpip-sentinel';
      let cs = null;
      try {
        cs = getComputedStyle(target);
      } catch (e) {
        cs = null;
      }
      const sentinelCss = [
        'visibility:hidden',
        'pointer-events:none',
        'padding:0',
        'border:0',
        'box-sizing:border-box',
        'width:' + Math.round(tRect.width) + 'px',
        'height:' + Math.round(tRect.height) + 'px',
        'display:' + (cs && cs.display ? cs.display : 'block'),
        'margin:' + (cs && cs.margin ? cs.margin : '0'),
        'flex:' + (cs && cs.flex ? cs.flex : '0 0 auto'),
        'align-self:' + (cs && cs.alignSelf ? cs.alignSelf : 'auto'),
      ].join('!important;');
      this.sentinel.setAttribute('style', sentinelCss + '!important');
      if (target.parentNode) target.parentNode.insertBefore(this.sentinel, target);

      const trap = hasTrapAncestor(target);
      if (trap && trap !== document.body && CONFIG.reparent && target.parentNode) {
        // 祖先里有 transform / contain 之类的元素，fixed 会以它为参照物 → 搬到顶层宿主里
        ensureHost();
        hostEl.appendChild(target);
        this.reparented = true;
      }

      this.docked = true;
      this.manual = false;
      this.dockBox = this.place(w, h);
      this.applyDockStyles(target, this.dockBox);
      this.setRatioSource(this.sentinel);
      this.refreshRatio();
      this.buildChrome();
      this.syncChrome();
      this.endShiftWatch(watch);
      this.nudgeSiteResize();
    }

    // ---- 防跳：记录参照物 → 改版面 → 实测位移并补回滚动 ----

    beginShiftWatch(target) {
      const scroller = findScroller(target);
      const probe = findProbe(target);
      const beforeTop = probe ? probe.getBoundingClientRect().top : 0;
      return { scroller: scroller, probe: probe, beforeTop: beforeTop, watchFrom: getScrollTop(scroller) };
    }

    endShiftWatch(watch) {
      if (!watch || !watch.probe || !watch.probe.isConnected) return;
      this.applyShiftCorrection(watch);
      // 站点可能在自己的 ResizeObserver / resize 回调里稍后再改一次版面，延迟再校准一次。
      // 但如果这期间用户自己滚动了，就不能再动他的滚动位置。
      const self = this;
      const expect = getScrollTop(watch.scroller);
      setTimeout(function () {
        if (self.stopped) return;
        if (!watch.probe || !watch.probe.isConnected) return;
        if (Math.abs(getScrollTop(watch.scroller) - expect) > 1) return;
        self.applyShiftCorrection(watch);
      }, 220);
    }

    applyShiftCorrection(watch) {
      const afterTop = watch.probe.getBoundingClientRect().top;
      const delta = afterTop - watch.beforeTop;
      if (!isFinite(delta) || Math.abs(delta) < 0.5) return;
      setScrollTop(watch.scroller, getScrollTop(watch.scroller) + delta);
    }

    undock(reason) {
      if (!this.docked) return;
      const el = this.dockEl;
      this.docked = false;
      const watch = el ? this.beginShiftWatch(el) : null;
      if (this.dockTimer) {
        clearTimeout(this.dockTimer);
        this.dockTimer = 0;
      }
      if (el) {
        if (this.savedStyleAttr == null) el.removeAttribute('style');
        else el.setAttribute('style', this.savedStyleAttr);
        // 搬走过的话放回占位元素的位置，顺序与样式都恢复原样
        if (this.reparented && this.sentinel && this.sentinel.parentNode) {
          this.sentinel.parentNode.replaceChild(el, this.sentinel);
        }
      }
      if (this.sentinel) {
        this.sentinel.remove();
        this.sentinel = null;
      }
      this.reparented = false;
      // 手动收起（回到原位 / 关闭）：在用户把视频重新滚回视野里之前，不再自动进小窗
      if (reason === 'user' || reason === 'user-close') this.awaitingVisible = true;
      disableGeometryShim();
      this.setRatioSource(this.video);
      if (this.bar) this.bar.remove();
      if (this.grip) this.grip.remove();
      this.bar = null;
      this.grip = null;
      this.barBtns = null;
      this.dockEl = null;
      this.dockBox = null;
      this.natural = null;
      this.manual = false;
      this.lastUndockAt = Date.now();
      this.ratio = this.video ? visibleRatio(this.video) : 1;
      this.endShiftWatch(watch);
      this.nudgeSiteResize();
    }

    /* ---- 工具条 ---- */

    buildChrome() {
      const self = this;
      const bar = document.createElement('div');
      bar.className = 'vpip-bar';
      const mk = function (label, title, fn) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'vpip-btn';
        b.textContent = label;
        b.title = title;
        b.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          fn();
        });
        return b;
      };
      const name = document.createElement('span');
      name.className = 'vpip-name';
      name.textContent = '小窗';
      const spacer = document.createElement('div');
      spacer.className = 'vpip-spacer';
      const back = mk('↩', '回到原位（取消小窗）', function () {
        self.undock('user');
      });
      const pin = mk('📌', '固定：滚回原位也不自动取消', function () {
        self.manual = !self.manual;
        self.syncChrome();
      });
      const close = mk('✕', '关闭小窗', function () {
        self.close();
      });
      bar.appendChild(name);
      bar.appendChild(back);
      bar.appendChild(pin);
      // ⧉ 点击本身就是那次"真实点击"，任何时候都可以手动把视频送进系统画中画
      const pip = mk('⧉', '进入系统画中画（点击即触发）', function () {
        self.enterSystemPiP();
      });
      bar.appendChild(pip);
      bar.appendChild(spacer);
      bar.appendChild(close);
      bar.addEventListener('pointerdown', function (e) {
        self.startDrag(e);
      });
      this.bar = bar;
      this.barBtns = { back: back, pin: pin, pip: pip, close: close };

      const grip = document.createElement('div');
      grip.className = 'vpip-grip';
      grip.title = '拖动改变大小';
      grip.addEventListener('pointerdown', function (e) {
        self.startResize(e);
      });
      this.grip = grip;

      document.body.appendChild(bar);
      document.body.appendChild(grip);
      this.barHeight = bar.offsetHeight || 26;
    }

    syncChrome() {
      if (!this.docked || !this.bar || !this.grip || !this.dockBox) return;
      const b = this.dockBox;
      const barH = this.barHeight || 26;
      const above = b.y >= barH + 4;
      let barY = above ? b.y - barH - 2 : b.y + b.h + 2;
      barY = Math.max(2, Math.min(barY, window.innerHeight - barH - 2));
      const barX = Math.max(2, Math.min(b.x, window.innerWidth - b.w - 2));
      this.bar.style.left = barX + 'px';
      this.bar.style.top = barY + 'px';
      this.bar.style.width = b.w + 'px';
      this.grip.style.left = b.x + b.w - 14 + 'px';
      this.grip.style.top = b.y + b.h - 14 + 'px';
      if (this.barBtns) {
        this.barBtns.pin.classList.toggle('vpip-on', !!this.manual);
        if (this.barBtns.pip) this.barBtns.pip.style.display = document.pictureInPictureEnabled ? '' : 'none';
      }
    }

    // 很多播放器把进度条几何（宽度、左边距）缓存在自己的字段里，并且只在窗口 resize 时
    // 重新测量。我们只用 transform 缩放，站点收不到任何通知，缓存就还是缩放前的尺寸 →
    // 拖进度条时"视觉位置"与"缓存宽度"对不上，落点算错。这里补一次 resize 通知。
    nudgeSiteResize() {
      const self = this;
      const fire = function () {
        try {
          window.dispatchEvent(new Event('resize'));
        } catch (e) {}
      };
      fire();
      setTimeout(function () {
        if (!self.stopped) fire();
      }, 300);
    }

    startDrag(e) {
      if (e.button !== 0) return;
      if (e.target && e.target.closest && e.target.closest('.vpip-btn')) return;
      e.preventDefault();
      const box = this.dockBox;
      if (!box) return;
      const x0 = box.x;
      const y0 = box.y;
      const sx = e.clientX;
      const sy = e.clientY;
      const self = this;
      const move = function (ev) {
        const maxX = Math.max(0, window.innerWidth - box.w);
        const maxY = Math.max(0, window.innerHeight - box.h);
        box.x = Math.min(maxX, Math.max(0, x0 + ev.clientX - sx));
        box.y = Math.min(maxY, Math.max(0, y0 + ev.clientY - sy));
        CONFIG.dock.xr = maxX ? box.x / maxX : 0;
        CONFIG.dock.yr = maxY ? box.y / maxY : 0;
        if (self.dockEl) self.applyDockStyles(self.dockEl, box);
        self.syncChrome();
      };
      const up = function () {
        window.removeEventListener('pointermove', move, true);
        window.removeEventListener('pointerup', up, true);
        window.removeEventListener('pointercancel', up, true);
        saveRaw(CONFIG);
      };
      window.addEventListener('pointermove', move, true);
      window.addEventListener('pointerup', up, true);
      window.addEventListener('pointercancel', up, true);
    }

    startResize(e) {
      if (e.button !== 0) return;
      e.preventDefault();
      const box = this.dockBox;
      if (!box) return;
      const w0 = box.w;
      const h0 = box.h;
      const sx = e.clientX;
      const sy = e.clientY;
      const ratio = w0 / Math.max(1, h0);
      const self = this;
      const move = function (ev) {
        const maxW = Math.max(160, Math.round(window.innerWidth * 0.95));
        const w = Math.min(maxW, Math.max(160, w0 + (ev.clientX - sx)));
        const h = CONFIG.lockAspect ? w / ratio : Math.max(90, h0 + (ev.clientY - sy));
        box.w = w;
        box.h = h;
        CONFIG.dock.w = w;
        if (self.dockEl) self.applyDockStyles(self.dockEl, box);
        self.syncChrome();
      };
      const up = function () {
        window.removeEventListener('pointermove', move, true);
        window.removeEventListener('pointerup', up, true);
        window.removeEventListener('pointercancel', up, true);
        // 缩放后可能超出视口，重新摆放一次
        const maxX = Math.max(0, window.innerWidth - box.w);
        const maxY = Math.max(0, window.innerHeight - box.h);
        box.x = Math.min(maxX, Math.max(0, box.x));
        box.y = Math.min(maxY, Math.max(0, box.y));
        CONFIG.dock.xr = maxX ? box.x / maxX : 0;
        CONFIG.dock.yr = maxY ? box.y / maxY : 0;
        if (self.dockEl) self.applyDockStyles(self.dockEl, box);
        self.syncChrome();
        saveRaw(CONFIG);
      };
      window.addEventListener('pointermove', move, true);
      window.addEventListener('pointerup', up, true);
      window.addEventListener('pointercancel', up, true);
    }

    close() {
      const v = this.video;
      this.undock('user-close');
      if (CONFIG.closeAction === 'pause' && v && !v.paused) {
        try {
          v.pause();
        } catch (e) {}
      }
    }

    /* ---- 事件 ---- */

    onFullscreen() {
      if (document.fullscreenElement && this.docked) this.undock('fullscreen');
    }

    onKey(e) {
      if (e.altKey && e.shiftKey && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault();
        openPanel();
      }
    }
  }

  /* ================= 7. 设置面板 ================= */

  function openPanel() {
    injectStyle();
    const old = document.getElementById('vpip-panel');
    if (old) {
      old.remove();
      return;
    }
    const panel = document.createElement('div');
    panel.id = 'vpip-panel';
    panel.className = 'vpip-panel';

    const title = document.createElement('h3');
    const titleText = document.createElement('span');
    titleText.textContent = '视频小窗设置';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'vpip-close';
    closeBtn.type = 'button';
    closeBtn.textContent = '✕';
    closeBtn.title = '关闭面板';
    closeBtn.addEventListener('click', function () {
      panel.remove();
    });
    title.appendChild(titleText);
    title.appendChild(closeBtn);
    panel.appendChild(title);

    function row(labelText, input) {
      const r = document.createElement('div');
      r.className = 'vpip-row';
      const l = document.createElement('label');
      l.textContent = labelText;
      r.appendChild(l);
      r.appendChild(input);
      panel.appendChild(r);
      return input;
    }
    function hint(text) {
      const d = document.createElement('div');
      d.className = 'vpip-hint';
      d.textContent = text;
      panel.appendChild(d);
    }
    function checkbox() {
      const c = document.createElement('input');
      c.type = 'checkbox';
      c.style.flex = '0 0 auto';
      return c;
    }
    function select(options) {
      const s = document.createElement('select');
      options.forEach(function (o) {
        const op = document.createElement('option');
        op.value = o[0];
        op.textContent = o[1];
        s.appendChild(op);
      });
      return s;
    }
    function textarea(rows) {
      const t = document.createElement('textarea');
      t.rows = rows || 4;
      return t;
    }

    // ① 播放方式（置顶）
    const mode = row(
      '播放方式',
      select([
        ['mini', '站内小窗（默认）'],
        ['pip', '系统画中画（浏览器悬浮窗）'],
      ])
    );
    mode.value = CONFIG.mode === 'pip' ? 'pip' : 'mini';
    hint(
      '画中画模式：划出视口只会进系统画中画，触发不了就什么都不做（不会退回小窗）。' +
        '进入画中画需要一次真实点击 —— 页面上任意位置点一下即可（浏览器给约 5 秒窗口），然后划出视口；工具条 ⧉ 也能随时手动进。' +
        '从画中画返回后（包括点系统悬浮窗上的"返回标签页"按钮），要先把视频滚回视野，再划走才会再次自动触发。'
    );

    // ② 画中画的两个独立开关（两种模式都可用）
    const pipOnTabSwitch = row('切标签时自动进画中画', checkbox());
    pipOnTabSwitch.checked = CONFIG.pipOnTabSwitch !== false;
    hint('独立开关，两种模式都生效：切到别的标签页时由浏览器自动弹画中画（需一次性授权：地址栏站点信息里的"自动画中画"，或首次弹窗选允许）。');

    const pipExitOnVisible = row('滚回视野时自动收起画中画', checkbox());
    pipExitOnVisible.checked = CONFIG.pipExitOnVisible !== false;
    hint('只对"划出视口后进入"的画中画生效；切窗口自动弹出的那种不会自动收（否则一弹出就会被关掉）。');

    // ② 给别的站点启用
    const ruleActions = document.createElement('div');
    ruleActions.className = 'vpip-actions';
    [['复制整站规则', 0], ['复制本页路径规则（推荐）', 2]].forEach(function (pair) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'vpip-ghost';
      b.textContent = pair[0];
      b.addEventListener('click', function () {
        copyRuleToast(pair[1]);
      });
      ruleActions.appendChild(b);
    });
    panel.appendChild(ruleActions);
    hint('加站点：复制规则 → 油猴图标 / 本脚本 / 设置 / 包含-排除 / 用户包含 / 添加… → 刷新页面。脚本改不了自己的 @match。');

    // ③ 小窗相关
    const closeAction = row(
      '小窗 ✕ 的行为',
      select([
        ['pause', '还原并暂停视频'],
        ['undock', '仅还原，继续播放'],
      ])
    );
    closeAction.value = CONFIG.closeAction;

    const lockAspect = row('缩放锁定比例', checkbox());
    lockAspect.checked = !!CONFIG.lockAspect;

    const undockOnPause = row('暂停时自动收起', checkbox());
    undockOnPause.checked = !!CONFIG.undockOnPause;

    const reparent = row('必要时搬到顶层宿主', checkbox());
    reparent.checked = !!CONFIG.reparent;

    const geometryShim = row('几何补偿', checkbox());
    geometryShim.checked = CONFIG.geometryShim !== false;
    hint('小窗内元素读到的 offsetWidth 换算成视觉尺寸，修"用布局尺寸算进度条落点"的播放器（如米游社）。某站点出异常就关掉。');

    // ④ 适配器
    const adapters = row('站点适配器 (JSON)', textarea(5));
    adapters.value = JSON.stringify(CONFIG.adapters || {}, null, 2);
    hint('按 host 配置：videoSelector / containerSelector / nativeMiniPlayer（站点自带小窗，让位）/ disabled。');

    const actions = document.createElement('div');
    actions.className = 'vpip-actions';

    function button(text, ghost, fn) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      if (ghost) b.className = 'vpip-ghost';
      b.addEventListener('click', fn);
      actions.appendChild(b);
      return b;
    }

    button('保存', false, function () {
      let parsedAdapters = null;
      try {
        parsedAdapters = JSON.parse(adapters.value || '{}');
      } catch (e) {
        toast('适配器 JSON 解析失败，未保存：' + e.message);
        return;
      }
      if (!parsedAdapters || typeof parsedAdapters !== 'object') parsedAdapters = {};
      CONFIG.mode = mode.value === 'pip' ? 'pip' : 'mini';
      CONFIG.pipOnTabSwitch = pipOnTabSwitch.checked;
      CONFIG.pipExitOnVisible = pipExitOnVisible.checked;
      CONFIG.closeAction = closeAction.value;
      CONFIG.lockAspect = lockAspect.checked;
      CONFIG.undockOnPause = undockOnPause.checked;
      CONFIG.reparent = reparent.checked;
      CONFIG.geometryShim = geometryShim.checked;
      CONFIG.adapters = parsedAdapters;
      saveRaw(CONFIG);
      toast('已保存，刷新页面后生效');
      // 画中画相关开关允许当场生效：注册/注销 Media Session 处理器 + 同步工具条按钮
      if (controller) {
        if (CONFIG.pipOnTabSwitch) controller.setupPiP();
        else controller.teardownPiP();
        if (controller.docked) controller.syncChrome();
      }
    });

    button('恢复默认', true, function () {
      CONFIG = mergeConfig(null);
      CONFIG.dock.xr = null;
      CONFIG.dock.yr = null;
      saveRaw(CONFIG);
      panel.remove();
      toast('已恢复默认配置（位置记忆也一并清除），刷新后生效');
    });

    panel.appendChild(actions);
    document.body.appendChild(panel);
  }

  /* ================= 8. 菜单与启动 ================= */

  let controller = null;

  function registerMenu() {
    if (typeof GM_registerMenuCommand !== 'function') return;
    GM_registerMenuCommand('⚙ 视频小窗设置面板', function () {
      openPanel();
    });
    GM_registerMenuCommand('📋 复制包含规则（本页路径，推荐）', function () {
      copyRuleToast(2);
    });
    GM_registerMenuCommand('📋 复制包含规则（整站）', function () {
      copyRuleToast(0);
    });
    GM_registerMenuCommand('＋ 给别的站点启用（说明）', function () {
      toast('在油猴图标 → 本脚本 → 设置页的「包含/排除」里，用"用户包含"添加规则；用菜单里的「📋 复制包含规则」可直接拿到现成规则');
    });
    GM_registerMenuCommand('⧉ 进入系统画中画', function () {
      if (!controller) {
        toast('没有找到可接管的视频');
        return;
      }
      controller.enterSystemPiP();
    });
    GM_registerMenuCommand('⤢ 手动变成站内小窗 / 还原', function () {
      if (!controller) {
        toast('没有找到可接管的视频');
        return;
      }
      if (controller.docked) controller.undock('user');
      else {
        controller.scan();
        if (!controller.video) {
          toast('没有找到可接管的视频');
          return;
        }
        controller.awaitingVisible = false; // 手动叫出来时不受"要先滚回视野"的限制
        controller.dock();
        controller.manual = true; // 手动叫出来的小窗默认固定住
        controller.syncChrome();
      }
    });
  }

  function boot() {
    registerMenu();
    exposeDebug();
    injectStyle();
    controller = new MiniController();
    controller.start();
    // 1.5s 心跳：SPA 换页、视频元素晚出现、工具条被清掉，都靠它兜住
    setInterval(supervise, 1500);
  }

  function supervise() {
    if (!controller) return;
    if (controller.stopped) return;
    if (controller.host !== location.host) {
      // SPA 跳到了别的域名（同一个标签页内换站）：重建控制器
      controller.stop();
      controller = new MiniController();
      controller.start();
      return;
    }
    controller.tick();
  }

  function exposeDebug() {
    try {
      // 控制台里可用来排查：__vpipDebug.config() / __vpipDebug.panel() / __vpipDebug.tick()
      window.__vpipDebug = {
        config: function () {
          return CONFIG;
        },
        controller: function () {
          return controller;
        },
        panel: openPanel,
        tick: function () {
          supervise();
        },
      };
    } catch (e) {}
  }

  boot();
})();



