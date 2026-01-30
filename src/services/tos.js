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

  await client.putObject({
    bucket: TOS_BUCKET,
    key,
    body: buffer,
    contentLength: buffer.length,
    contentType
  })

  // 返回公网可访问的 URL
  if (TOS_PUBLIC_URL) {
    const base = TOS_PUBLIC_URL.replace(/\/$/, '')
    return `${base}/${key}`
  }
  // 默认格式：https://{bucket}.tos-{region}.volces.com/{key}
  const region = config.TOS_REGION || 'cn-beijing'
  return `https://${TOS_BUCKET}.tos-${region}.volces.com/${key}`
}

module.exports = { getTosClient, uploadBuffer }
