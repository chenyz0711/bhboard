// ============================================================
// 密钥门禁共享模块
// 各页面登录时调用 window.KeyGate.validateAccessKey(name, key)
// ============================================================
(function () {
  const _s = 'iuuqt;00dsbdl.njehf.3134:6/vqtubti/jp';
  const _k = 'hRBBBBBBBybcBBJhdEF5O{h4NUmmZXF1ZkZ1NXN{ZUmjOEd6Z{R4PUmlNURyNB';
  const _a = 'qbttxpse';

  function _d(s) {
    let r = '';
    for (let i = 0; i < s.length; i++) r += String.fromCharCode(s.charCodeAt(i) - 1);
    return r;
  }

  const UPSTASH_URL = _d(_s);
  const UPSTASH_TOKEN = _d(_k);
  const ACCESS_KEY = _d(_a);
  const KEYS_KEY = 'bh_keys';

  async function upGet(key) {
    const res = await fetch(`${UPSTASH_URL}/get/${key}`, {
      headers: { 'Authorization': `Bearer ${UPSTASH_TOKEN}` }
    });
    const data = await res.json();
    return data.result;
  }

  async function upSetPlain(key, value) {
    const res = await fetch(
      `${UPSTASH_URL}/set/${key}/${encodeURIComponent(value)}`,
      { method: 'POST', headers: { 'Authorization': `Bearer ${UPSTASH_TOKEN}` } }
    );
    if (!res.ok) throw new Error('写入失败');
    return await res.json();
  }

  async function readKeys() {
    const raw = await upGet(KEYS_KEY);
    if (!raw) return {};
    try {
      const obj = JSON.parse(raw);
      return (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj : {};
    } catch (e) { return {}; }
  }

  async function saveKeys(keys) {
    await upSetPlain(KEYS_KEY, JSON.stringify(keys));
  }

  // 校验密钥。返回 { ok, msg }
  // - 本机已登录过：直接放行（不重复要密钥）
  // - 通用密钥：直接放行（可进任何账号）
  // - 未登记密钥：拒绝
  // - 未使用的密钥：绑定到当前名字并放行
  // - 已绑定且是自己的：放行
  // - 已绑定但是别人的：拒绝
  // 本机是否已登录（任意页面登录过都会写这个键）
  function isAlreadyLoggedIn() {
    try {
      const saved = localStorage.getItem('bh_user');
      if (!saved) return false;
      const user = JSON.parse(saved);
      return !!(user && user.username);
    } catch (e) { return false; }
  }

  async function validateAccessKey(name, key) {
    key = (key || '').trim();
    name = (name || '').trim();
    if (isAlreadyLoggedIn()) return { ok: true };   // 已登录设备免密钥
    if (!key) return { ok: false, msg: '请输入密钥' };
    if (key === ACCESS_KEY) return { ok: true };
    try {
      const keys = await readKeys();
      const entry = keys[key];
      if (!entry) return { ok: false, msg: '密钥无效，请找管理员要一个' };
      if (!entry.owner) {
        // 第一次使用，绑定到当前兄弟
        entry.owner = name;
        entry.usedAt = Date.now();
        await saveKeys(keys);
        return { ok: true };
      }
      if (entry.owner === name) return { ok: true };
      return { ok: false, msg: '这个密钥已经是别的兄弟的了' };
    } catch (e) {
      return { ok: false, msg: '网络错误，请重试' };
    }
  }

  // 记住密钥，下次自动带出
  function rememberKey(key) {
    if (key) localStorage.setItem('bh_access_key', key);
  }
  function storedKey() {
    try { return localStorage.getItem('bh_access_key') || ''; } catch (e) { return ''; }
  }

  // 读取登录用户（全站统一登录态，主页登录后各页面共享）
  function getUser() {
    try {
      const saved = localStorage.getItem('bh_user');
      if (!saved) return null;
      const user = JSON.parse(saved);
      return (user && user.username) ? user : null;
    } catch (e) { return null; }
  }

  // 未登录强制跳转主页登录
  function requireLogin() {
    if (!getUser()) {
      location.replace('https://j2k183.pages.dev/');
      return false;
    }
    return true;
  }

  // 管理员：仅 chenyz（不区分大小写）
  function isAdmin(name) {
    return String(name || '').trim().toLowerCase() === 'chenyz';
  }

  window.KeyGate = {
    validateAccessKey, rememberKey, storedKey, getUser, requireLogin, isAlreadyLoggedIn,
    credentials: function () { return { url: UPSTASH_URL, token: UPSTASH_TOKEN }; },
    accessKey: function () { return ACCESS_KEY; },
    isAdmin: isAdmin
  };
})();
