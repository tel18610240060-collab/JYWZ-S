const express = require('express')
const { requireAuth } = require('../auth')
const { query, exec } = require('../db/query')
const { config } = require('../config')
const { refreshAccessToken, getFollowingList, getFansList } = require('../douyin')

const router = express.Router()

async function getFallbackRankedFriends(meId) {
  const ranked = await query(
    `SELECT u.openid AS id,
            u.nickname AS nickName,
            u.avatar_url AS avatarUrl,
            CASE WHEN u.quit_date IS NULL THEN 0 ELSE DATEDIFF(CURDATE(), u.quit_date) END AS quitDays
     FROM users u
     WHERE u.id != ?
     ORDER BY quitDays DESC
     LIMIT 200`,
    [meId]
  )

  ranked.forEach((r, idx) => {
    r.rank = idx + 1
  })
  return ranked
}

async function tryGetDouyinRelationFriends(meId) {
  // 关系链能力并非一定开放给所有应用；这里先做“抽象层”占位：
  // 1) 小程序端 showDouyinOpenAuth -> ticket 已通过 /api/douyin/open-auth 存储在 douyin_open_tokens
  // 2) 如果后续拿到关系链开放接口，只需要在这里用 open access_token 调接口，
  //    再把返回的 open_id/openid 映射到本地 users 表即可。
  if (config.ENABLE_DOUYIN_RELATION !== '1') return null

  const rows = await query(
    `SELECT scope, open_id, access_token, refresh_token, expires_at, refresh_expires_at
     FROM douyin_open_tokens
     WHERE user_id=?
     ORDER BY expires_at DESC
     LIMIT 1`,
    [meId]
  )
  if (!rows.length) return null

  let { scope, open_id: openId, access_token: accessToken, refresh_token: refreshToken, expires_at: expiresAt } = rows[0]
  const scopeStr = String(scope || '')

  // 必须具备 following.list + fans.list，才能计算“互关好友”
  if (!scopeStr.includes('following.list') || !scopeStr.includes('fans.list')) return null
  if (!openId || !accessToken || !refreshToken) return null

  // access_token 过期则刷新（或续期）
  const expMs = new Date(expiresAt).getTime()
  const nowMs = Date.now()
  if (!Number.isNaN(expMs) && expMs <= nowMs + 60 * 1000) {
    const tok = await refreshAccessToken({ refreshToken })
    accessToken = tok.access_token
    refreshToken = tok.refresh_token || refreshToken
    openId = tok.open_id || openId
    scope = tok.scope || scope

    const newExpAt = new Date(nowMs + Math.max(1, Number(tok.expires_in || 0)) * 1000)
    const newRefreshExpAt = new Date(nowMs + Math.max(1, Number(tok.refresh_expires_in || 0)) * 1000)
    await exec(
      `UPDATE douyin_open_tokens
       SET scope=?, open_id=?, access_token=?, refresh_token=?, expires_at=?, refresh_expires_at=?
       WHERE user_id=? AND scope=?`,
      [scope, openId, accessToken, refreshToken, newExpAt, newRefreshExpAt, meId, scopeStr]
    )
  }

  // 取关注与粉丝的交集（互关=好友）
  async function collectAll(fetchFn, { max = 200, pageSize = 50 } = {}) {
    let cursor = 0
    let hasMore = true
    const out = []
    while (hasMore && out.length < max) {
      const d = await fetchFn({ accessToken, openId, cursor, count: pageSize })
      const list = Array.isArray(d.list) ? d.list : []
      out.push(...list)
      hasMore = !!d.has_more
      cursor = Number(d.cursor || 0)
      if (list.length === 0) break
    }
    return out.slice(0, max)
  }

  const [following, fans] = await Promise.all([
    collectAll(getFollowingList, { max: 500, pageSize: 50 }),
    collectAll(getFansList, { max: 500, pageSize: 50 })
  ])

  const followUnion = new Set(following.map((x) => x && x.union_id).filter(Boolean))
  const mutualUnionIds = Array.from(new Set(fans.map((x) => x && x.union_id).filter((u) => u && followUnion.has(u))))
  if (mutualUnionIds.length === 0) return []

  // 映射到本地已注册用户（按 unionid 关联）
  const placeholders = mutualUnionIds.map(() => '?').join(',')
  const local = await query(
    `SELECT openid, unionid, nickname, avatar_url,
            CASE WHEN quit_date IS NULL THEN 0 ELSE DATEDIFF(CURDATE(), quit_date) END AS quitDays
     FROM users
     WHERE unionid IN (${placeholders})
     LIMIT 500`,
    mutualUnionIds
  )

  // 按 quitDays 倒序排名
  local.sort((a, b) => Number(b.quitDays || 0) - Number(a.quitDays || 0))
  const ranked = local.slice(0, 200).map((u, idx) => ({
    id: u.openid,
    nickName: u.nickname,
    avatarUrl: u.avatar_url,
    quitDays: Number(u.quitDays || 0),
    rank: idx + 1
  }))

  return ranked
}

// 好友群组：这里用“互相关注”作为好友定义（可替换为抖音官方关系链能力）
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const rel = await tryGetDouyinRelationFriends(req.user.id)
    if (rel && Array.isArray(rel)) {
      res.setHeader('X-Friends-Source', 'douyin')
      res.json(rel)
      return
    }

    const ranked = await getFallbackRankedFriends(req.user.id)
    res.setHeader('X-Friends-Source', 'fallback')
    res.json(ranked)
  } catch (e) {
    next(e)
  }
})

router.post('/follow', requireAuth, async (req, res, next) => {
  try {
    const { targetOpenid } = req.body || {}
    if (!targetOpenid) return res.status(400).json({ error: 'missing targetOpenid' })

    const target = await query('SELECT id FROM users WHERE openid=? LIMIT 1', [targetOpenid])
    if (!target.length) return res.status(404).json({ error: 'target not found' })

    await exec('INSERT IGNORE INTO follows(follower_id, followee_id) VALUES(?,?)', [req.user.id, target[0].id])
    res.json({ ok: true })
  } catch (e) {
    next(e)
  }
})

router.post('/unfollow', requireAuth, async (req, res, next) => {
  try {
    const { targetOpenid } = req.body || {}
    if (!targetOpenid) return res.status(400).json({ error: 'missing targetOpenid' })

    const target = await query('SELECT id FROM users WHERE openid=? LIMIT 1', [targetOpenid])
    if (!target.length) return res.status(404).json({ error: 'target not found' })

    await exec('DELETE FROM follows WHERE follower_id=? AND followee_id=?', [req.user.id, target[0].id])
    res.json({ ok: true })
  } catch (e) {
    next(e)
  }
})

module.exports = router
