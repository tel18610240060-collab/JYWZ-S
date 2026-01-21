/**
 * 首页功能全面测试脚本
 * 测试数据准确性、计算逻辑、API接口等
 */

const { query } = require('../src/db/query')

// 模拟前端的 getStats 计算逻辑
function calculateStats(quitDate, now = new Date()) {
  if (!quitDate) return { days: 0, avoided: 0, saved: 0 }
  
  const quit = new Date(quitDate)
  const days = Math.max(0, Math.floor((now - quit) / (1000 * 60 * 60 * 24)))
  
  // 默认配置（可以从数据库获取实际配置）
  const cigsPerDay = 10
  const pricePerCig = 1.50
  
  const avoided = Math.round(days * cigsPerDay)
  const saved = Math.round(days * cigsPerDay * pricePerCig)
  
  return { days, avoided, saved }
}

// 模拟前端的 getRank 计算逻辑（简化版）
function calculateRank(days) {
  if (days < 1) return { name: '倔强青铜Ⅲ', rank: '倔强青铜', tier: 'Ⅲ', stars: 2 }
  if (days < 7) return { name: '倔强青铜Ⅱ', rank: '倔强青铜', tier: 'Ⅱ', stars: 1 }
  if (days < 14) return { name: '倔强青铜Ⅰ', rank: '倔强青铜', tier: 'Ⅰ', stars: 0 }
  if (days < 30) return { name: '秩序白银Ⅲ', rank: '秩序白银', tier: 'Ⅲ', stars: 2 }
  if (days < 60) return { name: '秩序白银Ⅱ', rank: '秩序白银', tier: 'Ⅱ', stars: 1 }
  if (days < 90) return { name: '秩序白银Ⅰ', rank: '秩序白银', tier: 'Ⅰ', stars: 0 }
  if (days < 120) return { name: '荣耀黄金Ⅳ', rank: '荣耀黄金', tier: 'Ⅳ', stars: 3 }
  // ... 更多段位
  return { name: '最强王者', rank: '最强王者', tier: 'Ⅴ', stars: 5 }
}

async function testUserPersonalStats(userId) {
  console.log('\n=== 用户个人统计测试 ===')
  
  const [userRows] = await query(
    `SELECT u.id, u.nickname, u.quit_date, u.region, 
            u.total_checkin_days, u.price_per_cig, u.cigs_per_day,
            COUNT(DISTINCT c.checkin_date) AS actual_checkin_count
     FROM users u
     LEFT JOIN checkins c ON c.user_id = u.id
     WHERE u.id = ?
     GROUP BY u.id`,
    [userId]
  )
  
  if (!userRows || userRows.length === 0) {
    console.error(`❌ 用户 ${userId} 不存在`)
    return null
  }
  
  const user = userRows[0]
  console.log(`用户: ${user.nickname} (ID: ${user.id})`)
  console.log(`戒烟日期: ${user.quit_date}`)
  console.log(`数据库累计打卡天数: ${user.total_checkin_days || 0}`)
  console.log(`实际打卡记录数: ${user.actual_checkin_count || 0}`)
  
  // 验证打卡天数一致性
  if (user.total_checkin_days !== user.actual_checkin_count) {
    console.warn(`⚠ 警告: 累计打卡天数(${user.total_checkin_days}) ≠ 实际打卡记录数(${user.actual_checkin_count})`)
  } else {
    console.log(`✓ 打卡天数一致性验证通过`)
  }
  
  // 计算前端应显示的数据
  const stats = calculateStats(user.quit_date)
  console.log(`\n前端计算的数据:`)
  console.log(`  打卡天数: ${stats.days}`)
  console.log(`  累计少吸: ${stats.avoided} 支`)
  console.log(`  节省金钱: ${stats.saved} 元`)
  
  // 使用实际配置计算
  const actualCigsPerDay = user.cigs_per_day || 10
  const actualPricePerCig = Number(user.price_per_cig) || 1.50
  const actualAvoided = Math.round(stats.days * actualCigsPerDay)
  const actualSaved = Math.round(stats.days * actualCigsPerDay * actualPricePerCig)
  
  console.log(`\n使用用户实际配置计算:`)
  console.log(`  每天吸烟: ${actualCigsPerDay} 支`)
  console.log(`  每支价格: ${actualPricePerCig} 元`)
  console.log(`  累计少吸: ${actualAvoided} 支`)
  console.log(`  节省金钱: ${actualSaved} 元`)
  
  // 段位计算
  const rank = calculateRank(user.total_checkin_days || stats.days)
  console.log(`\n段位信息:`)
  console.log(`  段位名称: ${rank.name}`)
  console.log(`  段位等级: ${rank.rank}`)
  console.log(`  罗马数字: ${rank.tier}`)
  console.log(`  星星数量: ${rank.stars}`)
  
  return { user, stats, rank }
}

async function testSameDayStatsLogic(quitDate, userRegion) {
  console.log('\n=== 同日戒烟统计逻辑测试 ===')
  console.log(`戒烟日期: ${quitDate}`)
  console.log(`用户地区: ${userRegion || '(未设置)'}`)
  
  // 1. 统计总数
  const [totalRows] = await query('SELECT COUNT(*) AS c FROM users WHERE quit_date=?', [quitDate])
  const total = Number(totalRows.c || 0)
  
  // 2. 统计失败数
  const [failedRows] = await query(
    'SELECT COUNT(*) AS c FROM users WHERE quit_date=? AND total_checkin_days=0',
    [quitDate]
  )
  const failed = Number(failedRows.c || 0)
  
  // 3. 统计活跃数
  const [activeRows] = await query(
    'SELECT COUNT(*) AS c FROM users WHERE quit_date=? AND total_checkin_days>0',
    [quitDate]
  )
  const active = Number(activeRows.c || 0)
  
  // 4. 验证数据一致性
  const sum = failed + active
  console.log(`\n统计结果:`)
  console.log(`  总数: ${total}`)
  console.log(`  失败数: ${failed}`)
  console.log(`  活跃数: ${active}`)
  console.log(`  失败数 + 活跃数 = ${sum}`)
  
  if (total !== sum) {
    console.error(`❌ 数据不一致！总数(${total}) ≠ 失败数(${failed}) + 活跃数(${active})`)
    console.error(`   差异: ${Math.abs(total - sum)} 个用户`)
  } else {
    console.log(`✓ 数据一致性验证通过`)
  }
  
  // 5. 同城人数
  let cityTotal = 0
  if (userRegion) {
    const [cityRows] = await query(
      'SELECT COUNT(*) AS c FROM users WHERE quit_date=? AND region=?',
      [quitDate, userRegion]
    )
    cityTotal = Number(cityRows.c || 0)
    console.log(`\n同城人数: ${cityTotal}`)
    
    if (cityTotal > total) {
      console.error(`❌ 同城人数(${cityTotal}) 大于总数(${total})，数据异常！`)
    } else {
      console.log(`✓ 同城人数验证通过 (${cityTotal} ≤ ${total})`)
    }
  } else {
    console.log(`\n同城人数: 0 (用户未设置地区)`)
  }
  
  return { total, active, failed, cityTotal, reduction: 0 }
}

async function testCalendarLogic(userId) {
  console.log('\n=== 日历逻辑测试 ===')
  
  // 获取用户的打卡记录
  const checkins = await query(
    'SELECT checkin_date FROM checkins WHERE user_id=? ORDER BY checkin_date DESC LIMIT 30',
    [userId]
  )
  
  const checkinDates = checkins.map(c => c.checkin_date.toISOString().slice(0, 10))
  const today = new Date().toISOString().slice(0, 10)
  
  console.log(`用户打卡记录数: ${checkinDates.length}`)
  console.log(`最近7条记录: ${checkinDates.slice(0, 7).join(', ')}`)
  
  // 判断是否是第一次打卡
  const checkedToday = checkinDates.includes(today)
  const isFirstCheckin = checkedToday && checkinDates.length === 1
  
  console.log(`今天是否已打卡: ${checkedToday}`)
  console.log(`是否是第一次打卡: ${isFirstCheckin}`)
  
  // 计算昨天和前天
  const todayDate = new Date()
  const yesterday = new Date(todayDate)
  yesterday.setDate(yesterday.getDate() - 1)
  const dayBeforeYesterday = new Date(todayDate)
  dayBeforeYesterday.setDate(dayBeforeYesterday.getDate() - 2)
  
  const yesterdayStr = yesterday.toISOString().slice(0, 10)
  const dayBeforeYesterdayStr = dayBeforeYesterday.toISOString().slice(0, 10)
  
  console.log(`\n补打卡规则测试:`)
  console.log(`  昨天: ${yesterdayStr} - ${checkinDates.includes(yesterdayStr) ? '已打卡' : '可补打卡'}`)
  console.log(`  前天: ${dayBeforeYesterdayStr} - ${checkinDates.includes(dayBeforeYesterdayStr) ? '已打卡' : '可补打卡'}`)
  
  if (isFirstCheckin) {
    console.log(`⚠ 第一次打卡：昨天和前天应显示×（不允许补打卡）`)
  } else {
    if (!checkinDates.includes(yesterdayStr)) {
      console.log(`✓ 昨天未打卡，应显示"补"标记`)
    }
    if (!checkinDates.includes(dayBeforeYesterdayStr)) {
      console.log(`✓ 前天未打卡，应显示"补"标记`)
    }
  }
  
  return { checkinDates, checkedToday, isFirstCheckin }
}

async function testAPIResponse(userId) {
  console.log('\n=== API响应数据测试 ===')
  
  const [userRows] = await query('SELECT id, quit_date, region FROM users WHERE id=? LIMIT 1', [userId])
  if (!userRows || userRows.length === 0) {
    console.error(`❌ 用户 ${userId} 不存在`)
    return null
  }
  
  const user = userRows[0]
  if (!user.quit_date) {
    console.error(`❌ 用户未设置戒烟日期`)
    return null
  }
  
  // 模拟API应该返回的数据
  const stats = await testSameDayStatsLogic(user.quit_date, user.region)
  
  const apiResponse = {
    group_key: user.quit_date,
    ...stats
  }
  
  console.log(`\nAPI应返回的数据:`)
  console.log(JSON.stringify(apiResponse, null, 2))
  
  return apiResponse
}

async function main() {
  const args = process.argv.slice(2)
  
  if (args.length < 1) {
    console.log('用法: node comprehensiveTest.js <userId>')
    console.log('       node comprehensiveTest.js list  (列出所有用户)')
    console.log('示例: node comprehensiveTest.js 1')
    process.exit(1)
  }
  
  if (args[0] === 'list') {
    const users = await query(
      'SELECT id, nickname, quit_date, region, total_checkin_days FROM users ORDER BY id ASC LIMIT 20'
    )
    console.log('\n=== 用户列表 ===')
    console.log('ID | 昵称 | 戒烟日期 | 地区 | 打卡天数')
    console.log('-'.repeat(60))
    users.forEach(u => {
      console.log(`${u.id} | ${u.nickname} | ${u.quit_date || '(未设置)'} | ${u.region || '(未设置)'} | ${u.total_checkin_days || 0}`)
    })
    process.exit(0)
  }
  
  const userId = parseInt(args[0], 10)
  
  try {
    console.log('='.repeat(60))
    console.log('首页功能全面测试')
    console.log('='.repeat(60))
    
    // 1. 用户个人统计测试
    await testUserPersonalStats(userId)
    
    // 2. 同日戒烟统计测试
    const [userRows] = await query('SELECT quit_date, region FROM users WHERE id=? LIMIT 1', [userId])
    if (userRows && userRows.length > 0 && userRows[0].quit_date) {
      await testSameDayStatsLogic(userRows[0].quit_date, userRows[0].region)
    }
    
    // 3. 日历逻辑测试
    await testCalendarLogic(userId)
    
    // 4. API响应测试
    await testAPIResponse(userId)
    
    console.log('\n' + '='.repeat(60))
    console.log('✅ 所有测试完成')
    console.log('='.repeat(60))
  } catch (error) {
    console.error('❌ 测试失败:', error)
    process.exit(1)
  }
  
  process.exit(0)
}

if (require.main === module) {
  main()
}

module.exports = { 
  testUserPersonalStats, 
  testSameDayStatsLogic, 
  testCalendarLogic,
  testAPIResponse 
}
