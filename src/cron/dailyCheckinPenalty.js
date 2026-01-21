// 每日24点定时任务：检测所有用户昨天是否断签，自动应用断签惩罚

const cron = require('node-cron')
const { query, exec } = require('../db/query')
const { calculateConsecutiveMissedDays, applyPenalty, formatDate } = require('../services/checkinPenalty')

/**
 * 执行断签检测和惩罚
 */
async function checkAndApplyPenalties() {
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = formatDate(yesterday)
  
  console.log(`[dailyCheckinPenalty] 开始检测 ${yesterdayStr} 的断签情况...`)
  
  try {
    // 查询所有需要检测的用户（last_calc_date不是昨天，或者为null）
    const users = await query(`
      SELECT id, quit_date, last_checkin_date, last_calc_date, total_checkin_days, failure_count
      FROM users
      WHERE last_calc_date IS NULL OR last_calc_date < ?
    `, [yesterdayStr])
    
    console.log(`[dailyCheckinPenalty] 找到 ${users.length} 个需要检测的用户`)
    
    let processed = 0
    let penalized = 0
    
    for (const user of users) {
      try {
        // 幂等性检查：如果last_calc_date已经是昨天，跳过
        if (user.last_calc_date === yesterdayStr) {
          continue
        }
        
        // 查询用户所有打卡记录
        const checkinRows = await query(
          'SELECT checkin_date FROM checkins WHERE user_id = ? ORDER BY checkin_date',
          [user.id]
        )
        const checkinDates = checkinRows.map(r => r.checkin_date)
        
        // 计算连续未打卡天数
        const consecutiveMissed = calculateConsecutiveMissedDays(
          checkinDates,
          user.last_checkin_date,
          yesterdayStr
        )
        
        if (consecutiveMissed > 0) {
          // 应用惩罚
          // 累计天数 = 打卡记录总数 - 惩罚扣减
          const checkinCount = checkinDates.length
          const penalty = applyPenalty(checkinCount, consecutiveMissed)
          
          // 更新用户统计
          await exec(
            `UPDATE users 
             SET total_checkin_days = ?,
                 failure_count = failure_count + ?,
                 last_calc_date = ?
             WHERE id = ?`,
            [
              penalty.newTotalDays,
              penalty.failureIncrement,
              yesterdayStr,
              user.id
            ]
          )
          
          penalized++
          console.log(`[dailyCheckinPenalty] 用户 ${user.id} 连续断签 ${consecutiveMissed} 天，累计天数: ${checkinCount} -> ${penalty.newTotalDays}`)
        } else {
          // 没有断签，只更新last_calc_date
          await exec(
            'UPDATE users SET last_calc_date = ? WHERE id = ?',
            [yesterdayStr, user.id]
          )
        }
        
        processed++
      } catch (e) {
        console.error(`[dailyCheckinPenalty] 处理用户 ${user.id} 失败:`, e.message)
      }
    }
    
    console.log(`[dailyCheckinPenalty] 完成：处理 ${processed} 个用户，惩罚 ${penalized} 个用户`)
  } catch (e) {
    console.error('[dailyCheckinPenalty] 执行失败:', e)
  }
}

/**
 * 启动定时任务
 */
function startDailyCron() {
  // 每天00:00执行
  cron.schedule('0 0 * * *', async () => {
    await checkAndApplyPenalties()
  }, {
    timezone: 'Asia/Shanghai'
  })
  
  console.log('[dailyCheckinPenalty] 定时任务已启动：每天00:00执行')
}

module.exports = {
  checkAndApplyPenalties,
  startDailyCron
}
