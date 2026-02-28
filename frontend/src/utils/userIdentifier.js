/**
 * 用户标识抽象层（为未来登录系统预留）
 */

/**
 * 获取当前用户标识符
 * 阶段1（当前）：使用设备ID作为临时用户标识
 * 阶段2（未来）：接入登录系统后，返回真实用户ID
 */
export const getUserIdentifier = () => {
  // 未来登录系统接入点 - 取消注释以下代码
  // const authUser = getAuthUser()
  // if (authUser) return authUser.id
  
  // 当前：使用设备指纹作为临时用户标识
  if (typeof window === 'undefined') return 'anonymous'
  
  let deviceId = localStorage.getItem('jewelry_erp_device_id')
  if (!deviceId) {
    deviceId = `device_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    localStorage.setItem('jewelry_erp_device_id', deviceId)
  }
  return deviceId
}

/**
 * 获取当前角色的历史记录key（包含用户标识，支持多用户隔离）
 */
export const getHistoryKey = (role) => {
  const userId = getUserIdentifier()
  return `conversationHistory_${userId}_${role}`
}

/**
 * 获取上次使用的session key（用于恢复上次对话）
 */
export const getLastSessionKey = (role) => {
  const userId = getUserIdentifier()
  return `lastSessionId_${userId}_${role}`
}

/**
 * 生成新的session ID
 */
export const generateSessionId = () => {
  return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

/**
 * 安全写入 localStorage，超出配额时自动清理最旧的对话历史
 */
export const safeLocalStorageSet = (key, value) => {
  try {
    localStorage.setItem(key, value)
  } catch (e) {
    if (e.name === 'QuotaExceededError' || e.code === 22) {
      console.warn('[Storage] 配额不足，正在清理旧数据...')
      try {
        const keysToTrim = []
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i)
          if (k && k.startsWith('conversationHistory_')) {
            keysToTrim.push(k)
          }
        }
        for (const k of keysToTrim) {
          try {
            const arr = JSON.parse(localStorage.getItem(k) || '[]')
            if (Array.isArray(arr) && arr.length > 10) {
              localStorage.setItem(k, JSON.stringify(arr.slice(0, 10)))
            }
          } catch { /* skip */ }
        }
        localStorage.setItem(key, value)
      } catch {
        console.error('[Storage] 清理后仍无法写入 localStorage')
      }
    }
  }
}

export default {
  getUserIdentifier,
  getHistoryKey,
  getLastSessionKey,
  generateSessionId,
  safeLocalStorageSet
}
