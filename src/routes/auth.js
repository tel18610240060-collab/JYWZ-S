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

    console.log('[auth/login] 收到登录请求，code:', code ? code.substring(0, 10) + '...' : 'empty')
    
    try {
      const s = await code2session(code)
      console.log('[auth/login] code2session 成功，openid:', s.openid ? s.openid.substring(0, 10) + '...' : 'empty')
      
      const nickname = (userInfo && (userInfo.nickName || userInfo.nickname)) || '未命名用户'
      const avatarUrl = (userInfo && (userInfo.avatarUrl || userInfo.avatar_url)) || ''
      
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
            console.log('[auth/login] 使用 phoneLoginCode 获取 session_key 用于解密手机号')
          } catch (phoneSessionError) {
            console.error('[auth/login] 获取手机号 session_key 失败:', phoneSessionError.message)
            // 如果失败，尝试使用登录的 session_key
          }
        }
        
        if (sessionKeyForPhone) {
          try {
            const phoneInfo = decryptPhoneNumber(encryptedData, iv, sessionKeyForPhone)
            phoneNumber = phoneInfo.phoneNumber || phoneInfo.purePhoneNumber
            console.log('[auth/login] 解密手机号成功:', phoneNumber ? phoneNumber.substring(0, 3) + '****' : 'none')
          } catch (decryptError) {
            console.error('[auth/login] 解密手机号失败:', decryptError.message)
          }
        }
      } else if (phoneCode) {
        // 新方式：使用 phoneCode（需要RSA加密，暂不支持）
        console.warn('[auth/login] 新方式获取手机号暂不支持，请使用旧方式')
      }

      const user = await upsertUserByOpenid({
        openid: s.openid,
        unionid: s.unionid,
        nickname,
        avatarUrl,
        phoneNumber
      })

      const token = await createSession(user.id)
      console.log('[auth/login] 登录成功，user_id:', user.id, 'phoneNumber:', phoneNumber ? '***' : 'none')
      res.json({ token, user })
    } catch (code2sessionError) {
      console.error('[auth/login] code2session 失败:')
      console.error('[auth/login] error message:', code2sessionError.message)
      console.error('[auth/login] error detail:', code2sessionError.detail)
      console.error('[auth/login] error statusCode:', code2sessionError.statusCode)
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
      console.log('[auth/phone] 收到新方式 phoneCode')
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
        
        console.log('[auth/phone] 手机号解密成功:', phoneNumber ? phoneNumber.substring(0, 3) + '****' : 'none')
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
