const express = require('express')
const { requireAuth } = require('../auth')
const { query, exec } = require('../db/query')
const { checkReplyPermission } = require('../middleware/rankPermission')
const { moderateComment } = require('../services/contentModeration')

const router = express.Router()

// 辅助函数：解析 image_urls 字段（兼容旧数据格式）
function parseImageUrls(imageUrls) {
  if (!imageUrls) return null
  
  // MySQL JSON 类型字段会被自动解析为 JavaScript 对象/数组
  // 如果已经是数组，直接返回
  if (Array.isArray(imageUrls)) {
    return imageUrls
  }
  
  // 如果是对象（可能是解析后的 JSON），尝试提取数组
  if (typeof imageUrls === 'object' && imageUrls !== null) {
    // 如果对象有数组属性，返回该数组
    if (Array.isArray(imageUrls.urls)) {
      return imageUrls.urls
    }
    // 否则尝试转换为数组
    return [imageUrls]
  }
  
  // 如果是字符串，尝试解析
  if (typeof imageUrls === 'string') {
    try {
      // 检查是否是 JSON 格式
      if (imageUrls.trim().startsWith('[') || imageUrls.trim().startsWith('{')) {
        const parsed = JSON.parse(imageUrls)
        // 如果解析后是数组，返回数组
        if (Array.isArray(parsed)) {
          return parsed
        }
        // 如果是对象，尝试提取数组
        if (parsed && Array.isArray(parsed.urls)) {
          return parsed.urls
        }
        // 否则返回包含对象的数组
        return [parsed]
      } else {
        // 旧数据可能是单个字符串路径，转换为数组
        return [imageUrls]
      }
    } catch (e) {
      // 解析失败时，如果是字符串，尝试作为单个URL
      return [imageUrls]
    }
  }
  
  return null
}

// 同日戒烟固定帖子的评论接口
router.get('/same-day/special-post/comments', requireAuth, async (req, res, next) => {
  try {
    // 获取当前用户的戒烟日期
    let me
    try {
      me = await query('SELECT quit_date FROM users WHERE id=? LIMIT 1', [req.user.id])
    } catch (dbError) {
      console.error('[groups] Database error in same-day/special-post/comments GET (query user):', dbError.message, dbError.stack)
      return res.status(500).json({ error: '数据库操作异常，请稍后重试', code: 'DB_ERROR' })
    }
    
    const quitDate = me[0] && me[0].quit_date
    if (!quitDate) {
      return res.json([])
    }

    // 查询所有同一戒烟日期的用户对该固定帖子的评论
    // 固定帖子的 post_id 为 NULL，group_type 为 'same-day'，通过 user_id 的 quit_date 来判断
    let rows
    try {
      rows = await query(
        `SELECT c.*, u.nickname, u.avatar_url,
                (SELECT COUNT(*) FROM comments c2 
                 WHERE c2.parent_comment_id = c.id AND c2.moderation_status='approved') AS reply_count
         FROM comments c
         JOIN users u ON u.id=c.user_id
         WHERE c.post_id IS NULL 
         AND c.group_type = 'same-day'
         AND u.quit_date = ?
         AND c.moderation_status='approved'
         AND c.parent_comment_id IS NULL
         ORDER BY c.created_at DESC`,
        [quitDate]
      )
    } catch (dbError) {
      console.error('[groups] Database error in same-day/special-post/comments GET:', dbError.message, dbError.stack)
      return res.status(500).json({ error: '数据库操作异常，请稍后重试', code: 'DB_ERROR' })
    }

    // 获取点赞信息
    const commentIds = (rows || []).map(c => c.id)
    let likesMap = {}
    let userLikesSet = new Set()
    
    if (commentIds.length > 0) {
      try {
        const likeRows = await query(
          `SELECT comment_id, COUNT(*) AS count 
           FROM comment_likes 
           WHERE comment_id IN (${commentIds.map(() => '?').join(',')})
           GROUP BY comment_id`,
          commentIds
        )
        likesMap = (likeRows || []).reduce((acc, row) => {
          acc[row.comment_id] = Number(row.count || 0)
          return acc
        }, {})
        
        const userLikeRows = await query(
          `SELECT comment_id 
           FROM comment_likes 
           WHERE comment_id IN (${commentIds.map(() => '?').join(',')}) AND user_id = ?`,
          [...commentIds, req.user.id]
        )
        userLikesSet = new Set((userLikeRows || []).map(r => r.comment_id))
      } catch (dbError) {
        console.error('[groups] Database error in same-day/special-post/comments GET (query likes):', dbError.message, dbError.stack)
      }
    }

    // 解析 image_urls JSON 字段
    const comments = (rows || []).map(c => {
      const parsedImageUrls = parseImageUrls(c.image_urls)
      return {
        ...c,
        image_urls: parsedImageUrls,
        like_count: Number(c.like_count || likesMap[c.id] || 0),
        liked: userLikesSet.has(c.id),
        reply_count: Number(c.reply_count || 0)
      }
    })

    res.json(comments)
  } catch (e) {
    console.error('[groups] Unexpected error in same-day/special-post/comments GET:', e.message, e.stack)
    next(e)
  }
})

router.post('/same-day/special-post/comments', requireAuth, async (req, res, next) => {
  try {
    // 获取当前用户的戒烟日期
    let me
    try {
      me = await query('SELECT quit_date FROM users WHERE id=? LIMIT 1', [req.user.id])
    } catch (dbError) {
      console.error('[groups] Database error in same-day/special-post/comments POST (query user):', dbError.message, dbError.stack)
      return res.status(500).json({ error: '数据库操作异常，请稍后重试', code: 'DB_ERROR' })
    }
    
    const quitDate = me[0] && me[0].quit_date
    if (!quitDate) {
      return res.status(400).json({ error: '请先设置戒烟日期' })
    }

    const { content, imageUrls } = req.body || {}

    if (!content && (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0)) {
      return res.status(400).json({ error: 'missing content or imageUrls' })
    }

    // 内容审核
    const moderationResult = await moderateComment({ content, imageUrls })
    const moderationStatus = moderationResult.passed ? 'approved' : 'rejected'
    const moderationResultJson = moderationResult.passed ? null : JSON.stringify({ reason: moderationResult.reason })

    // 插入评论（post_id 为 NULL，表示这是固定帖子的评论，group_type 为 'same-day' 表示同日小组）
    try {
      await exec(
        'INSERT INTO comments(post_id, user_id, content, image_urls, moderation_status, moderation_result, parent_comment_id, reply_to_user_id, like_count, group_type) VALUES(?,?,?,?,?,?,?,?,?,?)',
        [
          null, // post_id 为 NULL，表示固定帖子
          req.user.id,
          content || '',
          imageUrls ? JSON.stringify(imageUrls) : null,
          moderationStatus,
          moderationResultJson,
          null, // parent_comment_id - 回复帖子时为空
          null, // reply_to_user_id - 回复帖子时为空
          0, // like_count - 初始为0
          'same-day' // group_type - 同日戒烟小组
        ]
      )
    } catch (dbError) {
      console.error('[groups] Database error in same-day/special-post/comments POST (insert):', dbError.message, dbError.stack)
      return res.status(500).json({ error: '数据库操作异常，请稍后重试', code: 'DB_ERROR' })
    }

    // 如果审核失败，返回错误信息
    if (!moderationResult.passed) {
      return res.status(400).json({ error: moderationResult.reason || '内容不符合规范' })
    }

    // 返回评论列表（仅审核通过的，只返回顶级评论）
    let rows
    try {
      rows = await query(
        `SELECT c.*, u.nickname, u.avatar_url,
                (SELECT COUNT(*) FROM comments c2 
                 WHERE c2.parent_comment_id = c.id AND c2.moderation_status='approved') AS reply_count
         FROM comments c
         JOIN users u ON u.id=c.user_id
         WHERE c.post_id IS NULL 
         AND c.group_type = 'same-day'
         AND u.quit_date = ?
         AND c.moderation_status='approved'
         AND c.parent_comment_id IS NULL
         ORDER BY c.created_at DESC`,
        [quitDate]
      )
    } catch (dbError) {
      console.error('[groups] Database error in same-day/special-post/comments POST (query):', dbError.message, dbError.stack)
      return res.status(500).json({ error: '数据库操作异常，请稍后重试', code: 'DB_ERROR' })
    }

    // 获取点赞信息
    const commentIds = (rows || []).map(c => c.id)
    let likesMap = {}
    let userLikesSet = new Set()
    
    if (commentIds.length > 0) {
      try {
        const likeRows = await query(
          `SELECT comment_id, COUNT(*) AS count 
           FROM comment_likes 
           WHERE comment_id IN (${commentIds.map(() => '?').join(',')})
           GROUP BY comment_id`,
          commentIds
        )
        likesMap = (likeRows || []).reduce((acc, row) => {
          acc[row.comment_id] = Number(row.count || 0)
          return acc
        }, {})
        
        const userLikeRows = await query(
          `SELECT comment_id 
           FROM comment_likes 
           WHERE comment_id IN (${commentIds.map(() => '?').join(',')}) AND user_id = ?`,
          [...commentIds, req.user.id]
        )
        userLikesSet = new Set((userLikeRows || []).map(r => r.comment_id))
      } catch (dbError) {
        console.error('[groups] Database error in same-day/special-post/comments POST (query likes):', dbError.message, dbError.stack)
      }
    }

    // 解析 image_urls JSON 字段
    const comments = (rows || []).map(c => {
      try {
        return {
          ...c,
          image_urls: parseImageUrls(c.image_urls),
          like_count: Number(c.like_count || likesMap[c.id] || 0),
          liked: userLikesSet.has(c.id),
          reply_count: Number(c.reply_count || 0)
        }
      } catch (e) {
        console.error('[groups] Failed to parse image_urls:', e)
        return {
          ...c,
          image_urls: null,
          like_count: Number(c.like_count || likesMap[c.id] || 0),
          liked: userLikesSet.has(c.id),
          reply_count: Number(c.reply_count || 0)
        }
      }
    })

    res.json(comments)
  } catch (e) {
    console.error('[groups] Unexpected error in same-day/special-post/comments POST:', e.message, e.stack)
    next(e)
  }
})

// 同日戒烟群组：以 quit_date 作为 group_key
router.get('/same-day/summary', requireAuth, async (req, res, next) => {
  try {
    const me = await query('SELECT quit_date, region FROM users WHERE id=? LIMIT 1', [req.user.id])
    const quitDate = me[0] && me[0].quit_date
    const userRegion = me[0] && me[0].region
    if (!quitDate) {
      return res.json({ group_key: null, total: 0, active: 0, failed: 0, reduction: 0, cityTotal: 0 })
    }

    // 目前把“坚持中/失败/消失”先做占位：默认都算坚持中
    // 统计总数
    const totalRows = await query('SELECT COUNT(*) AS c FROM users WHERE quit_date=?', [quitDate])
    const total = Number(totalRows[0]?.c || 0)

    // 统计失败数：戒烟日期相同且累计打卡天数为0的用户
    const failedRows = await query(
      'SELECT COUNT(*) AS c FROM users WHERE quit_date=? AND total_checkin_days=0',
      [quitDate]
    )
    const failed = Number(failedRows[0]?.c || 0)

    // 统计幸存数：戒烟日期相同且累计打卡天数>0的用户
    const activeRows = await query(
      'SELECT COUNT(*) AS c FROM users WHERE quit_date=? AND total_checkin_days>0',
      [quitDate]
    )
    const active = Number(activeRows[0]?.c || 0)

    // 统计同城戒烟人数：戒烟日期相同且地区相同的用户
    let cityTotal = 0
    if (userRegion) {
      const cityRows = await query(
        'SELECT COUNT(*) AS c FROM users WHERE quit_date=? AND region=?',
        [quitDate, userRegion]
      )
      cityTotal = Number(cityRows[0]?.c || 0)
    }

    // 较昨天减员数：暂时设为0（如需计算，需要额外逻辑）
    const reduction = 0

    const result = { 
      group_key: quitDate, 
      total, 
      active, 
      failed, 
      reduction,
      cityTotal
    }
    
    res.json(result)
  } catch (e) {
    next(e)
  }
})

router.get('/same-day/posts', requireAuth, async (req, res, next) => {
  try {
    let me
    try {
      me = await query('SELECT quit_date FROM users WHERE id=? LIMIT 1', [req.user.id])
    } catch (dbError) {
      console.error('[groups] Database error in same-day/posts (query user):', dbError.message, dbError.stack)
      return res.status(500).json({ error: '数据库操作异常，请稍后重试', code: 'DB_ERROR' })
    }
    
    const quitDate = me[0] && me[0].quit_date
    if (!quitDate) {
      // 如果没有戒烟日期，只返回固定帖子
      const specialPost = {
        id: 'special_same_day',
        _isSpecialPost: true,
        title: '今天开始戒烟的勇士们 是什么促使你们戒烟的 都来说一说',
        content: '今天开始戒烟的勇士们 是什么促使你们戒烟的 都来说一说',
        group_key: null,
        created_at: new Date().toISOString(),
        last_reply_at: null,
        user_id: null,
        nickname: '系统',
        avatar_url: ''
      }
      return res.json([specialPost])
    }

    let rows
    try {
      rows = await query(
        `SELECT p.*, u.nickname, u.avatar_url
         FROM posts p
         JOIN users u ON u.id=p.user_id
         WHERE p.group_key=?
         ORDER BY COALESCE(p.last_reply_at, p.created_at) DESC
         LIMIT 100`,
        [quitDate]
      )
    } catch (dbError) {
      console.error('[groups] Database error in same-day/posts (query posts):', dbError.message, dbError.stack)
      return res.status(500).json({ error: '数据库操作异常，请稍后重试', code: 'DB_ERROR' })
    }
    
    // 创建固定帖子对象（放在列表最前面）
    const specialPost = {
      id: `special_same_day_${quitDate}`, // 使用特殊ID标识
      _isSpecialPost: true, // 标识这是固定帖子
      title: '今天开始戒烟的勇士们 是什么促使你们戒烟的 都来说一说',
      content: '今天开始戒烟的勇士们 是什么促使你们戒烟的 都来说一说',
      group_key: quitDate,
      created_at: new Date().toISOString(),
      last_reply_at: null,
      user_id: null,
      nickname: '系统',
      avatar_url: ''
    }
    
    // 查询固定帖子的最新回复时间
    try {
      const latestReplyRows = await query(
        `SELECT MAX(created_at) AS last_reply_at
         FROM comments c
         JOIN users u ON u.id=c.user_id
         WHERE c.post_id IS NULL 
         AND EXISTS (
           SELECT 1 FROM users u2 
           WHERE u2.quit_date = ? 
           AND u2.id = c.user_id
         )
         AND c.moderation_status='approved'
         LIMIT 1`,
        [quitDate]
      )
      if (latestReplyRows && latestReplyRows.length > 0 && latestReplyRows[0].last_reply_at) {
        specialPost.last_reply_at = latestReplyRows[0].last_reply_at
      }
    } catch (dbError) {
      // 查询失败不影响主流程
      console.error('[groups] Failed to query special post last_reply_at:', dbError.message)
    }
    
    // 将固定帖子放在最前面
    res.json([specialPost, ...(rows || [])])
  } catch (e) {
    console.error('[groups] Unexpected error in same-day/posts:', e.message, e.stack)
    next(e)
  }
})

router.post('/same-day/posts', requireAuth, async (req, res, next) => {
  try {
    let me
    try {
      me = await query('SELECT quit_date FROM users WHERE id=? LIMIT 1', [req.user.id])
    } catch (dbError) {
      console.error('[groups] Database error in same-day/posts POST (query user):', dbError.message, dbError.stack)
      return res.status(500).json({ error: '数据库操作异常，请稍后重试', code: 'DB_ERROR' })
    }
    
    const quitDate = me[0] && me[0].quit_date
    if (!quitDate) return res.status(400).json({ error: 'missing quit_date, set it first' })

    const { title, content, imageUrls } = req.body || {}
    if (!title) return res.status(400).json({ error: 'missing title' })

    let insertResult
    try {
      insertResult = await exec(
        `INSERT INTO posts(group_key, user_id, title, content, image_urls, last_reply_at)
         VALUES(?,?,?,?,?,NULL)`,
        [quitDate, req.user.id, title, content || '', imageUrls ? JSON.stringify(imageUrls) : null]
      )
    } catch (dbError) {
      console.error('[groups] Database error in same-day/posts POST (insert):', dbError.message, dbError.stack)
      return res.status(500).json({ error: '数据库操作异常，请稍后重试', code: 'DB_ERROR' })
    }

    let postRows
    try {
      postRows = await query('SELECT * FROM posts WHERE id=?', [insertResult.insertId])
    } catch (dbError) {
      console.error('[groups] Database error in same-day/posts POST (query after insert):', dbError.message, dbError.stack)
      return res.status(500).json({ error: '数据库操作异常，请稍后重试', code: 'DB_ERROR' })
    }
    
    if (!postRows || postRows.length === 0) {
      return res.status(500).json({ error: '创建帖子失败，请稍后重试', code: 'DB_ERROR' })
    }
    
    // 解析 image_urls JSON 字段
    const post = postRows[0]
    try {
      post.image_urls = parseImageUrls(post.image_urls)
    } catch (e) {
      console.error('[groups] Failed to parse image_urls:', e)
      post.image_urls = null
    }
    
    res.json(post)
  } catch (e) {
    console.error('[groups] Unexpected error in same-day/posts POST:', e.message, e.stack)
    next(e)
  }
})

router.post('/posts/:id/comments', requireAuth, async (req, res, next) => {
  try {
    const postId = Number(req.params.id)
    const { content, imageUrls } = req.body || {}

    if (!content && (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0)) {
      return res.status(400).json({ error: 'missing content or imageUrls' })
    }

    // 内容审核
    const moderationResult = await moderateComment({ content, imageUrls })
    const moderationStatus = moderationResult.passed ? 'approved' : 'rejected'
    const moderationResultJson = moderationResult.passed ? null : JSON.stringify({ reason: moderationResult.reason })

    try {
      await exec(
        'INSERT INTO comments(post_id, user_id, content, image_urls, moderation_status, moderation_result, parent_comment_id, reply_to_user_id, like_count) VALUES(?,?,?,?,?,?,?,?,?)',
        [
          postId,
          req.user.id,
          content || '',
          imageUrls ? JSON.stringify(imageUrls) : null,
          moderationStatus,
          moderationResultJson,
          null, // parent_comment_id - 回复帖子时为空
          null, // reply_to_user_id - 回复帖子时为空
          0 // like_count - 初始为0
        ]
      )
      await exec('UPDATE posts SET last_reply_at=NOW() WHERE id=?', [postId])
    } catch (dbError) {
      console.error('[groups] Database error in posts/:id/comments POST:', dbError.message, dbError.stack)
      return res.status(500).json({ error: '数据库操作异常，请稍后重试', code: 'DB_ERROR' })
    }

    // 如果审核失败，返回错误信息
    if (!moderationResult.passed) {
      return res.status(400).json({ error: moderationResult.reason || '内容不符合规范' })
    }

    // 返回评论列表（仅审核通过的，只返回顶级评论）
    let rows
    try {
      rows = await query(
        `SELECT c.*, u.nickname, u.avatar_url,
                (SELECT COUNT(*) FROM comments c2 
                 WHERE c2.parent_comment_id = c.id AND c2.moderation_status='approved') AS reply_count
         FROM comments c
         JOIN users u ON u.id=c.user_id
         WHERE c.post_id=? AND c.moderation_status='approved' AND c.parent_comment_id IS NULL
         ORDER BY c.created_at ASC`,
        [postId]
      )
    } catch (dbError) {
      console.error('[groups] Database error in posts/:id/comments POST (query):', dbError.message, dbError.stack)
      // 即使查询失败，评论已插入，返回空数组
      return res.json([])
    }

    // 解析 image_urls JSON 字段
    const comments = (rows || []).map(c => {
      try {
        return {
          ...c,
          image_urls: parseImageUrls(c.image_urls),
          reply_count: Number(c.reply_count || 0)
        }
      } catch (e) {
        console.error('[groups] Failed to parse image_urls:', e)
        return {
          ...c,
          image_urls: null,
          reply_count: Number(c.reply_count || 0)
        }
      }
    })

    res.json(comments)
  } catch (e) {
    console.error('[groups] Unexpected error in posts/:id/comments POST:', e.message, e.stack)
    next(e)
  }
})

router.get('/posts/:id/comments', requireAuth, async (req, res, next) => {
  try {
    const postId = Number(req.params.id)
    
    // 仅返回审核通过的评论（只返回顶级评论）
    let rows
    try {
      rows = await query(
        `SELECT c.*, u.nickname, u.avatar_url,
                (SELECT COUNT(*) FROM comments c2 
                 WHERE c2.parent_comment_id = c.id AND c2.moderation_status='approved') AS reply_count
         FROM comments c
         JOIN users u ON u.id=c.user_id
         WHERE c.post_id=? AND c.moderation_status='approved' AND c.parent_comment_id IS NULL
         ORDER BY c.created_at ASC`,
        [postId]
      )
    } catch (dbError) {
      console.error('[groups] Database error in posts/:id/comments GET:', dbError.message, dbError.stack)
      return res.status(500).json({ error: '数据库操作异常，请稍后重试', code: 'DB_ERROR' })
    }
    
    // 解析 image_urls JSON 字段，并获取点赞信息
    const commentIds = (rows || []).map(c => c.id)
    let likesMap = {}
    let userLikesSet = new Set()
    
    if (commentIds.length > 0) {
      try {
        // 获取所有评论的点赞数
        const likeRows = await query(
          `SELECT comment_id, COUNT(*) AS count 
           FROM comment_likes 
           WHERE comment_id IN (${commentIds.map(() => '?').join(',')})
           GROUP BY comment_id`,
          commentIds
        )
        likesMap = (likeRows || []).reduce((acc, row) => {
          acc[row.comment_id] = Number(row.count || 0)
          return acc
        }, {})
        
        // 获取当前用户已点赞的评论ID
        const userLikeRows = await query(
          `SELECT comment_id 
           FROM comment_likes 
           WHERE comment_id IN (${commentIds.map(() => '?').join(',')}) AND user_id = ?`,
          [...commentIds, req.user.id]
        )
        userLikesSet = new Set((userLikeRows || []).map(r => r.comment_id))
      } catch (dbError) {
        console.error('[groups] Database error in posts/:id/comments GET (query likes):', dbError.message, dbError.stack)
        // 点赞信息查询失败不影响主流程，继续返回评论
      }
    }
    
    const comments = (rows || []).map(c => {
      try {
        return {
          ...c,
          image_urls: parseImageUrls(c.image_urls),
          like_count: Number(c.like_count || likesMap[c.id] || 0),
          liked: userLikesSet.has(c.id),
          reply_count: Number(c.reply_count || 0)
        }
      } catch (e) {
        console.error('[groups] Failed to parse image_urls:', e)
        return {
          ...c,
          image_urls: null,
          like_count: Number(c.like_count || likesMap[c.id] || 0),
          liked: userLikesSet.has(c.id),
          reply_count: Number(c.reply_count || 0)
        }
      }
    })
    
    res.json(comments)
  } catch (e) {
    console.error('[groups] Unexpected error in posts/:id/comments GET:', e.message, e.stack)
    next(e)
  }
})

// 获取固定帖子的评论（与普通帖子评论接口分开，但逻辑相同）
router.get('/featured-posts/:id/comments', requireAuth, async (req, res, next) => {
  const postId = Number(req.params.id)
  
  try {
    if (!postId || isNaN(postId)) {
      return res.status(400).json({ error: 'invalid post id' })
    }
    
    // 注意：固定帖子的评论存储在 comments 表中，但 post_id 指向 featured_posts.id
    // 这里需要区分，或者使用统一的 comments 表（post_id 可以指向 posts 或 featured_posts）
    // 暂时使用相同的逻辑，后续可能需要调整表结构
    
    // 仅返回审核通过的评论（只返回顶级评论）
    let rows
    try {
      rows = await query(
        `SELECT c.*, u.nickname, u.avatar_url,
                (SELECT COUNT(*) FROM comments c2 
                 WHERE c2.parent_comment_id = c.id AND c2.moderation_status='approved') AS reply_count
         FROM comments c
         JOIN users u ON u.id=c.user_id
         WHERE c.post_id=? AND c.moderation_status='approved' AND c.parent_comment_id IS NULL
         ORDER BY c.created_at ASC`,
        [postId]
      )
    } catch (queryError) {
      console.error('[groups] Database query failed for featured-posts comments:', queryError.message, queryError.stack)
      return res.status(500).json({ error: 'database query failed', detail: queryError.message })
    }
    
    // 获取点赞信息
    const commentIds = (rows || []).map(c => c.id)
    let likesMap = {}
    let userLikesSet = new Set()
    
    if (commentIds.length > 0) {
      try {
        const likeRows = await query(
          `SELECT comment_id, COUNT(*) AS count 
           FROM comment_likes 
           WHERE comment_id IN (${commentIds.map(() => '?').join(',')})
           GROUP BY comment_id`,
          commentIds
        )
        likesMap = (likeRows || []).reduce((acc, row) => {
          acc[row.comment_id] = Number(row.count || 0)
          return acc
        }, {})
        
        const userLikeRows = await query(
          `SELECT comment_id 
           FROM comment_likes 
           WHERE comment_id IN (${commentIds.map(() => '?').join(',')}) AND user_id = ?`,
          [...commentIds, req.user.id]
        )
        userLikesSet = new Set((userLikeRows || []).map(r => r.comment_id))
      } catch (dbError) {
        console.error('[groups] Database error in featured-posts/:id/comments GET (query likes):', dbError.message, dbError.stack)
      }
    }
    
    // 处理 image_urls JSON 字段
    // 注意：MySQL JSON 字段在 mysql2 驱动中会自动解析为 JavaScript 对象/数组
    // 不需要手动 JSON.parse，但如果返回的是字符串则需要解析
    const comments = (rows || []).map(c => {
      try {
        const result = { ...c }
        
        // 处理 image_urls：如果是字符串则解析，否则直接使用
        if (c.image_urls) {
          if (typeof c.image_urls === 'string') {
            try {
              result.image_urls = parseImageUrls(c.image_urls)
            } catch (e) {
              console.error('[groups] Failed to parse image_urls JSON:', e.message)
              result.image_urls = null
            }
          } else {
            // 已经是对象或数组，直接使用
            result.image_urls = c.image_urls
          }
        } else {
          result.image_urls = null
        }
        
        // 添加点赞信息和回复数量
        result.like_count = Number(c.like_count || likesMap[c.id] || 0)
        result.liked = userLikesSet.has(c.id)
        result.reply_count = Number(c.reply_count || 0)
        
        return result
      } catch (e) {
        console.error('[groups] Failed to process comment:', e.message, e.stack)
        // 即使处理失败，也返回原始数据（避免整体失败）
        return {
          ...c,
          image_urls: null,
          like_count: Number(c.like_count || likesMap[c.id] || 0),
          liked: userLikesSet.has(c.id)
        }
      }
    })
    
    res.json(comments || [])
  } catch (e) {
    console.error('[groups] ERROR in featured-posts comments:', e.message, e.stack)
    next(e)
  }
})

router.post('/posts/:id/favorite', requireAuth, async (req, res, next) => {
  try {
    const postId = Number(req.params.id)
    try {
      await exec('INSERT IGNORE INTO favorites(user_id, post_id) VALUES(?,?)', [req.user.id, postId])
    } catch (dbError) {
      console.error('[groups] Database error in posts/:id/favorite POST:', dbError.message, dbError.stack)
      return res.status(500).json({ error: '数据库操作异常，请稍后重试', code: 'DB_ERROR' })
    }
    res.json({ ok: true })
  } catch (e) {
    console.error('[groups] Unexpected error in posts/:id/favorite POST:', e.message, e.stack)
    next(e)
  }
})

router.delete('/posts/:id/favorite', requireAuth, async (req, res, next) => {
  try {
    const postId = Number(req.params.id)
    try {
      await exec('DELETE FROM favorites WHERE user_id=? AND post_id=?', [req.user.id, postId])
    } catch (dbError) {
      console.error('[groups] Database error in posts/:id/favorite DELETE:', dbError.message, dbError.stack)
      return res.status(500).json({ error: '数据库操作异常，请稍后重试', code: 'DB_ERROR' })
    }
    res.json({ ok: true })
  } catch (e) {
    console.error('[groups] Unexpected error in posts/:id/favorite DELETE:', e.message, e.stack)
    next(e)
  }
})

// ========== 固定帖子接口 ==========

// 获取固定帖子列表
router.get('/featured-posts', requireAuth, async (req, res, next) => {
  try {
    let rows
    try {
      rows = await query(
        'SELECT * FROM featured_posts ORDER BY sort_order ASC, id ASC'
      )
    } catch (dbError) {
      console.error('[groups] Database error in featured-posts GET:', dbError.message, dbError.stack)
      return res.status(500).json({ error: '数据库操作异常，请稍后重试', code: 'DB_ERROR' })
    }

    // 如果是投票型帖子，获取投票选项
    const votePostIds = (rows || []).filter(p => p.post_type === 'vote').map(p => p.id)
    if (votePostIds.length > 0) {
      let optionRows
      try {
        optionRows = await query(
          'SELECT * FROM vote_options WHERE post_id IN (?) ORDER BY post_id ASC, sort_order ASC, id ASC',
          [votePostIds]
        )
      } catch (dbError) {
        console.error('[groups] Database error in featured-posts GET (query vote options):', dbError.message, dbError.stack)
        // 如果查询投票选项失败，继续返回帖子列表（不包含选项）
        return res.json(rows || [])
      }

      // 将投票选项按 post_id 分组
      const optionsByPostId = {}
      ;(optionRows || []).forEach(opt => {
        if (!optionsByPostId[opt.post_id]) {
          optionsByPostId[opt.post_id] = []
        }
        optionsByPostId[opt.post_id].push({
          ...opt,
          vote_count: Number(opt.vote_count || 0)
        })
      })

      // 为每个投票型帖子附加选项
      const postsWithOptions = (rows || []).map(post => {
        if (post.post_type === 'vote' && optionsByPostId[post.id]) {
          post.options = optionsByPostId[post.id]
        }
        return post
      })

      return res.json(postsWithOptions)
    }

    res.json(rows || [])
  } catch (e) {
    console.error('[groups] Unexpected error in featured-posts GET:', e.message, e.stack)
    next(e)
  }
})

// 获取固定帖子详情（包含投票选项和用户投票状态）
router.get('/featured-posts/:id', requireAuth, async (req, res, next) => {
  try {
    const postId = Number(req.params.id)
    if (!postId) {
      return res.status(400).json({ error: 'invalid post id' })
    }

    // 获取帖子信息
    let postRows
    try {
      postRows = await query('SELECT * FROM featured_posts WHERE id = ? LIMIT 1', [postId])
    } catch (dbError) {
      console.error('[groups] Database error in featured-posts/:id GET (query post):', dbError.message, dbError.stack)
      return res.status(500).json({ error: '数据库操作异常，请稍后重试', code: 'DB_ERROR' })
    }
    
    if (!postRows || postRows.length === 0) {
      return res.status(404).json({ error: 'post not found' })
    }

    const post = postRows[0]

    // 如果是投票型帖子，获取投票选项和用户投票状态
    if (post.post_type === 'vote') {
      let optionRows
      let voteRows
      
      try {
        optionRows = await query(
          'SELECT * FROM vote_options WHERE post_id = ? ORDER BY sort_order ASC, id ASC',
          [postId]
        )

        // 获取用户已投票的选项ID列表
        voteRows = await query(
          'SELECT option_id FROM vote_records WHERE post_id = ? AND user_id = ?',
          [postId, req.user.id]
        )
      } catch (dbError) {
        console.error('[groups] Database error in featured-posts/:id GET (query vote):', dbError.message, dbError.stack)
        return res.status(500).json({ error: '数据库操作异常，请稍后重试', code: 'DB_ERROR' })
      }
      
      const votedOptionIds = new Set((voteRows || []).map(r => r.option_id))

      // 为每个选项标记是否已投票，并确保 vote_count 是数字
      const options = (optionRows || []).map(opt => ({
        ...opt,
        vote_count: Number(opt.vote_count || 0),
        voted: votedOptionIds.has(opt.id)
      }))

      post.options = options
    }

    res.json(post)
  } catch (e) {
    console.error('[groups] Unexpected error in featured-posts/:id GET:', e.message, e.stack)
    next(e)
  }
})

// 点赞/取消点赞投票选项
router.post('/featured-posts/:id/vote', requireAuth, async (req, res, next) => {
  try {
    const postId = Number(req.params.id)
    const { optionId } = req.body || {}
    
    if (!postId || !optionId) {
      return res.status(400).json({ error: 'missing post_id or option_id' })
    }

    // 检查帖子是否存在且为投票型
    let postRows
    try {
      postRows = await query('SELECT post_type FROM featured_posts WHERE id = ? LIMIT 1', [postId])
    } catch (dbError) {
      console.error('[groups] Database error in featured-posts/:id/vote (query post):', dbError.message, dbError.stack)
      return res.status(500).json({ error: '数据库操作异常，请稍后重试', code: 'DB_ERROR' })
    }
    
    if (!postRows || postRows.length === 0) {
      return res.status(404).json({ error: 'post not found' })
    }
    if (postRows[0].post_type !== 'vote') {
      return res.status(400).json({ error: 'post is not a vote type' })
    }

    // 检查选项是否存在
    let optionRows
    try {
      optionRows = await query('SELECT id FROM vote_options WHERE id = ? AND post_id = ? LIMIT 1', [optionId, postId])
    } catch (dbError) {
      console.error('[groups] Database error in featured-posts/:id/vote (query option):', dbError.message, dbError.stack)
      return res.status(500).json({ error: '数据库操作异常，请稍后重试', code: 'DB_ERROR' })
    }
    
    if (!optionRows || optionRows.length === 0) {
      return res.status(404).json({ error: 'option not found' })
    }

    // 检查是否已投票
    let existingRows
    try {
      existingRows = await query(
        'SELECT id FROM vote_records WHERE post_id = ? AND option_id = ? AND user_id = ? LIMIT 1',
        [postId, optionId, req.user.id]
      )
    } catch (dbError) {
      console.error('[groups] Database error in featured-posts/:id/vote (query vote records):', dbError.message, dbError.stack)
      return res.status(500).json({ error: '数据库操作异常，请稍后重试', code: 'DB_ERROR' })
    }

    try {
      if (existingRows && existingRows.length > 0) {
        // 取消点赞
        await exec(
          'DELETE FROM vote_records WHERE post_id = ? AND option_id = ? AND user_id = ?',
          [postId, optionId, req.user.id]
        )
        // 更新选项的投票数
        await exec(
          'UPDATE vote_options SET vote_count = vote_count - 1 WHERE id = ?',
          [optionId]
        )
      } else {
        // 添加点赞
        await exec(
          'INSERT INTO vote_records(post_id, option_id, user_id) VALUES(?,?,?)',
          [postId, optionId, req.user.id]
        )
        // 更新选项的投票数
        await exec(
          'UPDATE vote_options SET vote_count = vote_count + 1 WHERE id = ?',
          [optionId]
        )
      }

      // 返回更新后的投票数
      let updatedRows
      try {
        updatedRows = await query('SELECT vote_count FROM vote_options WHERE id = ? LIMIT 1', [optionId])
      } catch (dbError) {
        console.error('[groups] Database error in featured-posts/:id/vote (query after update):', dbError.message, dbError.stack)
        return res.status(500).json({ error: '数据库操作异常，请稍后重试', code: 'DB_ERROR' })
      }
      
      const voteCount = updatedRows && updatedRows.length > 0 ? Number(updatedRows[0].vote_count || 0) : 0

      res.json({ ok: true, voteCount, voted: !(existingRows && existingRows.length > 0) })
    } catch (dbError) {
      console.error('[groups] Database error in featured-posts/:id/vote (update vote):', dbError.message, dbError.stack)
      return res.status(500).json({ error: '数据库操作异常，请稍后重试', code: 'DB_ERROR' })
    }
  } catch (e) {
    console.error('[groups] Unexpected error in featured-posts/:id/vote:', e.message, e.stack)
    next(e)
  }
})

// 回复固定帖子
router.post('/featured-posts/:id/comments', requireAuth, async (req, res, next) => {
  const postId = Number(req.params.id)
  
  try {
    const { content, imageUrls } = req.body || {}

    if (!content && (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0)) {
      return res.status(400).json({ error: 'missing content or imageUrls' })
    }

    // 获取帖子信息
    let postRows
    try {
      postRows = await query('SELECT * FROM featured_posts WHERE id = ? LIMIT 1', [postId])
    } catch (queryError) {
      console.error('[groups] Failed to query featured_posts:', queryError.message)
      return res.status(500).json({ error: 'database query failed', detail: queryError.message })
    }
    
    if (!postRows || postRows.length === 0) {
      return res.status(404).json({ error: 'post not found' })
    }

    const post = postRows[0]

    // 检查回复权限
    let permission
    try {
      permission = await checkReplyPermission(post, req.user.id)
    } catch (permError) {
      console.error('[groups] Failed to check permission:', permError.message, permError.stack)
      return res.status(500).json({ error: 'permission check failed', detail: permError.message })
    }
    
    if (!permission.canReply) {
      return res.status(403).json({ error: permission.reason || 'no permission to reply' })
    }

    // 内容审核
    let moderationResult
    try {
      moderationResult = await moderateComment({ content, imageUrls })
    } catch (modError) {
      console.error('[groups] Failed to moderate content:', modError.message, modError.stack)
      return res.status(500).json({ error: 'content moderation failed', detail: modError.message })
    }
    
    const moderationStatus = moderationResult.passed ? 'approved' : 'rejected'
    const moderationResultJson = moderationResult.passed ? null : JSON.stringify({ reason: moderationResult.reason })

    // 插入评论
    try {
      await exec(
        'INSERT INTO comments(post_id, user_id, content, image_urls, moderation_status, moderation_result, parent_comment_id, reply_to_user_id, like_count) VALUES(?,?,?,?,?,?,?,?,?)',
        [
          postId,
          req.user.id,
          content || '',
          imageUrls ? JSON.stringify(imageUrls) : null,
          moderationStatus,
          moderationResultJson,
          null, // parent_comment_id - 回复帖子时为空
          null, // reply_to_user_id - 回复帖子时为空
          0 // like_count - 初始为0
        ]
      )
    } catch (insertError) {
      console.error('[groups] Database error in featured-posts/:id/comments POST (insert):', insertError.message, insertError.stack)
      // 根据错误类型返回不同的错误信息
      if (insertError.code && insertError.code.startsWith('ER_')) {
        // MySQL 错误（如外键约束、字段类型等）
        return res.status(500).json({ 
          error: '数据库操作异常，请稍后重试', 
          code: 'DB_ERROR',
          detail: '如问题持续，请联系管理员查看服务器日志'
        })
      }
      return res.status(500).json({ 
        error: '数据库操作异常，请稍后重试', 
        code: 'DB_ERROR'
      })
    }

    // 如果审核失败，返回错误信息
    if (!moderationResult.passed) {
      return res.status(400).json({ error: moderationResult.reason || '内容不符合规范' })
    }

    // 返回评论列表（仅审核通过的）
    let commentRows
    try {
      commentRows = await query(
        `SELECT c.*, u.nickname, u.avatar_url
         FROM comments c
         JOIN users u ON u.id=c.user_id
         WHERE c.post_id=? AND c.moderation_status='approved'
         ORDER BY c.created_at ASC`,
        [postId]
      )
    } catch (queryError) {
      console.error('[groups] Failed to query comments after insert:', queryError.message)
      // 即使查询失败，也返回成功（评论已插入）
      return res.json([])
    }

    // 解析 image_urls JSON 字段
    const comments = (commentRows || []).map(c => {
      try {
        const result = { ...c }
        if (c.image_urls) {
          if (typeof c.image_urls === 'string') {
            try {
              result.image_urls = parseImageUrls(c.image_urls)
            } catch (e) {
              console.error('[groups] Failed to parse image_urls JSON:', e.message)
              result.image_urls = null
            }
          } else {
            result.image_urls = c.image_urls
          }
        } else {
          result.image_urls = null
        }
        return result
      } catch (e) {
        console.error('[groups] Failed to process comment:', e.message)
        return {
          ...c,
          image_urls: null
        }
      }
    })

    res.json(comments)
  } catch (e) {
    console.error('[groups] ERROR in POST featured-posts comments:', e.message, e.stack)
    console.error('[groups] Request params:', JSON.stringify(req.params))
    console.error('[groups] Request body:', JSON.stringify(req.body))
    console.error('[groups] Request user:', req.user?.id)
    next(e)
  }
})

// ========== 评论回复和点赞接口 ==========

// 回复评论（支持嵌套回复）
router.post('/comments/:id/replies', requireAuth, async (req, res, next) => {
  try {
    const commentId = Number(req.params.id)
    const { content, imageUrls, replyToUserId } = req.body || {}

    if (!content && (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0)) {
      return res.status(400).json({ error: 'missing content or imageUrls' })
    }

    // 获取父评论信息（包括 post_id）
    // 如果父评论本身是二级评论（有 parent_comment_id），则找到顶级评论
    let parentComment
    try {
      const parentRows = await query('SELECT post_id, user_id, parent_comment_id FROM comments WHERE id = ? LIMIT 1', [commentId])
      if (!parentRows || parentRows.length === 0) {
        return res.status(404).json({ error: 'parent comment not found' })
      }
      parentComment = parentRows[0]
      
      // 如果父评论是二级评论（有 parent_comment_id），则使用顶级评论的ID作为 parent_comment_id
      // 这样所有回复都显示为二级评论，不超过二级
      if (parentComment.parent_comment_id) {
        // 父评论是二级评论，找到它的顶级评论
        const topLevelRows = await query('SELECT id, user_id FROM comments WHERE id = ? LIMIT 1', [parentComment.parent_comment_id])
        if (topLevelRows && topLevelRows.length > 0) {
          // 使用顶级评论的ID作为 parent_comment_id，回复给二级评论的作者
          parentComment = {
            post_id: parentComment.post_id,
            user_id: parentComment.user_id, // 回复给二级评论的作者
            top_level_comment_id: topLevelRows[0].id // 顶级评论ID
          }
        }
      } else {
        // 父评论是顶级评论，直接使用
        parentComment.top_level_comment_id = commentId
      }
    } catch (dbError) {
      console.error('[groups] Database error in comments/:id/replies POST (query parent):', dbError.message, dbError.stack)
      return res.status(500).json({ error: '数据库操作异常，请稍后重试', code: 'DB_ERROR' })
    }

    // 内容审核
    const moderationResult = await moderateComment({ content, imageUrls })
    const moderationStatus = moderationResult.passed ? 'approved' : 'rejected'
    const moderationResultJson = moderationResult.passed ? null : JSON.stringify({ reason: moderationResult.reason })

    // 插入回复
    try {
      await exec(
        'INSERT INTO comments(post_id, user_id, content, image_urls, moderation_status, moderation_result, parent_comment_id, reply_to_user_id, like_count) VALUES(?,?,?,?,?,?,?,?,?)',
        [
          parentComment.post_id,
          req.user.id,
          content || '',
          imageUrls ? JSON.stringify(imageUrls) : null,
          moderationStatus,
          moderationResultJson,
          parentComment.top_level_comment_id, // parent_comment_id - 始终指向顶级评论，确保不超过二级
          replyToUserId || parentComment.user_id, // reply_to_user_id，回复给被回复的用户
          0 // like_count - 初始为0
        ]
      )
    } catch (dbError) {
      console.error('[groups] Database error in comments/:id/replies POST (insert):', dbError.message, dbError.stack)
      return res.status(500).json({ error: '数据库操作异常，请稍后重试', code: 'DB_ERROR' })
    }

    // 如果审核失败，返回错误信息
    if (!moderationResult.passed) {
      return res.status(400).json({ error: moderationResult.reason || '内容不符合规范' })
    }

    // 返回回复列表（仅审核通过的，包含嵌套结构）
    let rows
    try {
      rows = await query(
        `SELECT c.*, u.nickname, u.avatar_url, 
                ru.nickname AS reply_to_nickname
         FROM comments c
         JOIN users u ON u.id=c.user_id
         LEFT JOIN users ru ON ru.id=c.reply_to_user_id
         WHERE c.parent_comment_id=? AND c.moderation_status='approved'
         ORDER BY c.created_at ASC`,
        [commentId]
      )
    } catch (dbError) {
      console.error('[groups] Database error in comments/:id/replies POST (query):', dbError.message, dbError.stack)
      return res.status(500).json({ error: '数据库操作异常，请稍后重试', code: 'DB_ERROR' })
    }

    // 解析 image_urls JSON 字段
    const replies = (rows || []).map(c => {
      try {
        return {
          ...c,
          image_urls: parseImageUrls(c.image_urls),
          like_count: Number(c.like_count || 0),
          liked: false // 新回复默认未点赞
        }
      } catch (e) {
        console.error('[groups] Failed to parse image_urls:', e)
        return {
          ...c,
          image_urls: null,
          like_count: Number(c.like_count || 0),
          liked: false
        }
      }
    })

    res.json(replies)
  } catch (e) {
    console.error('[groups] Unexpected error in comments/:id/replies POST:', e.message, e.stack)
    next(e)
  }
})

// 获取评论的回复列表
router.get('/comments/:id/replies', requireAuth, async (req, res, next) => {
  try {
    const commentId = Number(req.params.id)
    
    let rows
    try {
      rows = await query(
        `SELECT c.*, u.nickname, u.avatar_url, 
                ru.nickname AS reply_to_nickname
         FROM comments c
         JOIN users u ON u.id=c.user_id
         LEFT JOIN users ru ON ru.id=c.reply_to_user_id
         WHERE c.parent_comment_id=? AND c.moderation_status='approved'
         ORDER BY c.created_at ASC`,
        [commentId]
      )
    } catch (dbError) {
      console.error('[groups] Database error in comments/:id/replies GET:', dbError.message, dbError.stack)
      return res.status(500).json({ error: '数据库操作异常，请稍后重试', code: 'DB_ERROR' })
    }

    // 获取点赞信息
    const replyIds = (rows || []).map(c => c.id)
    let likesMap = {}
    let userLikesSet = new Set()
    
    if (replyIds.length > 0) {
      try {
        const likeRows = await query(
          `SELECT comment_id, COUNT(*) AS count 
           FROM comment_likes 
           WHERE comment_id IN (${replyIds.map(() => '?').join(',')})
           GROUP BY comment_id`,
          replyIds
        )
        likesMap = (likeRows || []).reduce((acc, row) => {
          acc[row.comment_id] = Number(row.count || 0)
          return acc
        }, {})
        
        const userLikeRows = await query(
          `SELECT comment_id 
           FROM comment_likes 
           WHERE comment_id IN (${replyIds.map(() => '?').join(',')}) AND user_id = ?`,
          [...replyIds, req.user.id]
        )
        userLikesSet = new Set((userLikeRows || []).map(r => r.comment_id))
      } catch (dbError) {
        console.error('[groups] Database error in comments/:id/replies GET (query likes):', dbError.message, dbError.stack)
      }
    }

    // 解析 image_urls JSON 字段
    const replies = (rows || []).map(c => {
      try {
        return {
          ...c,
          image_urls: parseImageUrls(c.image_urls),
          like_count: Number(c.like_count || likesMap[c.id] || 0),
          liked: userLikesSet.has(c.id)
        }
      } catch (e) {
        console.error('[groups] Failed to parse image_urls:', e)
        return {
          ...c,
          image_urls: null,
          like_count: Number(c.like_count || likesMap[c.id] || 0),
          liked: userLikesSet.has(c.id)
        }
      }
    })

    res.json(replies)
  } catch (e) {
    console.error('[groups] Unexpected error in comments/:id/replies GET:', e.message, e.stack)
    next(e)
  }
})

// 点赞/取消点赞评论
router.post('/comments/:id/like', requireAuth, async (req, res, next) => {
  try {
    const commentId = Number(req.params.id)

    // 检查评论是否存在
    let commentRows
    try {
      commentRows = await query('SELECT id, like_count FROM comments WHERE id = ? LIMIT 1', [commentId])
    } catch (dbError) {
      console.error('[groups] Database error in comments/:id/like (query comment):', dbError.message, dbError.stack)
      return res.status(500).json({ error: '数据库操作异常，请稍后重试', code: 'DB_ERROR' })
    }
    
    if (!commentRows || commentRows.length === 0) {
      return res.status(404).json({ error: 'comment not found' })
    }

    // 检查是否已点赞
    let existingRows
    try {
      existingRows = await query(
        'SELECT id FROM comment_likes WHERE comment_id = ? AND user_id = ? LIMIT 1',
        [commentId, req.user.id]
      )
    } catch (dbError) {
      console.error('[groups] Database error in comments/:id/like (query like):', dbError.message, dbError.stack)
      return res.status(500).json({ error: '数据库操作异常，请稍后重试', code: 'DB_ERROR' })
    }

    try {
      if (existingRows && existingRows.length > 0) {
        // 取消点赞
        await exec(
          'DELETE FROM comment_likes WHERE comment_id = ? AND user_id = ?',
          [commentId, req.user.id]
        )
        // 更新评论的点赞数
        await exec(
          'UPDATE comments SET like_count = GREATEST(0, like_count - 1) WHERE id = ?',
          [commentId]
        )
      } else {
        // 添加点赞
        await exec(
          'INSERT INTO comment_likes(comment_id, user_id) VALUES(?,?)',
          [commentId, req.user.id]
        )
        // 更新评论的点赞数
        await exec(
          'UPDATE comments SET like_count = like_count + 1 WHERE id = ?',
          [commentId]
        )
      }

      // 返回更新后的点赞数
      let updatedRows
      try {
        updatedRows = await query('SELECT like_count FROM comments WHERE id = ? LIMIT 1', [commentId])
      } catch (dbError) {
        console.error('[groups] Database error in comments/:id/like (query after update):', dbError.message, dbError.stack)
        return res.status(500).json({ error: '数据库操作异常，请稍后重试', code: 'DB_ERROR' })
      }
      
      const likeCount = updatedRows && updatedRows.length > 0 ? Number(updatedRows[0].like_count || 0) : 0

      res.json({ ok: true, likeCount, liked: !(existingRows && existingRows.length > 0) })
    } catch (dbError) {
      console.error('[groups] Database error in comments/:id/like (update like):', dbError.message, dbError.stack)
      return res.status(500).json({ error: '数据库操作异常，请稍后重试', code: 'DB_ERROR' })
    }
  } catch (e) {
    console.error('[groups] Unexpected error in comments/:id/like:', e.message, e.stack)
    next(e)
  }
})

// ========== 同城戒烟小组接口 ==========

// 同城戒烟小组：以 city 或 region 作为标识
router.get('/same-city/summary', requireAuth, async (req, res, next) => {
  try {
    const me = await query('SELECT city, region FROM users WHERE id=? LIMIT 1', [req.user.id])
    // 优先使用 city，如果没有则使用 region
    const userRegion = (me[0] && me[0].city) || (me[0] && me[0].region)
    if (!userRegion) {
      return res.json({ group_key: null, total: 0, active: 0, failed: 0, reduction: 0 })
    }

    // 统计总数：同城所有用户（匹配 city 或 region）
    const totalRows = await query('SELECT COUNT(*) AS c FROM users WHERE city=? OR region=?', [userRegion, userRegion])
    const total = Number(totalRows[0]?.c || 0)

    // 统计失败数：同城且累计打卡天数为0的用户
    const failedRows = await query(
      'SELECT COUNT(*) AS c FROM users WHERE (city=? OR region=?) AND total_checkin_days=0',
      [userRegion, userRegion]
    )
    const failed = Number(failedRows[0]?.c || 0)

    // 统计活跃数：同城且累计打卡天数>0的用户
    const activeRows = await query(
      'SELECT COUNT(*) AS c FROM users WHERE (city=? OR region=?) AND total_checkin_days>0',
      [userRegion, userRegion]
    )
    const active = Number(activeRows[0]?.c || 0)

    // 较昨天减员数：暂时设为0
    const reduction = 0

    const result = { 
      group_key: userRegion, 
      total, 
      active, 
      failed, 
      reduction
    }
    
    res.json(result)
  } catch (e) {
    next(e)
  }
})

router.get('/same-city/posts', requireAuth, async (req, res, next) => {
  try {
    let me
    try {
      me = await query('SELECT city, region FROM users WHERE id=? LIMIT 1', [req.user.id])
    } catch (dbError) {
      console.error('[groups] Database error in same-city/posts (query user):', dbError.message, dbError.stack)
      return res.status(500).json({ error: '数据库操作异常，请稍后重试', code: 'DB_ERROR' })
    }
    
    // 优先使用 city，如果没有则使用 region
    const userRegion = (me[0] && me[0].city) || (me[0] && me[0].region)
    if (!userRegion) {
      // 如果没有地区信息，只返回固定帖子
      const specialPost = {
        id: 'special_same_city',
        _isSpecialPost: true,
        title: '同城戒烟的勇士们 是什么促使你们戒烟的 都来说一说',
        content: '同城戒烟的勇士们 是什么促使你们戒烟的 都来说一说',
        group_key: null,
        created_at: new Date().toISOString(),
        last_reply_at: null,
        user_id: null,
        nickname: '系统',
        avatar_url: ''
      }
      return res.json([specialPost])
    }

    // 查询同城所有用户的帖子（通过user_id的city或region来判断）
    // 注意：这里需要join users表来过滤city或region
    let rows
    try {
      rows = await query(
        `SELECT p.*, u.nickname, u.avatar_url
         FROM posts p
         JOIN users u ON u.id=p.user_id
         WHERE u.city=? OR u.region=?
         ORDER BY COALESCE(p.last_reply_at, p.created_at) DESC
         LIMIT 100`,
        [userRegion, userRegion]
      )
    } catch (dbError) {
      console.error('[groups] Database error in same-city/posts (query posts):', dbError.message, dbError.stack)
      return res.status(500).json({ error: '数据库操作异常，请稍后重试', code: 'DB_ERROR' })
    }
    
    // 创建固定帖子对象（放在列表最前面）
    const specialPost = {
      id: `special_same_city_${userRegion}`,
      _isSpecialPost: true,
      title: '同城戒烟的勇士们 是什么促使你们戒烟的 都来说一说',
      content: '同城戒烟的勇士们 是什么促使你们戒烟的 都来说一说',
      group_key: userRegion,
      created_at: new Date().toISOString(),
      last_reply_at: null,
      user_id: null,
      nickname: '系统',
      avatar_url: ''
    }
    
    // 查询固定帖子的最新回复时间
    try {
      const latestReplyRows = await query(
        `SELECT MAX(created_at) AS last_reply_at
         FROM comments c
         JOIN users u ON u.id=c.user_id
         WHERE c.post_id IS NULL 
         AND (u.city = ? OR u.region = ?)
         AND c.moderation_status='approved'
         LIMIT 1`,
        [userRegion, userRegion]
      )
      if (latestReplyRows && latestReplyRows.length > 0 && latestReplyRows[0].last_reply_at) {
        specialPost.last_reply_at = latestReplyRows[0].last_reply_at
      }
    } catch (dbError) {
      console.error('[groups] Failed to query special post last_reply_at:', dbError.message)
    }
    
    // 将固定帖子放在最前面
    res.json([specialPost, ...(rows || [])])
  } catch (e) {
    console.error('[groups] Unexpected error in same-city/posts:', e.message, e.stack)
    next(e)
  }
})

// 同城固定帖子的评论接口
router.get('/same-city/special-post/comments', requireAuth, async (req, res, next) => {
  try {
    // 获取当前用户的地区（优先使用 city，如果没有则使用 region）
    let me
    try {
      me = await query('SELECT city, region FROM users WHERE id=? LIMIT 1', [req.user.id])
    } catch (dbError) {
      console.error('[groups] Database error in same-city/special-post/comments GET (query user):', dbError.message, dbError.stack)
      return res.status(500).json({ error: '数据库操作异常，请稍后重试', code: 'DB_ERROR' })
    }
    
    // 优先使用 city，如果没有则使用 region
    const userRegion = (me[0] && me[0].city) || (me[0] && me[0].region)
    if (!userRegion) {
      return res.json([])
    }

    // 查询所有同一地区的用户对该固定帖子的评论
    // 固定帖子的 post_id 为 NULL，group_type 为 'same-city'，通过 user_id 的 city 或 region 来判断
    let rows
    try {
      rows = await query(
        `SELECT c.*, u.nickname, u.avatar_url,
                (SELECT COUNT(*) FROM comments c2 
                 WHERE c2.parent_comment_id = c.id AND c2.moderation_status='approved') AS reply_count
         FROM comments c
         JOIN users u ON u.id=c.user_id
         WHERE c.post_id IS NULL 
         AND c.group_type = 'same-city'
         AND (u.city = ? OR u.region = ?)
         AND c.moderation_status='approved'
         AND c.parent_comment_id IS NULL
         ORDER BY c.created_at DESC`,
        [userRegion, userRegion]
      )
    } catch (dbError) {
      console.error('[groups] Database error in same-city/special-post/comments GET:', dbError.message, dbError.stack)
      return res.status(500).json({ error: '数据库操作异常，请稍后重试', code: 'DB_ERROR' })
    }

    // 获取点赞信息
    const commentIds = (rows || []).map(c => c.id)
    let likesMap = {}
    let userLikesSet = new Set()
    
    if (commentIds.length > 0) {
      try {
        const likeRows = await query(
          `SELECT comment_id, COUNT(*) AS count 
           FROM comment_likes 
           WHERE comment_id IN (${commentIds.map(() => '?').join(',')})
           GROUP BY comment_id`,
          commentIds
        )
        likesMap = (likeRows || []).reduce((acc, row) => {
          acc[row.comment_id] = Number(row.count || 0)
          return acc
        }, {})
        
        const userLikeRows = await query(
          `SELECT comment_id 
           FROM comment_likes 
           WHERE comment_id IN (${commentIds.map(() => '?').join(',')}) AND user_id = ?`,
          [...commentIds, req.user.id]
        )
        userLikesSet = new Set((userLikeRows || []).map(r => r.comment_id))
      } catch (dbError) {
        console.error('[groups] Database error in same-city/special-post/comments GET (query likes):', dbError.message, dbError.stack)
      }
    }

    // 解析 image_urls JSON 字段
    const comments = (rows || []).map(c => {
      try {
        return {
          ...c,
          image_urls: parseImageUrls(c.image_urls),
          like_count: Number(c.like_count || likesMap[c.id] || 0),
          liked: userLikesSet.has(c.id),
          reply_count: Number(c.reply_count || 0)
        }
      } catch (e) {
        console.error('[groups] Failed to parse image_urls:', e)
        return {
          ...c,
          image_urls: null,
          like_count: Number(c.like_count || likesMap[c.id] || 0),
          liked: userLikesSet.has(c.id),
          reply_count: Number(c.reply_count || 0)
        }
      }
    })

    res.json(comments)
  } catch (e) {
    console.error('[groups] Unexpected error in same-city/special-post/comments GET:', e.message, e.stack)
    next(e)
  }
})

router.post('/same-city/special-post/comments', requireAuth, async (req, res, next) => {
  try {
    // 获取当前用户的地区（优先使用 city，如果没有则使用 region）
    let me
    try {
      me = await query('SELECT city, region FROM users WHERE id=? LIMIT 1', [req.user.id])
    } catch (dbError) {
      console.error('[groups] Database error in same-city/special-post/comments POST (query user):', dbError.message, dbError.stack)
      return res.status(500).json({ error: '数据库操作异常，请稍后重试', code: 'DB_ERROR' })
    }
    
    // 优先使用 city，如果没有则使用 region
    const userRegion = (me[0] && me[0].city) || (me[0] && me[0].region)
    if (!userRegion) {
      return res.status(400).json({ error: '请先设置城市信息' })
    }

    const { content, imageUrls } = req.body || {}

    if (!content && (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0)) {
      return res.status(400).json({ error: 'missing content or imageUrls' })
    }

    // 内容审核
    const moderationResult = await moderateComment({ content, imageUrls })
    const moderationStatus = moderationResult.passed ? 'approved' : 'rejected'
    const moderationResultJson = moderationResult.passed ? null : JSON.stringify({ reason: moderationResult.reason })

    // 插入评论（post_id 为 NULL，表示这是固定帖子的评论，group_type 为 'same-city' 表示同城小组）
    try {
      await exec(
        'INSERT INTO comments(post_id, user_id, content, image_urls, moderation_status, moderation_result, parent_comment_id, reply_to_user_id, like_count, group_type) VALUES(?,?,?,?,?,?,?,?,?,?)',
        [
          null, // post_id 为 NULL，表示固定帖子
          req.user.id,
          content || '',
          imageUrls ? JSON.stringify(imageUrls) : null,
          moderationStatus,
          moderationResultJson,
          null, // parent_comment_id - 回复帖子时为空
          null, // reply_to_user_id - 回复帖子时为空
          0, // like_count - 初始为0
          'same-city' // group_type - 同城戒烟小组
        ]
      )
    } catch (dbError) {
      console.error('[groups] Database error in same-city/special-post/comments POST (insert):', dbError.message, dbError.stack)
      return res.status(500).json({ error: '数据库操作异常，请稍后重试', code: 'DB_ERROR' })
    }

    // 如果审核失败，返回错误信息
    if (!moderationResult.passed) {
      return res.status(400).json({ error: moderationResult.reason || '内容不符合规范' })
    }

    // 返回评论列表（仅审核通过的，只返回顶级评论）
    let rows
    try {
      rows = await query(
        `SELECT c.*, u.nickname, u.avatar_url,
                (SELECT COUNT(*) FROM comments c2 
                 WHERE c2.parent_comment_id = c.id AND c2.moderation_status='approved') AS reply_count
         FROM comments c
         JOIN users u ON u.id=c.user_id
         WHERE c.post_id IS NULL 
         AND c.group_type = 'same-city'
         AND (u.city = ? OR u.region = ?)
         AND c.moderation_status='approved'
         AND c.parent_comment_id IS NULL
         ORDER BY c.created_at DESC`,
        [userRegion, userRegion]
      )
    } catch (dbError) {
      console.error('[groups] Database error in same-city/special-post/comments POST (query):', dbError.message, dbError.stack)
      return res.status(500).json({ error: '数据库操作异常，请稍后重试', code: 'DB_ERROR' })
    }

    // 获取点赞信息
    const commentIds = (rows || []).map(c => c.id)
    let likesMap = {}
    let userLikesSet = new Set()
    
    if (commentIds.length > 0) {
      try {
        const likeRows = await query(
          `SELECT comment_id, COUNT(*) AS count 
           FROM comment_likes 
           WHERE comment_id IN (${commentIds.map(() => '?').join(',')})
           GROUP BY comment_id`,
          commentIds
        )
        likesMap = (likeRows || []).reduce((acc, row) => {
          acc[row.comment_id] = Number(row.count || 0)
          return acc
        }, {})
        
        const userLikeRows = await query(
          `SELECT comment_id 
           FROM comment_likes 
           WHERE comment_id IN (${commentIds.map(() => '?').join(',')}) AND user_id = ?`,
          [...commentIds, req.user.id]
        )
        userLikesSet = new Set((userLikeRows || []).map(r => r.comment_id))
      } catch (dbError) {
        console.error('[groups] Database error in same-city/special-post/comments POST (query likes):', dbError.message, dbError.stack)
      }
    }

    // 解析 image_urls JSON 字段
    const comments = (rows || []).map(c => {
      try {
        return {
          ...c,
          image_urls: parseImageUrls(c.image_urls),
          like_count: Number(c.like_count || likesMap[c.id] || 0),
          liked: userLikesSet.has(c.id),
          reply_count: Number(c.reply_count || 0)
        }
      } catch (e) {
        console.error('[groups] Failed to parse image_urls:', e)
        return {
          ...c,
          image_urls: null,
          like_count: Number(c.like_count || likesMap[c.id] || 0),
          liked: userLikesSet.has(c.id),
          reply_count: Number(c.reply_count || 0)
        }
      }
    })

    res.json(comments)
  } catch (e) {
    console.error('[groups] Unexpected error in same-city/special-post/comments POST:', e.message, e.stack)
    next(e)
  }
})

module.exports = router
