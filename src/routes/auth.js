const express = require('express')
const { code2session } = require('../douyin')
const { upsertUserByOpenid, createSession } = require('../auth')

const router = express.Router()

// 兼容旧接口：/api/auth/code2session
router.post('/code2session', async (req, res, next) => {
  try {
    const { code } = req.body || {}
    if (!code) return res.status(400).json({ error: 'missing code' })
    const s = await code2session(code)
    res.json(s)
  } catch (e) {
    next(e)
  }
})

// 新接口：一次性登录
// 入参：{ code, userInfo:{nickName,avatarUrl} }
// 出参：{ token, user }
router.post('/login', async (req, res, next) => {
  try {
    const { code, userInfo } = req.body || {}
    if (!code) return res.status(400).json({ error: 'missing code' })

    const s = await code2session(code)
    const nickname = (userInfo && (userInfo.nickName || userInfo.nickname)) || '未命名用户'
    const avatarUrl = (userInfo && (userInfo.avatarUrl || userInfo.avatar_url)) || ''

    const user = await upsertUserByOpenid({
      openid: s.openid,
      unionid: s.unionid,
      nickname,
      avatarUrl
    })

    const token = await createSession(user.id)
    res.json({ token, user })
  } catch (e) {
    next(e)
  }
})

module.exports = router
