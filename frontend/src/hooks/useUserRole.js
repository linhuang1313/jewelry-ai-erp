/**
 * 用户角色管理 Hook (Phase 5 - copy-paste extraction from App.jsx)
 */
import { useState, useEffect, useRef } from 'react'
import { USER_ROLES } from '../constants/roles'
import { getHistoryKey, getLastSessionKey } from '../utils/userIdentifier'
import { parseMessageHiddenMarkers } from '../utils/messageParser'
import { getPendingTransferCount, getPendingSalesCount } from '../services/chatService'

export function useUserRole(userRole, setUserRole, conversationState, messages, setMessages, setSidebarOpen) {
  const {
    conversationTitle, currentConversationId, currentSessionId,
    loadRoleHistory,
    setCurrentConversationId, setCurrentSessionId, setConversationTitle,
    newConversation
  } = conversationState

  // 角色下拉菜单状态
  const [roleDropdownOpen, setRoleDropdownOpen] = useState(false)
  const [roleLoading, setRoleLoading] = useState(false)
  const roleDropdownRef = useRef(null)

  // 待处理转移单数量
  const [pendingTransferCount, setPendingTransferCount] = useState(0)
  // 待结算销售单数量
  const [pendingSalesCount, setPendingSalesCount] = useState(0)

  // 获取当前角色信息
  const getCurrentRole = () => {
    return USER_ROLES.find(r => r.id === userRole) || USER_ROLES[0]
  }

  // ========== 切换用户角色（增强版：保存恢复各角色上次对话） ==========
  const changeUserRole = async (roleId) => {
    // 如果是同一角色，直接返回
    if (roleId === userRole) {
      setRoleDropdownOpen(false)
      return
    }
    
    // 显示加载状态
    setRoleLoading(true)
    setRoleDropdownOpen(false)
    
    // 如果切换到不同角色，保存当前对话并加载新角色的历史记录
    if (roleId !== userRole) {
      // 1. 保存当前角色的对话和会话ID
      if (messages.length > 0) {
        // 直接保存到当前角色的历史记录（不使用延迟保存）
        const currentHistoryKey = getHistoryKey(userRole)
        const parsedHistory = JSON.parse(localStorage.getItem(currentHistoryKey) || '[]')
        const currentHistory = Array.isArray(parsedHistory) ? parsedHistory : []
        
        // 自动生成对话标题
        let title = conversationTitle
        if (title === '新对话' || !currentConversationId) {
          const firstUserMessage = messages.find(m => m.type === 'user')
          if (firstUserMessage) {
            title = firstUserMessage.content.substring(0, 20) || '新对话'
            if (firstUserMessage.content.length > 20) title += '...'
          }
        }
        
        const conversationId = currentConversationId || currentSessionId || Date.now().toString()
        const conversation = {
          id: conversationId,
          title: title,
          messages: messages,
          createdAt: currentConversationId ? 
            (currentHistory.find(c => c.id === currentConversationId)?.createdAt || new Date().toISOString()) :
            new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
        
        const existingIndex = currentHistory.findIndex(h => h.id === conversation.id)
        if (existingIndex >= 0) {
          currentHistory[existingIndex] = conversation
        } else {
          currentHistory.unshift(conversation)
        }
        
        const limitedHistory = currentHistory.slice(0, 50)
        localStorage.setItem(currentHistoryKey, JSON.stringify(limitedHistory))
        
        // 保存当前角色的上次会话ID
        const currentLastSessionKey = getLastSessionKey(userRole)
        localStorage.setItem(currentLastSessionKey, conversationId)
      }
      
      // 2. 切换到新角色，加载新角色的历史记录
      await loadRoleHistory(roleId)
      
      // 3. 尝试恢复新角色上次的对话
      const newLastSessionKey = getLastSessionKey(roleId)
      const lastSessionId = localStorage.getItem(newLastSessionKey)
      
      if (lastSessionId) {
        // 尝试恢复新角色上次的对话
        const newHistoryKey = getHistoryKey(roleId)
        try {
          const parsedData = JSON.parse(localStorage.getItem(newHistoryKey) || '[]')
          const history = Array.isArray(parsedData) ? parsedData : []
          const lastConversation = history.find(c => c.id === lastSessionId)
          
          if (lastConversation && lastConversation.messages && lastConversation.messages.length > 0) {
            const restoredMessages = parseMessageHiddenMarkers(lastConversation.messages)
            setMessages(restoredMessages)
            setCurrentConversationId(lastSessionId)
            setCurrentSessionId(lastSessionId)
            setConversationTitle(lastConversation.title || '新对话')
            console.log('[Role Switch] Restore last conversation:', lastSessionId)
          } else {
            // 没有找到上次对话，开始新对话
            newConversation()
          }
        } catch {
          newConversation()
        }
      } else {
        // 该角色没有上次对话记录，开始新对话
        newConversation()
      }
    }
    setUserRole(roleId)
    localStorage.setItem('userRole', roleId)
    setRoleLoading(false)
  }

  // 加载待处理转移单数量
  const loadPendingTransferCount = async () => {
    try {
      const count = await getPendingTransferCount(userRole)
      setPendingTransferCount(count)
    } catch (error) {
      console.error('Load pending transfer count failed:', error)
    }
  }

  // 加载待结算销售单数量
  const loadPendingSalesCount = async () => {
    try {
      const count = await getPendingSalesCount(userRole)
      setPendingSalesCount(count)
    } catch (error) {
      console.error('Load pending sales count failed:', error)
    }
  }

  // 点击外部关闭角色下拉菜单
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (roleDropdownRef.current && !roleDropdownRef.current.contains(event.target)) {
        setRoleDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // 角色变化时加载待处理数量
  useEffect(() => {
    loadPendingTransferCount()
    loadPendingSalesCount()
    const interval = setInterval(() => {
      loadPendingTransferCount()
      loadPendingSalesCount()
    }, 30000) // 30秒轮询（原3秒太频繁，浪费带宽）
    return () => clearInterval(interval)
  }, [userRole])

  return {
    roleDropdownOpen, setRoleDropdownOpen,
    roleLoading,
    roleDropdownRef,
    pendingTransferCount, pendingSalesCount,
    getCurrentRole,
    changeUserRole
  }
}
