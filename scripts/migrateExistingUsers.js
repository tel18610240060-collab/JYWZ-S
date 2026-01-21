// 为现有用户计算初始total_checkin_days（基于历史打卡记录）

const mysql = require('mysql2/promise')
require('dotenv').config()

const config = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'root',
  database: process.env.DB_NAME || 'quit_smoking_king'
}

async function migrateExistingUsers() {
  let conn
  try {
    conn = await mysql.createConnection(config)
    console.log('[migrateExistingUsers] 连接数据库成功')
    
    // 查询所有用户
    const [users] = await conn.query('SELECT id FROM users')
    console.log(`[migrateExistingUsers] 找到 ${users.length} 个用户`)
    
    let updated = 0
    
    for (const user of users) {
      // 查询用户的打卡记录数
      const [checkinRows] = await conn.query(
        'SELECT COUNT(*) as count FROM checkins WHERE user_id = ?',
        [user.id]
      )
      const checkinCount = checkinRows[0].count || 0
      
      // 查询最后打卡日期
      const [lastCheckinRows] = await conn.query(
        'SELECT MAX(checkin_date) as last_date FROM checkins WHERE user_id = ?',
        [user.id]
      )
      const lastCheckinDate = lastCheckinRows[0].last_date || null
      
      // 更新用户统计
      await conn.query(
        `UPDATE users 
         SET total_checkin_days = ?,
             last_checkin_date = ?
         WHERE id = ?`,
        [checkinCount, lastCheckinDate, user.id]
      )
      
      updated++
      if (updated % 100 === 0) {
        console.log(`[migrateExistingUsers] 已更新 ${updated} 个用户`)
      }
    }
    
    console.log(`[migrateExistingUsers] 完成：共更新 ${updated} 个用户`)
  } catch (e) {
    console.error('[migrateExistingUsers] 错误:', e)
    process.exit(1)
  } finally {
    if (conn) await conn.end()
  }
}

migrateExistingUsers()
