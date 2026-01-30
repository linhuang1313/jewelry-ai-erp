/**
 * 聊天服务 - 处理所有聊天相关的API调用
 */

import { API_ENDPOINTS, API_BASE_URL } from '../config'

/**
 * 发送聊天消息（流式）
 */
export const sendChatMessage = async (message, userRole, sessionId, language, signal) => {
  const response = await fetch(API_ENDPOINTS.CHAT_STREAM, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ 
      message, 
      user_role: userRole,
      session_id: sessionId,
      language
    }),
    signal
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`)
  }
  
  if (!response.body) {
    throw new Error('响应体为空')
  }

  return response
}

/**
 * 发送聊天消息（非流式）
 */
export const sendChatMessageSync = async (message, userRole) => {
  const response = await fetch(API_ENDPOINTS.CHAT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message, user_role: userRole }),
  })

  return await response.json()
}

/**
 * 获取聊天会话列表
 */
export const getChatSessions = async (userRole, limit = 50) => {
  const response = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/chat-sessions?user_role=${userRole}&limit=${limit}`)
  return await response.json()
}

/**
 * 获取指定会话的聊天历史
 */
export const getChatHistory = async (sessionId) => {
  const response = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/chat-history/${sessionId}`)
  return await response.json()
}

/**
 * 保存聊天消息到后端
 */
export const saveChatMessage = async (sessionId, messageType, content, userRole, intent = '') => {
  const params = new URLSearchParams({
    session_id: sessionId,
    message_type: messageType,
    content,
    user_role: userRole
  })
  if (intent) {
    params.append('intent', intent)
  }
  
  const response = await fetch(`${API_BASE_URL}/api/chat-logs/message?${params}`, {
    method: 'POST'
  })
  return response
}

/**
 * 上传图片进行OCR识别
 */
export const uploadImageForOCR = async (file) => {
  const formData = new FormData()
  formData.append('file', file)
  
  const response = await fetch(API_ENDPOINTS.OCR, {
    method: 'POST',
    body: formData
  })
  
  return await response.json()
}

/**
 * 获取客户列表
 */
export const getCustomers = async () => {
  const response = await fetch(`${API_BASE_URL}/api/customers`)
  if (!response.ok) {
    throw new Error(`加载客户列表失败: ${response.status}`)
  }
  const data = await response.json()
  return data.data?.customers || data.customers || []
}

/**
 * 获取客户存料余额
 */
export const getCustomerDeposit = async (customerId) => {
  const response = await fetch(`${API_BASE_URL}/api/gold-material/customers/${customerId}/deposit`)
  if (!response.ok) {
    return { current_balance: 0, customer_name: '' }
  }
  const result = await response.json()
  return {
    current_balance: result.deposit.current_balance,
    customer_name: result.customer_name
  }
}

/**
 * 创建收料单
 */
export const createGoldReceipt = async (data) => {
  const params = new URLSearchParams({
    customer_id: data.customer_id,
    gold_weight: data.gold_weight,
    gold_fineness: data.gold_fineness,
    remark: data.remark || '快捷收料',
    created_by: data.created_by || '结算专员'
  })
  
  const response = await fetch(`${API_BASE_URL}/api/gold-material/gold-receipts?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  })
  
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.detail || '创建收料单失败')
  }
  
  return await response.json()
}

/**
 * 创建提料单
 */
export const createWithdrawal = async (data, userRole) => {
  const params = new URLSearchParams({ 
    user_role: userRole, 
    created_by: data.created_by || '结算专员' 
  })
  
  const response = await fetch(`${API_BASE_URL}/api/gold-material/withdrawals?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customer_id: parseInt(data.customer_id),
      gold_weight: parseFloat(data.gold_weight),
      withdrawal_type: 'self',
      remark: data.remark || '快捷提料'
    })
  })
  
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.detail || '创建提料单失败')
  }
  
  return await response.json()
}

/**
 * 获取待处理转移单数量
 */
export const getPendingTransferCount = async (userRole) => {
  if (!['counter', 'settlement', 'manager'].includes(userRole)) {
    return 0
  }
  
  const response = await fetch(`${API_BASE_URL}/api/warehouse/transfers?status=pending`)
  if (!response.ok) return 0
  
  const transfers = await response.json()
  
  const roleLocationMap = {
    'counter': '展厅',
    'product': '商品部仓库'
  }
  const myLocation = roleLocationMap[userRole]
  
  if (myLocation) {
    return transfers.filter(t => t.to_location_name === myLocation).length
  }
  return transfers.length
}

/**
 * 获取待结算销售单数量
 */
export const getPendingSalesCount = async (userRole) => {
  if (!['settlement', 'manager'].includes(userRole)) {
    return 0
  }
  
  const response = await fetch(`${API_BASE_URL}/api/settlement/pending-sales`)
  if (!response.ok) return 0
  
  const sales = await response.json()
  return sales.length
}

export default {
  sendChatMessage,
  sendChatMessageSync,
  getChatSessions,
  getChatHistory,
  saveChatMessage,
  uploadImageForOCR,
  getCustomers,
  getCustomerDeposit,
  createGoldReceipt,
  createWithdrawal,
  getPendingTransferCount,
  getPendingSalesCount
}
