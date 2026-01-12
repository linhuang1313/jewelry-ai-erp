import React, { useState, useEffect } from 'react'
import { API_ENDPOINTS } from '../config'
import { History, Search, Calendar, RefreshCw, ChevronRight, MessageSquare, Clock, User, X } from 'lucide-react'

/**
 * 聊天历史回溯面板组件
 * 用于查看和搜索服务器端存储的所有对话记录
 */
export function ChatHistoryPanel({ isOpen, onClose, onLoadSession, userRole }) {
  const [sessions, setSessions] = useState([])
  const [selectedSession, setSelectedSession] = useState(null)
  const [sessionMessages, setSessionMessages] = useState([])
  const [loading, setLoading] = useState(false)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [isSearching, setIsSearching] = useState(false)
  const [activeTab, setActiveTab] = useState('sessions') // 'sessions' | 'search'

  // 角色名称映射
  const roleNames = {
    counter: '柜台',
    sales: '业务员',
    product: '商品专员',
    settlement: '结算专员',
    finance: '财务',
    manager: '管理层'
  }

  // 获取会话列表
  const fetchSessions = async () => {
    setLoading(true)
    try {
      const response = await fetch(`${API_ENDPOINTS.BASE_URL}/api/chat-sessions?limit=50`)
      const data = await response.json()
      if (data.success) {
        setSessions(data.sessions || [])
      }
    } catch (error) {
      console.error('获取会话列表失败:', error)
    } finally {
      setLoading(false)
    }
  }

  // 获取指定会话的消息
  const fetchSessionMessages = async (sessionId) => {
    setLoading(true)
    try {
      const response = await fetch(`${API_ENDPOINTS.BASE_URL}/api/chat-history/${sessionId}`)
      const data = await response.json()
      if (data.success) {
        setSessionMessages(data.messages || [])
        setSelectedSession(sessionId)
      }
    } catch (error) {
      console.error('获取会话消息失败:', error)
    } finally {
      setLoading(false)
    }
  }

  // 搜索聊天记录
  const searchLogs = async () => {
    if (!searchKeyword.trim()) return
    setIsSearching(true)
    try {
      const response = await fetch(
        `${API_ENDPOINTS.BASE_URL}/api/chat-logs/search?keyword=${encodeURIComponent(searchKeyword)}&limit=30`
      )
      const data = await response.json()
      if (data.success) {
        setSearchResults(data.logs || [])
      }
    } catch (error) {
      console.error('搜索失败:', error)
    } finally {
      setIsSearching(false)
    }
  }

  // 加载会话到主聊天界面
  const handleLoadSession = (sessionId) => {
    if (onLoadSession) {
      onLoadSession(sessionId, sessionMessages)
    }
  }

  // 格式化时间
  const formatTime = (isoString) => {
    if (!isoString) return ''
    const date = new Date(isoString)
    const now = new Date()
    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24))
    
    if (diffDays === 0) {
      return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    } else if (diffDays === 1) {
      return '昨天 ' + date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    } else if (diffDays < 7) {
      return `${diffDays}天前`
    } else {
      return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
    }
  }

  // 打开面板时加载数据
  useEffect(() => {
    if (isOpen) {
      fetchSessions()
    }
  }, [isOpen])

  // 按回车搜索
  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      searchLogs()
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* 遮罩层 */}
      <div 
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* 面板主体 */}
      <div className="relative ml-auto w-full max-w-2xl bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
        {/* 头部 */}
        <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-blue-100 rounded-xl">
                <History className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">对话历史回溯</h2>
                <p className="text-sm text-gray-500">查看和搜索所有历史对话记录</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/50 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>
          
          {/* 标签切换 */}
          <div className="flex mt-4 space-x-2">
            <button
              onClick={() => setActiveTab('sessions')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'sessions'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-white/70 text-gray-600 hover:bg-white'
              }`}
            >
              <MessageSquare className="w-4 h-4 inline mr-1.5" />
              会话列表
            </button>
            <button
              onClick={() => setActiveTab('search')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'search'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-white/70 text-gray-600 hover:bg-white'
              }`}
            >
              <Search className="w-4 h-4 inline mr-1.5" />
              搜索记录
            </button>
          </div>
        </div>

        {/* 内容区域 */}
        <div className="flex-1 overflow-hidden flex">
          {activeTab === 'sessions' ? (
            <>
              {/* 会话列表 */}
              <div className={`${selectedSession ? 'w-1/2' : 'w-full'} border-r border-gray-100 overflow-y-auto transition-all`}>
                <div className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm text-gray-500">共 {sessions.length} 个会话</span>
                    <button
                      onClick={fetchSessions}
                      disabled={loading}
                      className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                      <RefreshCw className={`w-4 h-4 text-gray-500 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                  
                  {loading && sessions.length === 0 ? (
                    <div className="py-12 text-center text-gray-400">
                      <RefreshCw className="w-8 h-8 mx-auto mb-2 animate-spin" />
                      <p>加载中...</p>
                    </div>
                  ) : sessions.length === 0 ? (
                    <div className="py-12 text-center text-gray-400">
                      <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-30" />
                      <p>暂无对话记录</p>
                      <p className="text-xs mt-1">开始新的对话后将自动保存</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {sessions.map((session) => (
                        <div
                          key={session.session_id}
                          onClick={() => fetchSessionMessages(session.session_id)}
                          className={`p-3 rounded-xl cursor-pointer transition-all group ${
                            selectedSession === session.session_id
                              ? 'bg-blue-50 border border-blue-200'
                              : 'bg-gray-50 hover:bg-gray-100 border border-transparent'
                          }`}
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">
                                {session.summary || '无标题对话'}
                              </p>
                              <div className="flex items-center mt-1.5 space-x-3 text-xs text-gray-500">
                                <span className="flex items-center">
                                  <Clock className="w-3 h-3 mr-1" />
                                  {formatTime(session.start_time)}
                                </span>
                                <span className="flex items-center">
                                  <MessageSquare className="w-3 h-3 mr-1" />
                                  {session.message_count} 条
                                </span>
                                {session.user_role && (
                                  <span className="flex items-center">
                                    <User className="w-3 h-3 mr-1" />
                                    {roleNames[session.user_role] || session.user_role}
                                  </span>
                                )}
                              </div>
                              {session.last_intent && (
                                <span className="inline-block mt-1.5 px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">
                                  {session.last_intent}
                                </span>
                              )}
                            </div>
                            <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform ${
                              selectedSession === session.session_id ? 'rotate-90' : ''
                            }`} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* 会话详情 */}
              {selectedSession && (
                <div className="w-1/2 flex flex-col bg-gray-50">
                  <div className="p-4 bg-white border-b border-gray-100">
                    <div className="flex items-center justify-between">
                      <h3 className="font-medium text-gray-900">对话详情</h3>
                      <button
                        onClick={() => handleLoadSession(selectedSession)}
                        className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
                      >
                        加载到聊天
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {sessionMessages.map((msg, index) => (
                      <div
                        key={msg.id || index}
                        className={`p-3 rounded-xl ${
                          msg.message_type === 'user'
                            ? 'bg-blue-600 text-white ml-8'
                            : 'bg-white text-gray-800 mr-8 shadow-sm'
                        }`}
                      >
                        <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                        <div className={`text-xs mt-2 ${
                          msg.message_type === 'user' ? 'text-blue-200' : 'text-gray-400'
                        }`}>
                          {formatTime(msg.created_at)}
                          {msg.intent && ` · ${msg.intent}`}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            /* 搜索标签页 */
            <div className="w-full flex flex-col">
              {/* 搜索框 */}
              <div className="p-4 border-b border-gray-100">
                <div className="relative">
                  <input
                    type="text"
                    value={searchKeyword}
                    onChange={(e) => setSearchKeyword(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder="搜索对话内容..."
                    className="w-full px-4 py-2.5 pl-10 bg-gray-100 border-0 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
                  />
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <button
                    onClick={searchLogs}
                    disabled={isSearching || !searchKeyword.trim()}
                    className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {isSearching ? '搜索中...' : '搜索'}
                  </button>
                </div>
              </div>

              {/* 搜索结果 */}
              <div className="flex-1 overflow-y-auto p-4">
                {searchResults.length === 0 ? (
                  <div className="py-12 text-center text-gray-400">
                    <Search className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p>输入关键词搜索历史对话</p>
                    <p className="text-xs mt-1">支持搜索对话内容、问题等</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-gray-500 mb-2">找到 {searchResults.length} 条结果</p>
                    {searchResults.map((log) => (
                      <div
                        key={log.id}
                        onClick={() => fetchSessionMessages(log.session_id)}
                        className="p-3 bg-white rounded-xl shadow-sm hover:shadow-md cursor-pointer transition-all"
                      >
                        <p className="text-sm text-gray-800">{log.content}</p>
                        <div className="flex items-center mt-2 space-x-3 text-xs text-gray-500">
                          <span>{formatTime(log.created_at)}</span>
                          <span>{roleNames[log.user_role] || log.user_role}</span>
                          {log.intent && (
                            <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">
                              {log.intent}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default ChatHistoryPanel

