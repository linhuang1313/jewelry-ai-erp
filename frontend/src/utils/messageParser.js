/**
 * 消息解析工具函数
 * 用于解析聊天消息中的隐藏标记，恢复特殊消息的额外字段
 */

import { API_BASE_URL } from '../config'

// 合并所有标记的正则表达式，一次匹配多种类型
const COMBINED_MARKER_REGEX = /<!-- (WITHDRAWAL_ORDER|GOLD_RECEIPT|INBOUND_ORDER|RETURN_ORDER|SALES_ORDER|SETTLEMENT_ORDER):(\d+):?([^>]*) -->/g

/**
 * 解析消息中的隐藏标记，恢复所有特殊消息的额外字段
 * @param {Array} messages - 消息数组
 * @returns {Array} - 解析后的消息数组
 */
export const parseMessageHiddenMarkers = (messages) => {
  // 添加数组安全检查
  if (!Array.isArray(messages)) return messages || []
  
  return messages.map(msg => {
    if (!msg.content) return msg
    
    // 使用合并正则一次性匹配所有标记
    const matches = [...msg.content.matchAll(COMBINED_MARKER_REGEX)]
    if (matches.length === 0) return msg
    
    matches.forEach(match => {
      const [, type, id] = match
      const orderId = parseInt(id)
      
      switch (type) {
        case 'WITHDRAWAL_ORDER':
          if (!msg.withdrawalDownloadUrl) {
            msg.withdrawalId = orderId
            msg.withdrawalDownloadUrl = `${API_BASE_URL}/api/gold-material/withdrawals/${orderId}/download?format=html`
          }
          break
        case 'GOLD_RECEIPT':
          if (!msg.goldReceiptDownloadUrl) {
            msg.goldReceiptId = orderId
            msg.goldReceiptDownloadUrl = `${API_BASE_URL}/api/gold-material/gold-receipts/${orderId}/print`
          }
          break
        case 'INBOUND_ORDER':
          if (!msg.inboundOrder) {
            msg.inboundOrder = { id: orderId }
          }
          break
        case 'RETURN_ORDER':
          if (!msg.returnOrder) {
            msg.returnOrder = { id: orderId }
          }
          break
        case 'SALES_ORDER':
          if (!msg.salesOrderId) {
            msg.salesOrderId = orderId
          }
          break
        case 'SETTLEMENT_ORDER':
          if (!msg.settlementOrderId) {
            msg.settlementOrderId = orderId
          }
          break
        default:
          break
      }
    })
    
    return msg
  })
}

/**
 * 解析单条消息中的所有隐藏标记
 * @param {Object} msg - 消息对象
 * @returns {Object} - 解析后的消息对象
 */
export const parseSingleMessage = (msg) => {
  if (!msg || !msg.content) return msg
  
  const result = { ...msg }
  
  // 提料单
  const withdrawalMatch = msg.content.match(/<!-- WITHDRAWAL_ORDER:(\d+):([^>]+) -->/)
  if (withdrawalMatch) {
    const withdrawalId = parseInt(withdrawalMatch[1])
    result.withdrawalId = withdrawalId
    result.withdrawalDownloadUrl = `${API_BASE_URL}/api/gold-material/withdrawals/${withdrawalId}/download?format=html`
  }
  
  // 收料单
  const goldReceiptMatch = msg.content.match(/<!-- GOLD_RECEIPT:(\d+):/)
  if (goldReceiptMatch) {
    const receiptId = parseInt(goldReceiptMatch[1])
    result.goldReceiptId = receiptId
    result.goldReceiptDownloadUrl = `${API_BASE_URL}/api/gold-material/gold-receipts/${receiptId}/print`
  }
  
  // 入库单
  const inboundMatch = msg.content.match(/<!-- INBOUND_ORDER:(\d+):/)
  if (inboundMatch) {
    result.inboundOrder = { id: parseInt(inboundMatch[1]) }
  }
  
  // 退货单
  const returnMatch = msg.content.match(/<!-- RETURN_ORDER:(\d+):/)
  if (returnMatch) {
    result.returnOrder = { id: parseInt(returnMatch[1]) }
  }
  
  // 销售单
  const salesMatch = msg.content.match(/<!-- SALES_ORDER:(\d+):/)
  if (salesMatch) {
    result.salesOrderId = parseInt(salesMatch[1])
  }
  
  // 结算单
  const settlementMatch = msg.content.match(/<!-- SETTLEMENT_ORDER:(\d+):/)
  if (settlementMatch) {
    result.settlementOrderId = parseInt(settlementMatch[1])
  }
  
  return result
}

export default {
  parseMessageHiddenMarkers,
  parseSingleMessage
}
