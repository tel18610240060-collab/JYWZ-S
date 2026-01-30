const { query, exec } = require('./db/query')
const { randomUUID } = require('crypto')
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

async function upsertUserByOpenid({ openid, unionid, nickname, avatarUrl, phoneNumber }) {
  console.log('[auth/upsertUserByOpenid] 开始处理用户信息保存')
  console.log('[auth/upsertUserByOpenid] 参数:', {
    openid: openid ? openid.substring(0, 10) + '...' : 'empty',
    unionid: unionid || 'none',
    nickname: nickname || 'none',
    avatarUrl: avatarUrl ? avatarUrl.substring(0, 50) + '...' : 'empty',
    phoneNumber: phoneNumber ? phoneNumber.substring(0, 3) + '****' : 'none'
  })
  
  if (!openid) {
    console.error('[auth/upsertUserByOpenid] openid 为空，无法保存用户')
    throw new Error('openid is required')
  }
  
  const existing = await query('SELECT * FROM users WHERE openid = ? LIMIT 1', [openid])
  console.log('[auth/upsertUserByOpenid] 查询现有用户，结果数量:', existing.length)
  
  if (existing.length) {
    console.log('[auth/upsertUserByOpenid] 用户已存在，准备更新，当前用户ID:', existing[0].id)
    // 更新用户信息，如果提供了手机号则更新
    const updateFields = []
    const updateValues = []
    
    if (unionid !== undefined) {
      updateFields.push('unionid=?')
      updateValues.push(unionid || null)
    }
    if (nickname !== undefined) {
      updateFields.push('nickname=?')
      updateValues.push(nickname || existing[0].nickname)
    }
    if (avatarUrl !== undefined) {
      updateFields.push('avatar_url=?')
      updateValues.push(avatarUrl || existing[0].avatar_url)
    }
    if (phoneNumber !== undefined && phoneNumber !== null) {
      updateFields.push('phone_number=?')
      updateValues.push(phoneNumber)
    }
    
    console.log('[auth/upsertUserByOpenid] 需要更新的字段:', updateFields)
    
    if (updateFields.length > 0) {
      updateValues.push(openid)
      const updateSql = `UPDATE users SET ${updateFields.join(', ')} WHERE openid=?`
      console.log('[auth/upsertUserByOpenid] 执行更新SQL:', updateSql)
      console.log('[auth/upsertUserByOpenid] 更新参数:', updateValues)
      await exec(updateSql, updateValues)
      console.log('[auth/upsertUserByOpenid] 更新完成')
    } else {
      console.log('[auth/upsertUserByOpenid] 无需更新字段')
    }
    
    const u = await query('SELECT * FROM users WHERE openid = ? LIMIT 1', [openid])
    console.log('[auth/upsertUserByOpenid] 更新后查询用户，用户ID:', u[0]?.id)
    return u[0]
  }

  console.log('[auth/upsertUserByOpenid] 用户不存在，准备插入新用户')
  const insertSql = 'INSERT INTO users(openid, unionid, nickname, avatar_url, phone_number) VALUES(?,?,?,?,?)'
  const insertValues = [openid, unionid || null, nickname || '未命名用户', avatarUrl || '', phoneNumber || null]
  console.log('[auth/upsertUserByOpenid] 执行插入SQL:', insertSql)
  console.log('[auth/upsertUserByOpenid] 插入参数:', {
    openid: insertValues[0] ? insertValues[0].substring(0, 10) + '...' : 'empty',
    unionid: insertValues[1] || 'null',
    nickname: insertValues[2] || 'none',
    avatarUrl: insertValues[3] ? insertValues[3].substring(0, 50) + '...' : 'empty',
    phoneNumber: insertValues[4] ? insertValues[4].substring(0, 3) + '****' : 'null'
  })
  
  await exec(insertSql, insertValues)
  console.log('[auth/upsertUserByOpenid] 插入完成')
  
  const u = await query('SELECT * FROM users WHERE openid = ? LIMIT 1', [openid])
  console.log('[auth/upsertUserByOpenid] 插入后查询用户，用户ID:', u[0]?.id)
  return u[0]
}

async function createSession(userId) {
  const token = randomUUID()
  const ttlDays = Math.max(1, config.SESSION_TTL_DAYS)
  await exec(
    'INSERT INTO sessions(token, user_id, expires_at) VALUES(?,?, DATE_ADD(NOW(), INTERVAL ? DAY))',
    [token, userId, ttlDays]
  )
  return token
}

module.exports = { requireAuth, upsertUserByOpenid, createSession }
