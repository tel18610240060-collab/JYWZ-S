const { query } = require('../db/query')

/**
 * 检查用户是否有权限回复某个帖子
 * @param {Object} post - 帖子对象，包含 reply_permission 字段
 * @param {number} userId - 用户ID
 * @returns {Promise<{canReply: boolean, reason?: string}>}
 */
async function checkReplyPermission(post, userId) {
  if (!post || !post.reply_permission) {
    return { canReply: true }
  }

  const permission = post.reply_permission

  // 所有人可回复
  if (permission === 'all') {
    return { canReply: true }
  }

  // 需要获取用户的累计打卡天数
  const userRows = await query(
    'SELECT total_checkin_days FROM users WHERE id = ? LIMIT 1',
    [userId]
  )

  if (!userRows || userRows.length === 0) {
    return { canReply: false, reason: '用户不存在' }
  }

  const totalCheckinDays = Number(userRows[0]?.total_checkin_days || 0)

  // 钻石以上：total_checkin_days >= 45
  if (permission === 'diamond+') {
    if (totalCheckinDays >= 45) {
      return { canReply: true }
    }
    return { canReply: false, reason: '需要钻石以上段位才能回复' }
  }

  // 黄金一以上：total_checkin_days >= 21
  if (permission === 'gold1+') {
    if (totalCheckinDays >= 21) {
      return { canReply: true }
    }
    return { canReply: false, reason: '需要黄金一以上段位才能回复' }
  }

  // 未知权限类型，默认不允许
  return { canReply: false, reason: '权限配置错误' }
}

module.exports = { checkReplyPermission }
