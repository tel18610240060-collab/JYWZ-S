const https = require('https')
const { config } = require('../config')

/**
 * 审核文本内容
 * @param {string} text - 要审核的文本
 * @returns {Promise<{passed: boolean, reason?: string, detail?: any}>}
 */
async function moderateText(text) {
  if (config.MODE === 'mock') {
    // Mock 模式：简单检查，包含明显违规词则拒绝
    const blockedWords = ['色情', '暴力', '政治', '广告']
    const hasBlocked = blockedWords.some(word => text.includes(word))
    return {
      passed: !hasBlocked,
      reason: hasBlocked ? '包含违规内容' : undefined
    }
  }

  if (!config.DOUYIN_APPID || !config.DOUYIN_SECRET) {
    // 如果没有配置，默认通过（开发环境）
    console.error('[moderation] Missing DOUYIN_APPID/DOUYIN_SECRET, skipping moderation')
    return { passed: true }
  }

  try {
    // 注意：抖音内容审核API需要access_token，但小程序场景下可能需要不同的认证方式
    // 这里先实现基础结构，实际使用时需要根据抖音API文档调整认证方式
    // 暂时在mock模式下简单检查，生产环境需要配置正确的认证
    
    // TODO: 实现完整的抖音内容审核API调用
    // 当前先使用简单规则检查，避免影响功能开发
    const blockedWords = ['色情', '暴力', '政治', '广告', '诈骗']
    const hasBlocked = blockedWords.some(word => text.includes(word))
    
    if (hasBlocked) {
      return {
        passed: false,
        reason: '内容不符合规范'
      }
    }

    return { passed: true }
  } catch (e) {
    console.error('[moderation] Text moderation failed:', e.message)
    // 审核服务异常时，为了不影响用户体验，默认通过（但记录日志）
    return { passed: true, reason: '审核服务异常，已通过' }
  }
}

/**
 * 审核图片内容
 * @param {string} imageUrl - 图片URL
 * @returns {Promise<{passed: boolean, reason?: string, detail?: any}>}
 */
async function moderateImage(imageUrl) {
  if (config.MODE === 'mock') {
    // Mock 模式：默认通过
    return { passed: true }
  }

  // 注意：抖音开放平台可能没有独立的图片审核API
  // 这里先返回通过，后续可以根据实际情况调整
  // 或者使用第三方图片审核服务（如阿里云、腾讯云等）
  console.warn('[moderation] Image moderation not fully implemented, defaulting to pass')
  return { passed: true }
}

/**
 * 审核评论（文本+图片）
 * @param {Object} commentData - 评论数据 {content?: string, imageUrls?: string[]}
 * @returns {Promise<{passed: boolean, reason?: string}>}
 */
async function moderateComment(commentData) {
  const { content, imageUrls } = commentData || {}

  // 审核文本
  if (content) {
    const textResult = await moderateText(content)
    if (!textResult.passed) {
      return { passed: false, reason: textResult.reason || '文本内容不符合规范' }
    }
  }

  // 审核图片（如果有）
  if (imageUrls && Array.isArray(imageUrls) && imageUrls.length > 0) {
    for (const imageUrl of imageUrls) {
      const imageResult = await moderateImage(imageUrl)
      if (!imageResult.passed) {
        return { passed: false, reason: imageResult.reason || '图片内容不符合规范' }
      }
    }
  }

  return { passed: true }
}

module.exports = {
  moderateText,
  moderateImage,
  moderateComment
}
