/**
 * 对话历史管理 Hook
 */
import { useState, useRef, useCallback } from 'react'
import { API_ENDPOINTS, API_BASE_URL } from '../config'
import { getHistoryKey, getLastSessionKey, generateSessionId } from '../utils/userIdentifier'
import { parseMessageHiddenMarkers } from '../utils/messageParser'

export const useConversationHistory = (userRole) => {
  const [conversationHistory, setConversationHistory] = useState([])
  const [currentConversationId, setCurrentConversationId] = useState(null)
  const [conversationTitle, setConversationTitle] = useState('新对话')
  const [currentSessionId, setCurrentSessionId] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('current_session_id')
      if (saved) return saved
      const newId = generateSessionId()
      localStorage.setItem('current_session_id', newId)
      return newId
    }
    return generateSessionId()
  })
  
  const roleHistoryCache = useRef({})
  const lastSavedRef = useRef({ messageCount: 0, lastMessageId: null })

  // 加载指定角色的历史记录
  const loadRoleHistory = useCallback(async (role) => {
    const historyKey = getHistoryKey(role)
    
    // 1. 检查内存缓存（5分钟有效期）
    const cached = roleHistoryCache.current[role]
    if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
      setConversationHistory(cached.data)
      return cached.data
    }
    
    // 2. 从 localStorage 加载
    let localHistory = []
    try {
      const parsed = JSON.parse(localStorage.getItem(historyKey) || '[]')
      localHistory = Array.isArray(parsed) ? parsed : []
      setConversationHistory(localHistory)
    } catch {
      localHistory = []
      setConversationHistory([])
    }
    
    // 3. 后台静默同步 API 数据
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
        console.log('后台同步历史记录失败（不影响使用）:', error.message)
      }
    }, 100)
    
    roleHistoryCache.current[role] = {
      data: localHistory,
      timestamp: Date.now()
    }
    
    return localHistory
  }, [])

  // 保存对话到历史记录
  const saveConversation = useCallback((messages) => {
    if (!messages || messages.length === 0) return
    
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
  }, [userRole, conversationTitle, currentConversationId, currentSessionId])

  // 加载指定对话
  const loadConversation = useCallback(async (conversationId) => {
    try {
      const response = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/chat-history/${conversationId}`)
      const data = await response.json()
      
      if (data.success && Array.isArray(data.messages)) {
        const messages = data.messages.map(msg => {
          const message = {
            type: msg.message_type === 'user' ? 'user' : 'system',
            content: msg.content || '',
            id: msg.id
          }
          return message
        })
        
        const parsedMessages = parseMessageHiddenMarkers(messages)
        const conversation = conversationHistory.find(c => c.id === conversationId)
        const title = conversation?.title || messages.find(m => m.type === 'user')?.content?.substring(0, 20) || '新对话'
        
        setCurrentConversationId(conversationId)
        setConversationTitle(title)
        setCurrentSessionId(conversationId)
        localStorage.setItem('current_session_id', conversationId)
        
        return { messages: parsedMessages, title }
      }
      
      // 从localStorage加载
      const historyKey = getHistoryKey(userRole)
      const parsedData = JSON.parse(localStorage.getItem(historyKey) || '[]')
      const history = Array.isArray(parsedData) ? parsedData : []
      const conversation = history.find(c => c.id === conversationId)
      
      if (conversation && conversation.messages) {
        const messages = parseMessageHiddenMarkers(conversation.messages)
        setCurrentConversationId(conversation.id)
        setConversationTitle(conversation.title)
        return { messages, title: conversation.title }
      }
      
      return null
    } catch (error) {
      console.error('加载对话失败:', error)
      
      const historyKey = getHistoryKey(userRole)
      const parsedData = JSON.parse(localStorage.getItem(historyKey) || '[]')
      const history = Array.isArray(parsedData) ? parsedData : []
      const conversation = history.find(c => c.id === conversationId)
      
      if (conversation && conversation.messages) {
        const messages = parseMessageHiddenMarkers(conversation.messages)
        setCurrentConversationId(conversation.id)
        setConversationTitle(conversation.title)
        return { messages, title: conversation.title }
      }
      
      return null
    }
  }, [userRole, conversationHistory])

  // 新建对话
  const newConversation = useCallback(() => {
    const newSessionId = generateSessionId()
    setCurrentConversationId(null)
    setConversationTitle('新对话')
    setCurrentSessionId(newSessionId)
    localStorage.setItem('current_session_id', newSessionId)
    return newSessionId
  }, [])

  // 删除对话
  const deleteConversation = useCallback((conversationId) => {
    const historyKey = getHistoryKey(userRole)
    const history = (Array.isArray(conversationHistory) ? conversationHistory : []).filter(c => c.id !== conversationId)
    localStorage.setItem(historyKey, JSON.stringify(history))
    setConversationHistory(history)
    
    if (currentConversationId === conversationId) {
      return newConversation()
    }
    return null
  }, [userRole, conversationHistory, currentConversationId, newConversation])

  return {
    conversationHistory,
    setConversationHistory,
    currentConversationId,
    setCurrentConversationId,
    conversationTitle,
    setConversationTitle,
    currentSessionId,
    setCurrentSessionId,
    loadRoleHistory,
    saveConversation,
    loadConversation,
    newConversation,
    deleteConversation
  }
}

export default useConversationHistory
