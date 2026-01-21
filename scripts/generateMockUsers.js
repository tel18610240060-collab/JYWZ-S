const { getPool } = require('../src/db/pool')
const { v4: uuidv4 } = require('uuid')

// 段位阈值（基于rank.md）
const RANK_THRESHOLDS = [
  { name: '倔强青铜', max: 6 },      // 0-6天
  { name: '秩序白银', max: 13 },     // 7-13天
  { name: '荣耀黄金', max: 20 },     // 14-20天
  { name: '尊贵铂金', max: 42 },     // 21-42天
  { name: '永恒钻石', max: 89 },     // 43-89天
  { name: '至尊星耀', max: 269 },    // 90-269天
  { name: '最强王者', max: 364 },    // 270-364天
  { name: '荣耀王者', max: 365 }      // 365+天
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

async function generateMockUsers() {
  const pool = getPool()
  const conn = await pool.getConnection()

  try {
    await conn.beginTransaction()

    // 清空现有数据（可选，谨慎使用）
    // await conn.query('DELETE FROM checkins')
    // await conn.query('DELETE FROM users')

    const today = new Date('2026-01-14')
    const startDate = new Date('2026-01-01')
    const daysDiff = Math.floor((today - startDate) / (1000 * 60 * 60 * 24)) + 1 // 14天

    console.log(`开始生成30000条用户数据...`)
    console.log(`戒烟日期范围: ${formatDate(startDate)} 至 ${formatDate(today)}`)

    const batchSize = 1000
    const totalUsers = 30000
    let inserted = 0

    // 确保每个日期、每个段位都有覆盖
    const usersPerDate = Math.floor(totalUsers / daysDiff) // 每个日期约2142个用户
    const usersPerRank = Math.floor(totalUsers / RANK_THRESHOLDS.length) // 每个段位约3750个用户

    for (let batch = 0; batch < Math.ceil(totalUsers / batchSize); batch++) {
      const batchUsers = []
      const batchCheckins = []

      for (let i = 0; i < batchSize && inserted < totalUsers; i++) {
        const userIndex = inserted

        // 分配戒烟日期：确保每个日期都有用户
        let quitDate
        if (userIndex < daysDiff * usersPerDate) {
          // 前N天均匀分布
          const dateIndex = Math.floor(userIndex / usersPerDate)
          quitDate = new Date(startDate)
          quitDate.setDate(quitDate.getDate() + dateIndex)
        } else {
          // 剩余用户随机分布
          quitDate = getRandomDate(startDate, today)
        }
        quitDate = formatDate(quitDate)

        // 分配累计打卡天数：确保每个段位都有覆盖
        let totalCheckinDays
        if (userIndex < RANK_THRESHOLDS.length * usersPerRank) {
          // 前N个段位均匀分布
          const rankIndex = Math.floor(userIndex / usersPerRank)
          const rank = RANK_THRESHOLDS[rankIndex]
          const prevMax = rankIndex > 0 ? RANK_THRESHOLDS[rankIndex - 1].max : -1
          totalCheckinDays = getRandomInt(prevMax + 1, rank.max)
        } else {
          // 剩余用户随机分布（包含失败用户）
          const shouldFail = Math.random() < 0.15 // 15%失败率
          if (shouldFail) {
            totalCheckinDays = 0
          } else {
            totalCheckinDays = getRandomInt(0, 365)
          }
        }

        // 失败次数：如果累计天数为0，可能有失败记录
        let failureCount = 0
        if (totalCheckinDays === 0) {
          failureCount = Math.random() < 0.7 ? 1 : 0 // 70%的0天用户有失败记录
        } else {
          // 非0天用户也可能有失败记录（但后来恢复了）
          failureCount = Math.random() < 0.1 ? getRandomInt(1, 3) : 0
        }

        // 最后打卡日期和计算日期
        let lastCheckinDate = null
        let lastCalcDate = null
        
        if (totalCheckinDays > 0) {
          // 有打卡记录的用户
          const quitDateObj = new Date(quitDate)
          const daysSinceQuit = Math.floor((today - quitDateObj) / (1000 * 60 * 60 * 24))
          
          // 最后打卡日期应该在戒烟日期之后，且不超过今天
          const maxCheckinDays = Math.min(totalCheckinDays, daysSinceQuit)
          if (maxCheckinDays > 0) {
            const lastCheckinDaysAgo = getRandomInt(0, Math.min(3, daysSinceQuit - maxCheckinDays))
            const lastCheckinDateObj = new Date(today)
            lastCheckinDateObj.setDate(lastCheckinDateObj.getDate() - lastCheckinDaysAgo)
            lastCheckinDate = formatDate(lastCheckinDateObj)
            lastCalcDate = formatDate(new Date(today))
          }
        } else {
          // 失败用户：最后计算日期可能是几天前
          if (failureCount > 0) {
            const daysAgo = getRandomInt(1, 5)
            const calcDateObj = new Date(today)
            calcDateObj.setDate(calcDateObj.getDate() - daysAgo)
            lastCalcDate = formatDate(calcDateObj)
          }
        }

        const openid = `mock_openid_${uuidv4().replace(/-/g, '')}`
        const unionid = Math.random() < 0.3 ? `mock_unionid_${uuidv4().replace(/-/g, '')}` : null
        const nickname = generateNickname()
        const gender = ['男', '女', '保密'][getRandomInt(0, 2)]
        const region = ['北京', '上海', '广州', '深圳', '杭州', '成都', '武汉', '西安'][getRandomInt(0, 7)]
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
          total_checkin_days: totalCheckinDays,
          failure_count: failureCount,
          last_checkin_date: lastCheckinDate,
          last_calc_date: lastCalcDate
        })

        inserted++
      }

      // 批量插入用户（使用INSERT ... VALUES语法）
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

    // 生成打卡记录（为有累计天数的用户生成打卡记录）
    console.log(`\n开始生成打卡记录...`)
    const [users] = await conn.query(`
      SELECT id, quit_date, total_checkin_days, last_checkin_date 
      FROM users 
      WHERE total_checkin_days > 0 AND last_checkin_date IS NOT NULL
      ORDER BY id
    `)

    console.log(`找到 ${users.length} 个需要生成打卡记录的用户`)

    const checkinBatch = []
    let checkinCount = 0

    for (const user of users) {
      const quitDate = new Date(user.quit_date)
      const lastCheckinDate = new Date(user.last_checkin_date)
      const daysSinceQuit = Math.floor((lastCheckinDate - quitDate) / (1000 * 60 * 60 * 24))
      
      if (daysSinceQuit <= 0) continue

      // 生成打卡记录：确保打卡数量不超过累计天数
      const targetCheckinCount = Math.min(user.total_checkin_days, daysSinceQuit)
      const checkinDates = new Set()
      
      // 生成连续的打卡日期（模拟真实打卡行为）
      let generatedCount = 0
      let currentDate = new Date(quitDate)
      
      while (generatedCount < targetCheckinCount && currentDate <= lastCheckinDate) {
        // 80%的概率打卡（模拟偶尔断签）
        if (Math.random() < 0.8) {
          checkinDates.add(formatDate(currentDate))
          generatedCount++
        }
        currentDate.setDate(currentDate.getDate() + 1)
      }

      // 如果生成的打卡数不够，随机补充一些
      while (checkinDates.size < targetCheckinCount && checkinDates.size < daysSinceQuit) {
        const randomDaysAgo = getRandomInt(0, daysSinceQuit)
        const checkinDateObj = new Date(quitDate)
        checkinDateObj.setDate(checkinDateObj.getDate() + randomDaysAgo)
        checkinDates.add(formatDate(checkinDateObj))
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
            INSERT IGNORE INTO checkins (user_id, checkin_date, mood, note, image_urls)
            VALUES ?
          `, [checkinBatch])
          checkinBatch.length = 0
          console.log(`已生成 ${checkinCount} 条打卡记录...`)
        }
      }
    }

    if (checkinBatch.length > 0) {
      await conn.query(`
        INSERT IGNORE INTO checkins (user_id, checkin_date, mood, note, image_urls)
        VALUES ?
      `, [checkinBatch])
    }

    console.log(`✅ 打卡记录生成完成，共 ${checkinCount} 条`)

  } catch (e) {
    await conn.rollback()
    console.error('生成数据失败:', e)
    throw e
  } finally {
    conn.release()
    await pool.end()
  }
}

// 运行
generateMockUsers().then(() => {
  console.log('\n🎉 数据生成完成！')
  process.exit(0)
}).catch((e) => {
  console.error('\n❌ 数据生成失败:', e)
  process.exit(1)
})
