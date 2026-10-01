// 冒烟测试：用最小 DOM 桩跑一遍脚本的启动、停靠/还原、几何补偿、防跳、闩锁、画中画、面板、菜单流程。
// 用法： node test/smoke-test.cjs   （或 npm test）
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
// 脚本文件名不写死：仓库根目录下唯一的 *.user.js 就是它（改名后无需改这里）
const SCRIPT_NAME = fs.readdirSync(ROOT).find((f) => f.endsWith('.user.js'));
if (!SCRIPT_NAME) {
  console.error('在 ' + ROOT + ' 里没找到 *.user.js');
  process.exit(1);
}
const FILE = path.join(ROOT, SCRIPT_NAME);
const code = fs.readFileSync(FILE, 'utf8');

const failures = [];
function check(name, cond) {
  if (!cond) failures.push(name);
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const created = [];

// 让桩元素走"原型链 + getter"，几何补偿（挂在 HTMLElement/Element.prototype 上）才有东西可挂，
// 也能验证补偿不会泄露到小窗容器之外。
const elementProto = {};
const htmlProto = Object.create(elementProto);
Object.defineProperty(elementProto, 'clientWidth', { configurable: true, get() { return this._cw || 0; } });
Object.defineProperty(elementProto, 'clientHeight', { configurable: true, get() { return this._ch || 0; } });
Object.defineProperty(htmlProto, 'offsetWidth', { configurable: true, get() { return this._ow || 0; } });
Object.defineProperty(htmlProto, 'offsetHeight', { configurable: true, get() { return this._oh || 0; } });
const FakeElement = function () {};
FakeElement.prototype = elementProto;
const FakeHTMLElement = function () {};
FakeHTMLElement.prototype = htmlProto;

function el(tag, rect) {
  const e = Object.create(htmlProto);
  Object.assign(e, {
    tagName: String(tag || 'div').toUpperCase(),
    nodeType: 1,
    _ow: 0,
    _oh: 26,
    _rect: rect || { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 },
    attrs: {},
    _h: {},
    children: [],
    isConnected: true,
    textContent: '',
    style: { setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; } },
    classList: (function () {
      const set = new Set();
      return {
        add: function () {
          for (let i = 0; i < arguments.length; i++) set.add(arguments[i]);
        },
        remove: function () {
          for (let i = 0; i < arguments.length; i++) set.delete(arguments[i]);
        },
        toggle: function (c, f) {
          if (f === undefined) {
            if (set.has(c)) {
              set.delete(c);
              return false;
            }
            set.add(c);
            return true;
          }
          if (f) set.add(c);
          else set.delete(c);
          return !!f;
        },
        contains: function (c) {
          return set.has(c);
        },
      };
    })(),
    parentElement: null,
    parentNode: null,
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    removeAttribute(k) { delete this.attrs[k]; },
    appendChild(c) { this.children.push(c); c.parentNode = this; c.parentElement = this; c.isConnected = true; return c; },
    insertBefore(c) { this.children.push(c); c.parentNode = this; c.parentElement = this; c.isConnected = true; return c; },
    replaceChild(n) { this.children.push(n); n.parentNode = this; n.parentElement = this; n.isConnected = true; return n; },
    remove() {
      this.isConnected = false;
      const p = this.parentNode;
      if (p) {
        const i = p.children.indexOf(this);
        if (i >= 0) p.children.splice(i, 1);
      }
    },
    querySelector() { return null; },
    querySelectorAll(sel) { return sel === 'video' ? this._videos || [] : []; },
    addEventListener(t, fn) { (this._h[t] = this._h[t] || []).push(fn); },
    removeEventListener(t, fn) {
      const a = this._h[t] || [];
      const i = a.indexOf(fn);
      if (i >= 0) a.splice(i, 1);
    },
    closest() { return null; },
    contains(n) {
      if (!n) return false;
      if (n === this) return true;
      return this.children.some((c) => c.contains && c.contains(n));
    },
    getBoundingClientRect() { return this._rect; },
    fire(t, ev) { (this._h[t] || []).slice().forEach((fn) => fn(ev || {})); },
  });
  created.push(e);
  Object.defineProperty(e, 'nextElementSibling', {
    get() {
      const p = this.parentNode;
      if (!p) return null;
      const i = p.children.indexOf(this);
      return i >= 0 ? p.children[i + 1] || null : null;
    },
  });
  return e;
}

// 复刻米游社文章页的真实结构（取自实测 DOM）：
//   article 640x836（播放器 + 标题 + 正文）
//     └ content 640x563   ← 期望被选中的播放器容器
//         └ player 640x563（内含站点自带控制条）
//             └ videoWrap 640x563
//                 └ video 640x563
const VIS = { left: 100, top: 200, right: 740, bottom: 763, width: 640, height: 563 };
const ARTICLE_VIS = { left: 100, top: 200, right: 740, bottom: 1036, width: 640, height: 836 };

const body = el('body');
const head = el('head');
const html = el('html');

const video = el('video', Object.assign({}, VIS));
Object.assign(video, { readyState: 4, ended: false, duration: 100, currentTime: 5, paused: false, videoWidth: 1280, videoHeight: 720 });
video._ow = 640;
video._oh = 563;
// 记录画中画请求；请求成功与否由 pipShouldFail 控制（模拟没有瞬时激活被拒）
const pipCalls = [];
let pipShouldFail = false;
video.requestPictureInPicture = function () {
  pipCalls.push(Date.now());
  return pipShouldFail ? Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })) : Promise.resolve();
};
const videoWrap = el('div', Object.assign({}, VIS));
const player = el('div', Object.assign({}, VIS));
player.textContent = '00:38/03:32 倍速 1080P';
const wrapper = el('div', Object.assign({}, VIS));
wrapper._videos = [video];
// transform 不影响 layout 尺寸，所以这两个值应当始终是"未缩放"的原尺寸
wrapper._ow = 640;
wrapper._oh = 563;
const article = el('div', Object.assign({}, ARTICLE_VIS));
article.textContent = '《原神》六周年主题曲《风的来信》09-28 · 2668评论 · 原神 - 官方 | 官方视频 旅途有你，就是意义。音乐出品：HOYO-MiX';

// 播放器下方的参照元素：模拟"停靠瞬间文档高度变小 300px"（占位没兜住/被站点重渲染掉）
const probe = el('div', { left: 100, top: 1100, right: 740, bottom: 1400, width: 640, height: 300 });
probe._ow = 640;
probe.getBoundingClientRect = function () {
  const collapsed = wrapper.style.position === 'fixed' ? 300 : 0;
  return { left: 100, top: 1100 - collapsed, right: 740, bottom: 1400 - collapsed, width: 640, height: 300 };
};

videoWrap.appendChild(video);
player.appendChild(videoWrap);
wrapper.appendChild(player);
article.appendChild(wrapper);
body.appendChild(article);
body.appendChild(probe);

function setRects(videoRect, articleRect) {
  [video, videoWrap, player, wrapper].forEach((e) => {
    e._rect = Object.assign({}, videoRect);
  });
  article._rect = Object.assign({}, articleRect);
}

const document = {
  body: body,
  head: head,
  documentElement: html,
  fullscreenElement: null,
  _h: {},
  addEventListener(t, fn) {
    (this._h[t] = this._h[t] || []).push(fn);
  },
  removeEventListener(t, fn) {
    const a = this._h[t] || [];
    const i = a.indexOf(fn);
    if (i >= 0) a.splice(i, 1);
  },
  fire(t, ev) {
    (this._h[t] || []).slice().forEach((fn) => fn(ev || {}));
  },
  createElement: (t) => el(t),
  createComment: (t) => ({ nodeType: 8, textContent: t, parentNode: null, isConnected: false, remove() {} }),
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: (s) => (s === 'video' ? [video] : []),
};

const win = {
  innerWidth: 1280,
  innerHeight: 800,
  scrollX: 0,
  scrollY: 500,
  scrolls: [],
  events: [],
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent(e) {
    win.events.push(e && e.type);
    return true;
  },
  scrollTo(x, y) {
    win.scrollX = x;
    win.scrollY = y;
    win.scrolls.push(y);
  },
};
win.top = win;
win.self = win;

const store = new Map();
const menus = [];
const intervals = [];

// 预置一份"老版本"配置：白名单为空、靠 usePreset 生效。用于验证升级迁移不会变成"一个站点都没有"。
store.set('vpip_config_v1', {
  version: 1,
  enabled: true,
  usePreset: true,
  whitelist: [],
  denylist: [],
  dock: { xr: 1, yr: 1, w: 360 },
  thresholds: { enter: 0.25, exit: 0.6, delay: 350, cooldown: 1200 },
  adapters: {},
});

const fakeMediaSession = {
  handlers: {},
  setActionHandler(action, fn) {
    this.handlers[action] = fn;
  },
};

const clipboard = [];
const sandbox = {
  window: win,
  document: document,
  location: { href: 'https://www.miyoushe.com/ys/article/78469922', protocol: 'https:', host: 'www.miyoushe.com', pathname: '/ys/article/78469922' },
  navigator: {
    mediaSession: fakeMediaSession,
    userActivation: { isActive: false, hasBeenActive: true },
  },
  GM_setClipboard: (t) => clipboard.push(t),
  GM_getValue: (k, d) => (store.has(k) ? store.get(k) : d),
  GM_setValue: (k, v) => store.set(k, v),
  GM_registerMenuCommand: (name, fn) => menus.push({ name: name, fn: fn }),
  IntersectionObserver: class {
    constructor(cb) { this.cb = cb; }
    observe() {}
    disconnect() {}
    unobserve() {}
  },
  MutationObserver: class {
    constructor(cb) { this.cb = cb; }
    observe() {}
    disconnect() {}
  },
  getComputedStyle: () => ({
    transform: 'none',
    filter: 'none',
    perspective: 'none',
    backdropFilter: 'none',
    contain: '',
    willChange: '',
    display: 'block',
    margin: '0px',
    flex: '0 1 auto',
    alignSelf: 'auto',
  }),
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  setInterval: (fn, ms) => { intervals.push(fn); return intervals.length; },
  clearInterval() {},
  console: console,
  URL: URL,
  Event: Event,
  Element: FakeElement,
  HTMLElement: FakeHTMLElement,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

(async function () {
  const dbg = win.__vpipDebug;
  let copyRuleMenu = [];
  check('脚本启动并暴露调试入口', !!dbg);
  if (!dbg) return report();

  check('配置里不再有白名单字段（范围交给油猴元数据）', !('whitelist' in dbg.config()) && !('usePresetSites' in dbg.config()));
  const matches = (fs.readFileSync(FILE, 'utf8').match(/^\/\/ @match\s+\S+$/gm) || []).map((l) => l.replace(/^\/\/ @match\s+/, ''));
  check('@match 精确到四个米游社板块 + taptap 动态', matches.length === 5);
  ['https://www.miyoushe.com/ys/article*', 'https://www.miyoushe.com/sr/article*', 'https://www.miyoushe.com/bh3/article*', 'https://www.miyoushe.com/zzz/article*', 'https://www.taptap.cn/moment*'].forEach((m) => {
    check('@match 含 ' + m, matches.indexOf(m) >= 0);
  });
  check('不再有整站宽泛匹配', matches.indexOf('https://www.miyoushe.com/*') < 0 && matches.indexOf('https://www.taptap.cn/*') < 0);
  // 加站点辅助：规则建议 + 复制到剪贴板
  copyRuleMenu = menus.filter((m) => m.name.indexOf('复制包含规则') >= 0);
  check('菜单里有两条复制规则项', copyRuleMenu.length === 2);
  copyRuleMenu.forEach((m) => m.fn());
  check('整站规则格式正确', clipboard.indexOf('https://www.miyoushe.com/*') >= 0);
  check('本页路径规则格式正确（前两段路径）', clipboard.indexOf('https://www.miyoushe.com/ys/article*') >= 0);
  check('第二部分默认关闭（播放方式 = 站内小窗）', dbg.config().mode === 'mini');
  check('"切标签自动进画中画"默认关闭', dbg.config().pipOnTabSwitch === false);
  check('默认不注册 Media Session 处理器', typeof fakeMediaSession.handlers.enterpictureinpicture !== 'function');

  const c = dbg.controller();
  check('已建立控制器（元数据命中即运行）', !!c);
  check('启动时未停靠', c && c.docked === false);
  check('启动时已记录"看得见"的状态', c && c.maxSeen === 1);

  // 划出视口（整块播放器连同外面那层正文容器一起滚出屏幕）
  const off = { left: 100, top: -613, right: 740, bottom: -50, width: 640, height: 563 };
  const offArticle = { left: 100, top: -613, right: 740, bottom: 223, width: 640, height: 836 };
  setRects(off, offArticle);
  c.scan();
  check('刚划出时还没停靠（有延迟去抖）', c.docked === false);
  await sleep(500);
  check('延迟后自动停靠', c.docked === true);
  check('停靠目标是播放器容器而不是"播放器+标题正文"', c.dockEl === wrapper);
  check('原位置插入了占位元素', !!c.sentinel && article.children.indexOf(c.sentinel) >= 0);
  check('占位元素尺寸等于播放器容器', c.sentinel && c.sentinel.attrs.style.indexOf('width:640px') >= 0);
  check('占位元素复刻了原容器的 display', c.sentinel && c.sentinel.attrs.style.indexOf('display:block') >= 0);
  check('已应用 fixed 停靠样式', wrapper.style.position === 'fixed');
  check('默认小窗宽 360', c.dockBox.w === 360);
  check('小窗高度按容器比例换算', Math.abs(c.dockBox.h - (360 * 563) / 640) < 0.01);
  check('整体等比缩放（内部组件一起变小）', wrapper.style.transform === 'scale(' + 360 / 640 + ',' + 360 / 640 + ')');
  check('容器原始尺寸保持不变（不改宽高）', wrapper.style.width === '640px' && wrapper.style.height === '563px');
  check('变换原点在左上角', wrapper.style['transform-origin'] === '0 0');
  check('圆角按缩放比例补偿', wrapper.style['border-radius'] === Math.round(8 / (360 / 640)) + 'px');
  check('默认停在右下角', c.dockBox.x === 1280 - 360 && Math.abs(c.dockBox.y - (800 - c.dockBox.h)) <= 1);
  check('工具条已创建', !!c.bar && !!c.grip);
  check('工具条保留 ⧉ 手动入口（任意模式下可用）', !!c.barBtns.pip);  check('默认整体等比缩放', wrapper.style.transform.indexOf('scale(') === 0);
  // 参照元素在停靠后上移了 300px → 应把滚动位置补回 300（500 → 200）
  check('停靠引起的整页位移被补偿（滚动补回）', win.scrollY === 200 && win.scrolls.length >= 1);
  const barRef = c.bar;

  // 站点覆盖样式后靠心跳压回去
  wrapper.style.position = 'static';
  c.tick();
  check('心跳把被覆盖的样式压回去', wrapper.style.position === 'fixed');

  // 停靠后应主动补一次 resize 通知，让站点播放器重新测量进度条几何
  check('停靠后补发了 window resize 通知', win.events.filter((t) => t === 'resize').length >= 1);

  // 播放器随状态改自己的高度（暂停 563 → 播放 360）时，缩放比例要重算
  wrapper._oh = 360;
  c.tick();
  check('检测到播放器高度变化并重算原始尺寸', c.natural.h === 360);
  check('小窗视觉高度按新比例重算', Math.abs(c.dockBox.h - (360 * 360) / 640) < 0.01);
  check('占位元素高度跟着同步', c.sentinel.style.height === '360px');
  check('缩放比例仍是等比', wrapper.style.transform === 'scale(' + 360 / 640 + ',' + 360 / 640 + ')');

  // 开关调试面板会让视口变小：小窗本体必须跟着收进可视区，不能只动工具条
  win.innerWidth = 900;
  win.innerHeight = 600;
  c.onViewportChange();
  check('视口变小后小窗仍在可视区内', c.dockBox.x + c.dockBox.w <= 900 && c.dockBox.y + c.dockBox.h <= 600);
  check('小窗实际位置与工具条一致', wrapper.style.left === c.dockBox.x + 'px' && wrapper.style.top === c.dockBox.y + 'px');
  win.innerWidth = 1280;
  win.innerHeight = 800;
  c.onViewportChange();

  // 拖动后位置被记住
  const fakeEv = (x, y, target) => ({
    button: 0,
    clientX: x,
    clientY: y,
    target: target,
    preventDefault() {},
    stopPropagation() {},
  });
  c.bar.fire('pointerdown', fakeEv(900, 700, c.bar));
  check('工具条可拖动（pointerdown 不报错）', true);

  // 滚回原位 —— 占位元素重新进入视野
  c.sentinel._rect = Object.assign({}, VIS);
  c.refreshRatio();
  c.evaluate();
  check('滚回原位后自动还原', c.docked === false);
  check('占位元素已移除', !c.sentinel);
  check('播放器样式已还原', wrapper.getAttribute('style') === null);
  check('工具条已移除', !body.children.includes(barRef));

  // 冷却期内不重复停靠
  setRects(off, offArticle);
  c.scan();
  await sleep(450);
  check('刚还原后有冷却，不会立刻再次停靠', c.docked === false);

  // 设置面板
  dbg.panel();
  const panel = created.filter((e) => e.className === 'vpip-panel').pop();
  check('设置面板已构建', !!panel);
  const saveBtn = created.filter((e) => e.textContent === '保存').pop();
  check('面板里有保存按钮', !!saveBtn);
  saveBtn.fire('click', {});
  check('保存写入 GM 存储', store.has('vpip_config_v1'));
  const saved = store.get('vpip_config_v1');
  check('保存的内容是配置对象', saved && saved.geometryShim === true && saved.mode === 'mini');
  check('旧版本遗留的无效键已被清掉', !('enabled' in saved) && !('pipEnabled' in saved) && !('scaleMode' in saved) && !('whitelist' in saved));

  // 播放方式切到系统画中画 → 工具条出现 ⧉ 按钮
  dbg.config().mode = 'pip';
  c.dock();
  c.syncChrome();
  check('工具条上有 ⧉ 手动入口', !!c.barBtns && !!c.barBtns.pip);
  c.undock('user');
  c.awaitingVisible = false;
  c.enterSystemPiP(); // 桩里没有 pictureInPictureEnabled → 只提示、不抛错
  check('手动进入画中画在不支持时给提示且不抛错', true);

  // 打开"切标签自动进画中画"这个独立开关 → 注册 Media Session 处理器
  dbg.config().pipOnTabSwitch = true;
  c.setupPiP();
  check('开启"切标签自动进画中画"后注册了处理器', typeof fakeMediaSession.handlers.enterpictureinpicture === 'function');
  check('处理器在没有视频时能安全返回', (() => {
    try {
      fakeMediaSession.handlers.enterpictureinpicture();
      return true;
    } catch (e) {
      return false;
    }
  })());

  // ——— 触发链路：点击获得瞬时激活 → 划出视口才进画中画 ———
  document.pictureInPictureEnabled = true;
  video.paused = false;
  pipShouldFail = false;
  // 情形 A：画中画模式下划出视口且有瞬时激活 → 直接进画中画
  setRects(off, offArticle);
  c.refreshRatio();
  sandbox.navigator.userActivation.isActive = true;
  const before = pipCalls.length;
  c.evaluate();
  await sleep(500);
  check('有瞬时激活时划出视口直接进系统画中画', pipCalls.length > before);
  check('画中画模式下不生成站内小窗', c.docked === false);

  // 情形 B：没有激活就划出去 → 什么都不做（不做兜底，也没有小窗）
  c.awaitingVisible = false;
  c.lastPipAttempt = 0;
  c.pipBlockedUntil = 0;
  sandbox.navigator.userActivation.isActive = false;
  const beforeNoActivation = pipCalls.length;
  setRects(off, offArticle);
  c.refreshRatio();
  c.evaluate();
  await sleep(500);
  check('没有瞬时激活时不会进画中画', pipCalls.length === beforeNoActivation);
  check('画中画模式不做小窗兜底', c.docked === false);

  // 情形 C：已经滚出视口之后才点击 → 不再补触发（避免劫持页面上的普通点击）
  const beforeLateClick = pipCalls.length;
  await sleep(700); // 等节流
  document.fire('click', {});
  check('已滚出视口后单纯点击页面不会触发画中画', pipCalls.length === beforeLateClick);

  // 情形 D：视频在视野里时点击也不触发
  setRects(VIS, ARTICLE_VIS);
  c.refreshRatio();
  const beforeVisibleClick = pipCalls.length;
  await sleep(700);
  document.fire('click', {});
  check('视频在视野里时点击不触发画中画', pipCalls.length === beforeVisibleClick);

  // 情形 E：被浏览器拒绝 → 依然不退回小窗
  pipShouldFail = true;
  sandbox.navigator.userActivation.isActive = true;
  c.awaitingVisible = false;
  c.lastPipAttempt = 0;
  c.pipBlockedUntil = 0;
  setRects(off, offArticle);
  c.refreshRatio();
  c.evaluate();
  await sleep(500);
  check('自动尝试被拒后也不退回站内小窗', c.docked === false);
  pipShouldFail = false;

  // 情形 F：小窗模式下划出视口仍然出小窗（画中画只由手动 ⧉ / 切标签触发）
  dbg.config().mode = 'mini';
  sandbox.navigator.userActivation.isActive = true;
  c.awaitingVisible = false;
  c.dock();
  check('小窗模式下有激活也照样出站内小窗', c.docked === true);
  c.undock('user');
  c.awaitingVisible = false;

  // 情形 G：画中画入口与模式无关 —— 手动 ⧉ 在小窗模式下也能进画中画
  const beforeManual = pipCalls.length;
  await sleep(700);
  c.enterSystemPiP();
  check('小窗模式下手动 ⧉ 也能进画中画', pipCalls.length > beforeManual);
  dbg.config().mode = 'pip';

  // ——— 画中画的自动收起：只对"划出视口后进入"的那种生效 ———
  let exitCalls = 0;
  document.exitPictureInPicture = () => {
    exitCalls++;
    document.pictureInPictureElement = null;
    return Promise.resolve();
  };
  sandbox.navigator.userActivation.isActive = false;

  // G1：开始时视频可见（切标签自动弹 / 手动 ⧉）→ 不能自动收起
  setRects(VIS, ARTICLE_VIS);
  c.refreshRatio();
  video.fire('enterpictureinpicture', {});
  document.pictureInPictureElement = video;
  check('记录到"开始时可见"', c.pipStartedVisible === true);
  c.evaluate();
  check('开始时可见的画中画不会被自动收起（修掉"切窗口后一会自动关闭"）', exitCalls === 0);

  // G2：开始时已划出视口 → 滚回视野自动收起
  video.fire('leavepictureinpicture', {});
  setRects(off, offArticle);
  c.refreshRatio();
  video.fire('enterpictureinpicture', {});
  document.pictureInPictureElement = video;
  check('记录到"开始时已划出视口"', c.pipStartedVisible === false);
  setRects(off, offArticle);
  c.refreshRatio();
  c.evaluate();
  check('视频还在视野外时不误收', exitCalls === 0);
  setRects(VIS, ARTICLE_VIS);
  c.refreshRatio();
  c.evaluate();
  check('滚回视野时自动收起', exitCalls === 1);
  document.pictureInPictureElement = null;
  document.pictureInPictureEnabled = false;

  // 情形 H：切标签开关是独立的 —— 小窗模式下也应注册处理器
  c.teardownPiP();
  dbg.config().mode = 'mini';
  c.setupPiP();
  check('小窗模式下"切标签自动进画中画"同样注册处理器', typeof fakeMediaSession.handlers.enterpictureinpicture === 'function');
  c.teardownPiP();
  check('关闭后注销了处理器', fakeMediaSession.handlers.enterpictureinpicture === null);

  // ——— 从画中画返回（点系统悬浮窗上的"返回标签页"按钮）后，不能立刻又被触发 ———
  dbg.config().mode = 'pip';
  document.pictureInPictureEnabled = true;
  pipShouldFail = false;
  video.paused = false;
  c.awaitingVisible = false;
  c.lastPipAttempt = 0;
  c.pipBlockedUntil = 0;
  sandbox.navigator.userActivation.isActive = true; // 那次点击留下的激活仍然有效
  setRects(off, offArticle);
  c.refreshRatio();
  video.fire('leavepictureinpicture', {}); // 画中画结束（用户点了返回标签页）
  check('画中画结束后进入"等待重新回到视野"状态', c.awaitingVisible === true);
  const beforeReturn = pipCalls.length;
  c.evaluate();
  await sleep(500);
  check('返回标签页后即使有激活也不会立刻再弹画中画', pipCalls.length === beforeReturn && c.docked === false);

  // 滚回视频 → 重新武装
  setRects(VIS, ARTICLE_VIS);
  c.refreshRatio();
  c.evaluate();
  check('视频回到视野后重新武装', c.awaitingVisible === false);
  check('重新武装时不会顺手弹画中画', pipCalls.length === beforeReturn);

  // 再划走（此时仍有激活）→ 才允许再次触发
  c.lastPipAttempt = 0;
  setRects(off, offArticle);
  c.refreshRatio();
  c.evaluate();
  await sleep(500);
  check('重新武装后再划走可以再次进画中画', pipCalls.length > beforeReturn);
  dbg.config().mode = 'mini';
  c.awaitingVisible = false;
  document.pictureInPictureEnabled = false;

  // 菜单命令
  check('注册了菜单命令', menus.length >= 3);
  menus.forEach((m) => {
    try {
      m.fn();
    } catch (e) {
      check('菜单命令可用：' + m.name + ' —— ' + e.message, false);
    }
  });

  // 心跳
  try {
    intervals.forEach((fn) => fn());
    check('心跳回调可执行', true);
  } catch (e) {
    check('心跳回调可执行 —— ' + e.message, false);
  }

  // 几何补偿：小窗内读到"视觉尺寸"，窗口外读到"布局尺寸"，还原后彻底复原
  check('停靠期间容器内读取被换算成视觉尺寸', wrapper.offsetWidth === 360);
  check('停靠期间 video 读取也被换算', video.offsetWidth === 360);
  check('容器外的元素不受影响（补偿不外泄）', probe.offsetWidth === 640);
  // 走真实的用户路径：点工具条上的"回到原位"
  c.barBtns.back.fire('click', { preventDefault() {}, stopPropagation() {} });
  check('还原后 offsetWidth 恢复为布局尺寸', wrapper.offsetWidth === 640);
  check('手动收起后进入"等待重新回到视野"状态', c.awaitingVisible === true);

  // 手动点"回到原位"之后：视频还在视野外，也不能再自动进小窗
  setRects(off, offArticle);
  await sleep(1300); // 等冷却期过去
  c.scan();
  await sleep(500);
  check('手动收起后、视频仍在视野外时不再自动进小窗', c.docked === false);
  check('仍处于"等待重新回到视野"状态', c.awaitingVisible === true);

  // 把视频滚回视野里 → 重新武装
  setRects(VIS, ARTICLE_VIS);
  c.scan();
  check('视频回到视野后重新武装', c.awaitingVisible === false);

  // 再滚出去 → 应该重新进小窗
  setRects(off, offArticle);
  c.scan();
  await sleep(500);
  check('重新武装后再滚出去会再次进小窗', c.docked === true);
  check('自动进小窗（非手动）不会固定在原位', c.manual === false);

  if (c.docked) c.undock('cleanup');
  report();
})();

function report() {
  console.log('\n' + (failures.length ? 'FAILED: ' + failures.length + ' 项 —— ' + failures.join(' | ') : 'ALL PASS'));
  process.exit(failures.length ? 1 : 0);
}



