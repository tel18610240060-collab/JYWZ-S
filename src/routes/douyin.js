const express = require('express')
const { requireAuth } = require('../auth')
const { exec, query } = require('../db/query')
const { exchangeOpenAuthTicket } = require('../douyin')

const router = express.Router()

// 小程序 showDouyinOpenAuth 成功后：上报 ticket，让后端换取 access_token 并持久化
router.post('/open-auth', requireAuth, async (req, res, next) => {
  try {
    const { ticket } = req.body || {}
    if (!ticket) return res.status(400).json({ error: 'missing ticket' })

    const tok = await exchangeOpenAuthTicket(ticket)
    const scope = tok.scope || 'unknown'

    const now = Date.now()
    const expiresAt = new Date(now + Math.max(1, Number(tok.expires_in || 0)) * 1000)
    const refreshExpiresAt = new Date(now + Math.max(1, Number(tok.refresh_expires_in || 0)) * 1000)

    await exec(
      `INSERT INTO douyin_open_tokens(user_id, scope, open_id, access_token, refresh_token, expires_at, refresh_expires_at)
       VALUES(?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         open_id=VALUES(open_id),
         access_token=VALUES(access_token),
         refresh_token=VALUES(refresh_token),
         expires_at=VALUES(expires_at),
         refresh_expires_at=VALUES(refresh_expires_at)`,
      [req.user.id, scope, tok.open_id || null, tok.access_token, tok.refresh_token, expiresAt, refreshExpiresAt]
    )

    res.json({ ok: true, scope, expires_at: expiresAt.toISOString() })
  } catch (e) {
    next(e)
  }
})

router.get('/open-auth/status', requireAuth, async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT scope, open_id, expires_at, refresh_expires_at
       FROM douyin_open_tokens
       WHERE user_id=?
       ORDER BY expires_at DESC
       LIMIT 20`,
      [req.user.id]
    )
    res.json(rows)
  } catch (e) {
    next(e)
  }
})

module.exports = router

