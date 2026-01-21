// API封装
const API_BASE = window.location.origin
let adminToken = localStorage.getItem('admin_token')

function setToken(token) {
  adminToken = token
  if (token) {
    localStorage.setItem('admin_token', token)
  } else {
    localStorage.removeItem('admin_token')
  }
}

function getToken() {
  return adminToken || localStorage.getItem('admin_token')
}

async function request(url, options = {}) {
  const token = getToken()
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  }

  if (token) {
    headers['X-Admin-Token'] = token
  }

  try {
    const res = await fetch(`${API_BASE}${url}`, {
      ...options,
      headers
    })

    const data = await res.json()

    if (!res.ok) {
      if (res.status === 401) {
        // 未授权，跳转到登录页
        setToken(null)
        if (window.location.pathname !== '/admin/login.html') {
          window.location.href = '/admin/login.html'
        }
      }
      throw new Error(data.error || 'Request failed')
    }

    return data
  } catch (e) {
    console.error('API request error:', e)
    throw e
  }
}

const api = {
  // 认证
  auth: {
    login: (password) => request('/api/admin/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password })
    }),
    logout: () => request('/api/admin/auth/logout', { method: 'POST' }),
    me: () => request('/api/admin/auth/me')
  },

  // 用户管理
  users: {
    list: (params) => {
      const query = new URLSearchParams(params).toString()
      return request(`/api/admin/users?${query}`)
    },
    get: (id) => request(`/api/admin/users/${id}`),
    update: (id, data) => request(`/api/admin/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    }),
    delete: (id) => request(`/api/admin/users/${id}`, { method: 'DELETE' }),
    checkins: (id, limit) => request(`/api/admin/users/${id}/checkins?limit=${limit || 100}`),
    posts: (id) => request(`/api/admin/users/${id}/posts`)
  },

  // 打卡管理
  checkins: {
    list: (params) => {
      const query = new URLSearchParams(params).toString()
      return request(`/api/admin/checkins?${query}`)
    },
    get: (id) => request(`/api/admin/checkins/${id}`),
    delete: (id) => request(`/api/admin/checkins/${id}`, { method: 'DELETE' })
  },

  // 内容管理
  posts: {
    list: (params) => {
      const query = new URLSearchParams(params).toString()
      return request(`/api/admin/posts?${query}`)
    },
    get: (id) => request(`/api/admin/posts/${id}`),
    delete: (id) => request(`/api/admin/posts/${id}`, { method: 'DELETE' })
  },
  comments: {
    list: (params) => {
      const query = new URLSearchParams(params).toString()
      return request(`/api/admin/comments?${query}`)
    },
    delete: (id) => request(`/api/admin/comments/${id}`, { method: 'DELETE' })
  },

  // 数据统计
  stats: {
    overview: () => request('/api/admin/stats/overview'),
    ranks: () => request('/api/admin/stats/ranks'),
    sameDay: (limit) => request(`/api/admin/stats/same-day?limit=${limit || 30}`),
    trends: (days) => request(`/api/admin/stats/trends?days=${days || 30}`)
  },

  // 系统管理
  system: {
    douyinTokens: () => request('/api/admin/system/douyin-tokens'),
    export: (type, format) => {
      const url = `/api/admin/system/export?type=${type}&format=${format || 'json'}`
      window.open(`${API_BASE}${url}&token=${getToken()}`, '_blank')
    }
  }
}

// 导出
window.adminAPI = api
window.setAdminToken = setToken
window.getAdminToken = getToken
