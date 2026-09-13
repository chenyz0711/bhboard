// ============================================================
// BHBoard 共享主题模块（默认 / 浅色 / 深色）
//
// 设计原则：
// 1. 默认模式（default）不注入任何样式，各页面严格保持原有配色
//    （南外生存蓝、管理与轮盘赌深色等一律不变）。
// 2. 只有当「目标模式」与「该页原本的深浅」不一致时才注入覆盖样式，
//    一致时同样一行都不注入，把影响面降到最小。
// 3. 不修改任何页面原有 CSS，而是读取现有样式表、按亮度反转生成
//    一份覆盖表追加到 head 末尾（同特异性、后者胜出）。
//    原样式表保持不动，因此来回切换主题不会累积误差。
// 4. 半透明颜色（alpha < 0.9，如遮罩、阴影）保持原样，
//    否则照片大图的黑遮罩会变成白遮罩。
//
// 对外接口：window.BHTheme = { get, set, apply, MODES }
// 用法：BHTheme.set('light') 立即生效并写入 localStorage，全站共享。
// ============================================================
(function () {
  const KEY = 'bh_theme';
  const STYLE_ID = 'bh-theme-override';
  const MODES = ['default', 'light', 'dark'];

  // 当前是否需要反转（目标模式与该页原本深浅不一致）
  let shouldInvert = false;
  // 行内 style 的原始颜色备份：反转是有损操作，必须基于原值重算，
  // 否则「默认 → 浅色 → 深色」来回切会累积反转、颜色越切越离谱
  const origInline = new WeakMap();

  // ---------- 存取 ----------
  function get() {
    try {
      const v = localStorage.getItem(KEY);
      return MODES.indexOf(v) >= 0 ? v : 'default';
    } catch (e) { return 'default'; }
  }
  function set(mode) {
    if (MODES.indexOf(mode) < 0) return;
    try { localStorage.setItem(KEY, mode); } catch (e) {}
    apply();
  }

  // ---------- 颜色工具 ----------
  // 匹配 CSS 里的颜色片段：#rgb / #rgba / #rrggbb / #rrggbbaa / rgb() / rgba()
  const COLOR_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|rgba?\([^)]*\)/g;
  // 只处理这些属性，避免动到布局（宽高、间距等）
  const PROP_RE = /(color|background|border|shadow|outline|fill|stroke)/i;

  function parseColor(tok) {
    tok = String(tok).trim();
    let m;
    if ((m = /^#([0-9a-fA-F]{3,8})$/.exec(tok))) {
      let h = m[1];
      if (h.length === 3 || h.length === 4) {
        h = h.split('').map(c => c + c).join('');
      }
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
      if ([r, g, b].some(isNaN)) return null;
      return { r, g, b, a };
    }
    if ((m = /^rgba?\(([^)]*)\)$/.exec(tok))) {
      const parts = m[1].split(/[\s,\/]+/).filter(x => x !== '');
      if (parts.length < 3) return null;
      const num = v => v.endsWith('%') ? Math.round(parseFloat(v) * 2.55) : Math.round(parseFloat(v));
      const r = num(parts[0]), g = num(parts[1]), b = num(parts[2]);
      const a = parts.length >= 4 ? parseFloat(parts[3]) : 1;
      if ([r, g, b].some(isNaN) || isNaN(a)) return null;
      return { r, g, b, a };
    }
    return null;
  }

  function rgb2hsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0, s = 0;
    const d = max - min;
    if (d > 1e-9) {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
      else if (max === g) h = ((b - r) / d + 2);
      else h = ((r - g) / d + 4);
      h /= 6;
    }
    return { h: h * 360, s, l: l * 100 };
  }

  function hsl2rgb(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360; s = Math.max(0, Math.min(1, s)); l = Math.max(0, Math.min(100, l)) / 100;
    if (s < 1e-9) { const v = Math.round(l * 255); return { r: v, g: v, b: v }; }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const conv = t => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return { r: Math.round(conv(h + 1 / 3) * 255), g: Math.round(conv(h) * 255), b: Math.round(conv(h - 1 / 3) * 255) };
  }

  function toCss(c) {
    const hex = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    const dec = v => Math.max(0, Math.min(255, Math.round(v)));
    if (c.a >= 1) return `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`;
    return `rgba(${dec(c.r)}, ${dec(c.g)}, ${dec(c.b)}, ${Math.round(c.a * 1000) / 1000})`;
  }

  // 亮度反转：保留色相与饱和度，只把明度 L 翻到对面，并按中性色 / 彩色分别限幅，
  // 避免纯黑纯白过硬、或强调色反转后暗到看不清
  function invertColor(c) {
    if (c.a < 0.9) return c;              // 遮罩 / 阴影保持原样
    const hsl = rgb2hsl(c.r, c.g, c.b);
    const neutral = hsl.s < 0.12;
    const lo = neutral ? 6 : 20;
    const hi = neutral ? 96 : 80;
    const nl = Math.max(lo, Math.min(hi, 100 - hsl.l));
    const rgb = hsl2rgb(hsl.h, hsl.s, nl);
    return { r: rgb.r, g: rgb.g, b: rgb.b, a: c.a };
  }

  function remapValue(v) {
    return String(v).replace(COLOR_RE, tok => {
      const c = parseColor(tok);
      if (!c) return tok;
      const n = invertColor(c);
      if (n === c) return tok;
      return toCss(n);
    });
  }

  // 相对亮度（0~1），用于判断某页原本是深色还是浅色
  function luminance(c) {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }

  // 取颜色串里的第一个颜色算亮度。
  // 必须用不带 g 标志的正则：COLOR_RE 带 g，exec 会受 lastIndex 残留影响而漏匹配。
  const FIRST_COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/;
  function valueLuminance(v) {
    const m = FIRST_COLOR_RE.exec(String(v));
    if (!m) return null;
    const c = parseColor(m[0]);
    return c ? luminance(c) : null;
  }

  // ---------- 识别本样式表是否是我们注入的 ----------
  function isOwnSheet(ss) {
    const node = ss.ownerNode;
    return !!(node && node.id === STYLE_ID);
  }

  function eachSheet(fn) {
    const sheets = document.styleSheets;
    for (let i = 0; i < sheets.length; i++) {
      const ss = sheets[i];
      if (isOwnSheet(ss)) continue;
      let rules;
      try { rules = ss.cssRules; } catch (e) { continue; }   // 跨域样式表读不到就跳过
      if (!rules) continue;
      fn(rules);
    }
  }

  // 命中 body / html,body / html body 这类选择器
  const BODY_SEL_RE = /(^|,)\s*(html\s+)?body\s*(,|$)/;

  // ---------- 判断该页原本是深色还是浅色 ----------
  function detectNatural() {
    let found = 'light';
    eachSheet(rules => {
      for (let i = 0; i < rules.length; i++) {
        const r = rules[i];
        if (!r.selectorText || !r.style) continue;
        if (!BODY_SEL_RE.test(r.selectorText)) continue;
        const v = r.style.getPropertyValue('background') || r.style.getPropertyValue('background-color');
        if (!v) continue;
        const lum = valueLuminance(v);
        if (lum === null) continue;
        found = lum < 0.5 ? 'dark' : 'light';
        return;
      }
    });
    return found;
  }

  // ---------- 生成覆盖样式表 ----------
  // 还原 at-rule 前缀：@media / @supports / @keyframes / @layer 都适用。
  // 优先取 cssText 里第一个 '{' 之前的部分（at-rule 前缀中不会含 '{'），
  // 读不到 cssText 时再按类型回退，保证在各种环境下都能正确还原。
  function atRuleHead(r) {
    const t = r.cssText || '';
    const i = t.indexOf('{');
    if (i > 0) return t.slice(0, i).trim();
    if (r.media && r.media.mediaText) return `@media ${r.media.mediaText}`;
    if (r.name) return `@keyframes ${r.name}`;
    if (r.conditionText) return `@supports ${r.conditionText}`;
    return '';
  }

  // 递归收集规则文本并返回数组。分组规则保留外层前缀，
  // 这样响应式断点与动画关键帧在主题模式下依然生效。
  function walk(rules) {
    const buf = [];
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i];
      // 普通规则用 selectorText，@keyframes 内部的关键帧用 keyText
      const sel = r.selectorText || r.keyText;
      if (sel && r.style) {
        const decls = [];
        for (let j = 0; j < r.style.length; j++) {
          const p = r.style[j];
          if (!PROP_RE.test(p)) continue;
          const v = r.style.getPropertyValue(p);
          if (!v) continue;
          const nv = remapValue(v);
          if (nv === v) continue;
          const prio = r.style.getPropertyPriority(p);
          decls.push(`${p}:${nv}${prio ? ' !' + prio : ''}`);
        }
        if (decls.length) buf.push(`${sel}{${decls.join(';')}}`);
      } else if (r.cssRules && r.cssRules.length) {
        const inner = walk(r.cssRules);
        if (!inner.length) continue;
        const head = atRuleHead(r);
        if (head) buf.push(`${head}{${inner.join('')}}`);
        else buf.push(inner.join(''));
      }
    }
    return buf;
  }

  function buildOverride() {
    const out = [];
    eachSheet(rules => { out.push.apply(out, walk(rules)); });

    // html 背景跟着 body 走，避免 overscroll 露出原色
    let bodyBg = null;
    eachSheet(rules => {
      if (bodyBg) return;
      for (let i = 0; i < rules.length; i++) {
        const r = rules[i];
        if (!r.selectorText || !r.style) continue;
        if (!BODY_SEL_RE.test(r.selectorText)) continue;
        const v = r.style.getPropertyValue('background-color') || r.style.getPropertyValue('background');
        if (!v) continue;
        const m = FIRST_COLOR_RE.exec(v);
        if (m) { bodyBg = remapValue(m[0]); return; }
      }
    });

    const mode = get();
    const head = [`:root{color-scheme:${mode}}`];
    if (bodyBg) head.push(`html{background-color:${bodyBg}}`);
    return head.concat(out).join('\n');
  }

  // ---------- 行内 style 处理 ----------
  function captureInline(el) {
    if (origInline.has(el)) return origInline.get(el);
    const st = el.style;
    if (!st || !st.length) return null;
    const saved = {};
    let any = false;
    for (let i = 0; i < st.length; i++) {
      const p = st[i];
      if (!PROP_RE.test(p)) continue;
      const v = st.getPropertyValue(p);
      if (!v || !FIRST_COLOR_RE.test(v)) continue;
      saved[p] = { v: v, prio: st.getPropertyPriority(p) };
      any = true;
    }
    if (!any) return null;
    origInline.set(el, saved);
    return saved;
  }

  function processInline(root) {
    if (!root || root.nodeType !== 1) return;
    const targets = [];
    if (root.getAttribute && root.getAttribute('style')) targets.push(root);
    if (root.querySelectorAll) {
      const list = root.querySelectorAll('[style]');
      for (let i = 0; i < list.length; i++) targets.push(list[i]);
    }
    for (let i = 0; i < targets.length; i++) {
      const el = targets[i];
      const saved = captureInline(el);
      if (!saved) continue;
      for (const p in saved) {
        const orig = saved[p];
        const next = shouldInvert ? remapValue(orig.v) : orig.v;
        try { el.style.setProperty(p, next, orig.prio || ''); } catch (e) {}
      }
    }
  }

  let mo = null;
  let queued = false;
  function observeInline() {
    if (mo || !document.body || typeof MutationObserver === 'undefined') return;
    mo = new MutationObserver(records => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        for (let i = 0; i < records.length; i++) {
          const added = records[i].addedNodes;
          for (let j = 0; j < added.length; j++) processInline(added[j]);
        }
      });
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  // ---------- 应用 ----------
  function removeOverride() {
    const old = document.getElementById(STYLE_ID);
    if (old && old.parentNode) old.parentNode.removeChild(old);
  }

  function apply() {
    const mode = get();
    const root = document.documentElement;
    if (root) root.setAttribute('data-bh-theme', mode);

    removeOverride();

    if (mode === 'default') {
      shouldInvert = false;
      processInline(document.body);      // 还原此前被反转过的行内颜色
      if (root) root.style.removeProperty('color-scheme');
      return;
    }

    const natural = detectNatural();
    shouldInvert = (natural !== mode);

    if (shouldInvert) {
      const css = buildOverride();
      const st = document.createElement('style');
      st.id = STYLE_ID;
      st.appendChild(document.createTextNode(css));
      (document.head || root).appendChild(st);
    }
    processInline(document.body);
    observeInline();
  }

  // 首次执行：head 内即可（样式表此时已解析），避免先闪一下原配色
  apply();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { apply(); });
  }

  window.BHTheme = { get: get, set: set, apply: apply, MODES: MODES, detectNatural: detectNatural };
})();
