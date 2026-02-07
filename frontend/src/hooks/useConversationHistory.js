/**
 * 对话历史管理 Hook (Phase 5 - copy-paste extraction from App.jsx)
 */
import { useState, useRef, useEffect } from 'react'
import { API_ENDPOINTS, API_BASE_URL } from '../config'
import { getHistoryKey, getLastSessionKey } from '../utils/userIdentifier'
import { parseMessageHiddenMarkers } from '../utils/messageParser'

export function useConversationHistory(userRole, messages, setMessages, setSidebarOpen, showToast) {
  // 历史对话记录相关状态
  const [conversationHistory, setConversationHistory] = useState([])
  const [currentConversationId, setCurrentConversationId] = useState(null)
  const [conversationTitle, setConversationTitle] = useState('New Chat')

  // 后端会话ID
  const [currentSessionId, setCurrentSessionId] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('current_session_id')
      if (saved) return saved
      const newId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      localStorage.setItem('current_session_id', newId)
      return newId
    }
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  })

  const [isRestoring, setIsRestoring] = useState(false)

  // Refs
  const roleHistoryCache = useRef({})
  const initialLoadRef = useRef(false)
  const lastSavedRef = useRef({ messageCount: 0, lastMessageId: null })

  // 加载指定角色的历史记录
  const loadRoleHistory = async (role) => {
    const historyKey = getHistoryKey(role)
    
    const cached = roleHistoryCache.current[role]
    if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
      setConversationHistory(cached.data)
      return cached.data
    }
    
    let localHistory = []
    try {
      const parsed = JSON.parse(localStorage.getItem(historyKey) || '[]')
      localHistory = Array.isArray(parsed) ? parsed : []
      setConversationHistory(localHistory)
    } catch {
      localHistory = []
      setConversationHistory([])
    }
    
    setTimeout(async () => {
      try {
        const response = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/chat-sessions?user_role=${role}&limit=50`)
        const data = await response.json()
        
        if (data.success && Array.isArray(data.sessions)) {
          const history = data.sessions.map(session => ({
            id: session.session_id,
            title: session.summary || '新对话',
            messages: [],
            createdAt: session.start_time || new Date().toISOString(),
            updatedAt: session.end_time || new Date().toISOString(),
            messageCount: session.message_count,
            lastIntent: session.last_intent
          }))
          
          localStorage.setItem(historyKey, JSON.stringify(history))
          
          roleHistoryCache.current[role] = {
            data: history,
            timestamp: Date.now()
          }
          
          setConversationHistory(prev => {
            if (localHistory.length > 0) {
              return history.map(h => {
                const local = localHistory.find(l => l.id === h.id)
                return local && local.messages?.length > 0 ? { ...h, messages: local.messages } : h
              })
            }
            return history
          })
        }
      } catch (error) {
        console.log('Backend sync history failed (does not affect usage):', error.message)
      }
    }, 100)
    
    roleHistoryCache.current[role] = {
      data: localHistory,
      timestamp: Date.now()
    }
    
    return localHistory
  }

  // 保存对话到历史记录
  const saveConversation = () => {
    if (messages.length === 0) return
    
    const lastMessage = messages[messages.length - 1]
    if (lastSavedRef.current.messageCount === messages.length && 
        lastSavedRef.current.lastMessageId === lastMessage?.id) {
      return
    }
    
    const historyKey = getHistoryKey(userRole)
    const parsedData = JSON.parse(localStorage.getItem(historyKey) || '[]')
    const history = Array.isArray(parsedData) ? parsedData : []
    
    let title = conversationTitle
    if (title === '新对话' || !currentConversationId) {
      const firstUserMessage = messages.find(m => m.type === 'user')
      if (firstUserMessage) {
        title = firstUserMessage.content.substring(0, 20) || '新对话'
        if (firstUserMessage.content.length > 20) title += '...'
        setConversationTitle(title)
      }
    }
    
    const conversationId = currentConversationId || currentSessionId || Date.now().toString()
    const conversation = {
      id: conversationId,
      title: title,
      messages: messages,
      createdAt: currentConversationId ? 
        (history.find(c => c.id === currentConversationId)?.createdAt || new Date().toISOString()) :
        new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    
    const existingIndex = history.findIndex(h => h.id === conversation.id)
    
    if (existingIndex >= 0) {
      history[existingIndex] = conversation
    } else {
      history.unshift(conversation)
    }
    
    const limitedHistory = history.slice(0, 50)
    localStorage.setItem(historyKey, JSON.stringify(limitedHistory))
    setConversationHistory(limitedHistory)
    setCurrentConversationId(conversationId)
    
    const lastSessionKey = getLastSessionKey(userRole)
    localStorage.setItem(lastSessionKey, conversationId)
    
    lastSavedRef.current = { messageCount: messages.length, lastMessageId: lastMessage?.id }
  }

  // 当消息变化时自动保存
  useEffect(() => {
    if (messages.length === 0) return
    
    const timer = setTimeout(() => {
      saveConversation()
    }, 1000)
    return () => clearTimeout(timer)
  }, [messages])

  // 加载指定对话
  const loadConversation = async (conversationId) => {
    const historyKey = getHistoryKey(userRole)
    let localConversation = null
    try {
      const parsedData = JSON.parse(localStorage.getItem(historyKey) || '[]')
      const history = Array.isArray(parsedData) ? parsedData : []
      localConversation = history.find(c => c.id === conversationId)
    } catch {}
    
    if (localConversation && localConversation.messages && localConversation.messages.length > 0) {
      const messages = parseMessageHiddenMarkers(localConversation.messages)
      setMessages(messages)
      setCurrentConversationId(localConversation.id)
      setConversationTitle(localConversation.title || '对话')
      setCurrentSessionId(conversationId)
      localStorage.setItem('current_session_id', conversationId)
      if (window.innerWidth < 1024) {
        setSidebarOpen(false)
      }
      return
    }
    
    try {
      const response = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/chat-history/${conversationId}`)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const data = await response.json()
      
      if (data.success && Array.isArray(data.messages)) {
        const messages = data.messages.map(msg => {
          const message = {
            type: msg.message_type === 'user' ? 'user' : 'system',
            content: msg.content || '',
            id: msg.id
          }
          
          if (msg.content) {
            const withdrawalMatch = msg.content.match(/<!-- WITHDRAWAL_ORDER:(\d+):([^>]+) -->/)
            if (withdrawalMatch) {
              const withdrawalId = parseInt(withdrawalMatch[1])
              message.withdrawalId = withdrawalId
              message.withdrawalDownloadUrl = `${API_BASE_URL}/api/gold-material/withdrawals/${withdrawalId}/download?format=html`
            }
            const goldReceiptMatch = msg.content.match(/<!-- GOLD_RECEIPT:(\d+):/)
            if (goldReceiptMatch) {
              const receiptId = parseInt(goldReceiptMatch[1])
              message.goldReceiptId = receiptId
              message.goldReceiptDownloadUrl = `${API_BASE_URL}/api/gold-material/gold-receipts/${receiptId}/print`
            }
            const inboundMatch = msg.content.match(/<!-- INBOUND_ORDER:(\d+):/)
            if (inboundMatch) {
              message.inboundOrder = { id: parseInt(inboundMatch[1]) }
            }
            const returnMatch = msg.content.match(/<!-- RETURN_ORDER:(\d+):/)
            if (returnMatch) {
              message.returnOrder = { id: parseInt(returnMatch[1]) }
            }
            const salesMatch = msg.content.match(/<!-- SALES_ORDER:(\d+):/)
            if (salesMatch) {
              message.salesOrderId = parseInt(salesMatch[1])
            }
            const settlementMatch = msg.content.match(/<!-- SETTLEMENT_ORDER:(\d+):/)
            if (settlementMatch) {
              message.settlementOrderId = parseInt(settlementMatch[1])
            }
          }
          
          return message
        })
        
        const history = conversationHistory
        const conversation = history.find(c => c.id === conversationId)
        const title = conversation?.title || messages.find(m => m.type === 'user')?.content?.substring(0, 20) || '新对话'
        
        setMessages(messages)
        setCurrentConversationId(conversationId)
        setConversationTitle(title)
        
        setCurrentSessionId(conversationId)
        localStorage.setItem('current_session_id', conversationId)
        
        if (window.innerWidth < 1024) {
          setSidebarOpen(false)
        } else {
          setSidebarOpen(true)
        }
      } else {
        const historyKey = getHistoryKey(userRole)
        const parsedData = JSON.parse(localStorage.getItem(historyKey) || '[]')
        const history = Array.isArray(parsedData) ? parsedData : []
        const conversation = history.find(c => c.id === conversationId)
        if (conversation && conversation.messages) {
          const messages = parseMessageHiddenMarkers(conversation.messages)
          setMessages(messages)
          setCurrentConversationId(conversation.id)
          setConversationTitle(conversation.title)
          if (window.innerWidth < 1024) {
            setSidebarOpen(false)
          } else {
            setSidebarOpen(true)
          }
        }
      }
    } catch (error) {
      console.error('Load conversation failed:', error)
      showToast('后端服务暂时不可用，无法加载历史对话详情')
      setCurrentConversationId(conversationId)
      setConversationTitle(localConversation?.title || '对话')
      setMessages([{
        type: 'system',
        content: '⚠️ 后端服务暂时不可用，无法加载此对话的历史消息。\n\n请稍后重试，或开始新对话。'
      }])
      if (window.innerWidth < 1024) {
        setSidebarOpen(false)
      }
    }
  }

  // 新建对话
  const newConversation = () => {
    setMessages([])
    setCurrentConversationId(null)
    setConversationTitle('新对话')
    
    const newSessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    setCurrentSessionId(newSessionId)
    localStorage.setItem('current_session_id', newSessionId)
    
    if (window.innerWidth < 1024) {
      setSidebarOpen(false)
    } else {
      setSidebarOpen(true)
    }
  }

  // 删除对话
  const deleteConversation = (conversationId) => {
    const historyKey = getHistoryKey(userRole)
    const history = (Array.isArray(conversationHistory) ? conversationHistory : []).filter(c => c.id !== conversationId)
    localStorage.setItem(historyKey, JSON.stringify(history))
    setConversationHistory(history)
    if (currentConversationId === conversationId) {
      newConversation()
    }
  }

  // 仅在页面初始加载时加载当前角色的历史对话记录
  useEffect(() => {
    if (!initialLoadRef.current) {
      initialLoadRef.current = true
      loadRoleHistory(userRole)
    }
  }, [])

  // 页面初始化时恢复当前对话
  useEffect(() => {
    if (!userRole || isRestoring) return
    
    const restoreCurrentConversation = async () => {
      setIsRestoring(true)
      
      const lastSessionKey = getLastSessionKey(userRole)
      const savedSessionId = localStorage.getItem(lastSessionKey) || localStorage.getItem('current_session_id')
      
      if (!savedSessionId) {
        setIsRestoring(false)
        return
      }
      
      const historyKey = getHistoryKey(userRole)
      try {
        const parsedData = JSON.parse(localStorage.getItem(historyKey) || '[]')
        const history = Array.isArray(parsedData) ? parsedData : []
        const conversation = history.find(c => c.id === savedSessionId)
        
        if (conversation && conversation.messages && conversation.messages.length > 0) {
          const restoredMessages = parseMessageHiddenMarkers(conversation.messages)
          setMessages(restoredMessages)
          setCurrentConversationId(savedSessionId)
          setCurrentSessionId(savedSessionId)
          setConversationTitle(conversation.title || '新对话')
          console.log('[Restore] Restored from local:', savedSessionId, 'message count:', restoredMessages.length)
        } else {
          console.log('[Restore] No local data, try to sync from backend:', savedSessionId)
          try {
            const response = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/chat-history/${savedSessionId}`)
            if (response.ok) {
              const data = await response.json()
              if (data.success && Array.isArray(data.messages) && data.messages.length > 0) {
                const backendMessages = data.messages.map(msg => ({
                  type: msg.message_type === 'user' ? 'user' : 'system',
                  content: msg.content || '',
                  id: msg.id
                }))
                const parsedMessages = parseMessageHiddenMarkers(backendMessages)
                setMessages(parsedMessages)
                setCurrentConversationId(savedSessionId)
                setCurrentSessionId(savedSessionId)
                console.log('[Restore] Restored from backend:', savedSessionId, 'message count:', parsedMessages.length)
              }
            }
          } catch (backendError) {
            console.error('[Restore] Backend sync failed:', backendError)
          }
        }
      } catch (error) {
        console.error('[Restore] Restore conversation failed:', error)
        try {
          localStorage.setItem(historyKey, '[]')
          console.warn('[Restore] Cleared corrupted history records')
        } catch {}
      } finally {
        setIsRestoring(false)
      }
    }
    
    restoreCurrentConversation()
  }, [userRole])

  return {
    conversationHistory, setConversationHistory,
    currentConversationId, setCurrentConversationId,
    conversationTitle, setConversationTitle,
    currentSessionId, setCurrentSessionId,
    roleHistoryCache,
    loadRoleHistory,
    saveConversation,
    loadConversation,
    newConversation,
    deleteConversation
  }
}
