// 管理后台主逻辑
let currentPage = 'dashboard'
let currentUsersPage = 1
let currentCheckinsPage = 1
let currentPostsPage = 1

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  // 检查登录状态
  if (!getAdminToken()) {
    window.location.href = '/admin/login.html'
    return
  }

  // 初始化路由
  initRouter()
  
  // 加载默认页面
  loadPage('dashboard')
})

// 路由初始化
function initRouter() {
  const menuItems = document.querySelectorAll('.menu-item')
  menuItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault()
      const page = item.dataset.page
      loadPage(page)
    })
  })
}

// 加载页面
function loadPage(page) {
  currentPage = page

  // 更新菜单状态
  document.querySelectorAll('.menu-item').forEach(item => {
    item.classList.remove('active')
    if (item.dataset.page === page) {
      item.classList.add('active')
    }
  })

  // 隐藏所有页面
  document.querySelectorAll('.page-content').forEach(p => {
    p.style.display = 'none'
  })

  // 显示当前页面
  const pageEl = document.getElementById(`page-${page}`)
  if (pageEl) {
    pageEl.style.display = 'block'
  }

  // 更新标题
  const titles = {
    dashboard: '仪表盘',
    users: '用户管理',
    checkins: '打卡管理',
    content: '内容管理',
    stats: '数据统计',
    system: '系统管理'
  }
  document.getElementById('pageTitle').textContent = titles[page] || '管理后台'

  // 加载页面数据
  switch(page) {
    case 'dashboard':
      loadDashboard()
      break
    case 'users':
      loadUsers()
      break
    case 'checkins':
      loadCheckins()
      break
    case 'content':
      loadPosts()
      break
    case 'stats':
      loadStats()
      break
  }
}

// 退出登录
async function logout() {
  try {
    await adminAPI.auth.logout()
  } catch (e) {
    console.error('Logout error:', e)
  }
  setAdminToken(null)
  window.location.href = '/admin/login.html'
}

// ==================== 仪表盘 ====================

async function loadDashboard() {
  try {
    // 加载总体统计
    const overview = await adminAPI.stats.overview()
    renderOverviewStats(overview.data)

    // 加载段位分布
    const ranks = await adminAPI.stats.ranks()
    renderRankChart(ranks.data)

    // 加载趋势数据
    const trends = await adminAPI.stats.trends(30)
    renderUserTrendChart(trends.data.users)
  } catch (e) {
    console.error('Load dashboard error:', e)
    showError('加载数据失败: ' + e.message)
  }
}

function renderOverviewStats(data) {
  const stats = [
    { title: '总用户数', value: data.total_users?.toLocaleString() || 0 },
    { title: '活跃用户', value: data.active_users?.toLocaleString() || 0 },
    { title: '失败用户', value: data.failed_users?.toLocaleString() || 0 },
    { title: '打卡总数', value: data.total_checkins?.toLocaleString() || 0 },
    { title: '帖子总数', value: data.total_posts?.toLocaleString() || 0 },
    { title: '评论总数', value: data.total_comments?.toLocaleString() || 0 },
    { title: '平均打卡天数', value: Math.round(data.avg_checkin_days || 0) },
    { title: '最高打卡天数', value: data.max_checkin_days || 0 }
  ]

  const html = stats.map(s => `
    <div class="stat-card">
      <div class="stat-card-title">${s.title}</div>
      <div class="stat-card-value">${s.value}</div>
    </div>
  `).join('')

  document.getElementById('overviewStats').innerHTML = html
}

let rankChart = null
function renderRankChart(data) {
  const ctx = document.getElementById('rankChart')
  if (rankChart) rankChart.destroy()

  rankChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.map(d => d.rank_range),
      datasets: [{
        label: '用户数',
        data: data.map(d => d.count),
        backgroundColor: 'rgba(24, 144, 255, 0.8)'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      }
    }
  })
}

let userTrendChart = null
function renderUserTrendChart(data) {
  const ctx = document.getElementById('userTrendChart')
  if (userTrendChart) userTrendChart.destroy()

  userTrendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.map(d => d.date),
      datasets: [{
        label: '新增用户',
        data: data.map(d => d.count),
        borderColor: 'rgb(24, 144, 255)',
        backgroundColor: 'rgba(24, 144, 255, 0.1)',
        tension: 0.4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false
    }
  })
}

// ==================== 用户管理 ====================

async function loadUsers(page = 1) {
  try {
    currentUsersPage = page
    const search = document.getElementById('userSearch')?.value || ''
    const rankFilter = document.getElementById('userRankFilter')?.value || ''

    const params = { page, limit: 50 }
    if (search) params.search = search
    if (rankFilter) params.rank_range = rankFilter

    const result = await adminAPI.users.list(params)
    renderUsersTable(result.data)
    renderPagination('usersPagination', result.pagination, loadUsers)
  } catch (e) {
    console.error('Load users error:', e)
    showError('加载用户列表失败: ' + e.message)
  }
}

function renderUsersTable(users) {
  const tbody = document.getElementById('usersTableBody')
  if (!users || users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center">暂无数据</td></tr>'
    return
  }

  tbody.innerHTML = users.map(user => {
    const rank = getRankName(user.total_checkin_days)
    return `
      <tr>
        <td>${user.id}</td>
        <td>${user.nickname || '-'}</td>
        <td>${user.quit_date || '-'}</td>
        <td>${user.total_checkin_days}</td>
        <td>${user.failure_count}</td>
        <td>${rank}</td>
        <td>
          <button class="btn btn-sm btn-primary" onclick="viewUser(${user.id})">查看</button>
          <button class="btn btn-sm btn-danger ml-8" onclick="deleteUser(${user.id})">删除</button>
        </td>
      </tr>
    `
  }).join('')
}

function getRankName(days) {
  if (days === 0) return '失败'
  if (days < 7) return '倔强青铜'
  if (days < 14) return '秩序白银'
  if (days < 30) return '荣耀黄金'
  if (days < 60) return '尊贵铂金'
  if (days < 90) return '永恒钻石'
  if (days < 180) return '至尊星耀'
  if (days < 365) return '最强王者'
  return '荣耀王者'
}

async function viewUser(id) {
  try {
    const user = await adminAPI.users.get(id)
    const checkins = await adminAPI.users.checkins(id, 10)
    const posts = await adminAPI.users.posts(id)

    const html = `
      <div class="form-group">
        <label class="form-label">ID</label>
        <div>${user.data.id}</div>
      </div>
      <div class="form-group">
        <label class="form-label">昵称</label>
        <input type="text" class="form-control" id="editNickname" value="${user.data.nickname || ''}">
      </div>
      <div class="form-group">
        <label class="form-label">戒烟日期</label>
        <input type="date" class="form-control" id="editQuitDate" value="${user.data.quit_date || ''}">
      </div>
      <div class="form-group">
        <label class="form-label">累计打卡天数</label>
        <input type="number" class="form-control" id="editTotalDays" value="${user.data.total_checkin_days || 0}">
      </div>
      <div class="form-group">
        <label class="form-label">失败次数</label>
        <input type="number" class="form-control" id="editFailureCount" value="${user.data.failure_count || 0}">
      </div>
      <div class="form-group">
        <label class="form-label">最近10条打卡记录</label>
        <div>${checkins.data.length} 条</div>
      </div>
      <div class="form-group">
        <label class="form-label">帖子数</label>
        <div>${posts.data.length} 条</div>
      </div>
      <div style="margin-top: 24px;">
        <button class="btn btn-primary" onclick="saveUser(${id})">保存</button>
        <button class="btn btn-default ml-8" onclick="closeUserModal()">取消</button>
      </div>
    `

    document.getElementById('userModalBody').innerHTML = html
    document.getElementById('userModal').classList.add('show')
  } catch (e) {
    console.error('View user error:', e)
    showError('加载用户详情失败: ' + e.message)
  }
}

async function saveUser(id) {
  try {
    const data = {
      nickname: document.getElementById('editNickname').value,
      quit_date: document.getElementById('editQuitDate').value || null,
      total_checkin_days: parseInt(document.getElementById('editTotalDays').value) || 0,
      failure_count: parseInt(document.getElementById('editFailureCount').value) || 0
    }

    await adminAPI.users.update(id, data)
    closeUserModal()
    loadUsers(currentUsersPage)
    showSuccess('保存成功')
  } catch (e) {
    console.error('Save user error:', e)
    showError('保存失败: ' + e.message)
  }
}

function closeUserModal() {
  document.getElementById('userModal').classList.remove('show')
}

async function deleteUser(id) {
  if (!confirm('确定要删除这个用户吗？此操作不可恢复！')) return

  try {
    await adminAPI.users.delete(id)
    loadUsers(currentUsersPage)
    showSuccess('删除成功')
  } catch (e) {
    console.error('Delete user error:', e)
    showError('删除失败: ' + e.message)
  }
}

// ==================== 打卡管理 ====================

async function loadCheckins(page = 1) {
  try {
    currentCheckinsPage = page
    const dateFrom = document.getElementById('checkinDateFrom')?.value || ''
    const dateTo = document.getElementById('checkinDateTo')?.value || ''

    const params = { page, limit: 50 }
    if (dateFrom) params.date_from = dateFrom
    if (dateTo) params.date_to = dateTo

    const result = await adminAPI.checkins.list(params)
    renderCheckinsTable(result.data)
    renderPagination('checkinsPagination', result.pagination, loadCheckins)
  } catch (e) {
    console.error('Load checkins error:', e)
    showError('加载打卡记录失败: ' + e.message)
  }
}

function renderCheckinsTable(checkins) {
  const tbody = document.getElementById('checkinsTableBody')
  if (!checkins || checkins.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center">暂无数据</td></tr>'
    return
  }

  tbody.innerHTML = checkins.map(checkin => `
    <tr>
      <td>${checkin.id}</td>
      <td>${checkin.nickname || '-'}</td>
      <td>${checkin.checkin_date}</td>
      <td>${checkin.mood || '-'}</td>
      <td>${checkin.note ? (checkin.note.length > 50 ? checkin.note.substring(0, 50) + '...' : checkin.note) : '-'}</td>
      <td>
        <button class="btn btn-sm btn-danger" onclick="deleteCheckin(${checkin.id})">删除</button>
      </td>
    </tr>
  `).join('')
}

async function deleteCheckin(id) {
  if (!confirm('确定要删除这条打卡记录吗？')) return

  try {
    await adminAPI.checkins.delete(id)
    loadCheckins(currentCheckinsPage)
    showSuccess('删除成功')
  } catch (e) {
    console.error('Delete checkin error:', e)
    showError('删除失败: ' + e.message)
  }
}

// ==================== 内容管理 ====================

async function loadPosts(page = 1) {
  try {
    currentPostsPage = page
    const result = await adminAPI.posts.list({ page, limit: 50 })
    renderPostsTable(result.data)
    renderPagination('postsPagination', result.pagination, loadPosts)
  } catch (e) {
    console.error('Load posts error:', e)
    showError('加载帖子列表失败: ' + e.message)
  }
}

function renderPostsTable(posts) {
  const tbody = document.getElementById('postsTableBody')
  if (!posts || posts.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center">暂无数据</td></tr>'
    return
  }

  tbody.innerHTML = posts.map(post => `
    <tr>
      <td>${post.id}</td>
      <td>${post.title}</td>
      <td>${post.nickname || '-'}</td>
      <td>${post.group_key}</td>
      <td>${post.comment_count || 0}</td>
      <td>${post.favorite_count || 0}</td>
      <td>${post.created_at}</td>
      <td>
        <button class="btn btn-sm btn-danger" onclick="deletePost(${post.id})">删除</button>
      </td>
    </tr>
  `).join('')
}

async function deletePost(id) {
  if (!confirm('确定要删除这个帖子吗？')) return

  try {
    await adminAPI.posts.delete(id)
    loadPosts(currentPostsPage)
    showSuccess('删除成功')
  } catch (e) {
    console.error('Delete post error:', e)
    showError('删除失败: ' + e.message)
  }
}

// ==================== 数据统计 ====================

async function loadStats() {
  try {
    const result = await adminAPI.stats.sameDay(30)
    renderSameDayStats(result.data)
  } catch (e) {
    console.error('Load stats error:', e)
    showError('加载统计数据失败: ' + e.message)
  }
}

function renderSameDayStats(data) {
  const tbody = document.getElementById('sameDayStatsBody')
  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center">暂无数据</td></tr>'
    return
  }

  tbody.innerHTML = data.map(item => `
    <tr>
      <td>${item.quit_date}</td>
      <td>${item.total}</td>
      <td>${item.failed}</td>
      <td>${item.survived}</td>
      <td>${Math.round(item.avg_checkin_days || 0)}</td>
    </tr>
  `).join('')
}

// ==================== 工具函数 ====================

function renderPagination(containerId, pagination, loadFn) {
  const container = document.getElementById(containerId)
  if (!container) return

  const { page, totalPages, total } = pagination
  container.innerHTML = `
    <div class="pagination-info">共 ${total.toLocaleString()} 条，第 ${page}/${totalPages} 页</div>
    <div class="pagination-buttons">
      <button class="btn btn-default" onclick="${loadFn.name}(1)" ${page === 1 ? 'disabled' : ''}>首页</button>
      <button class="btn btn-default" onclick="${loadFn.name}(${page - 1})" ${page === 1 ? 'disabled' : ''}>上一页</button>
      <button class="btn btn-default" onclick="${loadFn.name}(${page + 1})" ${page === totalPages ? 'disabled' : ''}>下一页</button>
      <button class="btn btn-default" onclick="${loadFn.name}(${totalPages})" ${page === totalPages ? 'disabled' : ''}>末页</button>
    </div>
  `
}

function exportData(type, format) {
  adminAPI.system.export(type, format)
}

function showError(message) {
  const div = document.createElement('div')
  div.className = 'error'
  div.textContent = message
  document.querySelector('.admin-content').insertBefore(div, document.querySelector('.admin-content').firstChild)
  setTimeout(() => div.remove(), 5000)
}

function showSuccess(message) {
  const div = document.createElement('div')
  div.className = 'success'
  div.textContent = message
  document.querySelector('.admin-content').insertBefore(div, document.querySelector('.admin-content').firstChild)
  setTimeout(() => div.remove(), 3000)
}
