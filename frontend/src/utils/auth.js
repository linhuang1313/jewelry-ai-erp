/**
 * auth.js - 前端认证工具
 * 管理 JWT token 存储、登录状态检查、API 请求头注入
 */

const TOKEN_KEY = 'auth_token'
const USER_KEY = 'auth_user'

/**
 * 保存登录信息
 */
export function saveAuth(token, user) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

/**
 * 获取 token
 */
export function getToken() {
  return localStorage.getItem(TOKEN_KEY)
}

/**
 * 获取当前用户信息
 */
export function getAuthUser() {
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/**
 * 检查是否已登录
 */
export function isAuthenticated() {
  const token = getToken()
  if (!token) return false
  
  // 简单检查 token 是否过期（解码 JWT payload）
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    const exp = payload.exp * 1000 // 转为毫秒
    return Date.now() < exp
  } catch {
    return false
  }
}

/**
 * 登出 - 清除所有认证信息
 */
export function logout() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

/**
 * 获取带 Authorization 头的 fetch 选项
 */
export function authHeaders() {
  const token = getToken()
  if (!token) return {}
  return {
    'Authorization': `Bearer ${token}`
  }
}

/**
 * 带认证的 fetch 封装
 */
export async function authFetch(url, options = {}) {
  const token = getToken()
  const headers = {
    ...options.headers,
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  
  const response = await fetch(url, { ...options, headers })
  
  // 如果 401，自动登出
  if (response.status === 401) {
    logout()
    window.location.reload()
  }
  
  return response
}
