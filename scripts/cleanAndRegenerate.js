const { getPool } = require('../src/db/pool')
const { v4: uuidv4 } = require('uuid')

// 段位阈值（基于 rank.js，使用 maxDays 作为段位上限）
const RANK_THRESHOLDS = [
  { name: '倔强青铜', min: 0, max: 8 },      // 0-8天（晋升到白银）
  { name: '秩序白银', min: 8, max: 17 },     // 8-17天（晋升到黄金）
  { name: '荣耀黄金', min: 17, max: 22 },     // 17-22天（晋升到铂金）
  { name: '尊贵铂金', min: 22, max: 45 },    // 22-45天（晋升到钻石）
  { name: '永恒钻石', min: 45, max: 93 },     // 45-93天（晋升到星耀）
  { name: '至尊星耀', min: 93, max: 271 },    // 93-271天（晋升到王者）
  { name: '最强王者', min: 271, max: 365 },   // 271-365天
  { name: '荣耀王者', min: 365, max: 500 }    // 365+天
]

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function getRandomDate(start, end) {
  const startTime = start.getTime()
  const endTime = end.getTime()
  const randomTime = startTime + Math.random() * (endTime - startTime)
  return new Date(randomTime)
}

function formatDate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function generateNickname() {
  const prefixes = ['戒烟', '坚持', '健康', '自律', '勇敢', '坚强', '决心', '毅力', '成功', '胜利']
  const suffixes = ['者', '人', '君', '王', '星', '光', '火', '风', '云', '海']
  return prefixes[getRandomInt(0, prefixes.length - 1)] + 
         suffixes[getRandomInt(0, suffixes.length - 1)] + 
         getRandomInt(1000, 9999)
}

async function cleanAndRegenerate() {
  const pool = getPool()
  const conn = await pool.getConnection()

  try {
    await conn.beginTransaction()

    // 1. 清理现有数据
    console.log('🧹 清理现有测试数据...')
    await conn.query('DELETE FROM checkins WHERE user_id IN (SELECT id FROM users WHERE openid LIKE "mock_%")')
    await conn.query('DELETE FROM users WHERE openid LIKE "mock_%"')
    console.log('✅ 清理完成')

    // 2. 生成新数据
    const today = new Date('2026-01-15')
    const startDate = new Date('2025-01-01')
    const endDate = new Date('2026-01-15')
    const daysDiff = Math.floor((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1 // 380天

    console.log(`\n📊 开始生成 3000 条用户数据...`)
    console.log(`戒烟日期范围: ${formatDate(startDate)} 至 ${formatDate(endDate)}`)

    const totalUsers = 3000
    const batchSize = 500
    let inserted = 0

    // 确保每个段位都有覆盖
    const usersPerRank = Math.floor(totalUsers / RANK_THRESHOLDS.length) // 每个段位约375个用户
    const failedUsersCount = Math.floor(totalUsers * 0.1) // 10%失败用户

    for (let batch = 0; batch < Math.ceil(totalUsers / batchSize); batch++) {
      const batchUsers = []

      for (let i = 0; i < batchSize && inserted < totalUsers; i++) {
        const userIndex = inserted

        // 分配戒烟日期：均匀分布在整个日期范围
        let quitDate
        if (userIndex < daysDiff) {
          // 前N天均匀分布
          quitDate = new Date(startDate)
          quitDate.setDate(quitDate.getDate() + (userIndex % daysDiff))
        } else {
          // 剩余用户随机分布
          quitDate = getRandomDate(startDate, endDate)
        }
        quitDate = formatDate(quitDate)

        // 先计算戒烟日期到今天的实际天数
        const quitDateObj = new Date(quitDate)
        const daysSinceQuit = Math.floor((today - quitDateObj) / (1000 * 60 * 60 * 24))
        
        // 分配累计打卡天数：确保每个段位都有覆盖，且不超过实际可能的天数
        let totalCheckinDays
        const isFailedUser = userIndex < failedUsersCount
        
        if (isFailedUser) {
          // 失败用户：total_checkin_days = 0
          totalCheckinDays = 0
        } else if (userIndex < RANK_THRESHOLDS.length * usersPerRank) {
          // 前N个段位均匀分布
          const rankIndex = Math.floor((userIndex - failedUsersCount) / usersPerRank)
          const rank = RANK_THRESHOLDS[rankIndex]
          const prevMin = rankIndex > 0 ? RANK_THRESHOLDS[rankIndex - 1].max : rank.min
          const maxPossible = Math.min(rank.max, daysSinceQuit + 1)
          totalCheckinDays = getRandomInt(prevMin, maxPossible)
        } else {
          // 剩余用户随机分布
          const randomRank = RANK_THRESHOLDS[getRandomInt(0, RANK_THRESHOLDS.length - 1)]
          const maxPossible = Math.min(randomRank.max, daysSinceQuit + 1)
          totalCheckinDays = getRandomInt(randomRank.min, maxPossible)
        }
        
        // 确保 total_checkin_days 不超过实际经过的天数
        totalCheckinDays = Math.min(totalCheckinDays, daysSinceQuit + 1)

        // 失败次数
        let failureCount = 0
        if (totalCheckinDays === 0) {
          failureCount = Math.random() < 0.8 ? 1 : 0 // 80%的0天用户有失败记录
        } else {
          // 非0天用户也可能有失败记录（但后来恢复了）
          failureCount = Math.random() < 0.05 ? getRandomInt(1, 2) : 0
        }

        // 计算最后打卡日期
        let lastCheckinDate = null
        let lastCalcDate = null
        
        if (totalCheckinDays > 0) {
          // 最后打卡日期：从今天往前推，确保有足够的天数来生成打卡记录
          // 最后打卡日期应该至少是 quitDate + (totalCheckinDays - 1) 天
          const minLastCheckinDays = Math.max(0, totalCheckinDays - 1)
          const maxLastCheckinDays = Math.min(daysSinceQuit, daysSinceQuit)
          const lastCheckinDaysFromQuit = getRandomInt(minLastCheckinDays, maxLastCheckinDays)
          
          const lastCheckinDateObj = new Date(quitDateObj)
          lastCheckinDateObj.setDate(lastCheckinDateObj.getDate() + lastCheckinDaysFromQuit)
          lastCheckinDate = formatDate(lastCheckinDateObj)
          lastCalcDate = formatDate(new Date(today))
        } else {
          // 失败用户：最后计算日期可能是几天前
          if (failureCount > 0) {
            const daysAgo = getRandomInt(1, 10)
            const calcDateObj = new Date(today)
            calcDateObj.setDate(calcDateObj.getDate() - daysAgo)
            lastCalcDate = formatDate(calcDateObj)
          }
        }

        const openid = `mock_openid_${uuidv4().replace(/-/g, '')}`
        const unionid = Math.random() < 0.3 ? `mock_unionid_${uuidv4().replace(/-/g, '')}` : null
        const nickname = generateNickname()
        const gender = ['男', '女', '保密'][getRandomInt(0, 2)]
        const region = ['北京', '上海', '广州', '深圳', '杭州', '成都', '武汉', '西安', '南京', '重庆'][getRandomInt(0, 9)]
        const pricePerCig = (Math.random() * 2 + 0.5).toFixed(2)
        const cigsPerDay = getRandomInt(5, 30)

        batchUsers.push({
          openid,
          unionid,
          nickname,
          avatar_url: `https://example.com/avatar/${getRandomInt(1, 100)}.jpg`,
          gender,
          region,
          quit_date: quitDate,
          price_per_cig: pricePerCig,
          cigs_per_day: cigsPerDay,
          total_checkin_days: totalCheckinDays, // 注意：这里可能在上面的逻辑中被调整过
          failure_count: failureCount,
          last_checkin_date: lastCheckinDate,
          last_calc_date: lastCalcDate
        })

        inserted++
      }

      // 批量插入用户
      const userSql = `
        INSERT INTO users (
          openid, unionid, nickname, avatar_url, gender, region, quit_date,
          price_per_cig, cigs_per_day,
          total_checkin_days, failure_count, last_checkin_date, last_calc_date
        ) VALUES ?
      `
      const userValues = batchUsers.map(u => [
        u.openid, u.unionid, u.nickname, u.avatar_url, u.gender, u.region, u.quit_date,
        u.price_per_cig, u.cigs_per_day,
        u.total_checkin_days, u.failure_count, u.last_checkin_date, u.last_calc_date
      ])
      
      await conn.query(userSql, [userValues])

      console.log(`已插入 ${inserted}/${totalUsers} 个用户`)
    }

    await conn.commit()
    console.log(`\n✅ 成功生成 ${inserted} 条用户数据`)

    // 3. 生成打卡记录（确保 total_checkin_days 和实际打卡记录数一致）
    await conn.beginTransaction() // 开始新事务用于生成打卡记录
    console.log(`\n📝 开始生成打卡记录...`)
    
    // 先清理所有 mock 用户的打卡记录，避免重复
    await conn.query('DELETE FROM checkins WHERE user_id IN (SELECT id FROM users WHERE openid LIKE "mock_%")')
    
    const [users] = await conn.query(`
      SELECT id, quit_date, total_checkin_days, last_checkin_date 
      FROM users 
      WHERE openid LIKE "mock_%" AND total_checkin_days > 0 AND last_checkin_date IS NOT NULL
      ORDER BY id
    `)

    console.log(`找到 ${users.length} 个需要生成打卡记录的用户`)

    const checkinBatch = []
    let checkinCount = 0
    let skippedCount = 0

    for (const user of users) {
      const quitDate = new Date(user.quit_date)
      const lastCheckinDate = new Date(user.last_checkin_date)
      const daysSinceQuit = Math.floor((lastCheckinDate - quitDate) / (1000 * 60 * 60 * 24))
      
      if (daysSinceQuit <= 0) {
        skippedCount++
        continue
      }

      // 确保打卡数量等于 total_checkin_days
      const targetCheckinCount = Math.min(user.total_checkin_days, daysSinceQuit + 1)
      
      // 如果目标打卡数超过可用日期数，调整目标数
      if (targetCheckinCount > daysSinceQuit + 1) {
        skippedCount++
        continue
      }
      
      const checkinDates = new Set()
      
      // 生成打卡日期：先收集所有可能的日期
      const allPossibleDates = []
      const endDate = new Date(lastCheckinDate)
      for (let d = 0; d <= daysSinceQuit; d++) {
        const dateObj = new Date(quitDate)
        dateObj.setDate(dateObj.getDate() + d)
        if (dateObj <= endDate) {
          allPossibleDates.push(formatDate(dateObj))
        }
      }
      
      // 如果可用日期数少于目标数，调整目标数
      if (targetCheckinCount > allPossibleDates.length) {
        // 这种情况不应该发生，因为我们已经检查过了，但为了安全还是处理一下
        skippedCount++
        continue
      }
      
      // 随机选择 targetCheckinCount 个日期
      const shuffled = allPossibleDates.sort(() => Math.random() - 0.5)
      for (let i = 0; i < targetCheckinCount && i < shuffled.length; i++) {
        checkinDates.add(shuffled[i])
      }
      
      // 最终检查：确保数量正确
      if (checkinDates.size !== targetCheckinCount) {
        skippedCount++
        continue
      }
      
      // 插入打卡记录
      for (const checkinDate of checkinDates) {
        checkinBatch.push([
          user.id,
          checkinDate,
          ['开心', '平静', '焦虑', '自信', '疲惫'][getRandomInt(0, 4)],
          Math.random() < 0.3 ? '今天也很棒！' : null,
          null
        ])
        checkinCount++

        if (checkinBatch.length >= 1000) {
          await conn.query(`
            INSERT INTO checkins (user_id, checkin_date, mood, note, image_urls)
            VALUES ?
            ON DUPLICATE KEY UPDATE mood=VALUES(mood), note=VALUES(note), image_urls=VALUES(image_urls)
          `, [checkinBatch])
          checkinBatch.length = 0
          console.log(`已生成 ${checkinCount} 条打卡记录...`)
        }
      }
    }
    
    if (skippedCount > 0) {
      console.log(`⚠️  跳过了 ${skippedCount} 个用户（数据异常）`)
    }

    if (checkinBatch.length > 0) {
      await conn.query(`
        INSERT INTO checkins (user_id, checkin_date, mood, note, image_urls)
        VALUES ?
        ON DUPLICATE KEY UPDATE mood=VALUES(mood), note=VALUES(note), image_urls=VALUES(image_urls)
      `, [checkinBatch])
    }

    // 提交打卡记录
    await conn.commit()
    console.log(`\n✅ 打卡记录生成完成，共 ${checkinCount} 条`)

    // 最终验证：确保所有用户的 total_checkin_days 和实际打卡记录数一致
    console.log(`\n🔍 验证数据一致性...`)
    const [verifyRows] = await conn.query(`
      SELECT u.id, u.total_checkin_days, COUNT(c.id) AS actual_count
      FROM users u
      LEFT JOIN checkins c ON c.user_id = u.id
      WHERE u.openid LIKE "mock_%"
      GROUP BY u.id, u.total_checkin_days
      HAVING u.total_checkin_days != COUNT(c.id)
    `)
    
    if (verifyRows.length > 0) {
      console.log(`⚠️  发现 ${verifyRows.length} 个用户数据不一致，正在修复...`)
      await conn.beginTransaction()
      for (const row of verifyRows) {
        await conn.query(
          'UPDATE users SET total_checkin_days = ? WHERE id = ?',
          [row.actual_count, row.id]
        )
      }
      await conn.commit()
      console.log(`✅ 已修复 ${verifyRows.length} 个用户的数据`)
    } else {
      console.log(`✅ 所有用户数据一致性验证通过`)
    }

  } catch (e) {
    await conn.rollback()
    console.error('❌ 生成数据失败:', e)
    throw e
  } finally {
    conn.release()
    await pool.end()
  }
}

// 运行
cleanAndRegenerate().then(() => {
  console.log('\n🎉 数据清理和重新生成完成！')
  process.exit(0)
}).catch((e) => {
  console.error('\n❌ 操作失败:', e)
  process.exit(1)
})
