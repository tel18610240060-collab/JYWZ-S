const express = require('express')
const { code2session, getPhoneNumber, decryptPhoneNumber } = require('../douyin')
const { upsertUserByOpenid, createSession, requireAuth } = require('../auth')
const { query, exec } = require('../db/query')

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
// 入参：{ code, userInfo:{nickName,avatarUrl}, phoneCode?, encryptedData?, iv? }
// 出参：{ token, user }
router.post('/login', async (req, res, next) => {
  try {
    const { code, userInfo, phoneCode, encryptedData, iv, phoneLoginCode } = req.body || {}
    if (!code) {
      console.error('[auth/login] missing code')
      return res.status(400).json({ error: 'missing code' })
    }

    try {
      const s = await code2session(code)
      
      // 仅当前端传了 userInfo 时才更新昵称/头像，否则保留库内已有（避免 getUserProfile 失败时覆盖老用户）
      const nickname = (userInfo && (userInfo.nickName || userInfo.nickname) && String(userInfo.nickName || userInfo.nickname).trim())
        ? (userInfo.nickName || userInfo.nickname)
        : undefined
      const avatarUrl = (userInfo && (userInfo.avatarUrl || userInfo.avatar_url) && String(userInfo.avatarUrl || userInfo.avatar_url).trim())
        ? (userInfo.avatarUrl || userInfo.avatar_url)
        : undefined
      
      // 处理手机号（优先使用旧方式：encryptedData + iv 解密）
      let phoneNumber = null
      if (encryptedData && iv) {
        // 旧方式：需要 phoneLoginCode 来获取 session_key 用于解密
        let sessionKeyForPhone = s.session_key
        if (phoneLoginCode && phoneLoginCode !== code) {
          // 如果提供了专门的 phoneLoginCode，用它获取 session_key
          try {
            const phoneSession = await code2session(phoneLoginCode)
            sessionKeyForPhone = phoneSession.session_key
          } catch (phoneSessionError) {
            // 获取手机号 session_key 失败，使用登录的 session_key
            // 如果失败，尝试使用登录的 session_key
          }
        }
        
        if (sessionKeyForPhone) {
          try {
            const phoneInfo = decryptPhoneNumber(encryptedData, iv, sessionKeyForPhone)
            phoneNumber = phoneInfo.phoneNumber || phoneInfo.purePhoneNumber
          } catch (decryptError) {
            // 解密手机号失败，继续流程
          }
        }
      } else if (phoneCode) {
        // 新方式：使用 phoneCode（需要RSA加密，暂不支持）
      }

      // 按 openid 判断新老用户：upsertUserByOpenid 内部会查询并返回 isNewUser
      const { user, isNewUser } = await upsertUserByOpenid({
        openid: s.openid,
        unionid: s.unionid,
        ...(nickname !== undefined && { nickname }),
        ...(avatarUrl !== undefined && { avatarUrl }),
        ...(phoneNumber !== undefined && phoneNumber !== null && { phoneNumber })
      })

      const token = await createSession(user.id)
      res.json({ token, user, isNewUser })
    } catch (code2sessionError) {
      // 保留错误日志用于生产环境问题排查
      throw code2sessionError
    }
  } catch (e) {
    next(e)
  }
})

// 单独获取手机号接口（用于登录后补充手机号）
router.post('/phone', requireAuth, async (req, res, next) => {
  try {
    const { phoneCode, encryptedData, iv, loginCode } = req.body || {}
    
    let phoneNumber = null
    
    if (phoneCode) {
      // 新方式：使用 phoneCode（需要RSA加密，暂不支持，返回提示）
      return res.status(400).json({ error: '新方式获取手机号需要RSA加密，暂不支持，请使用旧方式（encryptedData + iv）' })
    } else if (encryptedData && iv && loginCode) {
      // 旧方式：使用 encryptedData + iv 解密
      try {
        console.log('[auth/phone] 使用旧方式解密手机号')
        const s = await code2session(loginCode)
        const phoneInfo = decryptPhoneNumber(encryptedData, iv, s.session_key)
        phoneNumber = phoneInfo.phoneNumber || phoneInfo.purePhoneNumber
        
        // 更新用户手机号
        await exec('UPDATE users SET phone_number=? WHERE id=?', [phoneNumber, req.user.id])
        
        res.json({ phoneNumber })
      } catch (e) {
        console.error('[auth/phone] 解密手机号失败:', e.message)
        return res.status(400).json({ error: '解密手机号失败: ' + e.message })
      }
    } else {
      return res.status(400).json({ error: 'missing phoneCode or (encryptedData, iv, loginCode)' })
    }
  } catch (e) {
    console.error('[auth/phone] 错误:', e.message)
    next(e)
  }
})

module.exports = router
