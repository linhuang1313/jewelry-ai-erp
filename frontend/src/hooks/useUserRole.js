/**
 * 用户角色管理 Hook
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { USER_ROLES } from '../constants/roles'
import { getHistoryKey, getLastSessionKey } from '../utils/userIdentifier'
import { parseMessageHiddenMarkers } from '../utils/messageParser'

export const useUserRole = (onRoleChange) => {
  // 用户角色状态
  const [userRole, setUserRole] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('userRole') || 'sales'
    }
    return 'sales'
  })
  
  const [roleDropdownOpen, setRoleDropdownOpen] = useState(false)
  const [roleLoading, setRoleLoading] = useState(false)
  const roleDropdownRef = useRef(null)
  const roleHistoryCache = useRef({})

  // 获取当前角色信息
  const getCurrentRole = useCallback(() => {
    return USER_ROLES.find(r => r.id === userRole) || USER_ROLES[0]
  }, [userRole])

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

  // 切换用户角色
  const changeUserRole = useCallback(async (roleId, currentMessages, conversationTitle, currentConversationId, currentSessionId, conversationHistory) => {
    if (roleId === userRole) {
      setRoleDropdownOpen(false)
      return null
    }
    
    setRoleLoading(true)
    setRoleDropdownOpen(false)
    
    // 保存当前角色的对话
    if (currentMessages && currentMessages.length > 0) {
      const currentHistoryKey = getHistoryKey(userRole)
      const parsedHistory = JSON.parse(localStorage.getItem(currentHistoryKey) || '[]')
      const currentHistory = Array.isArray(parsedHistory) ? parsedHistory : []
      
      let title = conversationTitle
      if (title === '新对话' || !currentConversationId) {
        const firstUserMessage = currentMessages.find(m => m.type === 'user')
        if (firstUserMessage) {
          title = firstUserMessage.content.substring(0, 20) || '新对话'
          if (firstUserMessage.content.length > 20) title += '...'
        }
      }
      
      const conversationId = currentConversationId || currentSessionId || Date.now().toString()
      const conversation = {
        id: conversationId,
        title: title,
        messages: currentMessages,
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
      
      const currentLastSessionKey = getLastSessionKey(userRole)
      localStorage.setItem(currentLastSessionKey, conversationId)
    }
    
    // 切换到新角色
    setUserRole(roleId)
    localStorage.setItem('userRole', roleId)
    setRoleLoading(false)
    
    // 通知父组件角色已更改
    if (onRoleChange) {
      onRoleChange(roleId)
    }
    
    return roleId
  }, [userRole, onRoleChange])

  return {
    userRole,
    setUserRole,
    roleDropdownOpen,
    setRoleDropdownOpen,
    roleLoading,
    roleDropdownRef,
    roleHistoryCache,
    getCurrentRole,
    changeUserRole
  }
}

export default useUserRole
