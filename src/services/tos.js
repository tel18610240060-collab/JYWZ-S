/**
 * 抖音云 TOS 对象存储上传服务
 * 使用 @volcengine/tos-sdk
 */
const { TosClient } = require('@volcengine/tos-sdk')
const { config } = require('../config')

let _client = null

function getTosClient() {
  if (_client) return _client
  const { TOS_ACCESS_KEY_ID, TOS_SECRET_ACCESS_KEY, TOS_REGION, TOS_BUCKET } = config
  if (!TOS_ACCESS_KEY_ID || !TOS_SECRET_ACCESS_KEY || !TOS_BUCKET) {
    throw new Error('TOS 配置不完整，请设置 TOS_ACCESS_KEY_ID、TOS_SECRET_ACCESS_KEY、TOS_BUCKET')
  }
  // 地域对应 endpoint：cn-beijing -> tos-cn-beijing.volces.com（仅主机名）
  const endpoint = `tos-${TOS_REGION}.volces.com`
  _client = new TosClient({
    accessKeyId: TOS_ACCESS_KEY_ID,
    accessKeySecret: TOS_SECRET_ACCESS_KEY,
    region: TOS_REGION,
    endpoint
  })
  return _client
}

/**
 * 上传 Buffer 到 TOS
 * @param {Buffer} buffer - 文件内容
 * @param {string} key - 对象键（路径），如 uploads/2025/01/xxx.jpg
 * @param {string} contentType - MIME 类型
 * @returns {Promise<string>} - 返回可访问的完整 URL
 */
async function uploadBuffer(buffer, key, contentType = 'image/jpeg') {
  const client = getTosClient()
  const { TOS_BUCKET, TOS_PUBLIC_URL } = config

  // 先上传对象
  await client.putObject({
    bucket: TOS_BUCKET,
    key,
    body: buffer,
    contentLength: buffer.length,
    contentType
  })
  // 设置对象为公开读，避免访问时返回 403
  try {
    await client.setObjectAcl({
      bucket: TOS_BUCKET,
      key,
      acl: 'public-read'
    })
  } catch (aclError) {
    // 如果设置 ACL 失败，记录警告但不阻断流程（可能 bucket 已设置公开读，或需要单独配置）
    console.warn('[tos] setObjectAcl 失败，key:', key, 'error:', aclError.message)
  }

  // 返回公网可访问的 URL
  if (TOS_PUBLIC_URL) {
    const base = TOS_PUBLIC_URL.replace(/\/$/, '')
    const url = `${base}/${key}`
    return url
  }
  // 默认格式：https://{bucket}.tos-{region}.volces.com/{key}
  const region = config.TOS_REGION || 'cn-beijing'
  const url = `https://${TOS_BUCKET}.tos-${region}.volces.com/${key}`
  return url
}

module.exports = { getTosClient, uploadBuffer }
