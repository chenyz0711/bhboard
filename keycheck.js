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
  const BANNED_KEY = 'bh_banned';      // 注销黑名单：用户名数组
  const MEMBERS_KEY = 'bh_members';    // 成员表：{ 名字: { firstSeen, lastSeen } }

  function _parse(raw) {
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  // ---------- 注销黑名单 ----------
  async function readBanned() {
    const arr = _parse(await upGet(BANNED_KEY));
    return Array.isArray(arr) ? arr : [];
  }
  async function isBanned(name) {
    const n = String(name || '').trim();
    if (!n) return false;
    try {
      const list = await readBanned();
      return list.some(x => String(x).trim().toLowerCase() === n.toLowerCase());
    } catch (e) { return false; }   // 查不到就放行，避免网络抖动把所有人锁在外面
  }
  // 被注销者清除本地登录态（否则靠本地缓存仍能进站）
  function clearLocalUser() {
    try { localStorage.removeItem('bh_user'); } catch (e) {}
  }

  // ---------- 成员最近上线时间 ----------
  async function touchMember(name) {
    const n = String(name || '').trim();
    if (!n) return;
    try {
      let members = _parse(await upGet(MEMBERS_KEY));
      if (!members || typeof members !== 'object' || Array.isArray(members)) members = {};
      const now = Date.now();
      const old = members[n];
      // 兼容旧格式：值直接是"首次出现"时间戳
      const firstSeen = (old && typeof old === 'object') ? (old.firstSeen || now)
                    : (typeof old === 'number' ? old : now);
      members[n] = { firstSeen: firstSeen, lastSeen: now };
      await upSetPlain(MEMBERS_KEY, JSON.stringify(members));
    } catch (e) {}
  }

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

    // 黑名单最优先：被注销者即使本地还留着登录态也不能再进
    if (await isBanned(name)) {
      clearLocalUser();
      return { ok: false, msg: '这个账号已被注销，无法登录' };
    }

    if (isAlreadyLoggedIn()) { await touchMember(getUserName()); return { ok: true }; }

    // 空密钥 = 访客模式：不碰服务器、仅本地游戏，账号名自动生成（存储由首页统一写）
    if (!key) {
      const gname = (name || ('访客' + Math.random().toString(36).slice(2, 6).toUpperCase())).slice(0, 20);
      return { ok: true, guest: true, username: gname };
    }

    const isUniversal = (key === ACCESS_KEY);
    if (!isUniversal) {
      try {
        const keys = await readKeys();
        if (!keys[key]) return { ok: false, msg: '密钥无效，请找管理员要一个' };
      } catch (e) {
        return { ok: false, msg: '网络错误，请重试' };
      }
    }

    // 记录"谁用了这个密钥、用了几次"（同一密钥不同人分开记）
    await recordKeyUse(key, name);
    await touchMember(name);
    return { ok: true };
  }

  function getUserName() {
    const u = getUser();
    return u ? u.username : '';
  }

  // 是否访客（只读、不碰服务器）
  function isGuest() {
    const u = getUser();
    return !!(u && u.guest === true);
  }

  // 同一密钥可被多人使用：每个使用者单独计数，便于管理员针对性注销
  async function recordKeyUse(key, name) {
    if (!key || !name) return;
    try {
      const keys = await readKeys();
      const entry = keys[key] || (keys[key] = {});
      if (!entry.owner) entry.owner = name;      // 首位使用者作为持有人
      if (!entry.usedAt) entry.usedAt = Date.now();
      if (!entry.users || typeof entry.users !== 'object') entry.users = {};
      const u = entry.users[name] || (entry.users[name] = { count: 0, firstAt: Date.now() });
      u.count = (u.count || 0) + 1;
      u.lastAt = Date.now();
      await saveKeys(keys);
    } catch (e) {}
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
      location.replace('/');   // 相对路径，换域名也无需改代码
      return false;
    }
    // 已登录者异步复核黑名单（不阻塞渲染；命中则清除本地态并踢回主页）
    recheckBanned().catch(function(){});
    return true;
  }

  // 管理员：仅 chenyz（不区分大小写）
  function isAdmin(name) {
    return String(name || '').trim().toLowerCase() === 'chenyz';
  }

  // 页面加载时复核：已登录者若被注销，清除本地态并踢回主页
  async function recheckBanned() {
    const u = getUser();
    if (!u) return false;
    if (await isBanned(u.username)) {
      clearLocalUser();
      location.replace('/');   // 相对路径，换域名也无需改代码
      return true;
    }
    touchMember(u.username);   // 顺带刷新最近上线时间
    return false;
  }

  // ---------- 访客写拦截 ----------
  // 访客模式下，任何发往数据库的写操作（set/del/incrby/expire/mset/json 等）一律拦截，
  // 直接返回 403，绝不落库；读操作（get）放行，本地游戏可正常读取数据。
  (function installGuestWriteGuard() {
    const _WRITE_CMDS = ['set', 'del', 'incr', 'incrby', 'expire', 'pexpire', 'mset', 'json', 'setnx', 'lpush', 'rpush', 'sadd', 'hset'];
    const origFetch = window.fetch;
    window.fetch = function (input, init) {
      try {
        if (isGuest()) {
          const url = typeof input === 'string' ? input : (input && input.url) || '';
          const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
          if (url.indexOf(UPSTASH_URL) === 0) {
            // 命中写命令路径，或显式 POST/PUT/DELETE，都拦下
            const seg = url.slice(UPSTASH_URL.length + 1).split('/')[0].toLowerCase();
            const isWrite = method !== 'GET' || _WRITE_CMDS.indexOf(seg) === 0;
            if (isWrite) {
              return Promise.resolve(new Response(
                JSON.stringify({ result: null, guestBlocked: true }),
                { status: 403, headers: { 'Content-Type': 'application/json' } }
              ));
            }
          }
        }
      } catch (e) { /* 守卫出错时回退到原始 fetch，不阻断正常流程 */ }
      return origFetch.apply(this, arguments);
    };
  })();

  window.KeyGate = {
    validateAccessKey, rememberKey, storedKey, getUser, requireLogin, isAlreadyLoggedIn,
    isGuest: isGuest,
    credentials: function () { return { url: UPSTASH_URL, token: UPSTASH_TOKEN }; },
    accessKey: function () { return ACCESS_KEY; },
    isAdmin: isAdmin,
    isBanned: isBanned,
    readBanned: readBanned,
    recheckBanned: recheckBanned,
    touchMember: touchMember
  };
})();
