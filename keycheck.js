// ============================================================
// 密钥门禁共享模块
// 各页面登录时调用 window.KeyGate.validateAccessKey(name, key)
// ============================================================
(function () {
  const UPSTASH_URL = 'https://crack-midge-202395.upstash.io';
  const UPSTASH_TOKEN = 'gQAAAAAAAxabAAIgcDFiMDlmMjYxN2JkZTQ0NjBiYWVlZWVkYjY2ZGQ0NzRmMQ';
  const KEYS_KEY = 'bh_keys';
  const UNIVERSAL_KEY = 'adminchenyz';   // 通用密钥：可登录任何账号

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
    if (key === UNIVERSAL_KEY) return { ok: true };
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

  window.KeyGate = { validateAccessKey, rememberKey, storedKey, UNIVERSAL_KEY };
})();
