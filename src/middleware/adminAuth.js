const { config } = require('../config')
const { v4: uuidv4 } = require('uuid')

// 简单的内存存储（生产环境应使用Redis或数据库）
const adminTokens = new Map()

// 生成管理员token
function generateAdminToken() {
  const token = uuidv4()
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000 // 24小时
  adminTokens.set(token, { expiresAt })
  return token
}

// 验证管理员token
function verifyAdminToken(token) {
  if (!token) return false
  const session = adminTokens.get(token)
  if (!session) return false
  if (Date.now() > session.expiresAt) {
    adminTokens.delete(token)
    return false
  }
  return true
}

// 删除token
function revokeAdminToken(token) {
  adminTokens.delete(token)
}

// 管理员认证中间件
function requireAdminAuth(req, res, next) {
  try {
    const token = req.headers['x-admin-token'] || req.query.token
    if (!token) {
      res.status(401).json({ ok: false, error: 'missing admin token' })
      return
    }

    if (!verifyAdminToken(token)) {
      res.status(401).json({ ok: false, error: 'invalid or expired admin token' })
      return
    }

    req.adminToken = token
    next()
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
}

// 管理员登录
function adminLogin(password) {
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123'
  if (password !== adminPassword) {
    return null
  }
  return generateAdminToken()
}

module.exports = {
  requireAdminAuth,
  adminLogin,
  revokeAdminToken,
  verifyAdminToken
}
