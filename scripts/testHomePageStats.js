/**
 * 首页数据统计准确性验证脚本
 * 用于对比数据库实际数据和API返回的数据
 */

const { query } = require('../src/db/query')
const { config } = require('../src/config')

async function testSameDayStats(userId, quitDate, userRegion) {
  console.log('\n=== 同日戒烟统计验证 ===')
  console.log(`用户ID: ${userId}`)
  console.log(`戒烟日期: ${quitDate}`)
  console.log(`用户地区: ${userRegion || '(未设置)'}`)
  console.log('')

  // 1. 统计总数
  const [totalRows] = await query('SELECT COUNT(*) AS c FROM users WHERE quit_date=?', [quitDate])
  const total = Number(totalRows.c || 0)
  console.log(`✓ 总数 (total): ${total}`)

  // 2. 统计失败数
  const [failedRows] = await query(
    'SELECT COUNT(*) AS c FROM users WHERE quit_date=? AND total_checkin_days=0',
    [quitDate]
  )
  const failed = Number(failedRows.c || 0)
  console.log(`✓ 失败数 (failed): ${failed}`)

  // 3. 统计活跃数
  const [activeRows] = await query(
    'SELECT COUNT(*) AS c FROM users WHERE quit_date=? AND total_checkin_days>0',
    [quitDate]
  )
  const active = Number(activeRows.c || 0)
  console.log(`✓ 活跃数 (active): ${active}`)

  // 4. 验证总数 = 失败数 + 活跃数
  const sum = failed + active
  if (total !== sum) {
    console.error(`❌ 数据不一致！总数(${total}) ≠ 失败数(${failed}) + 活跃数(${active}) = ${sum}`)
  } else {
    console.log(`✓ 数据一致性验证通过: ${total} = ${failed} + ${active}`)
  }

  // 5. 统计同城人数
  let cityTotal = 0
  if (userRegion) {
    const [cityRows] = await query(
      'SELECT COUNT(*) AS c FROM users WHERE quit_date=? AND region=?',
      [quitDate, userRegion]
    )
    cityTotal = Number(cityRows.c || 0)
    console.log(`✓ 同城人数 (cityTotal): ${cityTotal}`)
    
    if (cityTotal > total) {
      console.error(`❌ 同城人数(${cityTotal}) 大于总数(${total})，数据异常！`)
    }
  } else {
    console.log(`⚠ 同城人数: 用户未设置地区，应为 0`)
  }

  // 6. 详细用户列表（用于调试）
  const users = await query(
    `SELECT id, nickname, quit_date, region, total_checkin_days 
     FROM users 
     WHERE quit_date=? 
     ORDER BY total_checkin_days DESC, id ASC 
     LIMIT 20`,
    [quitDate]
  )
  console.log(`\n前20个用户详情:`)
  users.forEach((u, idx) => {
    const status = u.total_checkin_days > 0 ? '活跃' : '失败'
    const regionMatch = userRegion && u.region === userRegion ? ' [同城]' : ''
    console.log(`  ${idx + 1}. ${u.nickname} (ID:${u.id}) - ${status} (${u.total_checkin_days}天)${regionMatch}`)
  })

  return {
    total,
    active,
    failed,
    cityTotal,
    reduction: 0
  }
}

async function testUserStats(userId) {
  console.log('\n=== 用户个人统计验证 ===')
  
  const [userRows] = await query(
    `SELECT u.id, u.quit_date, u.region, u.total_checkin_days,
            COUNT(DISTINCT c.checkin_date) AS checkin_count
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
  console.log(`用户ID: ${user.id}`)
  console.log(`戒烟日期: ${user.quit_date}`)
  console.log(`累计打卡天数 (total_checkin_days): ${user.total_checkin_days}`)
  console.log(`实际打卡记录数 (checkin_count): ${user.checkin_count}`)
  
  if (user.total_checkin_days !== user.checkin_count) {
    console.warn(`⚠ 累计打卡天数(${user.total_checkin_days}) 与打卡记录数(${user.checkin_count})不一致`)
  } else {
    console.log(`✓ 打卡天数一致性验证通过`)
  }
  
  return user
}

async function listUsers() {
  console.log('\n=== 用户列表 ===')
  const users = await query(
    'SELECT id, nickname, quit_date, region, total_checkin_days FROM users ORDER BY id ASC LIMIT 20'
  )
  if (users.length === 0) {
    console.log('数据库中没有用户')
    return
  }
  console.log('ID | 昵称 | 戒烟日期 | 地区 | 打卡天数')
  console.log('-'.repeat(60))
  users.forEach(u => {
    console.log(`${u.id} | ${u.nickname} | ${u.quit_date || '(未设置)'} | ${u.region || '(未设置)'} | ${u.total_checkin_days || 0}`)
  })
  console.log(`\n共 ${users.length} 个用户（显示前20个）`)
}

async function main() {
  const args = process.argv.slice(2)
  
  if (args.length < 1) {
    console.log('用法: node testHomePageStats.js <userId>')
    console.log('       node testHomePageStats.js list  (列出所有用户)')
    console.log('示例: node testHomePageStats.js 1')
    console.log('      node testHomePageStats.js list')
    process.exit(1)
  }
  
  if (args[0] === 'list') {
    await listUsers()
    process.exit(0)
  }
  
  const userId = parseInt(args[0], 10)
  
  try {
    // 获取用户信息
    const [userRows] = await query('SELECT id, quit_date, region FROM users WHERE id=? LIMIT 1', [userId])
    if (!userRows || userRows.length === 0) {
      console.error(`❌ 用户 ${userId} 不存在`)
      process.exit(1)
    }
    
    const user = userRows[0]
    if (!user.quit_date) {
      console.error(`❌ 用户 ${userId} 未设置戒烟日期`)
      process.exit(1)
    }
    
    // 测试用户个人统计
    await testUserStats(userId)
    
    // 测试同日戒烟统计
    const stats = await testSameDayStats(userId, user.quit_date, user.region)
    
    console.log('\n=== API 应返回的数据 ===')
    console.log(JSON.stringify({
      group_key: user.quit_date,
      ...stats
    }, null, 2))
    
    console.log('\n✅ 验证完成')
  } catch (error) {
    console.error('❌ 验证失败:', error)
    process.exit(1)
  }
  
  process.exit(0)
}

if (require.main === module) {
  main()
}

module.exports = { testSameDayStats, testUserStats }
