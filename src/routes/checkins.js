const express = require('express')
const { requireAuth } = require('../auth')
const { query, exec } = require('../db/query')

const router = express.Router()

// 格式化日期为 YYYY-MM-DD
function formatDate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// 获取昨天和前天的日期
function getMakeupDates() {
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const dayBeforeYesterday = new Date(today)
  dayBeforeYesterday.setDate(dayBeforeYesterday.getDate() - 2)
  
  return {
    today: formatDate(today),
    yesterday: formatDate(yesterday),
    dayBeforeYesterday: formatDate(dayBeforeYesterday)
  }
}

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const days = Math.min(30, Math.max(1, Number(req.query.days || 7)))
    
    let rows
    try {
      rows = await query(
        `SELECT checkin_date, mood, note, image_urls, created_at
         FROM checkins
         WHERE user_id=?
         ORDER BY checkin_date DESC
         LIMIT ?`,
        [req.user.id, days]
      )
    } catch (dbError) {
      console.error('[checkins] GET database error:', dbError.message)
      console.error('[checkins] GET database error stack:', dbError.stack)
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      return res.status(500).json({ error: '数据库查询失败', detail: dbError.message })
    }
    
    // 打印原始数据库查询结果
    console.log('[checkins] GET raw data from database:', JSON.stringify(rows, null, 2))
    console.log('[checkins] GET raw data count:', rows ? rows.length : 0)
    
    // 处理空数据情况
    if (!rows || rows.length === 0) {
      console.log('[checkins] GET empty data, returning []')
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      return res.json([])
    }
    
    // 解析逗号分割的图片URL字段
    const data = rows.map(row => {
      let imageUrls = null
      if (row.image_urls && typeof row.image_urls === 'string') {
        const trimmed = row.image_urls.trim()
        if (trimmed) {
          imageUrls = trimmed.split(',').map(url => url.trim()).filter(url => url)
          // 如果分割后没有有效URL，设为null
          if (imageUrls.length === 0) {
            imageUrls = null
          }
        }
      }
      return {
        checkin_date: row.checkin_date,
        mood: row.mood,
        note: row.note,
        image_urls: imageUrls,
        created_at: row.created_at
      }
    })
    
    // 确保返回JSON格式
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.json(data)
  } catch (e) {
    console.error('[checkins] GET unexpected error:', e.message)
    console.error('[checkins] GET unexpected error stack:', e.stack)
    // 确保错误响应也是JSON格式
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.status(500).json({ error: e.message || '服务器内部错误', detail: '获取打卡记录失败' })
  }
})

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { date, mood, note, imageUrls } = req.body || {}
    const dates = getMakeupDates()
    const checkinDate = date || dates.today
    
    // 补打卡验证：只允许今天、昨天、前天
    if (checkinDate !== dates.today && 
        checkinDate !== dates.yesterday && 
        checkinDate !== dates.dayBeforeYesterday) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      return res.status(400).json({ 
        ok: false, 
        error: '只能补打卡昨天或前天的日期' 
      })
    }
    
    // 验证并处理 imageUrls，转换为逗号分割的字符串
    let imageUrlsString = null
    if (imageUrls) {
      // 确保是数组格式
      const urlsArray = Array.isArray(imageUrls) ? imageUrls : [imageUrls]
      // 过滤掉空值
      const validUrls = urlsArray.filter(url => url && typeof url === 'string' && url.trim())
      if (validUrls.length > 0) {
        // 使用逗号分割多个URL
        imageUrlsString = validUrls.join(',')
      }
    }
    
    // 插入或更新打卡记录
    await exec(
      `INSERT INTO checkins(user_id, checkin_date, mood, note, image_urls)
       VALUES(?,?,?,?,?)
       ON DUPLICATE KEY UPDATE mood=VALUES(mood), note=VALUES(note), image_urls=VALUES(image_urls)`,
      [req.user.id, checkinDate, mood || null, note || null, imageUrlsString]
    )
    
    // 更新用户统计：累计天数 = 打卡记录总数
    const countRows = await query(
      'SELECT COUNT(*) AS c FROM checkins WHERE user_id = ?',
      [req.user.id]
    )
    // COUNT(*) 返回的是 BigInt，需要转换为 Number
    const totalCheckinDays = Number(countRows[0]?.c || 0)
    
    // 更新last_checkin_date（取最新的打卡日期）
    const latestRows = await query(
      'SELECT MAX(checkin_date) AS latest_date FROM checkins WHERE user_id = ?',
      [req.user.id]
    )
    const latestDate = latestRows[0]?.latest_date || checkinDate
    
    // 更新用户表的累计打卡天数
    const updateResult = await exec(
      `UPDATE users 
       SET total_checkin_days = ?, last_checkin_date = ?
       WHERE id = ?`,
      [totalCheckinDays, latestDate, req.user.id]
    )
    
    console.log('[checkins] POST success, checkin_date:', checkinDate, 'total_checkin_days:', totalCheckinDays)
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.json({ ok: true, checkin_date: checkinDate, total_checkin_days: totalCheckinDays })
  } catch (e) {
    console.error('[checkins] POST error:', e.message)
    console.error('[checkins] POST error stack:', e.stack)
    next(e)
  }
})

module.exports = router
