const { query, exec } = require('./db/query')
const { v4: uuidv4 } = require('uuid')
const { config } = require('./config')

function parseBearer(req) {
  const h = req.headers.authorization || ''
  const m = /^Bearer\s+(.+)$/.exec(h)
  return m ? m[1] : ''
}

async function requireAuth(req, res, next) {
  try {
    const token = parseBearer(req)
    if (!token) {
      res.status(401).json({ error: 'missing token' })
      return
    }

    const rows = await query(
      `SELECT s.token, s.expires_at, u.*
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > NOW()
       LIMIT 1`,
      [token]
    )

    if (!rows.length) {
      res.status(401).json({ error: 'invalid or expired token' })
      return
    }

    req.user = rows[0]
    req.token = token
    next()
  } catch (e) {
    next(e)
  }
}

async function upsertUserByOpenid({ openid, unionid, nickname, avatarUrl }) {
  const existing = await query('SELECT * FROM users WHERE openid = ? LIMIT 1', [openid])
  if (existing.length) {
    await exec(
      'UPDATE users SET unionid=?, nickname=?, avatar_url=? WHERE openid=?',
      [unionid || null, nickname || existing[0].nickname, avatarUrl || existing[0].avatar_url, openid]
    )
    const u = await query('SELECT * FROM users WHERE openid = ? LIMIT 1', [openid])
    return u[0]
  }

  await exec(
    'INSERT INTO users(openid, unionid, nickname, avatar_url) VALUES(?,?,?,?)',
    [openid, unionid || null, nickname || '未命名用户', avatarUrl || '']
  )
  const u = await query('SELECT * FROM users WHERE openid = ? LIMIT 1', [openid])
  return u[0]
}

async function createSession(userId) {
  const token = uuidv4()
  const ttlDays = Math.max(1, config.SESSION_TTL_DAYS)
  await exec(
    'INSERT INTO sessions(token, user_id, expires_at) VALUES(?,?, DATE_ADD(NOW(), INTERVAL ? DAY))',
    [token, userId, ttlDays]
  )
  return token
}

module.exports = { requireAuth, upsertUserByOpenid, createSession }
