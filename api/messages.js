const { Redis } = require('@upstash/redis');
const redis = Redis.fromEnv();

const STORAGE_KEY = 'bh_messages';
const USERS_KEY = 'bh_users';
const SESSION_PREFIX = 'bh_session:';
const PENDING_KEY = 'bh_pending';

// 通过会话 Token 查找登录用户，替代明文密码校验
async function getSessionUser(req) {
  const authHeader = req.headers.authorization || '';
  const bodyToken = (req.body && req.body.token) || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : bodyToken;
  if (!token) return null;

  const email = await redis.get(SESSION_PREFIX + token);
  if (!email) return null;

  const users = (await redis.get(USERS_KEY)) || {};
  const user = users[email];
  if (!user) return null;
  return { email, username: user.username };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // GET - 获取留言（公开）
    if (req.method === 'GET') {
      const messages = (await redis.get(STORAGE_KEY)) || [];
      return res.status(200).json(messages);
    }

    // POST - 发留言（需要会话验证）
    if (req.method === 'POST') {
      const user = await getSessionUser(req);
      if (!user) {
        return res.status(401).json({ error: '登录已过期，请重新登录' });
      }

      const text = (req.body && req.body.text) || '';
      if (!text || text.trim() === '') {
        return res.status(400).json({ error: '内容不能为空' });
      }

      const newMsg = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        username: user.username,
        text: text.trim().slice(0, 500),
        timestamp: Date.now()
      };

      const messages = (await redis.get(STORAGE_KEY)) || [];
      messages.push(newMsg);
      if (messages.length > 500) {
        messages.shift();
      }
      await redis.set(STORAGE_KEY, messages);
      // 写入成功后清理前端备份标记（如有）
      await redis.set(PENDING_KEY, []);
      return res.status(200).json(newMsg);
    }

    // DELETE - 清空（需要会话验证）
    if (req.method === 'DELETE') {
      const user = await getSessionUser(req);
      if (!user) {
        return res.status(401).json({ error: '登录已过期，请重新登录' });
      }

      await redis.set(STORAGE_KEY, []);
      await redis.set(PENDING_KEY, []);
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: '方法不允许' });
  } catch (error) {
    console.error('API错误:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
};
