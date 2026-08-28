const { Redis } = require('@upstash/redis');
const redis = Redis.fromEnv();

const USERS_KEY = 'bh_users';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: '方法不允许' });
  }

  const { action, email, password, username } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: '邮箱和密码不能为空' });
  }

  // 简单邮箱格式校验
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: '邮箱格式不正确' });
  }

  try {
    const users = await redis.get(USERS_KEY) || {};

    // 注册
    if (action === 'register') {
      if (!username || username.trim() === '') {
        return res.status(400).json({ error: '用户名不能为空' });
      }
      if (users[email]) {
        return res.status(400).json({ error: '该邮箱已注册' });
      }
      // 检查用户名是否被占用
      for (const key in users) {
        if (users[key].username === username.trim()) {
          return res.status(400).json({ error: '该用户名已被使用' });
        }
      }
      users[email] = {
        username: username.trim().slice(0, 20),
        password: password, // 明文存储（简易版，不搞加密了）
        createdAt: Date.now()
      };
      await redis.set(USERS_KEY, users);
      return res.status(200).json({
        success: true,
        user: { email, username: users[email].username }
      });
    }

    // 登录
    if (action === 'login') {
      const user = users[email];
      if (!user) {
        return res.status(400).json({ error: '邮箱未注册' });
      }
      if (user.password !== password) {
        return res.status(400).json({ error: '密码错误' });
      }
      return res.status(200).json({
        success: true,
        user: { email, username: user.username }
      });
    }

    return res.status(400).json({ error: '未知操作' });
  } catch (error) {
    console.error('认证错误:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
};