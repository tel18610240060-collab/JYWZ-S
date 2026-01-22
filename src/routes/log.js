const express = require('express')
const { requireAuth } = require('../auth')

const router = express.Router()

// 客户端错误日志接口
router.post('/error', requireAuth, (req, res) => {
  try {
    const { type, message, detail, stack } = req.body || {}
    const userId = req.user ? req.user.id : 'unknown'
    
    // 记录完整的错误信息到服务器日志
    console.error(`[CLIENT_ERROR] User: ${userId}, Type: ${type || 'unknown'}`)
    console.error(`[CLIENT_ERROR] Message: ${message || 'no message'}`)
    if (detail) {
      console.error(`[CLIENT_ERROR] Detail: ${JSON.stringify(detail, null, 2)}`)
    }
    if (stack) {
      console.error(`[CLIENT_ERROR] Stack: ${stack}`)
    }
    
    res.json({ ok: true })
  } catch (e) {
    console.error('[CLIENT_ERROR] Failed to log error:', e.message)
    res.json({ ok: true }) // 即使记录失败也返回成功，避免影响用户体验
  }
})

module.exports = router
