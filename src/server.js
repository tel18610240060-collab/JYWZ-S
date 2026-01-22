const express = require('express')
const path = require('path')
const { config } = require('./config')
const { ping } = require('./db/pool')

const authRoutes = require('./routes/auth')
const userRoutes = require('./routes/users')
const checkinRoutes = require('./routes/checkins')
const groupRoutes = require('./routes/groups')
const friendRoutes = require('./routes/friends')
const douyinRoutes = require('./routes/douyin')
const adminRoutes = require('./routes/admin')
const uploadRoutes = require('./routes/upload')
const logRoutes = require('./routes/log')

function createApp() {
  const app = express()

  app.use(express.json({ limit: '1mb' }))

  // 请求日志中间件（记录方法和路径，以及响应状态码）
  app.use((req, res, next) => {
    const originalSend = res.send
    res.send = function(data) {
      const statusCode = res.statusCode || 200
      if (statusCode >= 400) {
        console.error(`[${statusCode}] ${req.method} ${req.path}`)
      } else {
        console.log(`${req.method} ${req.path}`)
      }
      return originalSend.call(this, data)
    }
    next()
  })

  app.get('/health', async (req, res) => {
    try {
      await ping()
      res.json({ ok: true, mode: config.MODE })
    } catch (e) {
      res.status(500).json({ ok: false, error: 'db not ready' })
    }
  })

  // API 路由必须在静态文件中间件之前
  app.use('/api/auth', authRoutes)
  app.use('/api/users', userRoutes)
  app.use('/api/checkins', checkinRoutes)
  app.use('/api/groups', groupRoutes)
  app.use('/api/friends', friendRoutes)
  app.use('/api/douyin', douyinRoutes)
  app.use('/api/admin', adminRoutes)
  app.use('/api/upload', uploadRoutes)
  app.use('/api/log', logRoutes)

  // 兼容旧接口：/api/user/upsert（小程序旧版本）
  app.post('/api/user/upsert', async (req, res) => {
    // 新后端不再建议使用 openid 直传；保留给测试迁移。
    res.json({ ok: true, deprecated: true })
  })

  // 静态文件中间件（必须在 404 handler 之前）
  // 使用绝对路径，确保能找到 public 目录
  const publicPath = path.join(__dirname, '../public')
  app.use(express.static(publicPath))

  // 404 handler（必须在所有路由和静态文件中间件之后）
  app.use((req, res) => {
    res.status(404).json({ error: `Cannot ${req.method} ${req.path}` })
  })

  // error handler
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.statusCode || 500
    res.status(status).json({ error: err.message || 'server error', detail: err.detail })
  })

  return app
}

module.exports = { createApp }
