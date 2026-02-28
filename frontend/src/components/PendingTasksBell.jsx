import React, { useState, useEffect, useRef, useCallback } from 'react'
import { apiGet, apiPost } from '../utils/api'
import ActionCardRenderer from './chat/cards/ActionCardRenderer'

const ROLE_LABELS = {
  finance: '财务',
  settlement: '结算',
  product: '商品部',
  counter: '柜台',
  sales: '业务员',
  material: '料部',
  manager: '经理',
}

const PendingTasksBell = ({ userRole }) => {
  const [pendingCards, setPendingCards] = useState([])
  const [notifications, setNotifications] = useState([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [activeTab, setActiveTab] = useState('tasks')
  const [selectedCard, setSelectedCard] = useState(null)
  const dropdownRef = useRef(null)

  const fetchPending = useCallback(async () => {
    const result = await apiGet('/api/action-cards/pending', { showErrorToast: false })
    if (result?.items && Array.isArray(result.items)) {
      setPendingCards(result.items)
    }
  }, [])

  const fetchNotifications = useCallback(async () => {
    const result = await apiGet('/api/notifications/unread', { showErrorToast: false })
    if (result?.items && Array.isArray(result.items)) {
      setNotifications(result.items)
    }
  }, [])

  useEffect(() => {
    fetchPending()
    fetchNotifications()
    const interval = setInterval(() => {
      fetchPending()
      fetchNotifications()
    }, 30000)
    return () => clearInterval(interval)
  }, [fetchPending, fetchNotifications])

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowDropdown(false)
        setSelectedCard(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const totalCount = pendingCards.length + notifications.length

  const handleMarkAllRead = async () => {
    await apiPost('/api/notifications/read-all', {}, { showErrorToast: false })
    setNotifications([])
  }

  const handleCardUpdate = (updatedCard) => {
    setPendingCards(prev => prev.filter(c => c.card_id !== updatedCard.card_id))
    setSelectedCard(null)
    fetchNotifications()
  }

  if (selectedCard) {
    return (
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => { setSelectedCard(null); setShowDropdown(true) }}
          className="relative p-2 text-gray-600 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          {totalCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center font-medium">
              {totalCount > 9 ? '9+' : totalCount}
            </span>
          )}
        </button>

        <div className="absolute right-0 top-12 w-[480px] max-h-[600px] bg-white rounded-xl shadow-2xl border border-gray-200 z-50 overflow-hidden">
          <div className="p-4 border-b border-gray-100 flex items-center gap-2">
            <button
              onClick={() => { setSelectedCard(null); setShowDropdown(true) }}
              className="text-gray-500 hover:text-gray-700"
            >
              ← 返回
            </button>
            <span className="font-medium text-gray-900">卡片详情</span>
          </div>
          <div className="p-4 overflow-y-auto max-h-[520px]">
            <ActionCardRenderer
              card={selectedCard}
              userRole={userRole}
              onCardUpdate={handleCardUpdate}
            />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="relative p-2 text-gray-600 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {totalCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center font-medium">
            {totalCount > 9 ? '9+' : totalCount}
          </span>
        )}
      </button>

      {showDropdown && (
        <div className="absolute right-0 top-12 w-96 max-h-[500px] bg-white rounded-xl shadow-2xl border border-gray-200 z-50 overflow-hidden">
          {/* Tab 切换 */}
          <div className="flex border-b border-gray-100">
            <button
              onClick={() => setActiveTab('tasks')}
              className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                activeTab === 'tasks'
                  ? 'text-amber-600 border-b-2 border-amber-500'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              📋 待办 {pendingCards.length > 0 && <span className="ml-1 px-1.5 py-0.5 bg-red-100 text-red-600 text-xs rounded-full">{pendingCards.length}</span>}
            </button>
            <button
              onClick={() => setActiveTab('notifications')}
              className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                activeTab === 'notifications'
                  ? 'text-amber-600 border-b-2 border-amber-500'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              🔔 通知 {notifications.length > 0 && <span className="ml-1 px-1.5 py-0.5 bg-blue-100 text-blue-600 text-xs rounded-full">{notifications.length}</span>}
            </button>
          </div>

          {/* 内容 */}
          <div className="overflow-y-auto max-h-[420px]">
            {activeTab === 'tasks' ? (
              pendingCards.length === 0 ? (
                <div className="p-8 text-center text-gray-400 text-sm">暂无待办任务</div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {pendingCards.map(card => {
                    const payload = card.payload || {}
                    const confirmedCount = (card.actions_taken || []).filter(a => a.action === 'confirm').length
                    const totalRoles = (card.target_roles || []).length
                    return (
                      <div
                        key={card.card_id}
                        onClick={() => setSelectedCard(card)}
                        className="p-4 hover:bg-amber-50/50 cursor-pointer transition-colors"
                      >
                        <div className="flex items-start gap-3">
                          <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center text-lg flex-shrink-0">
                            💰
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <span className="font-medium text-gray-900 text-sm truncate">
                                {payload.customer_name || '收款确认'}
                              </span>
                              <span className="text-amber-600 font-bold text-sm whitespace-nowrap ml-2">
                                ¥{Number(payload.total_amount || 0).toLocaleString()}
                              </span>
                            </div>
                            <div className="text-xs text-gray-500 mt-0.5">
                              来自: {ROLE_LABELS[card.creator_role] || card.creator_role}
                              {' · '}
                              等待: {(card.target_roles || []).filter(r => !(card.actions_taken || []).some(a => a.role === r && a.action === 'confirm')).map(r => ROLE_LABELS[r] || r).join('、')}
                            </div>
                            <div className="flex items-center gap-2 mt-1.5">
                              <div className="flex-1 bg-gray-200 rounded-full h-1.5">
                                <div
                                  className="bg-green-500 rounded-full h-1.5 transition-all"
                                  style={{ width: `${totalRoles > 0 ? (confirmedCount / totalRoles) * 100 : 0}%` }}
                                />
                              </div>
                              <span className="text-xs text-gray-400">{confirmedCount}/{totalRoles}</span>
                            </div>
                          </div>
                          <svg className="w-4 h-4 text-gray-300 flex-shrink-0 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            ) : (
              notifications.length === 0 ? (
                <div className="p-8 text-center text-gray-400 text-sm">暂无新通知</div>
              ) : (
                <>
                  <div className="px-4 py-2 flex justify-end">
                    <button
                      onClick={handleMarkAllRead}
                      className="text-xs text-blue-500 hover:text-blue-700"
                    >
                      全部已读
                    </button>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {notifications.map(n => (
                      <div key={n.id} className="p-4 hover:bg-blue-50/50 transition-colors">
                        <div className="flex items-start gap-3">
                          <span className="text-lg">
                            {n.notification_type === 'card_completed' ? '✅' : '❌'}
                          </span>
                          <div className="flex-1">
                            <div className="text-sm font-medium text-gray-900">{n.title}</div>
                            {n.body && <div className="text-xs text-gray-500 mt-0.5">{n.body}</div>}
                            <div className="text-xs text-gray-400 mt-1">
                              {n.create_time && new Date(n.create_time).toLocaleString('zh-CN')}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default PendingTasksBell
