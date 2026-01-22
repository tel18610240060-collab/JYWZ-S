const https = require('https')
const { config } = require('./config')

function postJsonHttps({ hostname, path, bodyObj }) {
  const body = JSON.stringify(bodyObj)

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      },
      (res) => {
        let raw = ''
        res.on('data', (c) => (raw += c))
        res.on('end', () => {
          try {
            const json = JSON.parse(raw || '{}')
            resolve({ statusCode: res.statusCode || 0, data: json })
          } catch (e) {
            reject(e)
          }
        })
      }
    )

    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

function formEncode(obj) {
  return Object.entries(obj)
    .filter(([, v]) => typeof v !== 'undefined' && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&')
}

function postFormHttps({ hostname, path, formObj }) {
  const body = formEncode(formObj)

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body)
        }
      },
      (res) => {
        let raw = ''
        res.on('data', (c) => (raw += c))
        res.on('end', () => {
          try {
            const json = JSON.parse(raw || '{}')
            resolve({ statusCode: res.statusCode || 0, data: json })
          } catch (e) {
            reject(e)
          }
        })
      }
    )

    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

function postMultipartHttps({ hostname, path, fields }) {
  const boundary = `----douyinForm${Date.now()}`

  const parts = []
  for (const [k, v] of Object.entries(fields || {})) {
    if (typeof v === 'undefined' || v === null) continue
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${String(v)}\r\n`,
        'utf8'
      )
    )
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'))
  const body = Buffer.concat(parts)

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname,
        path,
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length
        }
      },
      (res) => {
        let raw = ''
        res.on('data', (c) => (raw += c))
        res.on('end', () => {
          try {
            const json = JSON.parse(raw || '{}')
            resolve({ statusCode: res.statusCode || 0, data: json })
          } catch (e) {
            reject(e)
          }
        })
      }
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

function getJsonHttps({ hostname, path, headers }) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname,
        path,
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...(headers || {})
        }
      },
      (res) => {
        let raw = ''
        res.on('data', (c) => (raw += c))
        res.on('end', () => {
          try {
            const json = JSON.parse(raw || '{}')
            resolve({ statusCode: res.statusCode || 0, data: json })
          } catch (e) {
            reject(e)
          }
        })
      }
    )
    req.on('error', reject)
    req.end()
  })
}

async function code2session(code) {
  if (config.MODE === 'mock') {
    return { openid: 'mock_openid', unionid: 'mock_unionid', session_key: 'mock_session_key' }
  }

  console.log('[douyin] code2session 调用，MODE:', config.MODE)
  console.log('[douyin] DOUYIN_APPID:', config.DOUYIN_APPID ? config.DOUYIN_APPID.substring(0, 10) + '...' : 'empty')
  console.log('[douyin] DOUYIN_SECRET:', config.DOUYIN_SECRET ? '***' : 'empty')
  console.log('[douyin] IS_SANDBOX:', config.IS_SANDBOX)

  if (!config.DOUYIN_APPID || !config.DOUYIN_SECRET) {
    console.error('[douyin] 缺少 DOUYIN_APPID 或 DOUYIN_SECRET')
    const err = new Error('missing DOUYIN_APPID/DOUYIN_SECRET')
    err.statusCode = 500
    throw err
  }

  const hostname = config.IS_SANDBOX === '1' ? 'open-sandbox.douyin.com' : 'developer.toutiao.com'
  const path = '/api/apps/v2/jscode2session'

  console.log('[douyin] 调用抖音 API，hostname:', hostname, 'path:', path)
  
  const { data } = await postJsonHttps({
    hostname,
    path,
    bodyObj: {
      appid: config.DOUYIN_APPID,
      secret: config.DOUYIN_SECRET,
      code,
      anonymous_code: ''
    }
  })

  console.log('[douyin] 抖音 API 响应，err_no:', data.err_no, 'err_tips:', data.err_tips)

  if (data.err_no && data.err_no !== 0) {
    console.error('[douyin] code2session 失败，err_no:', data.err_no, 'err_tips:', data.err_tips)
    const err = new Error(data.err_tips || 'code2session failed')
    err.statusCode = 502
    err.detail = data
    throw err
  }

  const d = data.data || {}
  return {
    openid: d.openid,
    unionid: d.unionid,
    session_key: d.session_key
  }
}

async function exchangeOpenAuthTicket(ticket) {
  if (config.MODE === 'mock') {
    return {
      access_token: 'mock_open_access_token',
      expires_in: 15 * 24 * 3600,
      refresh_token: 'mock_open_refresh_token',
      refresh_expires_in: 30 * 24 * 3600,
      open_id: 'mock_open_id',
      scope: 'ma.user.data'
    }
  }

  if (!config.DOUYIN_APPID || !config.DOUYIN_SECRET) {
    const err = new Error('missing DOUYIN_APPID/DOUYIN_SECRET')
    err.statusCode = 500
    throw err
  }

  // open auth ticket -> open platform access_token（与 showDouyinOpenAuth 的 ticket 配套）
  const hostname = 'open.douyin.com'
  const path = '/oauth/access_token/'

  const { data, statusCode } = await postFormHttps({
    hostname,
    path,
    formObj: {
      client_key: config.DOUYIN_APPID,
      client_secret: config.DOUYIN_SECRET,
      code: ticket,
      grant_type: 'authorization_code'
    }
  })

  if (statusCode < 200 || statusCode >= 300) {
    const err = new Error(`oauth access_token http ${statusCode}`)
    err.statusCode = 502
    err.detail = data
    throw err
  }

  const d = (data && data.data) || {}
  const errCode = Number(d.error_code ?? data.error_code ?? data.err_no ?? 0)
  if (errCode !== 0) {
    const err = new Error(d.description || data.err_tips || data.message || 'oauth access_token failed')
    err.statusCode = 502
    err.detail = data
    throw err
  }

  return {
    access_token: d.access_token,
    expires_in: Number(d.expires_in || 0),
    refresh_token: d.refresh_token,
    refresh_expires_in: Number(d.refresh_expires_in || 0),
    open_id: d.open_id || d.openid || null,
    scope: d.scope || null
  }
}

async function refreshAccessToken({ refreshToken }) {
  if (config.MODE === 'mock') {
    return {
      access_token: 'mock_open_access_token_2',
      expires_in: 15 * 24 * 3600,
      refresh_token: refreshToken || 'mock_open_refresh_token',
      refresh_expires_in: 30 * 24 * 3600,
      open_id: 'mock_open_id',
      scope: 'following.list,fans.list'
    }
  }

  const hostname = 'open.douyin.com'
  const path = '/oauth/refresh_token/'

  // 文档要求 multipart/form-data
  const { data, statusCode } = await postMultipartHttps({
    hostname,
    path,
    fields: {
      client_key: config.DOUYIN_APPID,
      client_secret: config.DOUYIN_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    }
  })

  if (statusCode < 200 || statusCode >= 300) {
    const err = new Error(`oauth refresh_token http ${statusCode}`)
    err.statusCode = 502
    err.detail = data
    throw err
  }

  const d = (data && data.data) || {}
  const errCode = Number(d.error_code ?? data.error_code ?? 0)
  if (errCode !== 0) {
    const err = new Error(d.description || data.message || 'oauth refresh_token failed')
    err.statusCode = 502
    err.detail = data
    throw err
  }

  return {
    access_token: d.access_token,
    expires_in: Number(d.expires_in || 0),
    refresh_token: d.refresh_token,
    refresh_expires_in: Number(d.refresh_expires_in || 0),
    open_id: d.open_id || null,
    scope: d.scope || null
  }
}

async function getFollowingList({ accessToken, openId, cursor = 0, count = 50 }) {
  const hostname = 'open.douyin.com'
  const qs = formEncode({ open_id: openId, cursor, count })
  const path = `/following/list/?${qs}`
  const { data, statusCode } = await getJsonHttps({
    hostname,
    path,
    headers: { 'Content-Type': 'application/json', 'access-token': accessToken }
  })

  if (statusCode < 200 || statusCode >= 300) {
    const err = new Error(`following/list http ${statusCode}`)
    err.statusCode = 502
    err.detail = data
    throw err
  }
  const d = (data && data.data) || {}
  const errCode = Number(d.error_code ?? 0)
  if (errCode !== 0) {
    const err = new Error(d.description || 'following/list failed')
    err.statusCode = 502
    err.detail = data
    throw err
  }
  return d
}

async function getFansList({ accessToken, openId, cursor = 0, count = 50 }) {
  const hostname = 'open.douyin.com'
  const qs = formEncode({ open_id: openId, cursor, count })
  const path = `/fans/list/?${qs}`
  const { data, statusCode } = await getJsonHttps({
    hostname,
    path,
    headers: { 'Content-Type': 'application/json', 'access-token': accessToken }
  })

  if (statusCode < 200 || statusCode >= 300) {
    const err = new Error(`fans/list http ${statusCode}`)
    err.statusCode = 502
    err.detail = data
    throw err
  }
  const d = (data && data.data) || {}
  const errCode = Number(d.error_code ?? 0)
  if (errCode !== 0) {
    const err = new Error(d.description || 'fans/list failed')
    err.statusCode = 502
    err.detail = data
    throw err
  }
  return d
}

// 获取手机号（新方式，基础库 >=3.51.0）
// 注意：此接口需要应用公钥/私钥RSA加密，实现较复杂
// 建议优先使用旧方式（encryptedData + iv 解密）
async function getPhoneNumber(phoneCode) {
  if (config.MODE === 'mock') {
    return { phoneNumber: '13800138000', purePhoneNumber: '13800138000', countryCode: '86' }
  }

  // 新方式需要RSA加密等复杂处理，暂时返回错误提示使用旧方式
  const err = new Error('新方式获取手机号需要RSA加密，请使用旧方式（encryptedData + iv）')
  err.statusCode = 400
  throw err
}

// 解密手机号（旧方式，使用 encryptedData + iv）
function decryptPhoneNumber(encryptedData, iv, sessionKey) {
  const crypto = require('crypto')
  
  try {
    const key = Buffer.from(sessionKey, 'base64')
    const ivBuf = Buffer.from(iv, 'base64')
    const encryptedBuf = Buffer.from(encryptedData, 'base64')
    
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, ivBuf)
    decipher.setAutoPadding(true)
    
    let decoded = decipher.update(encryptedBuf, undefined, 'utf8')
    decoded += decipher.final('utf8')
    
    const dataObj = JSON.parse(decoded)
    return {
      phoneNumber: dataObj.phoneNumber,
      purePhoneNumber: dataObj.purePhoneNumber,
      countryCode: dataObj.countryCode || '86'
    }
  } catch (e) {
    throw new Error('解密手机号失败: ' + e.message)
  }
}

module.exports = {
  code2session,
  exchangeOpenAuthTicket,
  refreshAccessToken,
  getFollowingList,
  getFansList,
  getPhoneNumber,
  decryptPhoneNumber
}
