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

export default {
  getUserIdentifier,
  getHistoryKey,
  getLastSessionKey,
  generateSessionId
}
