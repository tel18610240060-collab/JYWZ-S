const { getPool } = require('../src/db/pool')

function formatDate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

async function updateLastCheckinDate() {
  const pool = getPool()
  const conn = await pool.getConnection()

  try {
    await conn.beginTransaction()

    const today = new Date()
    const todayStr = formatDate(today)

    console.log(`🔄 开始更新所有用户的 last_checkin_date 为 ${todayStr}...`)

    // 更新所有有打卡记录的用户（total_checkin_days > 0）
    const [result] = await conn.query(
      `UPDATE users 
       SET last_checkin_date = ? 
       WHERE total_checkin_days > 0 AND last_checkin_date IS NOT NULL`,
      [todayStr]
    )

    console.log(`✅ 已更新 ${result.affectedRows} 个用户的 last_checkin_date`)

    await conn.commit()

  } catch (e) {
    await conn.rollback()
    console.error('❌ 更新失败:', e)
    throw e
  } finally {
    conn.release()
    await pool.end()
  }
}

// 运行
updateLastCheckinDate().then(() => {
  console.log('\n🎉 更新完成！')
  process.exit(0)
}).catch((e) => {
  console.error('\n❌ 操作失败:', e)
  process.exit(1)
})
