// 断签惩罚计算服务

/**
 * 计算连续未打卡天数
 * @param {Array<string>} checkinDates - 用户所有打卡日期（格式：YYYY-MM-DD）
 * @param {string|null} lastCheckinDate - 最后打卡日期（格式：YYYY-MM-DD）
 * @param {string} yesterday - 昨天日期（格式：YYYY-MM-DD）
 * @returns {number} 连续未打卡天数
 */
function calculateConsecutiveMissedDays(checkinDates, lastCheckinDate, yesterday) {
  if (!lastCheckinDate) {
    // 如果从未打卡，计算从戒烟日期到昨天的天数
    // 这里需要传入quit_date，暂时返回0（由调用方处理）
    return 0
  }

  const lastDate = new Date(lastCheckinDate)
  const yesterdayDate = new Date(yesterday)
  
  // 计算日期差（天数）
  const diffTime = yesterdayDate - lastDate
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
  
  if (diffDays <= 0) {
    return 0 // 昨天已打卡或今天打卡
  }
  
  // 检查中间是否有打卡记录
  const checkinSet = new Set(checkinDates)
  let consecutiveMissed = 0
  
  // 从lastCheckinDate的下一天开始，到yesterday，逐天检查
  for (let d = new Date(lastDate); d <= yesterdayDate; d.setDate(d.getDate() + 1)) {
    const dateStr = formatDate(d)
    if (dateStr === lastCheckinDate) {
      continue // 跳过最后打卡日期
    }
    if (!checkinSet.has(dateStr)) {
      consecutiveMissed++
    } else {
      // 如果中间有打卡，重置计数
      consecutiveMissed = 0
    }
  }
  
  return consecutiveMissed
}

/**
 * 应用断签惩罚
 * @param {number} totalDays - 当前累计打卡天数（打卡记录总数）
 * @param {number} consecutiveMissedDays - 连续未打卡天数
 * @returns {{newTotalDays: number, cleared: boolean, failureIncrement: number}}
 */
function applyPenalty(totalDays, consecutiveMissedDays) {
  if (consecutiveMissedDays === 0) {
    return {
      newTotalDays: totalDays,
      cleared: false,
      failureIncrement: 0
    }
  }
  
  if (consecutiveMissedDays === 1) {
    // 连续1天未打卡：扣减7天
    return {
      newTotalDays: Math.max(0, totalDays - 7),
      cleared: false,
      failureIncrement: 0
    }
  }
  
  if (consecutiveMissedDays === 2) {
    // 连续2天未打卡：扣减21天
    return {
      newTotalDays: Math.max(0, totalDays - 21),
      cleared: false,
      failureIncrement: 0
    }
  }
  
  // 连续3天及以上未打卡：清零，失败次数+1
  return {
    newTotalDays: 0,
    cleared: true,
    failureIncrement: 1
  }
}

/**
 * 格式化日期为 YYYY-MM-DD
 */
function formatDate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

module.exports = {
  calculateConsecutiveMissedDays,
  applyPenalty,
  formatDate
}
