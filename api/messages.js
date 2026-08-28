const { Redis } = require('@upstash/redis');
const redis = Redis.fromEnv();

const STORAGE_KEY = 'bh_messages';
const USERS_KEY = 'bh_users';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // GET - 获取留言（公开）
    if (req.method === 'GET') {
      const messages = await redis.get(STORAGE_KEY) || [];
      return res.status(200).json(messages);
    }

    // POST - 发留言（需要登录验证）
    if (req.method === 'POST') {
      const { email, password, text } = req.body;

      // 验证用户
      if (!email || !password) {
        return res.status(401).json({ error: '请先登录' });
      }

      const users = await redis.get(USERS_KEY) || {};
      const user = users[email];
      if (!user || user.password !== password) {
        return res.status(401).json({ error: '登录已过期，请重新登录' });
      }

      if (!text || text.trim() === '') {
        return res.status(400).json({ error: '内容不能为空' });
      }

      const newMsg = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        username: user.username,
        text: text.trim().slice(0, 500),
        timestamp: Date.now()
      };

      const messages = await redis.get(STORAGE_KEY) || [];
      messages.push(newMsg);
      if (messages.length > 500) {
        messages.shift();
      }
      await redis.set(STORAGE_KEY, messages);
      return res.status(200).json(newMsg);
    }

    // DELETE - 清空（需要登录验证）
    if (req.method === 'DELETE') {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(401).json({ error: '请先登录' });
      }

      const users = await redis.get(USERS_KEY) || {};
      const user = users[email];
      if (!user || user.password !== password) {
        return res.status(401).json({ error: '登录已过期，请重新登录' });
      }

      await redis.set(STORAGE_KEY, []);
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: '方法不允许' });
  } catch (error) {
    console.error('API错误:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
};
