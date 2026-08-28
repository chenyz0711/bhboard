const { Redis } = require('@upstash/redis');
const crypto = require('crypto');
const redis = Redis.fromEnv();

const USERS_KEY = 'bh_users';
const SESSION_PREFIX = 'bh_session:';
const SESSION_TTL = 7 * 24 * 60 * 60; // 会话有效期 7 天

// 密码加盐哈希，不再明文存储
function makeHash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 32).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

// 兼容旧数据：旧版明文密码直接比对，新版哈希走 scrypt 验证
function verifyPassword(password, stored) {
  if (typeof stored === 'string' && stored.startsWith('scrypt:')) {
    const [, salt, hash] = stored.split(':');
    try {
      const check = crypto.scryptSync(String(password), salt, 32).toString('hex');
      return crypto.timingSafeEqual(Buffer.from(check, 'hex'), Buffer.from(hash, 'hex'));
    } catch (e) {
      return false;
    }
  }
  return stored === password;
}

// 邮箱不区分大小写查找已有用户
function findUserKey(users, email) {
  const mailKey = email.toLowerCase().trim();
  if (users[mailKey]) return mailKey;
  for (const key in users) {
    if (key.toLowerCase() === mailKey) return key;
  }
  return null;
}

async function createSession(email) {
  const token = crypto.randomBytes(24).toString('hex');
  await redis.set(SESSION_PREFIX + token, email, { ex: SESSION_TTL });
  return token;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: '方法不允许' });
  }

  const { action, email, password, username, token } = req.body || {};

  try {
    // 退出登录：删除会话
    if (action === 'logout') {
      if (token) await redis.del(SESSION_PREFIX + token);
      return res.status(200).json({ success: true });
    }

    if (!email || !password) {
      return res.status(400).json({ error: '邮箱和密码不能为空' });
    }

    // 简单邮箱格式校验
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: '邮箱格式不正确' });
    }

    const users = (await redis.get(USERS_KEY)) || {};

    // 注册
    if (action === 'register') {
      if (!username || username.trim() === '') {
        return res.status(400).json({ error: '用户名不能为空' });
      }
      if (password.length < 4) {
        return res.status(400).json({ error: '密码至少 4 位' });
      }
      const mailKey = email.toLowerCase().trim();
      if (findUserKey(users, mailKey)) {
        return res.status(400).json({ error: '该邮箱已注册' });
      }
      // 检查用户名是否被占用
      const name = username.trim().slice(0, 20);
      for (const key in users) {
        if (users[key].username === name) {
          return res.status(400).json({ error: '该用户名已被使用' });
        }
      }
      users[mailKey] = {
        username: name,
        passwordHash: makeHash(password),
        createdAt: Date.now()
      };
      await redis.set(USERS_KEY, users);
      const sessionToken = await createSession(mailKey);
      return res.status(200).json({
        success: true,
        user: { email: mailKey, username: name },
        token: sessionToken
      });
    }

    // 登录
    if (action === 'login') {
      const userKey = findUserKey(users, email);
      const user = userKey ? users[userKey] : null;
      if (!user) {
        return res.status(400).json({ error: '邮箱未注册' });
      }
      const stored = user.passwordHash || user.password;
      if (!verifyPassword(password, stored)) {
        return res.status(400).json({ error: '密码错误' });
      }
      const sessionToken = await createSession(userKey);
      return res.status(200).json({
        success: true,
        user: { email: userKey, username: user.username },
        token: sessionToken
      });
    }

    return res.status(400).json({ error: '未知操作' });
  } catch (error) {
    console.error('认证错误:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
};
