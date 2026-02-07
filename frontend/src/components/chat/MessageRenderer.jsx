import React from 'react'
import { ThinkingMessage } from './ThinkingMessage'
import {
  UserMessage,
  WithdrawalRecordCard,
  PaymentConfirmCard,
  ReceiptConfirmCard,
  WithdrawalConfirmCard,
  SystemMessage,
} from './cards'

export const MessageRenderer = ({ msg, idx, setMessages, setCurrentPage, userRole, API_BASE_URL }) => {
  // 思考过程消息
  if (msg.type === 'thinking' && Array.isArray(msg.steps)) {
    return <ThinkingMessage steps={msg.steps} />
  }

  // 收款确认卡片
  if (msg.type === 'payment_confirm' && msg.paymentData) {
    return <PaymentConfirmCard msg={msg} setMessages={setMessages} />
  }

  // 收料确认卡片
  if (msg.type === 'receipt_confirm' && msg.receiptData) {
    return <ReceiptConfirmCard msg={msg} setMessages={setMessages} API_BASE_URL={API_BASE_URL} />
  }

  // 提料确认卡片
  if (msg.type === 'withdrawal_confirm' && msg.withdrawalData) {
    return <WithdrawalConfirmCard msg={msg} setMessages={setMessages} API_BASE_URL={API_BASE_URL} />
  }

  // 提料单记录卡片（已完成的提料单）
  if (msg.type === 'withdrawal_record' && msg.withdrawalData) {
    return <WithdrawalRecordCard withdrawalData={msg.withdrawalData} />
  }

  // 用户消息
  if (msg.type === 'user') {
    return <UserMessage content={msg.content} />
  }

  // 系统消息（流式内容或普通内容）
  if (msg.type === 'system') {
    return (
      <SystemMessage
        msg={msg}
        setMessages={setMessages}
        setCurrentPage={setCurrentPage}
        userRole={userRole}
        API_BASE_URL={API_BASE_URL}
      />
    )
  }

  return null
}

export default MessageRenderer
