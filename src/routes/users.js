const express = require('express')
const { requireAuth } = require('../auth')
const { query, exec } = require('../db/query')

const router = express.Router()

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const rows = await query('SELECT * FROM users WHERE id=? LIMIT 1', [req.user.id])
    res.json(rows[0])
  } catch (e) {
    next(e)
  }
})

router.put('/me', requireAuth, async (req, res, next) => {
  try {
    const body = req.body || {}
    const fields = {
      nickname: body.nickname,
      avatar_url: body.avatar_url,
      gender: body.gender,
      region: body.region,
      city: body.city,
      phone_number: body.phoneNumber || body.phone_number,
      quit_date: body.quit_date,
      price_per_cig: body.price_per_cig,
      cigs_per_day: body.cigs_per_day
    }

    // 只允许更新白名单字段
    const updates = []
    const params = []
    for (const [k, v] of Object.entries(fields)) {
      if (typeof v === 'undefined') continue
      updates.push(`${k}=?`)
      params.push(v)
    }

    if (!updates.length) return res.json({ ok: true })

    params.push(req.user.id)
    await exec(`UPDATE users SET ${updates.join(', ')} WHERE id=?`, params)

    const rows = await query('SELECT * FROM users WHERE id=? LIMIT 1', [req.user.id])
    res.json(rows[0])
  } catch (e) {
    next(e)
  }
})

// 用户统计接口
router.get('/stats', requireAuth, async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT 
        total_checkin_days,
        failure_count,
        last_checkin_date,
        last_calc_date
       FROM users 
       WHERE id=? LIMIT 1`,
      [req.user.id]
    )
    
    if (!rows.length) {
      return res.status(404).json({ error: 'user not found' })
    }
    
    const user = rows[0]
    
    // 计算段位信息（需要引入rank.js，但rank.js在小程序端）
    // 这里先返回基础数据，段位计算可以在前端完成
    res.json({
      total_checkin_days: user.total_checkin_days || 0,
      failure_count: user.failure_count || 0,
      last_checkin_date: user.last_checkin_date,
      last_calc_date: user.last_calc_date
    })
  } catch (e) {
    next(e)
  }
})

module.exports = router
