// ============================================================
// BHBoard 共享主题模块（默认 / 浅色 / 深色）
//
// 设计原则（显式调色板版）：
// 1. 不做任何"视觉反转"。浅色 / 深色都是直接写死的调色板，
//    颜色是设计出来的、可预测的，不依赖各页原有 CSS 的具体取值。
// 2. 默认模式（default）不注入任何样式，各页面严格保持原有配色
//    （南外生存蓝、管理与轮盘赌深色等一律不变）。
// 3. 页面渲染时读取用户当前模式：把 data-bh-theme 挂在 <html> 上，
//    注入的覆盖样式全部以 html[data-bh-theme="x"] 为前缀。
//    因此同一份样式表能让每页在加载 / 切换时都按当前模式取色。
// 4. 选择器只用全站真实存在的结构类（.container/.card/.header/...
//    及各页特有类），命中面广且不会误伤。
//
// 对外接口：window.BHTheme = { get, set, apply, MODES }
// 用法：BHTheme.set('light') 立即生效并写入 localStorage，全站共享。
// ============================================================
(function () {
  const KEY = 'bh_theme';
  const STYLE_ID = 'bh-theme-palette';
  const MODES = ['default', 'light', 'dark'];

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

  // ============================================================
  // 调色板：每种模式一套显式颜色。键是语义角色，值是 CSS 颜色。
  // 想调整某个模式的整体观感，只改这里即可，不涉及任何算法。
  // ============================================================
  const PALETTES = {
    light: {
      scheme: 'light',
      pageBg: '#f2f4f7',          // 页面底色
      pageText: '#1f2430',        // 正文主色
      cardBg: '#ffffff',          // 卡片 / 面板底
      cardText: '#1f2430',
      cardBorder: '#e2e6ee',
      headerBg: '#ffffff',
      headerText: '#1f2430',
      footerText: '#98a0b3',
      subText: '#6b7280',         // 次级说明文字
      inputBg: '#ffffff',
      inputText: '#1f2430',
      inputBorder: '#d5dae4',
      btnBg: '#2d3348',
      btnText: '#ffffff',
      btnBorder: 'transparent',
      btnGhostBg: 'transparent',
      btnGhostText: '#2d3348',
      btnGhostBorder: '#c7cede',
      accentBg: '#3b5bdb',        // 强调 / 选中
      accentText: '#ffffff',
      goldBg: '#c99a2e',
      goldText: '#ffffff',
      dangerBg: '#d6455b',
      dangerText: '#ffffff',
      rowHover: '#f5f7fb',
      dotOn: '#37b24d',
      dotOff: '#adb5bd',
      iframeBg: '#ffffff'
    },
    dark: {
      scheme: 'dark',
      pageBg: '#0f1219',
      pageText: '#e6e8ee',
      cardBg: '#1a1f2b',
      cardText: '#e6e8ee',
      cardBorder: '#2a3140',
      headerBg: '#141824',
      headerText: '#e6e8ee',
      footerText: '#6b7280',
      subText: '#9aa3b2',
      inputBg: '#0f1219',
      inputText: '#e6e8ee',
      inputBorder: '#2a3140',
      btnBg: '#e6e8ee',
      btnText: '#12151d',
      btnBorder: 'transparent',
      btnGhostBg: 'transparent',
      btnGhostText: '#e6e8ee',
      btnGhostBorder: '#3a4356',
      accentBg: '#5c7cfa',
      accentText: '#0b0e14',
      goldBg: '#e0b458',
      goldText: '#12151d',
      dangerBg: '#f0657a',
      dangerText: '#12151d',
      rowHover: '#232a38',
      dotOn: '#51cf66',
      dotOff: '#495057',
      iframeBg: '#0f1219'
    }
  };

  // ============================================================
  // 由调色板生成一份完整覆盖样式表。
  // 所有选择器都以 html[data-bh-theme="MODE"] 为前缀，
  // 且用 !important 压过各页内联的硬编码颜色。
  // ============================================================
  function buildCss(mode) {
    const p = PALETTES[mode];
    if (!p) return '';
    const R = `html[data-bh-theme="${mode}"]`;   // 前缀

    // 结构选择器：全站真实存在的类（来自各页 class 词表提取）
    const cardSel = [
      '.card','.panel','.log-panel','.login-box','.auth-box','.overlay-card',
      '.confirm-box','.rules-box','.unlock-box','.admin-unlock','.cu-box',
      '.char-card','.diff-card','.mate-card','.menu-card','.mp-item',
      '.msg-item','.log-item','.wall-item','.match-row','.notice-body','.node'
    ].join(',');

    const subSel = [
      '.sub','.menu-desc','.msg-time','.log-date','.row-meta','.empty-tip',
      '.empty','.tip','.send-tip','.quota-tip','.refresh-tip','.waiting-tip',
      '.stale-tip','.notice-tip','.notice-meta','.docs-note','.subtitle',
      '.auth-hint','.meta','.mp-item-meta','.mp-time','.desc','.choice-sub','.mp-sub'
    ].join(',');

    const btnSel = ['.btn-main','.btn','.btn-send','.btn-auth','.act-btn',
      '.action-btn','.propose-btn','.punch-btn','.match-btn','.back-btn','.mp-add'].join(',');

    const btnGhostSel = ['.btn-ghost','.link-btn','.logout-btn','.back','.btn-small'].join(',');

    const inputSel = ['input','textarea','select','.name-input','.unlock-input'].join(',');

    const goldSel = ['.btn-gold','.gold','.admin-tag','.title-badge'].join(',');
    const dangerSel = ['.danger','.wall-del','.lightbox-del','.mp-del','.row-actions .del'].join(',');
    const accentSel = ['.btab.active','.active','.theme-btn.on','.diff-card.sel','.char-card.sel','.on'].join(',');

    return [
      // --- 页面底色 / 正文 ---
      `${R}{color-scheme:${p.scheme};}`,
      `${R} body,${R} .container,${R} .wrap,${R} .stage-wrap{`,
      `  background:${p.pageBg} !important;color:${p.pageText} !important;}`,
      `${R}{background:${p.pageBg} !important;}`,   // html 元素本身，避免 overscroll 露出原色

      // --- 页头 / 页脚 ---
      `${R} .header,${R} .msg-top,${R} .chat-bar{`,
      `  background:${p.headerBg} !important;color:${p.headerText} !important;`,
      `  border-color:${p.cardBorder} !important;}`,
      `${R} .header *,${R} .header-right *{color:inherit;}`,
      `${R} .footer{color:${p.footerText} !important;}`,

      // --- 卡片 / 面板 ---
      `${R} ${cardSel}{`,
      `  background:${p.cardBg} !important;color:${p.cardText} !important;`,
      `  border-color:${p.cardBorder} !important;box-shadow:none !important;}`,

      // --- 次级文字 ---
      `${R} ${subSel}{color:${p.subText} !important;}`,

      // --- 输入框 ---
      `${R} ${inputSel}{`,
      `  background:${p.inputBg} !important;color:${p.inputText} !important;`,
      `  border-color:${p.inputBorder} !important;}`,
      `${R} ${inputSel}::placeholder{color:${p.subText} !important;opacity:.8;}`,

      // --- 按钮 ---
      `${R} ${btnSel}{`,
      `  background:${p.btnBg} !important;color:${p.btnText} !important;`,
      `  border-color:${p.btnBorder} !important;}`,
      `${R} ${btnGhostSel}{`,
      `  background:${p.btnGhostBg} !important;color:${p.btnGhostText} !important;`,
      `  border-color:${p.btnGhostBorder} !important;}`,
      `${R} ${goldSel}{background:${p.goldBg} !important;color:${p.goldText} !important;`,
      `  border-color:${p.goldBg} !important;}`,
      `${R} ${dangerSel}{background:${p.dangerBg} !important;color:${p.dangerText} !important;`,
      `  border-color:${p.dangerBg} !important;}`,
      `${R} ${accentSel}{background:${p.accentBg} !important;color:${p.accentText} !important;`,
      `  border-color:${p.accentBg} !important;}`,
      `${R} .disabled,${R} [disabled]{opacity:.5 !important;}`,

      // --- 列表行 / 表格 ---
      `${R} .row:hover,${R} .mp-item:hover,${R} .log-item:hover,${R} .msg-item:hover{`,
      `  background:${p.rowHover} !important;}`,
      `${R} th{color:${p.subText} !important;border-color:${p.cardBorder} !important;}`,
      `${R} td{border-color:${p.cardBorder} !important;color:${p.cardText} !important;}`,

      // --- 状态点 ---
      `${R} .dot.on,${R} .dot[style*="37b24d"]{background:${p.dotOn} !important;}`,
      `${R} .dot.off{background:${p.dotOff} !important;}`,

      // --- iframe 承载的架构文档：底色跟随，避免白块 ---
      `${R} .docs-frame,${R} iframe{background:${p.iframeBg} !important;}`
    ].join('\n');
  }

  // ============================================================
  // 行内颜色：页面里有些颜色写在 style="..." 上（如状态点、进度条），
  // CSS 覆盖不到。这里对常见的行内背景/边框色做定向替换。
  // 备份原值，切回默认模式时还原，避免累积。
  // ============================================================
  const origInline = new WeakMap();

  // 只重映射这些行内属性里的颜色
  const INLINE_PROPS = ['background', 'background-color', 'border-color', 'color'];
  // 简单色名/十六进制映射：深底↔浅底、深字↔浅字
  // 注意：靠传入的属性名 prop 判断这是文字色还是背景/边框色，
  // 不能用颜色值本身判断（颜色值里不含 "color" 字样）。
  function inlineColorFor(v, mode, prop) {
    if (!v) return v;
    const p = PALETTES[mode];
    if (!p) return v;
    // 仅处理纯颜色值，不动渐变/多值（那些交给 CSS 层）
    const hex = /^#([0-9a-fA-F]{3,8})$/.exec(v.trim());
    if (!hex) return v;
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map(c => c + c).join('');
    const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
    if ([r,g,b].some(isNaN)) return v;
    const lum = (0.2126*r + 0.7152*g + 0.0722*b) / 255;
    const isDark = lum < 0.5;
    const isTextColor = (prop === 'color');
    if (isTextColor) {
      // 文字色：原本深字→浅模式用正文色，原本浅字→用卡片正文色
      return isDark ? p.pageText : p.cardText;
    }
    // 背景/边框色：深底→卡片底，浅底→页面底
    return isDark ? p.cardBg : p.pageBg;
  }

  function captureInline(el) {
    if (origInline.has(el)) return origInline.get(el);
    const st = el.style;
    if (!st || !st.length) return null;
    const saved = {};
    let any = false;
    for (let i = 0; i < st.length; i++) {
      const pr = st[i];
      if (INLINE_PROPS.indexOf(pr) < 0) continue;
      const v = st.getPropertyValue(pr);
      if (!v || !/^#[0-9a-fA-F]{3,8}$/.test(v.trim())) continue;
      saved[pr] = { v: v, prio: st.getPropertyPriority(pr) };
      any = true;
    }
    if (!any) return null;
    origInline.set(el, saved);
    return saved;
  }

  let currentMode = 'default';
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
      for (const pr in saved) {
        const orig = saved[pr];
        const next = currentMode === 'default'
          ? orig.v
          : inlineColorFor(orig.v, currentMode, pr);
        try { el.style.setProperty(pr, next, orig.prio || ''); } catch (e) {}
      }
    }
  }

  let mo = null, queued = false;
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
  function ensureStyleEl() {
    let st = document.getElementById(STYLE_ID);
    if (!st) {
      st = document.createElement('style');
      st.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(st);
    }
    return st;
  }

  function apply() {
    const mode = get();
    currentMode = mode;
    const root = document.documentElement;
    if (root) root.setAttribute('data-bh-theme', mode);

    const st = ensureStyleEl();
    if (mode === 'default') {
      st.textContent = '';                 // 默认：清空覆盖，各页恢复原样
      if (root) root.style.removeProperty('color-scheme');
    } else {
      st.textContent = buildCss(mode);     // 浅色/深色：注入显式调色板
    }
    processInline(document.body);
    if (mode !== 'default') observeInline();
  }

  // 首次执行：head 内即可，避免先闪一下原配色
  apply();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { apply(); });
  }

  window.BHTheme = { get: get, set: set, apply: apply, MODES: MODES, PALETTES: PALETTES };
})();
