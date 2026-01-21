const express = require('express')
const { getPool } = require('../db/pool')
const { query, exec } = require('../db/query')
const { requireAdminAuth, adminLogin, revokeAdminToken } = require('../middleware/adminAuth')

const router = express.Router()

// ==================== 认证相关 ====================

// 管理员登录
router.post('/auth/login', async (req, res) => {
  try {
    const { password } = req.body || {}
    if (!password) {
      return res.status(400).json({ ok: false, error: 'password required' })
    }

    const token = adminLogin(password)
    if (!token) {
      return res.status(401).json({ ok: false, error: 'invalid password' })
    }

    res.json({ ok: true, token })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// 管理员登出
router.post('/auth/logout', requireAdminAuth, async (req, res) => {
  try {
    revokeAdminToken(req.adminToken)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// 当前管理员信息
router.get('/auth/me', requireAdminAuth, async (req, res) => {
  res.json({ ok: true, authenticated: true })
})

// ==================== 用户管理 ====================

// 用户列表
router.get('/users', requireAdminAuth, async (req, res) => {
  try {
    const pool = getPool()
    const {
      page = 1,
      limit = 50,
      search,
      quit_date,
      total_checkin_days,
      failure_count,
      rank_range
    } = req.query

    let sql = `
      SELECT id, openid, unionid, nickname, avatar_url, gender, region, quit_date,
             price_per_cig, cigs_per_day, total_checkin_days, failure_count,
             last_checkin_date, last_calc_date, created_at, updated_at
      FROM users WHERE 1=1
    `
    const params = []

    // 搜索（昵称或openid）
    if (search) {
      sql += ' AND (nickname LIKE ? OR openid LIKE ?)'
      const searchPattern = `%${search}%`
      params.push(searchPattern, searchPattern)
    }

    // 筛选
    if (quit_date) {
      sql += ' AND quit_date = ?'
      params.push(quit_date)
    }

    if (total_checkin_days !== undefined) {
      if (total_checkin_days === '0') {
        sql += ' AND total_checkin_days = 0'
      } else {
        sql += ' AND total_checkin_days > 0'
      }
    }

    if (failure_count !== undefined) {
      sql += ' AND failure_count = ?'
      params.push(Number(failure_count))
    }

    // 段位筛选
    if (rank_range) {
      const ranges = {
        '倔强青铜': 'total_checkin_days >= 1 AND total_checkin_days < 7',
        '秩序白银': 'total_checkin_days >= 7 AND total_checkin_days < 14',
        '荣耀黄金': 'total_checkin_days >= 14 AND total_checkin_days < 30',
        '尊贵铂金': 'total_checkin_days >= 30 AND total_checkin_days < 60',
        '永恒钻石': 'total_checkin_days >= 60 AND total_checkin_days < 90',
        '至尊星耀': 'total_checkin_days >= 90 AND total_checkin_days < 180',
        '最强王者': 'total_checkin_days >= 180 AND total_checkin_days < 365',
        '荣耀王者': 'total_checkin_days >= 365',
        '失败': 'total_checkin_days = 0'
      }
      if (ranges[rank_range]) {
        sql += ` AND ${ranges[rank_range]}`
      }
    }

    // 获取总数
    const countSql = sql.replace(/SELECT.*FROM/, 'SELECT COUNT(*) as total FROM').replace(/ORDER BY.*/, '')
    const countParams = params.slice()
    const [countRows] = await pool.query(countSql, countParams)
    const total = countRows[0].total

    // 分页查询
    sql += ' ORDER BY id DESC LIMIT ? OFFSET ?'
    params.push(Number(limit), (Number(page) - 1) * Number(limit))

    const [rows] = await pool.query(sql, params)

    res.json({
      ok: true,
      data: rows,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit))
      }
    })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// 用户详情
router.get('/users/:id', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params
    const rows = await query('SELECT * FROM users WHERE id = ? LIMIT 1', [id])
    if (!rows.length) {
      return res.status(404).json({ ok: false, error: 'user not found' })
    }
    res.json({ ok: true, data: rows[0] })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// 更新用户信息
router.put('/users/:id', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params
    const body = req.body || {}

    const allowedFields = [
      'nickname', 'avatar_url', 'gender', 'region', 'quit_date',
      'price_per_cig', 'cigs_per_day', 'total_checkin_days', 'failure_count',
      'last_checkin_date', 'last_calc_date'
    ]

    const updates = []
    const params = []
    for (const field of allowedFields) {
      if (field in body) {
        updates.push(`${field} = ?`)
        params.push(body[field])
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ ok: false, error: 'no fields to update' })
    }

    params.push(id)
    await exec(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params)

    const rows = await query('SELECT * FROM users WHERE id = ? LIMIT 1', [id])
    res.json({ ok: true, data: rows[0] })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// 删除用户
router.delete('/users/:id', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params
    await exec('DELETE FROM users WHERE id = ?', [id])
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// 用户打卡记录
router.get('/users/:id/checkins', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params
    const { limit = 100 } = req.query
    const rows = await query(
      'SELECT * FROM checkins WHERE user_id = ? ORDER BY checkin_date DESC LIMIT ?',
      [id, Number(limit)]
    )
    res.json({ ok: true, data: rows })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// 用户帖子
router.get('/users/:id/posts', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params
    const rows = await query(
      'SELECT * FROM posts WHERE user_id = ? ORDER BY created_at DESC',
      [id]
    )
    res.json({ ok: true, data: rows })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ==================== 打卡管理 ====================

// 打卡记录列表
router.get('/checkins', requireAdminAuth, async (req, res) => {
  try {
    const pool = getPool()
    const {
      page = 1,
      limit = 50,
      user_id,
      checkin_date,
      date_from,
      date_to
    } = req.query

    let sql = `
      SELECT c.*, u.nickname, u.avatar_url
      FROM checkins c
      JOIN users u ON u.id = c.user_id
      WHERE 1=1
    `
    const params = []

    if (user_id) {
      sql += ' AND c.user_id = ?'
      params.push(user_id)
    }

    if (checkin_date) {
      sql += ' AND c.checkin_date = ?'
      params.push(checkin_date)
    }

    if (date_from) {
      sql += ' AND c.checkin_date >= ?'
      params.push(date_from)
    }

    if (date_to) {
      sql += ' AND c.checkin_date <= ?'
      params.push(date_to)
    }

    // 获取总数
    const countSql = sql.replace(/SELECT.*FROM/, 'SELECT COUNT(*) as total FROM').replace(/ORDER BY.*/, '')
    const countParams = params.slice()
    const [countRows] = await pool.query(countSql, countParams)
    const total = countRows[0].total

    // 分页查询
    sql += ' ORDER BY c.checkin_date DESC, c.created_at DESC LIMIT ? OFFSET ?'
    params.push(Number(limit), (Number(page) - 1) * Number(limit))

    const [rows] = await pool.query(sql, params)

    // 解析JSON字段
    const data = rows.map(row => ({
      ...row,
      image_urls: row.image_urls ? JSON.parse(row.image_urls) : null
    }))

    res.json({
      ok: true,
      data,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit))
      }
    })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// 打卡详情
router.get('/checkins/:id', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params
    const rows = await query(
      `SELECT c.*, u.nickname, u.avatar_url
       FROM checkins c
       JOIN users u ON u.id = c.user_id
       WHERE c.id = ? LIMIT 1`,
      [id]
    )
    if (!rows.length) {
      return res.status(404).json({ ok: false, error: 'checkin not found' })
    }

    const data = {
      ...rows[0],
      image_urls: rows[0].image_urls ? JSON.parse(rows[0].image_urls) : null
    }

    res.json({ ok: true, data })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// 删除打卡记录
router.delete('/checkins/:id', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params
    await exec('DELETE FROM checkins WHERE id = ?', [id])
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ==================== 内容管理 ====================

// 帖子列表
router.get('/posts', requireAdminAuth, async (req, res) => {
  try {
    const pool = getPool()
    const { page = 1, limit = 50, group_key, user_id } = req.query

    let sql = `
      SELECT p.*, u.nickname, u.avatar_url,
             (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count,
             (SELECT COUNT(*) FROM favorites WHERE post_id = p.id) as favorite_count
      FROM posts p
      JOIN users u ON u.id = p.user_id
      WHERE 1=1
    `
    const params = []

    if (group_key) {
      sql += ' AND p.group_key = ?'
      params.push(group_key)
    }

    if (user_id) {
      sql += ' AND p.user_id = ?'
      params.push(user_id)
    }

    // 获取总数
    const countSql = sql.replace(/SELECT.*FROM/, 'SELECT COUNT(*) as total FROM').replace(/ORDER BY.*/, '')
    const countParams = params.slice()
    const [countRows] = await pool.query(countSql, countParams)
    const total = countRows[0].total

    // 分页查询
    sql += ' ORDER BY COALESCE(p.last_reply_at, p.created_at) DESC LIMIT ? OFFSET ?'
    params.push(Number(limit), (Number(page) - 1) * Number(limit))

    const [rows] = await pool.query(sql, params)

    // 解析JSON字段
    const data = rows.map(row => ({
      ...row,
      image_urls: row.image_urls ? JSON.parse(row.image_urls || 'null') : null
    }))

    res.json({
      ok: true,
      data,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit))
      }
    })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// 帖子详情
router.get('/posts/:id', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params
    const rows = await query(
      `SELECT p.*, u.nickname, u.avatar_url
       FROM posts p
       JOIN users u ON u.id = p.user_id
       WHERE p.id = ? LIMIT 1`,
      [id]
    )
    if (!rows.length) {
      return res.status(404).json({ ok: false, error: 'post not found' })
    }

    const data = {
      ...rows[0],
      image_urls: rows[0].image_urls ? JSON.parse(rows[0].image_urls || 'null') : null
    }

    res.json({ ok: true, data })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// 删除帖子
router.delete('/posts/:id', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params
    await exec('DELETE FROM posts WHERE id = ?', [id])
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// 评论列表
router.get('/comments', requireAdminAuth, async (req, res) => {
  try {
    const pool = getPool()
    const { page = 1, limit = 50, post_id, user_id } = req.query

    let sql = `
      SELECT c.*, u.nickname, u.avatar_url, p.title as post_title
      FROM comments c
      JOIN users u ON u.id = c.user_id
      JOIN posts p ON p.id = c.post_id
      WHERE 1=1
    `
    const params = []

    if (post_id) {
      sql += ' AND c.post_id = ?'
      params.push(post_id)
    }

    if (user_id) {
      sql += ' AND c.user_id = ?'
      params.push(user_id)
    }

    // 获取总数
    const countSql = sql.replace(/SELECT.*FROM/, 'SELECT COUNT(*) as total FROM').replace(/ORDER BY.*/, '')
    const countParams = params.slice()
    const [countRows] = await pool.query(countSql, countParams)
    const total = countRows[0].total

    // 分页查询
    sql += ' ORDER BY c.created_at DESC LIMIT ? OFFSET ?'
    params.push(Number(limit), (Number(page) - 1) * Number(limit))

    const [rows] = await pool.query(sql, params)

    res.json({
      ok: true,
      data: rows,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit))
      }
    })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// 删除评论
router.delete('/comments/:id', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params
    await exec('DELETE FROM comments WHERE id = ?', [id])
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ==================== 数据统计 ====================

// 总体统计
router.get('/stats/overview', requireAdminAuth, async (req, res) => {
  try {
    const pool = getPool()

    const [stats] = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM users) as total_users,
        (SELECT COUNT(*) FROM users WHERE total_checkin_days > 0) as active_users,
        (SELECT COUNT(*) FROM users WHERE total_checkin_days = 0) as failed_users,
        (SELECT COUNT(*) FROM checkins) as total_checkins,
        (SELECT COUNT(*) FROM posts) as total_posts,
        (SELECT COUNT(*) FROM comments) as total_comments,
        (SELECT COUNT(*) FROM favorites) as total_favorites,
        (SELECT COUNT(*) FROM follows) as total_follows,
        (SELECT AVG(total_checkin_days) FROM users) as avg_checkin_days,
        (SELECT MAX(total_checkin_days) FROM users) as max_checkin_days,
        (SELECT COUNT(DISTINCT quit_date) FROM users WHERE quit_date IS NOT NULL) as total_quit_dates
    `)

    res.json({ ok: true, data: stats[0] })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// 段位分布统计
router.get('/stats/ranks', requireAdminAuth, async (req, res) => {
  try {
    const rankStats = await query(`
      SELECT 
        CASE 
          WHEN total_checkin_days = 0 THEN '失败（0天）'
          WHEN total_checkin_days >= 1 AND total_checkin_days < 7 THEN '倔强青铜'
          WHEN total_checkin_days >= 7 AND total_checkin_days < 14 THEN '秩序白银'
          WHEN total_checkin_days >= 14 AND total_checkin_days < 30 THEN '荣耀黄金'
          WHEN total_checkin_days >= 30 AND total_checkin_days < 60 THEN '尊贵铂金'
          WHEN total_checkin_days >= 60 AND total_checkin_days < 90 THEN '永恒钻石'
          WHEN total_checkin_days >= 90 AND total_checkin_days < 180 THEN '至尊星耀'
          WHEN total_checkin_days >= 180 AND total_checkin_days < 365 THEN '最强王者'
          WHEN total_checkin_days >= 365 THEN '荣耀王者'
        END as rank_range,
        COUNT(*) as count
      FROM users
      GROUP BY rank_range
      ORDER BY MIN(total_checkin_days)
    `)

    res.json({ ok: true, data: rankStats })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// 同日戒烟统计
router.get('/stats/same-day', requireAdminAuth, async (req, res) => {
  try {
    const { limit = 30 } = req.query
    const rows = await query(`
      SELECT 
        quit_date,
        COUNT(*) as total,
        COUNT(CASE WHEN total_checkin_days = 0 THEN 1 END) as failed,
        COUNT(CASE WHEN total_checkin_days > 0 THEN 1 END) as survived,
        AVG(total_checkin_days) as avg_checkin_days
      FROM users
      WHERE quit_date IS NOT NULL
      GROUP BY quit_date
      ORDER BY quit_date DESC
      LIMIT ?
    `, [Number(limit)])

    res.json({ ok: true, data: rows })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// 趋势数据
router.get('/stats/trends', requireAdminAuth, async (req, res) => {
  try {
    const { days = 30 } = req.query

    // 用户增长趋势
    const userTrends = await query(`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM users
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `, [Number(days)])

    // 打卡趋势
    const checkinTrends = await query(`
      SELECT checkin_date as date, COUNT(*) as count
      FROM checkins
      WHERE checkin_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      GROUP BY checkin_date
      ORDER BY date ASC
    `, [Number(days)])

    // 内容增长趋势
    const contentTrends = await query(`
      SELECT DATE(created_at) as date, 
             COUNT(*) as posts,
             (SELECT COUNT(*) FROM comments WHERE DATE(created_at) = DATE(p.created_at)) as comments
      FROM posts p
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `, [Number(days)])

    res.json({
      ok: true,
      data: {
        users: userTrends,
        checkins: checkinTrends,
        content: contentTrends
      }
    })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ==================== 系统管理 ====================

// 抖音token列表
router.get('/system/douyin-tokens', requireAdminAuth, async (req, res) => {
  try {
    const rows = await query(`
      SELECT t.*, u.nickname, u.openid
      FROM douyin_open_tokens t
      JOIN users u ON u.id = t.user_id
      ORDER BY t.created_at DESC
    `)
    res.json({ ok: true, data: rows })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// 数据导出（简化版，返回JSON）
router.post('/system/export', requireAdminAuth, async (req, res) => {
  try {
    const { type = 'users', format = 'json' } = req.body

    let data = []
    let filename = 'export'

    if (type === 'users') {
      data = await query('SELECT * FROM users ORDER BY id')
      filename = 'users'
    } else if (type === 'checkins') {
      data = await query('SELECT * FROM checkins ORDER BY checkin_date DESC')
      filename = 'checkins'
    } else if (type === 'posts') {
      data = await query('SELECT * FROM posts ORDER BY created_at DESC')
      filename = 'posts'
    }

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`)
      res.json(data)
    } else {
      // CSV格式（简化实现）
      if (data.length === 0) {
        return res.status(400).json({ ok: false, error: 'no data to export' })
      }

      const headers = Object.keys(data[0])
      const csvRows = [
        headers.join(','),
        ...data.map(row => headers.map(h => {
          const val = row[h]
          if (val === null || val === undefined) return ''
          if (typeof val === 'object') return JSON.stringify(val)
          return String(val).replace(/"/g, '""')
        }).join(','))
      ]

      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`)
      res.send('\ufeff' + csvRows.join('\n')) // BOM for Excel
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

module.exports = router
