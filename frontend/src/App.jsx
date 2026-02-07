import { useState, useRef, useEffect } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Toaster } from 'react-hot-toast'
import { Bar, Pie, Line, Doughnut } from 'react-chartjs-2'
import { API_ENDPOINTS, API_BASE_URL } from './config'
import LanguageSelector from './components/LanguageSelector'
import { hasPermission, canAccessPage, getPermissionDeniedMessage } from './config/permissions'
import { JewelryInboundCardComponent } from './components/JewelryInboundCard'
import { createCardFromBackend, updateCard, createNewCard } from './utils/inboundHelpers'
import { confirmInbound, reportError } from './services/inboundService'
import { FinancePage } from './components/finance'
import { AnalyticsPage } from './components/AnalyticsPage'
import DashboardPage from './components/DashboardPage'
import ManagerDashboardPage from './components/ManagerDashboardPage'
import { ExportPage } from './components/ExportPage'
import { WarehousePage } from './components/WarehousePage'
import { SettlementPage } from './components/SettlementPage'
import { SalespersonPage } from './components/SalespersonPage'
import { CustomerPage } from './components/CustomerPage'
import { QuickOrderModal } from './components/QuickOrderModal'
import { QuickReturnModal } from './components/QuickReturnModal'
import QuickInboundModal from './components/QuickInboundModal'
import SalesOrdersPage from './components/SalesOrdersPage'
import ManagerDashboardCard from './components/ManagerDashboardCard'
import { SupplierPage } from './components/SupplierPage'
import ReturnPage from './components/ReturnPage'
import GoldMaterialPage from './components/GoldMaterialPage'
import LoanPage from './components/LoanPage'
import DocumentCenterPage from './components/DocumentCenterPage'
import ProductCodePage from './components/ProductCodePage'
import InboundOrdersPage from './components/InboundOrdersPage'
import { USER_ROLES } from './constants/roles'
import { Header, Sidebar } from './components/layout'
import { ThinkingIndicator, ThinkingMessage, WelcomeScreen, InputArea } from './components/chat'
import { OCRModal, QuickReceiptModal, QuickWithdrawalModal } from './components/modals'
import { ChatHistoryPanel } from './components/ChatHistoryPanel'
import { getUserIdentifier, getHistoryKey, getLastSessionKey } from './utils/userIdentifier'
import { parseMessageHiddenMarkers } from './utils/messageParser'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  PointElement,
  LineElement,
  Filler,
  Title,
  Tooltip,
  Legend,
} from 'chart.js'

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  PointElement,
  LineElement,
  Filler,
  Title,
  Tooltip,
  Legend
)

function App() {
  // 国际化
  const { t, i18n } = useTranslation()
  const [showLanguageSelector, setShowLanguageSelector] = useState(() => {
    // 首次访问显示语言选择?
    if (typeof window !== 'undefined') {
      return localStorage.getItem('languageSelected') !== 'true'
    }
    return true
  })
  const currentLanguage = i18n.language || 'zh'
  
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)  // 图片上传状态
  const messagesEndRef = useRef(null)
  const abortControllerRef = useRef(null)  // SSE 请求取消控制?
  
  // OCR编辑对话框相关状态
  const [showOCRModal, setShowOCRModal] = useState(false)
  const [ocrResult, setOcrResult] = useState('')
  const [uploadedImage, setUploadedImage] = useState(null)
  
  // 历史对话记录相关状态
  const [conversationHistory, setConversationHistory] = useState([]) // 历史对话列表
  const [currentConversationId, setCurrentConversationId] = useState(null) // 当前对话ID
  
  // 后端会话ID（用于聊天记录持久化）
  const [currentSessionId, setCurrentSessionId] = useState(() => {
    // 生成或恢复?session_id
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('current_session_id')
      if (saved) return saved
      const newId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      localStorage.setItem('current_session_id', newId)
      return newId
    }
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  })
  // 侧边栏开关（桌面端默认打开，移动端默认关闭）
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth >= 1024
    }
    return true
  })
  const [conversationTitle, setConversationTitle] = useState('New Chat') // 当前对话标题
  const [currentPage, setCurrentPage] = useState('chat') // 'chat', 'finance', 'warehouse', 'settlement', 'analytics', 'export'
  const [showQuickOrderModal, setShowQuickOrderModal] = useState(false) // 快捷开单弹窗
  const [showQuickReturnModal, setShowQuickReturnModal] = useState(false) // 快捷退货弹窗
  const [showQuickInboundModal, setShowQuickInboundModal] = useState(false) // 快捷入库弹窗
  const [showSalesSearchModal, setShowSalesSearchModal] = useState(false) // 销售管理弹窗
  const [showHistoryPanel, setShowHistoryPanel] = useState(false) // 历史回顾面板
  const [showQuickReceiptModal, setShowQuickReceiptModal] = useState(false) // 快捷收料弹窗
  const [showQuickWithdrawalModal, setShowQuickWithdrawalModal] = useState(false) // 快捷提料弹窗
  const [toastMessage, setToastMessage] = useState('') // Toast 提示消息
  
  // 用户角色相关状态
  const [userRole, setUserRole] = useState(() => {
    // 浠?localStorage 读取保存的角色，默认为业务员
    if (typeof window !== 'undefined') {
      return localStorage.getItem('userRole') || 'sales'
    }
    return 'sales'
  })
  const [roleDropdownOpen, setRoleDropdownOpen] = useState(false)
  const [roleLoading, setRoleLoading] = useState(false)  // 角色切换加载状态
  const roleDropdownRef = useRef(null)
  const roleHistoryCache = useRef({})  // 角色历史记录缓存
  
  // 待处理转移单数量（用于分仓库存按钮badge：
  const [pendingTransferCount, setPendingTransferCount] = useState(0)
  // 待结算销售单数量（用于结算管理按钮badge：
  const [pendingSalesCount, setPendingSalesCount] = useState(0)

  // Toast 鎻愮ず鍑芥暟：绉掑悗鑷姩娑堝け：
  const showToast = (message, duration = 3000) => {
    setToastMessage(message)
    setTimeout(() => setToastMessage(''), duration)
  }

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // getUserIdentifier, getHistoryKey, getLastSessionKey, parseMessageHiddenMarkers
  // 已移至 utils/userIdentifier.js 和 utils/messageParser.js，通过顶部 import 引入

  // 加载指定角色的历史记录（优化版：优先使用缓存/localStorage，后台静默同步API：
  const loadRoleHistory = async (role) => {
    const historyKey = getHistoryKey(role)
    
    // 1. 首先检查内存缓存（5鍒嗛挓鏈夋晥鏈燂級
    const cached = roleHistoryCache.current[role]
    if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
      setConversationHistory(cached.data)
      return cached.data
    }
    
    // 2. 立即从?localStorage 加载（快速响应）
    let localHistory = []
    try {
      const parsed = JSON.parse(localStorage.getItem(historyKey) || '[]')
      localHistory = Array.isArray(parsed) ? parsed : []
      setConversationHistory(localHistory)
    } catch {
      localHistory = []
      setConversationHistory([])
    }
    
    // 3. 后台静默同步 API 数据（不阻塞 UI：
    // 浣跨敤 setTimeout 璁?UI 鍏堟洿鏂?
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
          
          // 更新 localStorage
          localStorage.setItem(historyKey, JSON.stringify(history))
          
          // 更新内存缓存
          roleHistoryCache.current[role] = {
            data: history,
            timestamp: Date.now()
          }
          
          // 只有当前角色匹配时才更新 UI
          // 避免切换角色后旧请求覆盖新数据?
          setConversationHistory(prev => {
            // 如果本地已有数据，合并保留本地的消息内容
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
    
    // Cache local data
    roleHistoryCache.current[role] = {
      data: localHistory,
      timestamp: Date.now()
    }
    
    return localHistory
  }

  // ========== 切换用户角色（增强版：保存恢复各角色上次对话） ==========
  const changeUserRole = async (roleId) => {
    // 如果是同一角色，直接返回?
    if (roleId === userRole) {
      setRoleDropdownOpen(false)
      return
    }
    
    // 显示加载状态
    setRoleLoading(true)
    setRoleDropdownOpen(false)
    
    // 如果切换到不同角色，保存当前对话并加载新角色的历史记录?
    if (roleId !== userRole) {
      // 1. 保存当前角色的对话和会话ID
      if (messages.length > 0) {
        // 直接保存到当前角色的历史记录（不使用延迟保存
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
        
        // 鍙繚鐣欐渶杩?0涓璇?
        const limitedHistory = currentHistory.slice(0, 50)
        localStorage.setItem(currentHistoryKey, JSON.stringify(limitedHistory))
        
        // 保存当前角色的上次会话ID
        const currentLastSessionKey = getLastSessionKey(userRole)
        localStorage.setItem(currentLastSessionKey, conversationId)
      }
      
      // 2. 切换到新角色，加载新角色的历史记录?
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
    setRoleLoading(false)  // 关闭加载状态
  }

  // 获取当前角色信息
  const getCurrentRole = () => {
    return USER_ROLES.find(r => r.id === userRole) || USER_ROLES[0]
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

  // 组件卸载时取消正在进行的 SSE 璇锋眰
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [])

  // 仅在页面初始加载时加载当前角色的历史对话记录
  // 角色切换时由 changeUserRole 函数负责加载，避免重复调用?
  const initialLoadRef = useRef(false)
  useEffect(() => {
    if (!initialLoadRef.current) {
      initialLoadRef.current = true
      loadRoleHistory(userRole)
    }
  }, []) // 只在组件挂载时执行一起

  // ========== 页面初始化时恢复当前对话（增强版：支持后端同步兜底） ==========
  const [isRestoring, setIsRestoring] = useState(false) // 防止重复恢复
  
  useEffect(() => {
    // 纭繚 userRole 宸插垵濮嬪寲
    if (!userRole || isRestoring) return
    
    const restoreCurrentConversation = async () => {
      setIsRestoring(true)
      
      // 获取该角色上次使用的session
      const lastSessionKey = getLastSessionKey(userRole)
      const savedSessionId = localStorage.getItem(lastSessionKey) || localStorage.getItem('current_session_id')
      
      if (!savedSessionId) {
        setIsRestoring(false)
        return
      }
      
      // 妫€鏌ocalStorage中是否有这个对话的消?
      const historyKey = getHistoryKey(userRole)
      try {
        const parsedData = JSON.parse(localStorage.getItem(historyKey) || '[]')
        const history = Array.isArray(parsedData) ? parsedData : []
        const conversation = history.find(c => c.id === savedSessionId)
        
        if (conversation && conversation.messages && conversation.messages.length > 0) {
          // 浠庢湰鍦版仮澶?
          const restoredMessages = parseMessageHiddenMarkers(conversation.messages)
          setMessages(restoredMessages)
          setCurrentConversationId(savedSessionId)
          setCurrentSessionId(savedSessionId)
          setConversationTitle(conversation.title || '新对话')
          console.log('[Restore] Restored from local:', savedSessionId, 'message count:', restoredMessages.length)
        } else {
          // 本地没有，尝试从后端同步
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
        // 数据损坏时，清空该角色的历史记录
        try {
          localStorage.setItem(historyKey, '[]')
          console.warn('[Restore] Cleared corrupted history records')
        } catch {}
      } finally {
        setIsRestoring(false)
      }
    }
    
    restoreCurrentConversation()
  }, [userRole]) // 渚濊禆 userRole，确保角色变化时也能正确恢复

  // 加载待处理转移单数量（柜台角色需要看到商品部发来的转移单
  const loadPendingTransferCount = async () => {
    // 只有柜台、结算、管理层需要看到待接收转移单数据?
    if (!['counter', 'settlement', 'manager'].includes(userRole)) {
      setPendingTransferCount(0)
      return
    }
    try {
      const response = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/warehouse/transfers?status=pending`)
      if (response.ok) {
        const transfers = await response.json()
        
        // 根据角色过滤，与 WarehousePage 閫昏緫淇濇寔涓€鑷?
        const roleLocationMap = {
          'counter': '展厅',
          'product': '商品部仓库'
        }
        const myLocation = roleLocationMap[userRole]
        
        if (myLocation) {
          // 只计算目标是当前角色管辖仓库的转移单
          const filtered = transfers.filter(t => t.to_location_name === myLocation)
          setPendingTransferCount(filtered.length)
        } else {
          // 管理员看所?
          setPendingTransferCount(transfers.length)
        }
      }
    } catch (error) {
      console.error('Load pending transfer count failed:', error)
      // 非关键功能，静默失败
    }
  }

  // 加载待结算销售单数量（结算专员需要看到柜台开的销售单
  const loadPendingSalesCount = async () => {
    // 只有结算专员和管理层需要看到待结算销售单数量
    if (!['settlement', 'manager'].includes(userRole)) {
      setPendingSalesCount(0)
      return
    }
    try {
      const response = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/settlement/pending-sales`)
      if (response.ok) {
        const sales = await response.json()
        setPendingSalesCount(sales.length)
      }
    } catch (error) {
      console.error('Load pending sales count failed:', error)
      // 非关键功能，静默失败
    }
  }


  // 角色变化时加载待处理数量
  useEffect(() => {
    loadPendingTransferCount()
    loadPendingSalesCount()
    // 姣?绉掑埛鏂颁竴娆?
    const interval = setInterval(() => {
      loadPendingTransferCount()
      loadPendingSalesCount()
    }, 3000)
    return () => clearInterval(interval)
  }, [userRole])

  // 保存对话到历史记录（保存到当前角色的历史记录
  // ========== 保存对话（增强版：去重优化?+ 保存上次会话ID：==========
  const lastSavedRef = useRef({ messageCount: 0, lastMessageId: null })
  
  const saveConversation = () => {
    if (messages.length === 0) return
    
    // 性能优化：检查消息是否真的变化了，避免重复保存
    const lastMessage = messages[messages.length - 1]
    if (lastSavedRef.current.messageCount === messages.length && 
        lastSavedRef.current.lastMessageId === lastMessage?.id) {
      return // 消息没有变化，不需要保存
    }
    
    // 获取当前角色的历史记录key
    const historyKey = getHistoryKey(userRole)
    // 浠巐ocalStorage获取当前角色的最新历史记录?
    const parsedData = JSON.parse(localStorage.getItem(historyKey) || '[]')
    const history = Array.isArray(parsedData) ? parsedData : []
    
    // 自动生成对话标题（使用第一条用户消息的?0涓瓧绗︼級
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
    
    // 鍙繚鐣欐渶杩?0涓璇?
    const limitedHistory = history.slice(0, 50)
    localStorage.setItem(historyKey, JSON.stringify(limitedHistory))
    setConversationHistory(limitedHistory)
    setCurrentConversationId(conversationId)
    
    // 保存当前角色的上次会话ID（用于角色切换时恢复
    const lastSessionKey = getLastSessionKey(userRole)
    localStorage.setItem(lastSessionKey, conversationId)
    
    // 更新保存状态，用于去重检测?
    lastSavedRef.current = { messageCount: messages.length, lastMessageId: lastMessage?.id }
  }

  // 当消息变化时自动保存（优化：去重
  useEffect(() => {
    if (messages.length === 0) return
    
    // 延迟保存，避免频繁写入
    const timer = setTimeout(() => {
      saveConversation()
    }, 1000)
    return () => clearTimeout(timer)
  }, [messages])

  // 加载指定对话（从后端API加载完整消息内容
  const loadConversation = async (conversationId) => {
    // 先尝试从localStorage加载（优先本地缓存，避免后端不可用时无法加载）
    const historyKey = getHistoryKey(userRole)
    let localConversation = null
    try {
      const parsedData = JSON.parse(localStorage.getItem(historyKey) || '[]')
      const history = Array.isArray(parsedData) ? parsedData : []
      localConversation = history.find(c => c.id === conversationId)
    } catch {}
    
    // 如果本地有完整消息，直接使用
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
      return // 本地有数据，无需请求后端
    }
    
    try {
      // 本地无数据，尝试从后端API获取
      const response = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/chat-history/${conversationId}`)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const data = await response.json()
      
      if (data.success && Array.isArray(data.messages)) {
        // 将后端消息格式转换为前端消息格式
        const messages = data.messages.map(msg => {
          const message = {
            type: msg.message_type === 'user' ? 'user' : 'system',  // assistant 消息显示为?system 绫诲瀷
            content: msg.content || '',
            id: msg.id
          }
          
          // 解析所有类型的隐藏标记
          if (msg.content) {
            // 提料单
            const withdrawalMatch = msg.content.match(/<!-- WITHDRAWAL_ORDER:(\d+):([^>]+) -->/)
            if (withdrawalMatch) {
              const withdrawalId = parseInt(withdrawalMatch[1])
              message.withdrawalId = withdrawalId
              message.withdrawalDownloadUrl = `${API_BASE_URL}/api/gold-material/withdrawals/${withdrawalId}/download?format=html`
            }
            // 收料单
            const goldReceiptMatch = msg.content.match(/<!-- GOLD_RECEIPT:(\d+):/)
            if (goldReceiptMatch) {
              const receiptId = parseInt(goldReceiptMatch[1])
              message.goldReceiptId = receiptId
              message.goldReceiptDownloadUrl = `${API_BASE_URL}/api/gold-material/gold-receipts/${receiptId}/print`
            }
            // 入库?
            const inboundMatch = msg.content.match(/<!-- INBOUND_ORDER:(\d+):/)
            if (inboundMatch) {
              message.inboundOrder = { id: parseInt(inboundMatch[1]) }
            }
            // 退货单
            const returnMatch = msg.content.match(/<!-- RETURN_ORDER:(\d+):/)
            if (returnMatch) {
              message.returnOrder = { id: parseInt(returnMatch[1]) }
            }
            // 销售单
            const salesMatch = msg.content.match(/<!-- SALES_ORDER:(\d+):/)
            if (salesMatch) {
              message.salesOrderId = parseInt(salesMatch[1])
            }
            // 结算?
            const settlementMatch = msg.content.match(/<!-- SETTLEMENT_ORDER:(\d+):/)
            if (settlementMatch) {
              message.settlementOrderId = parseInt(settlementMatch[1])
            }
          }
          
          return message
        })
        
        // 从历史记录中获取对话标题
        const history = conversationHistory
        const conversation = history.find(c => c.id === conversationId)
        const title = conversation?.title || messages.find(m => m.type === 'user')?.content?.substring(0, 20) || '新对话'
        
        setMessages(messages)
        setCurrentConversationId(conversationId)
        setConversationTitle(title)
        
        // 设置后端 session_id，确保后续消息继续使用相同的会话
        setCurrentSessionId(conversationId)
        localStorage.setItem('current_session_id', conversationId)
        
        // 只在移动端关闭侧边栏，桌面端保持打开
        if (window.innerWidth < 1024) {
          setSidebarOpen(false)
        } else {
          // 桌面端确保侧边栏打开
          setSidebarOpen(true)
        }
      } else {
        // 如果API失败，尝试从localStorage加载
        const historyKey = getHistoryKey(userRole)
        const parsedData = JSON.parse(localStorage.getItem(historyKey) || '[]')
        const history = Array.isArray(parsedData) ? parsedData : []
        const conversation = history.find(c => c.id === conversationId)
        if (conversation && conversation.messages) {
          // 解析消息中的隐藏标记，恢复所有特殊消息的额外字段
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
      // 后端不可用，显示提示消息
      showToast('后端服务暂时不可用，无法加载历史对话详情')
      // 至少切换到该对话（即使没有消息内容）
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
    
    // 生成新的后端 session_id
    const newSessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    setCurrentSessionId(newSessionId)
    localStorage.setItem('current_session_id', newSessionId)
    
    // 只在移动端关闭侧边栏，桌面端保持打开
    if (window.innerWidth < 1024) {
      setSidebarOpen(false)
    } else {
      // 桌面端确保侧边栏打开
      setSidebarOpen(true)
    }
  }

  // 删除对话（从当前角色的历史记录删除）
  // 注意：e.stopPropagation() 由 Sidebar 组件内部处理
  const deleteConversation = (conversationId) => {
    // 获取当前角色的历史记录key
    const historyKey = getHistoryKey(userRole)
    const history = (Array.isArray(conversationHistory) ? conversationHistory : []).filter(c => c.id !== conversationId)
    localStorage.setItem(historyKey, JSON.stringify(history))
    setConversationHistory(history)
    if (currentConversationId === conversationId) {
      newConversation()
    }
  }

  const sendMessage = async () => {
    if (!input.trim() || loading) return

    const userMessage = input.trim()
    setInput('')
    setMessages(prev => [...prev, { type: 'user', content: userMessage }])
    setLoading(true)
    
    // 创建思考过程消息ID
    const thinkingMessageId = Date.now()
    let contentMessageId = null
    let currentContent = ''
    let isContentStarted = false
    let thinkingSteps = []

    try {
      console.log('Send stream request to:', API_ENDPOINTS.CHAT_STREAM)
      console.log('Request message:', userMessage)
      
      // 取消之前的请求（如果有）
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
      abortControllerRef.current = new AbortController()
      
      const response = await fetch(API_ENDPOINTS.CHAT_STREAM, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          message: userMessage, 
          user_role: userRole,
          session_id: currentSessionId,  // 传递会话ID，确保同一对话的消息关联在一起
          language: currentLanguage  // 传递当前语言设置
        }),
        signal: abortControllerRef.current.signal  // 添加取消信号
      })

      console.log('Received response, status code:', response.status)
      console.log('Response headers:', {
        'Content-Type': response.headers.get('Content-Type'),
        'Cache-Control': response.headers.get('Cache-Control'),
        'Connection': response.headers.get('Connection'),
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error('Response error, status code:', response.status)
        console.error('Error content:', errorText)
        throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`)
      }
      
      if (!response.body) {
        console.error('Response body is empty')
          throw new Error('响应体为空')
      }
      
        console.log('Start reading SSE stream...')

      // 创建思考过程消息
      setMessages(prev => [...prev, { 
        id: thinkingMessageId,
        type: 'thinking', 
        steps: [],
        progress: 0
      }])

      // 读取SSE流
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      let chunkCount = 0
      while (true) {
        try {
          const { done, value } = await reader.read()
          
          if (done) {
            console.log(`SSE stream ended, total ${chunkCount} data chunks received`)
            setLoading(false)
            break
          }
          
          if (!value) {
            console.warn('Received empty value, continue waiting...')
            continue
          }

          chunkCount++
          if (chunkCount <= 3) {
            console.log(`Received chunk #${chunkCount}, length: ${value.length} bytes`)
          }

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || '' // 保留不完整的行?

          for (const line of lines) {
                  if (line.trim() === '') continue // 跳过空行
                  if (line.startsWith('data: ')) {
                    try {
                      const jsonStr = line.slice(6)
                      console.log('Parse SSE JSON:', jsonStr)
                      const data = JSON.parse(jsonStr)
                      console.log('Received SSE data:', data)
                      // 鐗瑰埆妫€鏌?all_products
                      if (data.data?.all_products) {
                        console.log('[IMPORTANT] Detected all_products:', data.data.all_products)
                      }
                
                // 处理思考步骤?
                if (data.type === 'thinking') {
                  const stepIndex = thinkingSteps.findIndex(s => s.step === data.step)
                  if (stepIndex >= 0) {
                    // 更新现有步骤
                    thinkingSteps[stepIndex] = {
                      step: data.step,
                      message: data.message,
                      progress: data.progress || 0,
                      status: data.status || 'processing'
                    }
                  } else {
                    // 添加新步骤?
                    thinkingSteps.push({
                      step: data.step,
                      message: data.message,
                      progress: data.progress || 0,
                      status: data.status || 'processing'
                    })
                  }
                  
                  setMessages(prev => prev.map(msg => {
                    if (msg.id === thinkingMessageId) {
                      return { ...msg, steps: [...thinkingSteps], progress: data.progress || 0 }
                    }
                    return msg
                  }))
                }
                // 内容开?
                else if (data.type === 'content_start') {
                  isContentStarted = true
                  contentMessageId = Date.now()
                  setMessages(prev => [...prev, { 
                    id: contentMessageId,
                    type: 'system', 
                    content: '',
                    isStreaming: true
                  }])
                }
                // 内容?
                else if (data.type === 'content') {
                  // 如果content_start事件还没收到，先创建消息
                  if (!isContentStarted || !contentMessageId) {
                    isContentStarted = true
                    contentMessageId = Date.now()
                    setMessages(prev => [...prev, { 
                      id: contentMessageId,
                      type: 'system', 
                      content: '',
                      isStreaming: true
                    }])
                  }
                  currentContent += data.chunk
                  setMessages(prev => prev.map(msg => {
                    if (msg.id === contentMessageId) {
                      return { ...msg, content: currentContent }
                    }
                    return msg
                  }))
                }
              // 鏀舵纭
              else if (data.type === 'payment_confirm') {
                console.log('Received payment_confirm event:', data)
                setLoading(false)
                // 移除思考过程消息
                setMessages(prev => prev.filter(msg => msg.id !== thinkingMessageId))
                // 创建收款确认卡片消息
                const confirmData = data.data
                setMessages(prev => [...prev, { 
                  id: Date.now(),
                  type: 'payment_confirm', 
                  paymentData: confirmData,
                  content: confirmData.message
                }])
              }
              // 收料确认卡片
              else if (data.type === 'receipt_confirm') {
                setLoading(false)
                setMessages(prev => prev.filter(msg => msg.id !== thinkingMessageId))
                // 创建收料确认卡片消息
                const confirmData = data.data
                setMessages(prev => [...prev, { 
                  id: Date.now(),
                  type: 'receipt_confirm', 
                  receiptData: confirmData,
                  content: confirmData.message
                }])
              }
              // 提料确认卡片
              else if (data.type === 'withdrawal_confirm') {
                setLoading(false)
                setMessages(prev => prev.filter(msg => msg.id !== thinkingMessageId))
                // 创建提料确认卡片消息
                const confirmData = data.data
                setMessages(prev => [...prev, { 
                  id: Date.now(),
                  type: 'withdrawal_confirm', 
                  withdrawalData: confirmData,
                  content: confirmData.message
                }])
              }
              // 瀹屾垚
              else if (data.type === 'complete') {
                console.log('Received complete event:', data)
                setLoading(false)
                // 移除思考过程消息（如果存在
                setMessages(prev => prev.filter(msg => msg.id !== thinkingMessageId))
                
                // 如果没有内容消息（比如入库操作直接返回结果），创建一个新消息
                if (!contentMessageId || !isContentStarted) {
                    console.log('Create new system message to display result')
                  contentMessageId = Date.now()
                  // 处理入库等操作的响应
                  if (data.data) {
                    // ========== 智能表单弹出：当信息不完整时自动弹出表单 ==========
                    if (data.data.need_form) {
                      console.log('Detected need_form flag, popup corresponding form:', data.data.action)
                      
                      // 根据操作类型弹出对应的表?
                        if (data.data.action === '退货') {
                        setShowQuickReturnModal(true)
                        } else if (data.data.action === '入库') {
                        setShowQuickInboundModal(true)
                        } else if (data.data.action === '创建销售单') {
                        setShowQuickOrderModal(true)
                      }
                      
                      // 添加提示消息
                      setMessages(prev => [...prev, { 
                        type: 'system', 
                        content: data.data.message || '📝 请在弹出的表格中填写完整信息',
                        id: contentMessageId
                      }])
                      return  // 不再继续处理
                    }
                    
                    let messageContent = ''
                    if (data.data.message) {
                      messageContent = data.data.message
                    } else if (data.data.success !== undefined) {
                      messageContent = data.data.success 
                        ? '操作成功完成' 
                        : (data.data.error || '操作失败')
                    }
                    
                    console.log('Create message, content:', messageContent)
                    
                    // 检查是否是入库操作，如果是则创建待确认的卡片数据?
                    let inboundCard = null
                    let inboundCards = null  // 澶氬晢鍝佸叆搴撴椂浣跨敤
                    // 打印完整?data.data 对象
                    console.log('[Inbound Debug] Complete data.data:', JSON.stringify(data.data, null, 2))
                    console.log('[Inbound Debug] all_products exists:', 'all_products' in (data.data || {}))
                    console.log('[Inbound Debug] all_products value:', data.data?.all_products)
                    console.log('[Inbound Debug] all_products length:', data.data?.all_products?.length)
                    
                    if (data.data?.success && data.data?.pending && data.data?.card_data) {
                      // 鏂规B锛氬垱寤哄緟纭鐨勫崱鐗囷紙status: 'pending'：
                      try {
                        // 缁熶竴浣跨敤 all_products（如果没有则使用 card_data 浣滀负鍗曞厓绱犳暟缁勶級
                        console.log('[Debug] data.data.all_products original:', data.data.all_products)
                        console.log('[Debug] data.data.card_data original:', data.data.card_data)
                        
                        const allProducts = data.data.all_products && data.data.all_products.length > 0 
                          ? data.data.all_products 
                          : [data.data.card_data]
                        console.log('收到待确认商品数据，共', allProducts.length, '个商品', allProducts)
                        
                        // 统一创建卡片数组（无论单商品还是多商品）
                        inboundCards = allProducts.map((cardData, index) => {
                          console.log(`[Debug] Create card ${index+1}:`, cardData)
                          const card = createNewCard({
                            productName: cardData.product_name,
                            goldWeight: cardData.weight,
                            laborCostPerGram: cardData.labor_cost,
                            pieceCount: cardData.piece_count,
                            pieceLaborCost: cardData.piece_labor_cost,
                            totalCost: cardData.total_cost,
                            supplier: {
                              id: 0,
                              name: cardData.supplier || '未知供应商',
                            },
                            status: 'pending',
                            source: 'api',
                            createdAt: new Date(),
                          })
                          card.barcode = ''
                          return card
                        })
                        console.log('Create inbound cards, total:', inboundCards.length, inboundCards)
                        
                        // 如果只有一个商品，同时设置 inboundCard（向后兼容）
                        if (inboundCards.length === 1) {
                          inboundCard = inboundCards[0]
                          inboundCards = null  // 单商品时清空数组，使用单卡片显示
                        }
                      } catch (error) {
                        console.error('Create inbound cards failed:', error)
                      }
                    } else if (data.data?.success && data.data?.order && data.data?.detail && !data.data?.pending) {
                      // 如果已经有订单和明细，且没有pending标志，说明是已确认的（向后兼容或直接入库的情况）
                      console.log('Detected confirmed inbound data (backward compatible)')
                      const orderNo = data.data.order.order_no || ''
                      if (orderNo.startsWith('RK')) {
                        try {
                          inboundCard = createCardFromBackend(
                            data.data.detail,
                            null
                          )
                          inboundCard.orderNo = orderNo
                          inboundCard.orderId = data.data.order.id
                          if (!inboundCard.barcode) {
                            inboundCard.barcode = orderNo
                          }
                          inboundCard.status = 'confirmed'
                          console.log('Create confirmed inbound card (backward compatible):', inboundCard)
                        } catch (error) {
                          console.error('Create inbound card failed:', error)
                        }
                      }
                    } else {
                      console.log('No match for inbound card condition, data:', data.data)
                    }
                    
                    setMessages(prev => [...prev, {
                      id: contentMessageId,
                      type: 'system',
                      content: messageContent,
                      isStreaming: false,
                      // 添加其他数据（如订单信息等）
                      order: data.data.order,
                      detail: data.data.detail,
                      inventory: data.data.inventory,
                      chartData: data.data.chart_data,
                      pieData: data.data.pie_data,
                      chartType: data.data.action,
                      rawData: data.data.raw_data,  // 原始数据（用于详细数据展示）
                      // AI意图识别结果（用于可视化显示）
                      detectedIntent: data.data.action,
                      // 添加入库卡片数据（单商品或多商品
                      inboundCard: inboundCard,
                      inboundCards: inboundCards,  // 澶氬晢鍝佸叆搴撴椂鐨勫崱鐗囨暟缁?
                    }])
                  } else {
                    console.warn('complete event has no data field')
                  }
                } else {
                  console.log('Update existing content message')
                  // 如果有内容消息，更新?
                  setMessages(prev => prev.map(msg => {
                    if (msg.id === contentMessageId) {
                      const updatedMsg = { 
                        ...msg, 
                        isStreaming: false
                      }
                      // 只有在有图表数据时才添加
                      if (data.data?.chart_data) {
                        updatedMsg.chartData = data.data.chart_data
                        updatedMsg.chartType = data.data.action
                      }
                      if (data.data?.pie_data) {
                        updatedMsg.pieData = data.data.pie_data
                      }
                      // 添加其他数据
                      if (data.data?.order) updatedMsg.order = data.data.order
                      if (data.data?.detail) updatedMsg.detail = data.data.detail
                      if (data.data?.inventory) updatedMsg.inventory = data.data.inventory
                      if (data.data?.raw_data) updatedMsg.rawData = data.data.raw_data
                      
                      // 如果是入库操作，创建卡片数据
                      if (data.data?.success && data.data?.order && data.data?.detail) {
                        const orderNo = data.data.order.order_no || ''
                        if (orderNo.startsWith('RK')) {
                          try {
                            const inboundCard = createCardFromBackend(data.data.detail, null)
                            inboundCard.orderNo = orderNo
                            inboundCard.orderId = data.data.order.id
                            if (!inboundCard.barcode) {
                              inboundCard.barcode = orderNo // 浣跨敤璁㈠崟鍙蜂綔涓烘潯鐮?
                            }
                            inboundCard.status = 'confirmed'
                            updatedMsg.inboundCard = inboundCard
                          } catch (error) {
                            console.error('Create inbound card failed:', error)
                          }
                        }
                      }
                      
                      return updatedMsg
                    }
                    return msg
                  }))
                }
              }
                // 閿欒
                else if (data.type === 'error') {
                  setLoading(false)
                  setMessages(prev => prev.map(msg => {
                    if (msg.id === thinkingMessageId || msg.id === contentMessageId) {
                      return { ...msg, type: 'system', content: `❌ ${data.message}`, isStreaming: false }
                    }
                    return msg
                  }))
                }
              } catch (e) {
                console.error('Parse SSE data failed:', e)
              }
            }
          }
        } catch (readError) {
          console.error('Read SSE stream failed:', readError)
          setLoading(false)
          setMessages(prev => prev.filter(msg => msg.id !== thinkingMessageId))
          setMessages(prev => [...prev, { 
            type: 'system', 
            content: `❌ 读取流式响应失败：{readError.message}` 
          }])
          break
        }
      }
    } catch (error) {
      // 如果是请求被取消（用户切换页面或发送新消息），静默处理
      if (error.name === 'AbortError') {
          console.log('SSE request cancelled')
        setLoading(false)
        setMessages(prev => prev.filter(msg => msg.id !== thinkingMessageId))
        return
      }
      
      setLoading(false)
      // 移除思考过程消息
      setMessages(prev => prev.filter(msg => msg.id !== thinkingMessageId))
      
      let errorMessage = `❌ 网络错误{error.message}`
      
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        errorMessage = '❌ 无法连接到服务器，请检查后端服务是否运行（http://localhost:8000）'
      }
      
      setMessages(prev => [...prev, { 
        type: 'system', 
        content: errorMessage 
      }])
    }
  }

  // 处理完成响应的辅助函?
  const handleCompleteResponse = (data, messageId) => {
    if (!data.success) {
      setMessages(prev => prev.map(msg => {
        if (msg.id === messageId) {
          return { ...msg, content: `❌ ${data.message || '处理失败'}` }
        }
        return msg
      }))
      return
    }

    // 处理各种响应类型（保持向后兼容）
    let systemMessage = data.message || ''
    
    // 如果有原始数据，可以用于图表?
    if (data.raw_data) {
      // 可以根据需要处理raw_data
    }

    // 更新消息内容（如果需要添加额外信息）
    setMessages(prev => prev.map(msg => {
      if (msg.id === messageId) {
        return { ...msg, content: systemMessage }
      }
      return msg
    }))
  }

  // 保留旧的sendMessage作为备用（如果需要回退）
  const sendMessageOld = async () => {
    if (!input.trim() || loading) return

    const userMessage = input.trim()
    setInput('')
    setMessages(prev => [...prev, { type: 'user', content: userMessage }])
    setLoading(true)

    try {
      const response = await fetch(API_ENDPOINTS.CHAT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: userMessage, user_role: userRole }),
      })

      const data = await response.json()
      setLoading(false)

      if (data.success) {
        let systemMessage = data.message
        
        // 如果有思考过程，先显示思考过?
        if (data.thinking_steps && data.thinking_steps.length > 0) {
          systemMessage = "💡 处理过程：\n" + data.thinking_steps.join('\n') + "\n\n" + systemMessage
        }

        // 如果是图表数据（查询所有库存）
        if (data.chart_data) {
          systemMessage += `\n\n📊 库存统计：\n` +
            `商品种类：{data.summary.total_products}绉峔n` +
            `供应商数量：${data.summary.total_suppliers}瀹禱n` +
            `鎬诲簱瀛橈細${data.summary.total_weight.toFixed(2)}鍏媆n`
          
          setMessages(prev => [...prev, { 
            type: 'system', 
            content: systemMessage,
            chartData: data.chart_data,
            pieData: data.pie_data,
            tableData: data.table_data
          }])
        }
        // 如果是批量入库成功?
        else if (data.order && data.details && data.details.length > 0) {
          systemMessage += `\n\n📋 入库单信息：\n` +
            `入库单号：{data.order.order_no}\n` +
            `鍟嗗搧鏁伴噺：{data.details.length}涓猏n\n`
          
          // 显示每个商品的详细信息?
          data.details.forEach((detail, index) => {
            systemMessage += `鍟嗗搧${index + 1}锛歕n` +
              `  商品名称：{detail.product_name}\n` +
              `  閲嶉噺：{detail.weight}鍏媆n` +
              `  宸ヨ垂：{detail.labor_cost}克鍏媆n` +
              `  供应商：${detail.supplier}\n` +
              `  璇ュ晢鍝佸伐璐癸細${detail.total_cost.toFixed(2)}鍏僜n\n`
          })
          
          systemMessage += `💰 鍚堣宸ヨ垂：{data.total_labor_cost.toFixed(2)}鍏僜n\n`
          
          // 显示库存更新
          if (data.inventories && data.inventories.length > 0) {
            systemMessage += `📦 库存更新：\n`
            data.inventories.forEach(inv => {
              systemMessage += `  ${inv.product_name}：{inv.total_weight}鍏媆n`
            })
          }
          
          setMessages(prev => [...prev, { 
            type: 'system', 
            content: systemMessage 
          }])
        }
        // 向后兼容：单个商品入库（旧格式）
        else if (data.order && data.detail && data.inventory) {
          systemMessage += `\n\n📋 入库单信息：\n` +
            `入库单号：{data.order.order_no}\n` +
            `商品名称：{data.detail.product_name}\n` +
            `重量：${data.detail.weight}克\n` +
            `工费：${data.detail.labor_cost}元/克\n` +
            `供应商：${data.detail.supplier}\n` +
            `总成本：${data.detail.total_cost.toFixed(2)}元\n\n` +
            `📦 当前库存：${data.inventory.total_weight}克`

          setMessages(prev => [...prev, { 
            type: 'system', 
            content: systemMessage 
          }])
        }
        // 如果是查询单个库存（保留向后兼容）
        else if (data.inventory && !data.order) {
          systemMessage += `\n\n📦 库存信息：\n` +
            `商品名称：${data.inventory.product_name}\n` +
            `总重量：${data.inventory.total_weight}克\n`
          
          // 显示所有工费明?
          if (data.inventory.labor_cost_details && data.inventory.labor_cost_details.length > 0) {
          systemMessage += `\n💵 工费明细：\n`
            data.inventory.labor_cost_details.forEach((detail, idx) => {
            systemMessage += `  记录${idx + 1}：工费${detail.labor_cost.toFixed(2)}元/克，重量${detail.weight}克，总工费${detail.total_cost.toFixed(2)}元（入库单：${detail.order_no}）\n`
            })
          }
          
          systemMessage += (data.inventory.last_update ? 
            `\n最后更新：${new Date(data.inventory.last_update).toLocaleString('zh-CN')}` : 
            '')

          setMessages(prev => [...prev, { 
            type: 'system', 
            content: systemMessage,
            laborCostDetails: data.inventory.labor_cost_details  // 用于表格展示
          }])
          return
        }
        // 如果是查询所有库存（返回inventories鏁扮粍： 保留向后兼容
        else if (data.inventories && Array.isArray(data.inventories) && data.inventories.length > 0 && !data.action) {
          systemMessage += `\n\n📦 商品列表：\n`
          data.inventories.forEach((inv, idx) => {
            systemMessage += `${idx + 1}. ${inv.product_name}：${inv.total_weight}克`
            if (inv.latest_labor_cost) {
              systemMessage += `，最新工费：${inv.latest_labor_cost}元/克`
            }
            if (inv.avg_labor_cost) {
              systemMessage += `，平均工费：${inv.avg_labor_cost}元/克`
            }
            systemMessage += `\n`
          })
          
          if (data.total_weight) {
            systemMessage += `\n💵 总库存：${data.total_weight.toFixed(2)}克`
          }
          
          setMessages(prev => [...prev, { 
            type: 'system', 
            content: systemMessage 
          }])
          return
        }
        // 如果是查询入库单详情（保留向后兼容）
        else if (data.order && data.details && !data.order.order_no.startsWith('XS')) {
          systemMessage += `\n\n📋 入库单详情：\n` +
            `入库单号：${data.order.order_no}\n` +
            `入库时间：${new Date(data.order.create_time).toLocaleString('zh-CN')}\n` +
            `状态：${data.order.status}\n\n` +
            `商品明细：\n`
          data.details.forEach((detail, idx) => {
            systemMessage += `${idx + 1}. ${detail.product_category || detail.product_name}：${detail.weight}克，工费${detail.labor_cost}元/克，总工费${detail.total_cost.toFixed(2)}元\n`
          })
          
          setMessages(prev => [...prev, { 
            type: 'system', 
            content: systemMessage 
          }])
          return
        }
        // 如果是查询最近的入库单列表（保留向后兼容）
        else if (data.orders && Array.isArray(data.orders) && data.orders.length > 0 && !data.orders[0].order_no.startsWith('XS')) {
          systemMessage += `\n\n📋 最近的入库单：\n`
          data.orders.forEach((order, idx) => {
            systemMessage += `${idx + 1}. ${order.order_no} - ${new Date(order.create_time).toLocaleString('zh-CN')} (${order.status})\n`
          })
          
          setMessages(prev => [...prev, { 
            type: 'system', 
            content: systemMessage 
          }])
          return
        }
        // 处理۵ɹ
        else if (data.order && data.order.order_no && data.order.order_no.startsWith('XS')) {
          // 这是销售单（销售单号以XS开头）
          systemMessage += `\n\n📋 销售单信息：\n` +
            `销售单号：${data.order.order_no}\n` +
            `客户：${data.order.customer_name}\n` +
            `业务员：${data.order.salesperson}\n` +
            `门店代码：${data.order.store_code || '未填写'}\n` +
            `日期：${new Date(data.order.order_date).toLocaleString('zh-CN')}\n` +
            `状态：${data.order.status}\n\n` +
            `商品明细：\n`
          
          if (data.order.details && data.order.details.length > 0) {
            data.order.details.forEach((detail, idx) => {
              systemMessage += `${idx + 1}. ${detail.product_name}：${detail.weight}克，工费${detail.labor_cost}元/克，总工费${detail.total_labor_cost.toFixed(2)}元\n`
            })
          }
          
          systemMessage += `\n💵 合计：\n` +
            `总克重：${data.order.total_weight}克\n` +
            `总工费：${data.order.total_labor_cost.toFixed(2)}元`
          
          setMessages(prev => [...prev, { 
            type: 'system', 
            content: systemMessage,
            salesOrder: data.order  // 保存完整数据用于后续展示
          }])
        }
        // 处理销售单列表查询
        else if (data.orders && Array.isArray(data.orders) && data.orders.length > 0 && data.orders[0].order_no && data.orders[0].order_no.startsWith('XS')) {
          systemMessage += `\n\n📋 销售单列表：\n`
          data.orders.forEach((order, idx) => {
            systemMessage += `${idx + 1}. ${order.order_no} - ${order.customer_name} - ${new Date(order.order_date).toLocaleString('zh-CN')} - ${order.status}\n`
          })
          
          setMessages(prev => [...prev, { 
            type: 'system', 
            content: systemMessage,
            salesOrders: data.orders
          }])
        }
        // 处理客户创建/查询
        else if (data.customer) {
          systemMessage += `\n\n👤 客户信息：\n` +
            `客户编号：${data.customer.customer_no}\n` +
            `客户名称：${data.customer.name}\n` +
            `电话：${data.customer.phone || '未填写'}\n` +
            `类型：${data.customer.customer_type}\n` +
            `累计购买：${data.customer.total_purchase_amount.toFixed(2)}元\n` +
            `购买次数：${data.customer.total_purchase_count}次`
          
          setMessages(prev => [...prev, { 
            type: 'system', 
            content: systemMessage 
          }])
        }
        // 处理客户列表查询
        else if (data.customers && Array.isArray(data.customers)) {
          systemMessage += `\n\n👤 客户列表：\n` +
            `共 ${data.customers.length} 位客户\n\n`
          
          data.customers.forEach((customer, idx) => {
            systemMessage += `${idx + 1}. ${customer.name} (${customer.customer_no}) - ${customer.phone || '无电话'} - 累计购买${customer.total_purchase_amount.toFixed(2)}元\n`
          })
          
          setMessages(prev => [...prev, { 
            type: 'system', 
            content: systemMessage 
          }])
        }
        // 处理库存检查错误?
        else if (data.inventory_errors && Array.isArray(data.inventory_errors)) {
          systemMessage += `\n\n❌ 库存检查失败：\n`
          data.inventory_errors.forEach((error, idx) => {
            systemMessage += `${idx + 1}. ${error.product_name}：{error.error}\n` +
              `   需要：${error.required_weight}鍏媆n` +
              `   鍙敤：{error.available_weight}鍏媆n`
            if (error.reserved_weight !== undefined) {
              systemMessage += `   宸查鐣欙細${error.reserved_weight}鍏媆n`
            }
            systemMessage += `\n`
          })
          
          setMessages(prev => [...prev, { 
            type: 'system', 
            content: systemMessage,
            inventoryErrors: data.inventory_errors
          }])
        }
        else {
          setMessages(prev => [...prev, { 
            type: 'system', 
            content: systemMessage 
          }])
        }
      } else {
        let errorMessage = data.message
        
        // 如果有思考过程，先显示思考过?
        if (data.thinking_steps && data.thinking_steps.length > 0) {
          errorMessage = "💡 处理过程：\n" + data.thinking_steps.join('\n') + "\n\n" + errorMessage
        }
        
        // 处理库存检查错误（在错误响应中
        if (data.inventory_errors && Array.isArray(data.inventory_errors)) {
          errorMessage += `\n\n❌ 库存检查失败：\n`
          data.inventory_errors.forEach((error, idx) => {
            errorMessage += `${idx + 1}. ${error.product_name}：{error.error}\n` +
              `   需要：${error.required_weight}鍏媆n` +
              `   鍙敤：{error.available_weight}鍏媆n`
            if (error.reserved_weight !== undefined) {
              errorMessage += `   宸查鐣欙細${error.reserved_weight}鍏媆n`
            }
            if (error.total_weight !== undefined) {
              errorMessage += `   鎬诲簱瀛橈細${error.total_weight}鍏媆n`
            }
            errorMessage += `\n`
          })
          
          setMessages(prev => [...prev, { 
            type: 'system', 
            content: errorMessage,
            inventoryErrors: data.inventory_errors
          }])
          setLoading(false)
          return
        }
        
        // 如果有缺失字段列表，格式化显示?
        if (data.missing_fields && data.missing_fields.length > 0) {
          errorMessage += `\n\n❌ 缺失的必填项：\n`
          data.missing_fields.forEach(field => {
            errorMessage += `  • ${field}\n`
          })
          errorMessage += `\n请补充完整信息后重新提交。`
        }
        
        // 如果是多供应商错误，添加规则说明
        if (data.suppliers && Array.isArray(data.suppliers) && data.suppliers.length > 1) {
            errorMessage += `\n\n📋 系统规则提醒：\n`
            errorMessage += `每张入库单只能对应一个供应商。如果一次入库包含多个供应商的商品，请按供应商拆分为多张入库单分别提交。\n`
            errorMessage += `例如：先提交"供应商A的商品1、商品2"，再提交"供应商B的商品3、商品4"。`
        }
        
        setMessages(prev => [...prev, { 
          type: 'system', 
          content: errorMessage 
        }])
      }
    } catch (error) {
      setLoading(false)
      let errorMessage = `❌ 网络错误{error.message}`
      
      // 提供更详细的错误信息
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        errorMessage = '❌ 无法连接到服务器，请检查后端服务是否运行（http://localhost:8000）'
      } else if (error.name === 'AbortError') {
        errorMessage = '❌ 请求超时，请稍后重试'
      }
      
      setMessages(prev => [...prev, { 
        type: 'system', 
        content: errorMessage 
      }])
    }
  }

  // 处理图片上传（接收 File 对象，由 InputArea 组件传入）
  const handleImageUpload = async (file) => {
    if (!file) return

    // 楠岃瘉鏂囦欢绫诲瀷
    if (!file.type.startsWith('image/')) {
      setMessages(prev => [...prev, {
        type: 'system',
        content: '❌ 璇蜂笂浼犲浘鐗囨枃浠讹紙jpg銆乸ng绛夋牸寮忥級'
      }])
      return
    }

    // 验证文件大小（限制10MB）
    if (file.size > 10 * 1024 * 1024) {
      setMessages(prev => [...prev, {
        type: 'system',
        content: '❌ 图片文件过大，请上传小于10MB的图片'
      }])
      return
    }

    setUploading(true)
    
    // 保存图片预览（使用Promise确保图片加载完成功
    const imageDataUrlPromise = new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        const imageDataUrl = e.target.result
        setUploadedImage(imageDataUrl)
        
        // 显示用户上传的图片?
        setMessages(prev => [...prev, {
          type: 'user',
          content: `馃摲 上传入库单图片：${file.name}`,
          image: imageDataUrl
        }])
        
        resolve(imageDataUrl)
      }
      reader.readAsDataURL(file)
    })

    try {
      const formData = new FormData()
      formData.append('file', file)

      // 调用识别接口（只识别，不入库
      const response = await fetch(API_ENDPOINTS.RECOGNIZE_INBOUND_SHEET, {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()
      setUploading(false)

      // 等待图片加载完成
      const imageDataUrl = await imageDataUrlPromise

      if (data.success) {
        // OCR完成后打开对话?
        handleOCRComplete(data.recognized_text, imageDataUrl)
        
        let systemMessage = "✅ 图片识别完成！\n\n"
        
        // 显示思考过程
        if (data.thinking_steps && data.thinking_steps.length > 0) {
          systemMessage += "💡 处理过程：\n" + data.thinking_steps.join('\n') + "\n\n"
        }

        systemMessage += "📝 识别出的文字内容已显示在编辑对话框中，请仔细审核并编辑。"

        setMessages(prev => [...prev, {
          type: 'system',
          content: systemMessage
        }])
      } else {
        let errorMessage = data.message
        
        // 显示思考过程
        if (data.thinking_steps && data.thinking_steps.length > 0) {
          errorMessage = "💡 处理过程：\n" + data.thinking_steps.join('\n') + "\n\n" + errorMessage
        }
        
        // 如果识别失败但有部分文字，也打开对话框
        if (data.recognized_text && data.recognized_text.trim().length > 0) {
          const imageDataUrl = await imageDataUrlPromise
          handleOCRComplete(data.recognized_text, imageDataUrl)
          errorMessage += `\n\n📝 已识别出部分文字（已显示在编辑对话框中），您可以手动修正后确认入库。`
        }

        setMessages(prev => [...prev, {
          type: 'system',
          content: errorMessage
        }])
      }
    } catch (error) {
      setUploading(false)
      let errorMessage = `❌ 上传失败：${error.message}`
      
      // 提供更详细的错误信息
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        errorMessage = '❌ 无法连接到服务器，请检查后端服务是否运行（http://localhost:8000）'
      } else if (error.name === 'AbortError') {
        errorMessage = '❌ 上传超时，请检查网络连接或稍后重试'
      }
      
      setMessages(prev => [...prev, {
        type: 'system',
        content: errorMessage
      }])
    }

  }

  // OCR完成后打开对话?
  const handleOCRComplete = (text, imageUrl) => {
    setOcrResult(text || '')
    setUploadedImage(imageUrl)
    setShowOCRModal(true)
  }

  // 确认入库
  const handleConfirmInbound = async () => {
    const textToSend = ocrResult.trim()
    if (!textToSend) {
        alert('请输入内容')
      return
    }

    // 关闭对话?
    setShowOCRModal(false)
    setUploadedImage(null)
    const textToProcess = ocrResult
    setOcrResult('')

    // 显示用户消息
    setMessages(prev => [...prev, { 
      type: 'user', 
      content: textToProcess 
    }])
    setLoading(true)

    try {
      const response = await fetch(API_ENDPOINTS.CHAT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: textToProcess, user_role: userRole }),
      })

      const data = await response.json()
      setLoading(false)

      if (data.success) {
        let systemMessage = data.message
        
        // 如果有思考过程，先显示思考过?
        if (data.thinking_steps && data.thinking_steps.length > 0) {
          systemMessage = "💡 处理过程：\n" + data.thinking_steps.join('\n') + "\n\n" + systemMessage
        }

        // 如果是图表数据（查询所有库存）
        if (data.chart_data) {
          systemMessage += `\n\n📊 库存统计：\n` +
            `商品种类：{data.summary.total_products}绉峔n` +
            `供应商数量：${data.summary.total_suppliers}瀹禱n` +
            `鎬诲簱瀛橈細${data.summary.total_weight.toFixed(2)}鍏媆n`
          
          setMessages(prev => [...prev, { 
            type: 'system', 
            content: systemMessage,
            chartData: data.chart_data,
            pieData: data.pie_data,
            tableData: data.table_data
          }])
        }
        // 如果是批量入库成功?
        else if (data.order && data.details && data.details.length > 0 && data.order.order_no && data.order.order_no.startsWith('RK')) {
          systemMessage += `\n\n📋 入库单信息：\n` +
            `入库单号：{data.order.order_no}\n` +
            `鍟嗗搧鏁伴噺：{data.details.length}涓猏n\n`
          
          data.details.forEach((detail, index) => {
            systemMessage += `鍟嗗搧${index + 1}锛歕n` +
              `  商品名称：{detail.product_category || detail.product_name}\n` +
              `  閲嶉噺：{detail.weight}鍏媆n` +
              `  工费：${detail.labor_cost}元/克\n` +
              `  供应商：${detail.supplier}\n` +
              `  该商品工费：${detail.total_cost.toFixed(2)}元\n\n`
          })
          
          systemMessage += `💵 合计工费：${data.total_labor_cost.toFixed(2)}元\n\n`
          
          if (data.inventories && data.inventories.length > 0) {
            systemMessage += `📦 库存更新：\n`
            data.inventories.forEach(inv => {
              systemMessage += `  ${inv.product_name}：${inv.total_weight}克\n`
            })
          }

          setMessages(prev => [...prev, {
            type: 'system',
            content: systemMessage
          }])
        }
        // 处理۵ɹ（OCR确认后也可能创建销售单
        else if (data.order && data.order.order_no && data.order.order_no.startsWith('XS')) {
          systemMessage += `\n\n📋 销售单信息：\n` +
            `销售单号：${data.order.order_no}\n` +
            `客户：${data.order.customer_name}\n` +
            `业务员：${data.order.salesperson}\n` +
            `门店代码：${data.order.store_code || '未填写'}\n` +
            `日期：${new Date(data.order.order_date).toLocaleString('zh-CN')}\n` +
            `状态：${data.order.status}\n\n` +
            `商品明细：\n`
          
          if (data.order.details && data.order.details.length > 0) {
            data.order.details.forEach((detail, idx) => {
              systemMessage += `${idx + 1}. ${detail.product_name}：${detail.weight}克，工费${detail.labor_cost}元/克，总工费${detail.total_labor_cost.toFixed(2)}元\n`
            })
          }
          
          systemMessage += `\n💵 合计：\n` +
            `总克重：${data.order.total_weight}克\n` +
            `总工费：${data.order.total_labor_cost.toFixed(2)}元`
          
          setMessages(prev => [...prev, { 
            type: 'system', 
            content: systemMessage,
            salesOrder: data.order
          }])
        }
        // 如果是查询所有库存（返回inventories鏁扮粍：
        else if (data.inventories && Array.isArray(data.inventories) && data.inventories.length > 0) {
          systemMessage += `\n\n📦 商品列表：\n`
          data.inventories.forEach((inv, idx) => {
            systemMessage += `${idx + 1}. ${inv.product_name}：${inv.total_weight}克`
            if (inv.latest_labor_cost) {
              systemMessage += `，最新工费：${inv.latest_labor_cost}元/克`
            }
            if (inv.avg_labor_cost) {
              systemMessage += `，平均工费：${inv.avg_labor_cost.toFixed(2)}元/克`
            }
            systemMessage += `\n`
          })
          
          if (data.total_weight) {
            systemMessage += `\n💵 总库存：${data.total_weight.toFixed(2)}克`
          }
          
          setMessages(prev => [...prev, { 
            type: 'system', 
            content: systemMessage 
          }])
        }
        // 处理库存检查错误?
        else if (data.inventory_errors && Array.isArray(data.inventory_errors)) {
          systemMessage += `\n\n❌ 库存检查失败：\n`
          data.inventory_errors.forEach((error, idx) => {
            systemMessage += `${idx + 1}. ${error.product_name}：{error.error}\n` +
              `   需要：${error.required_weight}鍏媆n` +
              `   鍙敤：{error.available_weight}鍏媆n`
            if (error.reserved_weight !== undefined) {
              systemMessage += `   宸查鐣欙細${error.reserved_weight}鍏媆n`
            }
            systemMessage += `\n`
          })
          
          setMessages(prev => [...prev, { 
            type: 'system', 
            content: systemMessage,
            inventoryErrors: data.inventory_errors
          }])
        }
        // 处理库存检查错误（重复代码，保留以防万一）
        else if (data.inventory_errors && Array.isArray(data.inventory_errors)) {
          systemMessage += `\n\n❌ 库存检查失败：\n`
          data.inventory_errors.forEach((error, idx) => {
            systemMessage += `${idx + 1}. ${error.product_name}：{error.error}\n` +
              `   需要：${error.required_weight}鍏媆n` +
              `   鍙敤：{error.available_weight}鍏媆n`
            if (error.reserved_weight !== undefined) {
              systemMessage += `   宸查鐣欙細${error.reserved_weight}鍏媆n`
            }
            systemMessage += `\n`
          })
          
          setMessages(prev => [...prev, { 
            type: 'system', 
            content: systemMessage,
            inventoryErrors: data.inventory_errors
          }])
        }
        // 鍏朵粬鎴愬姛鍝嶅簲
        else {
          setMessages(prev => [...prev, {
            type: 'system',
            content: systemMessage
          }])
        }
      } else {
        let errorMessage = data.message
        
        if (data.thinking_steps && data.thinking_steps.length > 0) {
          errorMessage = "💡 处理过程：\n" + data.thinking_steps.join('\n') + "\n\n" + errorMessage
        }

        // 处理库存检查错误（在错误响应中
        if (data.inventory_errors && Array.isArray(data.inventory_errors)) {
          errorMessage += `\n\n❌ 库存检查失败：\n`
          data.inventory_errors.forEach((error, idx) => {
            errorMessage += `${idx + 1}. ${error.product_name}：{error.error}\n` +
              `   需要：${error.required_weight}鍏媆n` +
              `   鍙敤：{error.available_weight}鍏媆n`
            if (error.reserved_weight !== undefined) {
              errorMessage += `   宸查鐣欙細${error.reserved_weight}鍏媆n`
            }
            if (error.total_weight !== undefined) {
              errorMessage += `   鎬诲簱瀛橈細${error.total_weight}鍏媆n`
            }
            errorMessage += `\n`
          })
          
          setMessages(prev => [...prev, { 
            type: 'system', 
            content: errorMessage,
            inventoryErrors: data.inventory_errors
          }])
          setLoading(false)
          return
        }

        // 如果是多供应商错误，添加规则说明
        if (data.suppliers && Array.isArray(data.suppliers) && data.suppliers.length > 1) {
          errorMessage += `\n\n📋 绯荤粺瑙勫垯鎻愰啋锛歕n`
          errorMessage += `每张入库单只能对应一个供应商。如果一次入库包含多个供应商的商品，请按供应商拆分为多张入库单分别提交。\n`
        }

        setMessages(prev => [...prev, {
          type: 'system',
          content: errorMessage
        }])
      }
    } catch (error) {
      setLoading(false)
      setMessages(prev => [...prev, {
        type: 'system',
        content: `❌ 网络错误{error.message}`
      }])
    }
  }

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // 璇█閫夋嫨椤?
  if (showLanguageSelector) {
    return <LanguageSelector onSelect={() => setShowLanguageSelector(false)} />
  }

  return (
    <div className="flex h-screen bg-jewelry-gold-50 overflow-hidden">
      {/* 侧边栏 - 历史对话记录 */}
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        conversationHistory={conversationHistory}
        currentConversationId={currentConversationId}
        userRole={userRole}
        onNewConversation={newConversation}
        onLoadConversation={loadConversation}
        onDeleteConversation={deleteConversation}
      />

      {/* 涓诲唴瀹瑰尯鍩?*/}
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header
          currentPage={currentPage}
          setCurrentPage={setCurrentPage}
          userRole={userRole}
          roleDropdownOpen={roleDropdownOpen}
          setRoleDropdownOpen={setRoleDropdownOpen}
          roleLoading={roleLoading}
          roleDropdownRef={roleDropdownRef}
          getCurrentRole={getCurrentRole}
          changeUserRole={changeUserRole}
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
          pendingTransferCount={pendingTransferCount}
          pendingSalesCount={pendingSalesCount}
          setShowQuickOrderModal={setShowQuickOrderModal}
          setShowSalesSearchModal={setShowSalesSearchModal}
          setShowHistoryPanel={setShowHistoryPanel}
          currentLanguage={currentLanguage}
          i18n={i18n}
        />

        {/* 主内容区域 - 根据 currentPage 切换 */}
        {currentPage === 'chat' && (
          <>
            {/* 对话区域 - 苹果风格 */}
            <div className="flex-1 overflow-y-auto px-6 py-8">
          <div className="max-w-4xl mx-auto space-y-6">
        {messages.length === 0 && (
              <WelcomeScreen
                userRole={userRole}
                setInput={setInput}
                setShowQuickOrderModal={setShowQuickOrderModal}
                setShowQuickInboundModal={setShowQuickInboundModal}
                setShowQuickReturnModal={setShowQuickReturnModal}
                setCurrentPage={setCurrentPage}
              />
            )}
            {messages.map((msg, idx) => {
              // 思考过程消息
              if (msg.type === 'thinking' && Array.isArray(msg.steps)) {
                return <ThinkingMessage key={msg.id || idx} steps={msg.steps} />
              }
              
              // 收款确认卡片
              if (msg.type === 'payment_confirm' && msg.paymentData) {
                const pd = msg.paymentData
                return (
                  <div key={msg.id || idx} className="flex justify-start">
                    <div className="bg-white rounded-2xl shadow-lg border border-orange-200 max-w-md overflow-hidden">
                      {/* 鏍囬鏍?*/}
                      <div className="bg-gradient-to-r from-orange-500 to-amber-500 px-5 py-3">
                        <div className="flex items-center gap-2 text-white">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span className="font-semibold">纭鐧昏鏀舵</span>
                        </div>
                      </div>
                      
                      {/* 内容?*/}
                      <div className="p-5 space-y-4">
                        {/* 客户信息 */}
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center">
                            <span className="text-orange-600 font-bold text-lg">{pd.customer?.name?.charAt(0) || '客'}</span>
                          </div>
                          <div>
                            <div className="font-semibold text-gray-900">{pd.customer?.name}</div>
                            <div className="text-sm text-gray-500">{pd.customer?.customer_no}</div>
                          </div>
                        </div>
                        
                        {/* 金额信息 */}
                        <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-600">当前欠款</span>
                            <span className="font-medium text-gray-900">¥{pd.current_debt?.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-600">鏈鏀舵</span>
                            <span className="font-bold text-orange-600 text-lg">¥{pd.payment_amount?.toFixed(2)}</span>
                          </div>
                          <div className="border-t border-gray-200 pt-2 flex justify-between text-sm">
                            <span className="text-gray-600">收款后欠款</span>
                            <span className={`font-medium ${(pd.balance_after || 0) >= 0 ? 'text-orange-600' : 'text-green-600'}`}>
                              {(pd.balance_after || 0) >= 0 
                                ? `¥${pd.balance_after?.toFixed(2)}` 
                                : `-¥${Math.abs(pd.balance_after || 0).toFixed(2)} (预收款)`
                              }
                            </span>
                          </div>
                        </div>
                        
                        {/* 鏀舵鏂瑰紡 */}
                        <div className="flex items-center gap-2 text-sm text-gray-600">
                          <span>收款方式：</span>
                          <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded">{pd.payment_method}</span>
                        </div>
                        
                        {/* 操作按钮 */}
                        <div className="flex gap-3 pt-2">
                          <button
                            onClick={async () => {
                              try {
                                const { confirmPayment } = await import('./services/financeService')
                                const result = await confirmPayment(
                                  pd.customer.id,
                                  pd.payment_amount,
                                  pd.payment_method,
                                  pd.remark || ''
                                )
                                if (result.success) {
                                  // 更新消息为成功状态
                                  const balanceText = (pd.balance_after || 0) >= 0 
                                    ? `¥${pd.balance_after.toFixed(2)}` 
                                    : `-¥${Math.abs(pd.balance_after || 0).toFixed(2)} (预收款`
                                  setMessages(prev => prev.map(m => 
                                    m.id === msg.id 
                                      ? { ...m, type: 'system', content: `✅ 鏀舵鐧昏鎴愬姛锛乗n\n客户：{pd.customer.name}\n鏀舵閲戦锛毬?{pd.payment_amount.toFixed(2)}\n鏀舵鏂瑰紡：{pd.payment_method}\n鏀舵鍚庢瑺娆撅細${balanceText}` }
                                      : m
                                  ))
                                } else {
                                  alert('收款登记失败：' + (result.error || '未知错误'))
                                }
                              } catch (error) {
                                console.error('Receipt registration failed:', error)
                                alert('收款登记失败：' + error.message)
                              }
                            }}
                            className="flex-1 bg-orange-500 hover:bg-orange-600 text-white font-medium py-2.5 px-4 rounded-xl transition-colors"
                          >
                            纭鐧昏
                          </button>
                          <button
                            onClick={() => {
                              // 取消确认，移除此消息
                              setMessages(prev => prev.filter(m => m.id !== msg.id))
                            }}
                            className="px-4 py-2.5 border border-gray-300 text-gray-600 rounded-xl hover:bg-gray-50 transition-colors"
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              }

              // 收料确认卡片
              if (msg.type === 'receipt_confirm' && msg.receiptData) {
                const rd = msg.receiptData
                return (
                  <div key={msg.id || idx} className="flex justify-start">
                    <div className="bg-white rounded-2xl shadow-lg border border-yellow-200 max-w-md overflow-hidden">
                      {/* 鏍囬鏍?*/}
                      <div className="bg-gradient-to-r from-yellow-500 to-amber-500 px-5 py-3">
                        <div className="flex items-center gap-2 text-white">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                          </svg>
                          <span className="font-semibold">纭寮€鍏锋敹鏂欏崟</span>
                        </div>
                      </div>
                      
                      {/* 内容?*/}
                      <div className="p-5 space-y-4">
                        {/* 客户信息 */}
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-yellow-100 rounded-full flex items-center justify-center">
                              <span className="text-yellow-600 font-bold text-lg">{rd.customer?.name?.charAt(0) || '客'}</span>
                          </div>
                          <div>
                            <div className="font-semibold text-gray-900">{rd.customer?.name}</div>
                            <div className="text-sm text-gray-500">{rd.customer?.phone || rd.customer?.customer_no}</div>
                          </div>
                        </div>
                        
                        {/* 金料信息 */}
                        <div className="bg-yellow-50 rounded-xl p-4 space-y-3">
                          <div className="flex justify-between items-center">
                            <span className="text-gray-600">收料克重</span>
                            <span className="font-bold text-yellow-700 text-2xl">{rd.gold_weight?.toFixed(2)} 克</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-600">成色</span>
                            <span className="font-medium text-gray-900 px-2 py-0.5 bg-yellow-100 rounded">{rd.gold_fineness}</span>
                          </div>
                          {rd.remark && (
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-600">备注</span>
                              <span className="text-gray-700">{rd.remark}</span>
                            </div>
                          )}
                        </div>
                        
                        {/* 操作按钮 */}
                        <div className="flex gap-3 pt-2">
                          <button
                            onClick={async () => {
                              try {
                                const params = new URLSearchParams({
                                  customer_id: rd.customer.id.toString(),
                                  gold_weight: rd.gold_weight.toString(),
                                  gold_fineness: rd.gold_fineness,
                                  remark: rd.remark || '聊天收料',
                                  created_by: '结算专员'
                                })
                                const response = await fetch(`${API_BASE_URL}/api/gold-material/gold-receipts?${params}`, {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' }
                                })
                                if (response.ok) {
                                  const result = await response.json()
                                  // 更新消息为成功状态
                                  setMessages(prev => prev.map(m => 
                                    m.id === msg.id 
                                      ? { ...m, type: 'system', content: `✅ 收料单创建成功！\n\n单号：{result.data.receipt_no}\n客户：{rd.customer.name}\n克重：{rd.gold_weight.toFixed(2)}克
成色：{rd.gold_fineness}` }
                                      : m
                                  ))
                                  // 打开打印页面
                                  if (result.data.id) {
                                    window.open(`${API_BASE_URL}/api/gold-material/gold-receipts/${result.data.id}/print`, '_blank')
                                  }
                                } else {
                                  const error = await response.json()
                                  alert('收料单创建失败：' + (error.detail || '鏈煡閿欒'))
                                }
                              } catch (error) {
                                console.error('Receipt order creation failed:', error)
                                alert('收料单创建失败：' + error.message)
                              }
                            }}
                            className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-white font-medium py-2.5 px-4 rounded-xl transition-colors"
                          >
                            纭骞舵墦鍗?
                          </button>
                          <button
                            onClick={() => {
                              // 取消确认，移除此消息
                              setMessages(prev => prev.filter(m => m.id !== msg.id))
                            }}
                            className="px-4 py-2.5 border border-gray-300 text-gray-600 rounded-xl hover:bg-gray-50 transition-colors"
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              }

              // 提料确认卡片
              if (msg.type === 'withdrawal_confirm' && msg.withdrawalData) {
                const wd = msg.withdrawalData
                return (
                  <div key={msg.id || idx} className="flex justify-start">
                    <div className="bg-white rounded-2xl shadow-lg border border-blue-200 max-w-md overflow-hidden">
                      {/* 鏍囬鏍?*/}
                      <div className="bg-gradient-to-r from-blue-500 to-indigo-500 px-5 py-3">
                        <div className="flex items-center gap-2 text-white">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11l5-5m0 0l5 5m-5-5v12" />
                          </svg>
                            <span className="font-semibold">确认创建收料单</span>
                        </div>
                      </div>
                      
                      {/* 内容?*/}
                      <div className="p-5 space-y-4">
                        {/* 客户信息 */}
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                              <span className="text-blue-600 font-bold text-lg">{wd.customer?.name?.charAt(0) || '客'}</span>
                          </div>
                          <div>
                            <div className="font-semibold text-gray-900">{wd.customer?.name}</div>
                            <div className="text-sm text-gray-500">{wd.customer?.phone || wd.customer?.customer_no}</div>
                          </div>
                        </div>
                        
                        {/* 提料信息 */}
                        <div className="bg-blue-50 rounded-xl p-4 space-y-3">
                          <div className="flex justify-between items-center">
                            <span className="text-gray-600">提料克重</span>
                            <span className="font-bold text-blue-700 text-2xl">{wd.gold_weight?.toFixed(2)} 克</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-600">当前存料</span>
                            <span className="font-medium text-gray-900">{wd.current_balance?.toFixed(2)} 克</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-600">提料后余额</span>
                            <span className="font-medium text-green-600">{wd.balance_after?.toFixed(2)} 克</span>
                          </div>
                          {wd.remark && (
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-600">备注</span>
                              <span className="text-gray-700">{wd.remark}</span>
                            </div>
                          )}
                        </div>
                        
                        {/* 操作按钮 */}
                        <div className="flex gap-3 pt-2">
                          <button
                            onClick={async () => {
                              try {
                                const params = new URLSearchParams({
                                  user_role: 'settlement',
                                  created_by: '结算专员'
                                })
                                const response = await fetch(`${API_BASE_URL}/api/gold-material/withdrawals?${params}`, {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    customer_id: wd.customer.id,
                                    gold_weight: wd.gold_weight,
                                    withdrawal_type: 'self',
                                    remark: wd.remark || '聊天提料'
                                  })
                                })
                                if (response.ok) {
                                  const result = await response.json()
                                  // 更新消息为成功状态
                                  setMessages(prev => prev.map(m => 
                                    m.id === msg.id 
                                      ? { ...m, type: 'system', content: `✅ 提料单创建成功！\n\n单号：${result.withdrawal_no}\n客户：${wd.customer.name}\n克重：${wd.gold_weight.toFixed(2)}克\n（待料部确认发出）` }
                                      : m
                                  ))
                                  // 打开打印页面
                                  if (result.id) {
                                    window.open(`${API_BASE_URL}/api/gold-material/withdrawals/${result.id}/download?format=html`, '_blank')
                                  }
                                } else {
                                  const error = await response.json()
                                  alert('提料单创建失败：' + (error.detail || '未知错误'))
                                }
                              } catch (error) {
                              console.error('提料单创建失败', error)
                              alert('提料单创建失败：' + error.message)
                              }
                            }}
                            className="flex-1 bg-blue-500 hover:bg-blue-600 text-white font-medium py-2.5 px-4 rounded-xl transition-colors"
                          >
                            纭骞舵墦鍗?
                          </button>
                          <button
                            onClick={() => {
                              // 取消确认，移除此消息
                              setMessages(prev => prev.filter(m => m.id !== msg.id))
                            }}
                            className="px-4 py-2.5 border border-gray-300 text-gray-600 rounded-xl hover:bg-gray-50 transition-colors"
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              }

              // 提料单记录卡片（已完成的提料单）
              if (msg.type === 'withdrawal_record' && msg.withdrawalData) {
                const wd = msg.withdrawalData
                return (
                  <div key={msg.id || idx} className="flex justify-start">
                    <div className="bg-white rounded-2xl shadow-lg border border-green-200 max-w-md overflow-hidden">
                      {/* 鏍囬鏍?*/}
                      <div className="bg-gradient-to-r from-green-500 to-emerald-500 px-5 py-3">
                        <div className="flex items-center gap-2 text-white">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          <span className="font-semibold">提料单已生成</span>
                        </div>
                      </div>
                      
                      {/* 内容?*/}
                      <div className="p-5 space-y-4">
                        {/* 单号信息 */}
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-gray-500">鍗曞彿</span>
                          <span className="font-mono font-semibold text-green-700">{wd.withdrawal_no}</span>
                        </div>
                        
                        {/* 客户信息 */}
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                              <span className="text-green-600 font-bold text-lg">{wd.customer_name?.charAt(0) || '客'}</span>
                          </div>
                          <div>
                            <div className="font-semibold text-gray-900">{wd.customer_name}</div>
                            <div className="text-xs text-gray-500">{wd.created_at}</div>
                          </div>
                        </div>
                        
                        {/* 提料信息 */}
                        <div className="bg-green-50 rounded-xl p-4 space-y-2">
                          <div className="flex justify-between items-center">
                            <span className="text-gray-600">提料克重</span>
                            <span className="font-bold text-green-700 text-2xl">{wd.gold_weight?.toFixed(2)} 克</span>
                          </div>
                          {wd.remark && (
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-600">备注</span>
                              <span className="text-gray-700">{wd.remark}</span>
                            </div>
                          )}
                        </div>
                        
                        {/* 操作按钮 */}
                        <div className="flex gap-3 pt-2">
                          <button
                            onClick={() => window.open(wd.download_url, '_blank')}
                            className="flex-1 bg-green-500 hover:bg-green-600 text-white font-medium py-2.5 px-4 rounded-xl transition-colors flex items-center justify-center gap-2"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                            </svg>
                            打印/下载
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              }
              
              // 用户消息
              if (msg.type === 'user') {
                return (
                  <div key={msg.id || idx} className="flex justify-end">
                    <div className="bg-gradient-to-r from-jewelry-navy to-jewelry-navy-light text-white rounded-3xl px-5 py-4 shadow-md max-w-2xl">
                      <div className="text-[15px] leading-relaxed whitespace-pre-wrap">{msg.content}</div>
                    </div>
                  </div>
                )
              }
              
              // 系统消息（流式内容或普通内容）- 甯I澶村儚
              if (msg.type === 'system') {
                return (
                  <React.Fragment key={msg.id || idx}>
                    <div className="flex justify-start items-start gap-3">
                      {/* AI澶村儚 - 鎷涜储鐚?*/}
                      <img src="/ai-avatar.png" alt="AI" className="flex-shrink-0 w-8 h-8 rounded-full object-cover shadow-md ring-2 ring-jewelry-gold/30" />
                      <div className={`
                        ${msg.id ? 'max-w-2xl' : 'max-w-[85%] md:max-w-[75%]'}
                        rounded-3xl px-5 py-4 shadow-sm border border-jewelry-gold/20 bg-gradient-to-br from-amber-50/80 to-yellow-50/80
                      `}>
                        {/* 意图识别可视化标签?- 珠宝风格 */}
                        {msg.detectedIntent && (
                          <div className="flex items-center gap-1.5 mb-2 pb-2 border-b border-gray-100">
                            <span className="text-xs text-gray-400">🎯 璇嗗埆鍒帮細</span>
                            <span className="px-2 py-0.5 text-xs font-medium bg-gradient-to-r from-amber-100 to-yellow-100 text-amber-700 rounded-full">
                              {msg.detectedIntent}
                            </span>
                          </div>
                        )}
                        <div className="text-[15px] leading-relaxed whitespace-pre-wrap text-gray-800">
                          {/* 隐藏内容中的特殊标记 */}
                          {msg.content?.replace(/\n*<!-- (RETURN_ORDER|INBOUND_ORDER|SALES_ORDER|SETTLEMENT_ORDER|CUSTOMER_DEBT|EXPORT_INBOUND|WITHDRAWAL_ORDER|GOLD_RECEIPT):[^>]+ -->/g, '')}
                          {/* 流式生成时的闪烁光标 */}
                          {msg.isStreaming && (
                            <span className="inline-block w-0.5 h-4 bg-blue-500 ml-1 animate-pulse"></span>
                          )}
                        </div>
                {/* 如果有图片，显示预览 */}
                {msg.image && (
                          <div className="mt-3">
                    <img 
                      src={msg.image} 
                      alt="上传的入库单" 
                              className="max-w-full h-auto rounded-2xl border border-gray-200/60"
                      style={{ maxHeight: '300px' }}
                    />
                  </div>
                )}
                        {/* 提料单操作按钮 - 支持从对象或从内容解析 */}
                        {(() => {
                          // 尝试从消息对象获取，或从内容中解析隐藏标签?
                          let withdrawalId = msg.withdrawalId
                          let downloadUrl = msg.withdrawalDownloadUrl
                          if (!withdrawalId && msg.content) {
                            const match = msg.content.match(/<!-- WITHDRAWAL_ORDER:(\d+):/)
                            if (match) {
                              withdrawalId = parseInt(match[1])
                              downloadUrl = `${API_BASE_URL}/api/gold-material/withdrawals/${withdrawalId}/download?format=html`
                            }
                          }
                          if (!withdrawalId) return null
                          return (
                            <div className="mt-4 pt-3 border-t border-gray-100 flex gap-2">
                              <button
                                onClick={() => window.open(downloadUrl, '_blank')}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-50 text-green-600 rounded-lg hover:bg-green-100 transition-colors"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                                </svg>
                                打印提料单
                              </button>
                            </div>
                          )
                        })()}
                        {/* 收料单操作按钮 - 支持从对象或从内容解析 */}
                        {(() => {
                          // 尝试从消息对象获取，或从内容中解析隐藏标签?
                          let receiptId = msg.goldReceiptId
                          let downloadUrl = msg.goldReceiptDownloadUrl
                          if (!receiptId && msg.content) {
                            const match = msg.content.match(/<!-- GOLD_RECEIPT:(\d+):/)
                            if (match) {
                              receiptId = parseInt(match[1])
                              downloadUrl = `${API_BASE_URL}/api/gold-material/gold-receipts/${receiptId}/print`
                            }
                          }
                          if (!receiptId) return null
                          return (
                            <div className="mt-4 pt-3 border-t border-gray-100 flex gap-2">
                              <button
                                onClick={() => window.open(downloadUrl, '_blank')}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-yellow-50 text-yellow-600 rounded-lg hover:bg-yellow-100 transition-colors"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                                </svg>
                                打印收料单
                              </button>
                            </div>
                          )
                        })()}
                        {/* 退货单操作按钮 - 支持从对象或从内容解析 */}
                        {(() => {
                          // 尝试从消息对象获取，或从内容中解析隐藏标签?
                          let returnId = msg.returnOrder?.id
                          if (!returnId && msg.content) {
                            const match = msg.content.match(/<!-- RETURN_ORDER:(\d+):/)
                            if (match) returnId = parseInt(match[1])
                          }
                          if (!returnId) return null
                          return (
                            <div className="mt-4 pt-3 border-t border-gray-100 flex gap-2">
                              <button
                                onClick={() => window.open(`${API_BASE_URL}/api/returns/${returnId}/download?format=html`, '_blank')}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                                </svg>
                                打印退货单
                              </button>
                              <button
                                onClick={() => window.open(`${API_BASE_URL}/api/returns/${returnId}/download?format=pdf`, '_blank')}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-50 text-green-600 rounded-lg hover:bg-green-100 transition-colors"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                </svg>
                                下载
                              </button>
                            </div>
                          )
                        })()}
                        {/* 入库单操作按钮 - 支持从对象或从内容解析 */}
                        {(() => {
                          // 尝试从消息对象获取，或从内容中解析隐藏标签?
                          let inboundId = msg.inboundOrder?.id
                          if (!inboundId && msg.content) {
                            const match = msg.content.match(/<!-- INBOUND_ORDER:(\d+):/)
                            if (match) inboundId = parseInt(match[1])
                          }
                          if (!inboundId) return null
                          return (
                            <div className="mt-4 pt-3 border-t border-gray-100 flex gap-2">
                              <button
                                onClick={() => window.open(`${API_BASE_URL}/api/inbound-orders/${inboundId}/download?format=html`, '_blank')}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                                </svg>
                                打印入库单
                              </button>
                              <button
                                onClick={() => window.open(`${API_BASE_URL}/api/inbound-orders/${inboundId}/download?format=pdf`, '_blank')}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-50 text-green-600 rounded-lg hover:bg-green-100 transition-colors"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                </svg>
                                下载
                              </button>
                            </div>
                          )
                        })()}
                        {/* 销售单操作按钮 - 支持从对象或从内容解析 */}
                        {(() => {
                          // 尝试从消息对象获取，或从内容中解析隐藏标签?
                          let salesId = msg.salesOrderId
                          if (!salesId && msg.content) {
                            const match = msg.content.match(/<!-- SALES_ORDER:(\d+):/)
                            if (match) salesId = parseInt(match[1])
                          }
                          if (!salesId) return null
                          return (
                            <div className="mt-4 pt-3 border-t border-gray-100 flex gap-2">
                              <button
                                onClick={() => window.open(`${API_BASE_URL}/api/sales/orders/${salesId}/download?format=html`, '_blank')}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                                </svg>
                                打印销售单
                              </button>
                              <button
                                onClick={() => window.open(`${API_BASE_URL}/api/sales/orders/${salesId}/download?format=pdf`, '_blank')}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-50 text-green-600 rounded-lg hover:bg-green-100 transition-colors"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                </svg>
                                下载
                              </button>
                            </div>
                          )
                        })()}
                        {/* 结算单操作按钮 - 支持从对象或从内容解析 */}
                        {(() => {
                          // 尝试从消息对象获取，或从内容中解析隐藏标签?
                          let settlementId = msg.settlementOrderId
                          if (!settlementId && msg.content) {
                            const match = msg.content.match(/<!-- SETTLEMENT_ORDER:(\d+):/)
                            if (match) settlementId = parseInt(match[1])
                          }
                          if (!settlementId) return null
                          return (
                            <div className="mt-4 pt-3 border-t border-gray-100 flex gap-2">
                              <button
                                onClick={() => window.open(`${API_BASE_URL}/api/settlement/orders/${settlementId}/download?format=html`, '_blank')}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-cyan-50 text-cyan-600 rounded-lg hover:bg-cyan-100 transition-colors"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                                </svg>
                                打印结算单
                              </button>
                              <button
                                onClick={() => window.open(`${API_BASE_URL}/api/settlement/orders/${settlementId}/download?format=pdf`, '_blank')}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-50 text-green-600 rounded-lg hover:bg-green-100 transition-colors"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                </svg>
                                下载
                              </button>
                              {/* ½按钮 - 仅结算专员和管理层可?*/}
                              {(userRole === 'settlement' || userRole === 'manager') && (
                                <button
                                  onClick={async () => {
                                    if (!confirm('确定要撤销此结算单吗？撤销后可以重新选择支付方式进行结算。')) return
                                    try {
                                      const response = await fetch(`${API_BASE_URL}/api/settlement/orders/${settlementId}/revert?user_role=${userRole}`, {
                                        method: 'POST'
                                      })
                                      if (response.ok) {
                                        const result = await response.json()
                                        alert(result.message || '结算单已撤销')
                                        // 跳转到结算管理页?
                                        setCurrentPage('settlement')
                                      } else {
                                        const error = await response.json()
                                        alert('撤销失败：' + (error.detail || '未知错误'))
                                      }
                                    } catch (error) {
                                        console.error('撤销结算单失败', error)
                                        alert('撤销失败：' + error.message)
                                    }
                                  }}
                                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-orange-50 text-orange-600 rounded-lg hover:bg-orange-100 transition-colors"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                  </svg>
                                  重新结算
                                </button>
                              )}
                            </div>
                          )
                        })()}
                        {/* 客户账务下载按钮 - 从内容中解析隐藏标记 */}
                        {(() => {
                          if (!msg.content) return null
                          const match = msg.content.match(/<!-- CUSTOMER_DEBT:(\d+):(.+?) -->/)
                          if (!match) return null
                          const customerId = parseInt(match[1])
                          const customerName = match[2].trim()
                          return (
                            <div className="mt-4 pt-3 border-t border-gray-100 flex gap-2">
                              <button
                                onClick={() => window.open(`${API_BASE_URL}/api/export/customer-transactions/${customerId}`, '_blank')}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-orange-50 text-orange-600 rounded-lg hover:bg-orange-100 transition-colors"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                                下载账务明细 (Excel)
                              </button>
                            </div>
                          )
                        })()}
                        {/* 入库单查询导出按钮?- 从内容中解析隐藏标记 */}
                        {(() => {
                          if (!msg.content) return null
                          const match = msg.content.match(/<!-- EXPORT_INBOUND:([^:]*):([^:]*):([^:]*):([^>]*) -->/)
                          if (!match) return null
                          const dateStart = match[1] || ''
                          const dateEnd = match[2] || ''
                          const supplier = match[3] || ''
                          const product = match[4] || ''
                          // 构建查询参数
                          const params = new URLSearchParams()
                          if (dateStart) params.append('date_start', dateStart)
                          if (dateEnd) params.append('date_end', dateEnd)
                          if (supplier) params.append('supplier', supplier)
                          if (product) params.append('product', product)
                          const queryString = params.toString()
                          return (
                            <div className="mt-4 pt-3 border-t border-gray-100 flex gap-2">
                              <button
                                onClick={() => window.open(`${API_BASE_URL}/api/export/inbound-query${queryString ? '?' + queryString : ''}`, '_blank')}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100 transition-colors"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                                下载入库明细 (Excel)
                              </button>
                            </div>
                          )
                        })()}
              </div>
            </div>
            {/* 工费明细表格（单个商品查询） */}
            {Array.isArray(msg.laborCostDetails) && msg.laborCostDetails.length > 0 && (
                      <div className="flex justify-start mt-2">
                        <div className="max-w-4xl w-full bg-white rounded-2xl shadow-sm border border-gray-200/60 p-6">
                  <h3 className="text-lg font-semibold mb-2">工费明细表</h3>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">序号</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">工费（元/克）</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">重量（克）</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">总工费（元）</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">入库单号</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">入库时间</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {msg.laborCostDetails.map((detail, index) => (
                          <tr key={index}>
                            <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">{index + 1}</td>
                            <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900 font-semibold">{detail.labor_cost.toFixed(2)}</td>
                            <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900 font-medium">{detail.weight.toFixed(2)}</td>
                            <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900 font-semibold">{detail.total_cost.toFixed(2)}</td>
                            <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-500">{detail.order_no}</td>
                            <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-500">{new Date(detail.create_time).toLocaleString('zh-CN')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
                    {/* 入库核对卡片展示 */}
                    {msg.inboundCard && (
                      <div className="flex justify-start mt-2">
                        <div className="max-w-2xl w-full">
                          <JewelryInboundCardComponent
                            data={msg.inboundCard}
                            actions={{
                              onConfirm: async (card) => {
                                // 鏂规B：调用真实的入库API
                                console.log('Confirm inbound:', card)
                                try {
                                  // 更新卡片状态为处理中
                                  setMessages(prev => prev.map(m => {
                                    if (m.id === msg.id) {
                                      return { ...m, inboundCard: updateCard(card, { status: 'processing' }) }
                                    }
                                    return m
                                  }))
                                  
                                  // 调用入库API
                                  const { confirmInbound } = await import('./services/inboundService')
                                  // 涓嶄娇鐢∕ock妯″紡锛岀‘淇濊幏鍙栫湡瀹炵殑orderId
                                  const useMock = false
                                  const result = await confirmInbound(card, useMock)
                                  
                                  console.log('Confirm inbound result:', result)
                                  console.log('Order ID:', result.order?.id)
                                  console.log('Order No:', result.order?.order_no)
                                  
                                  // 更新卡片状态和订单信息
                                  setMessages(prev => prev.map(m => {
                                    if (m.id === msg.id) {
                                      const updatedCard = updateCard(card, { 
                                        status: 'confirmed',
                                        orderNo: result.order?.order_no || card.orderNo,
                                        orderId: result.order?.id || card.orderId,
                                        barcode: result.order?.order_no || card.barcode || '',
                                      })
                                      console.log('Updated card:', updatedCard)
                                      console.log('Updated orderId:', updatedCard.orderId)
                                      return { ...m, inboundCard: updatedCard }
                                    }
                                    return m
                                  }))
                                } catch (error) {
                                  console.error('Confirm inbound failed:', error)
                                  // 更新状态为错误
                                  setMessages(prev => prev.map(m => {
                                    if (m.id === msg.id) {
                                      return { 
                                        ...m, 
                                        inboundCard: updateCard(card, { 
                                          status: 'error', 
                                          errorMessage: error instanceof Error ? error.message : '入库失败'
                                        }) 
                                      }
                                    }
                                    return m
                                  }))
                                }
                              },
                              onReportError: async (card, errorReason) => {
                                // 报告数据错误
                                console.log('Report inbound data error:', card, errorReason)
                                try {
                                  const useMock = import.meta.env.DEV && import.meta.env.VITE_USE_MOCK !== 'false'
                                  await reportError(card, errorReason, useMock)
                                  setMessages(prev => prev.map(m => {
                                    if (m.id === msg.id) {
                                      return { ...m, inboundCard: updateCard(card, { status: 'error', errorMessage: errorReason || '数据报错已提交' }) }
                                    }
                                    return m
                                  }))
                                } catch (error) {
                                  console.error('报错提交失败:', error)
                                }
                              },
                            }}
                          />
                        </div>
                      </div>
                    )}
                    {/* 多商品入库卡片展示?*/}
                    {Array.isArray(msg.inboundCards) && msg.inboundCards.length > 0 && (
                      <div className="flex justify-start mt-2">
                        <div className="max-w-4xl w-full space-y-4">
                          <div className="text-sm text-gray-600 mb-2 font-medium">
                            克{msg.inboundCards.length} 个商品待入库
                          </div>
                          {msg.inboundCards.map((card, cardIndex) => (
                            <div key={card.id || cardIndex} className="border-l-4 border-amber-400 pl-3">
                              <JewelryInboundCardComponent
                                data={card}
                                actions={{
                                  onConfirm: async (cardToConfirm) => {
                                    console.log('Confirm single product inbound:', cardToConfirm)
                                    try {
                                      // 更新当前卡片状态为处理中
                                      setMessages(prev => prev.map(m => {
                                        if (m.id === msg.id && m.inboundCards) {
                                          const updatedCards = m.inboundCards.map((c, i) => 
                                            i === cardIndex ? updateCard(c, { status: 'processing' }) : c
                                          )
                                          return { ...m, inboundCards: updatedCards }
                                        }
                                        return m
                                      }))
                                      
                                      // 调用入库API
                                      const { confirmInbound } = await import('./services/inboundService')
                                      const result = await confirmInbound(cardToConfirm, false)
                                      
                                      console.log('Confirm inbound result:', result)
                                      
                                      // 更新卡片状态
                                      setMessages(prev => prev.map(m => {
                                        if (m.id === msg.id && m.inboundCards) {
                                          const updatedCards = m.inboundCards.map((c, i) => 
                                            i === cardIndex ? updateCard(c, { 
                                              status: 'confirmed',
                                              orderNo: result.order?.order_no || c.orderNo,
                                              orderId: result.order?.id || c.orderId,
                                              barcode: result.order?.order_no || c.barcode || '',
                                            }) : c
                                          )
                                          return { ...m, inboundCards: updatedCards }
                                        }
                                        return m
                                      }))
                                    } catch (error) {
                                      console.error('Confirm inbound failed:', error)
                                      setMessages(prev => prev.map(m => {
                                        if (m.id === msg.id && m.inboundCards) {
                                          const updatedCards = m.inboundCards.map((c, i) => 
                                            i === cardIndex ? updateCard(c, { 
                                              status: 'error', 
                                              errorMessage: error instanceof Error ? error.message : '入库失败'
                                            }) : c
                                          )
                                          return { ...m, inboundCards: updatedCards }
                                        }
                                        return m
                                      }))
                                    }
                                  },
                                  onReportError: async (cardToReport, errorReason) => {
                                    console.log('Report inbound data error:', cardToReport, errorReason)
                                    try {
                                      await reportError(cardToReport, errorReason, false)
                                      setMessages(prev => prev.map(m => {
                                        if (m.id === msg.id && m.inboundCards) {
                                          const updatedCards = m.inboundCards.map((c, i) => 
                                            i === cardIndex ? updateCard(c, { 
                                              status: 'error', 
                                              errorMessage: errorReason || '数据报错已提交' 
                                            }) : c
                                          )
                                          return { ...m, inboundCards: updatedCards }
                                        }
                                        return m
                                      }))
                                    } catch (error) {
                                      console.error('报错提交失败:', error)
                                    }
                                  },
                                }}
                              />
                            </div>
                          ))}
                          {/* 批量确认按钮 */}
                          {msg.inboundCards.some(c => c.status === 'pending') && (
                            <div className="flex gap-3 mt-4 pt-4 border-t border-gray-200">
                              <button
                                onClick={async () => {
                                  console.log('Batch confirm inbound')
                                  const { confirmInbound } = await import('./services/inboundService')
                                  
                                  for (let i = 0; i < msg.inboundCards.length; i++) {
                                    const card = msg.inboundCards[i]
                                    if (card.status !== 'pending') continue
                                    
                                    try {
                                      // 更新状态为处理?
                                      setMessages(prev => prev.map(m => {
                                        if (m.id === msg.id && m.inboundCards) {
                                          const updatedCards = m.inboundCards.map((c, idx) => 
                                            idx === i ? updateCard(c, { status: 'processing' }) : c
                                          )
                                          return { ...m, inboundCards: updatedCards }
                                        }
                                        return m
                                      }))
                                      
                                      const result = await confirmInbound(card, false)
                                      
                                      // 更新状态为已确认?
                                      setMessages(prev => prev.map(m => {
                                        if (m.id === msg.id && m.inboundCards) {
                                          const updatedCards = m.inboundCards.map((c, idx) => 
                                            idx === i ? updateCard(c, { 
                                              status: 'confirmed',
                                              orderNo: result.order?.order_no || c.orderNo,
                                              orderId: result.order?.id || c.orderId,
                                            }) : c
                                          )
                                          return { ...m, inboundCards: updatedCards }
                                        }
                                        return m
                                      }))
                                    } catch (error) {
                                      console.error('Batch inbound failed:', error)
                                      setMessages(prev => prev.map(m => {
                                        if (m.id === msg.id && m.inboundCards) {
                                          const updatedCards = m.inboundCards.map((c, idx) => 
                                            idx === i ? updateCard(c, { 
                                              status: 'error',
                                              errorMessage: error instanceof Error ? error.message : '入库失败'
                                            }) : c
                                          )
                                          return { ...m, inboundCards: updatedCards }
                                        }
                                        return m
                                      }))
                                    }
                                  }
                                }}
                                className="px-6 py-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-lg font-medium hover:from-amber-600 hover:to-orange-600 transition-all shadow-md"
                              >
                                ✅ 全部确认入库
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    {/* 销售单卡片展示 */}
                    {msg.salesOrder && (
                      <div className="flex justify-start mt-2">
                        <div className="max-w-4xl w-full bg-gradient-to-r from-green-50 to-blue-50 rounded-2xl shadow-lg p-6 border border-green-200/60">
                          <h3 className="text-xl font-bold text-gray-800 mb-4">📋 销售单详情</h3>
                          <div className="grid grid-cols-2 gap-4 mb-4">
                            <div>
                              <span className="text-gray-600">销售单号：</span>
                              <span className="font-semibold">{msg.salesOrder.order_no}</span>
                            </div>
                            <div>
                              <span className="text-gray-600">客户：</span>
                              <span className="font-semibold">{msg.salesOrder.customer_name}</span>
                            </div>
                            <div>
                              <span className="text-gray-600">业务员：</span>
                              <span className="font-semibold">{msg.salesOrder.salesperson}</span>
                            </div>
                            <div>
                              <span className="text-gray-600">门店代码：</span>
                              <span className="font-semibold">{msg.salesOrder.store_code || '未填写'}</span>
                            </div>
                            <div>
                              <span className="text-gray-600">日期：</span>
                              <span className="font-semibold">{new Date(msg.salesOrder.order_date).toLocaleString('zh-CN')}</span>
                            </div>
                            <div>
                              <span className="text-gray-600">状态：</span>
                              <span className={`font-semibold ${
                                msg.salesOrder.status === 'confirmed' || msg.salesOrder.status === '已结算' ? 'text-blue-600' :
                                msg.salesOrder.status === 'draft' || msg.salesOrder.status === '待结算' ? 'text-yellow-600' : 
                                msg.salesOrder.status === 'cancelled' || msg.salesOrder.status === '已取消' ? 'text-gray-500' :
                                'text-gray-600'
                              }`}>
                                {msg.salesOrder.status === 'draft' ? '未确认' :
                                 msg.salesOrder.status === 'confirmed' ? '已确认' :
                                 msg.salesOrder.status === 'cancelled' ? '已取消' :
                                 msg.salesOrder.status}
                              </span>
                            </div>
                          </div>
                          {/* 商品明细表格 */}
                          {Array.isArray(msg.salesOrder?.details) && msg.salesOrder.details.length > 0 && (
                            <div className="mt-4">
                              <h4 className="font-semibold mb-2 text-gray-700">商品明细</h4>
                              <div className="overflow-x-auto">
                                <table className="min-w-full divide-y divide-gray-200 bg-white rounded-lg">
                                  <thead className="bg-gray-100">
                                    <tr>
                                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-700 uppercase">商品名称</th>
                                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-700 uppercase">克重</th>
                                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-700 uppercase">工费</th>
                                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-700 uppercase">总工费</th>
                                    </tr>
                                  </thead>
                                  <tbody className="bg-white divide-y divide-gray-200">
                                    {msg.salesOrder.details.map((detail, idx) => (
                                      <tr key={idx} className="hover:bg-gray-50">
                                        <td className="px-4 py-2 text-sm text-gray-900">{detail.product_name}</td>
                                        <td className="px-4 py-2 text-sm text-gray-900">{detail.weight}克</td>
                                        <td className="px-4 py-2 text-sm text-gray-900">{detail.labor_cost}元/克</td>
                                        <td className="px-4 py-2 text-sm font-semibold text-gray-900">{detail.total_labor_cost.toFixed(2)}元</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                              <div className="mt-4 flex justify-end space-x-6 text-lg font-bold text-gray-800">
                                <span>总克重：<span className="text-blue-600">{msg.salesOrder.total_weight}克</span></span>
                                <span>总工费：<span className="text-green-600">{msg.salesOrder.total_labor_cost.toFixed(2)}元</span></span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    {/* 库存检查错误提示卡片?*/}
                    {Array.isArray(msg.inventoryErrors) && msg.inventoryErrors.length > 0 && (
                      <div className="flex justify-start mt-2">
                        <div className="max-w-4xl w-full bg-red-50 rounded-2xl shadow-sm p-6 border border-red-200/60">
                          <h3 className="text-xl font-bold text-red-800 mb-4">❌ 库存检查失败</h3>
                          <div className="space-y-4">
                            {msg.inventoryErrors.map((error, idx) => (
                              <div key={idx} className="bg-white rounded-lg p-4 border border-red-200">
                                <div className="font-semibold text-red-700 mb-2">
                                  {idx + 1}. {error.product_name}
                                </div>
                                <div className="text-sm text-gray-700 space-y-1">
                                  <div className="flex items-center">
                                    <span className="text-red-600 font-medium">错误：</span>
                                    <span className="ml-2">{error.error}</span>
                                  </div>
                                  <div className="flex items-center">
                                    <span className="text-gray-600">需要：</span>
                                    <span className="ml-2 font-semibold">{error.required_weight}克</span>
                                  </div>
                                  <div className="flex items-center">
                                    <span className="text-gray-600">可用：</span>
                                    <span className="ml-2 font-semibold text-red-600">{error.available_weight}克</span>
                                  </div>
                                  {error.reserved_weight !== undefined && (
                                    <div className="flex items-center">
                                      <span className="text-gray-600">已预留：</span>
                                      <span className="ml-2 font-semibold">{error.reserved_weight}克</span>
                                    </div>
                                  )}
                                  {error.total_weight !== undefined && (
                                    <div className="flex items-center">
                                      <span className="text-gray-600">总库存：</span>
                                      <span className="ml-2 font-semibold">{error.total_weight}克</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
            {/* 鍥捐〃灞曠ず */}
            {msg.chartData && (
                      <div className="flex justify-start mt-2">
                        <div className="max-w-5xl w-full bg-white rounded-2xl shadow-sm border border-gray-200/60 p-6">
                          {/* 鍥捐〃缃戞牸甯冨眬 */}
                          <div className={`grid gap-6 ${msg.pieData ? 'md:grid-cols-2' : 'grid-cols-1'}`}>
                            {/* 鏌辩姸鍥?鎶樼嚎鍥?*/}
                            <div className="bg-gray-50 rounded-xl p-4">
                              {msg.lineData ? (
                                <Line 
                                  data={msg.lineData} 
                                  options={{
                                    responsive: true,
                                    plugins: {
                                      legend: { position: 'top' },
                                      title: {
                                        display: true,
                                        text: msg.chartTitle || '趋势分析（折线图）',
                                        font: { size: 14, weight: 'bold' }
                                      },
                                    },
                                    scales: {
                                      y: { beginAtZero: true },
                                    }
                                  }} 
                                />
                              ) : (
                  <Bar 
                    data={msg.chartData} 
                    options={{
                      responsive: true,
                      plugins: {
                                      legend: { position: 'top' },
                        title: {
                          display: true,
                                        text: (() => {
                                          if (msg.chartType === '供应商分析' || msg.chartType === '生成图表') {
                                            return '供应商占比分析（柱状图）'
                                          } else if (msg.chartType === '查询库存') {
                                            return '📊 库存统计图表'
                                          }
                                          return '数据统计图表'
                                        })(),
                                        font: { size: 14, weight: 'bold' }
                        },
                        tooltip: {
                          callbacks: {
                            label: function(context) {
                              const label = context.dataset.label || '';
                              const value = context.parsed.y;
                              const unit = label.includes('工费') ? ' 元' : ' 克';
                              return `${label}: ${value.toLocaleString()}${unit}`;
                            }
                          }
                        }
                      },
                      scales: {
                        y: {
                          beginAtZero: true,
                                          title: { display: true, text: '重量（克）' }
                        },
                        x: {
                                          title: { display: true, text: '商品名称' }
                        }
                      }
                    }} 
                  />
                              )}
                            </div>
                  
                            {/* 鐜舰鍥撅紙鏇夸唬楗煎浘锛屾洿鐜颁唬：*/}
                  {msg.pieData && (
                              <div className="bg-gray-50 rounded-xl p-4">
                                <Doughnut 
                        data={msg.pieData} 
                        options={{
                          responsive: true,
                          plugins: {
                                      legend: { position: 'right' },
                            title: {
                              display: true,
                                        text: (() => {
                                            if (msg.chartType === '供应商分析' || msg.chartType === '生成图表') {
                                              return '🍪 供应商占比分布'
                                          }
                                            return '🍪 库存占比分布'
                                        })(),
                                        font: { size: 14, weight: 'bold' }
                                      },
                            tooltip: {
                              callbacks: {
                                label: function(context) {
                                  const label = context.label || '';
                                  const value = context.parsed;
                                  const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                  const percentage = ((value / total) * 100).toFixed(1);
                                  return `${label}: ${value.toLocaleString()} 克(${percentage}%)`;
                                }
                              }
                            }
                                    },
                                    cutout: '50%',
                        }} 
                      />
                    </div>
                  )}
                      </div>
                          {/* 查看详细数据折叠面板 */}
                          {msg.rawData && (msg.rawData.suppliers || msg.rawData.inventory) && (
                            <details className="mt-4 border-t border-gray-100 pt-4">
                              <summary className="cursor-pointer text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1">
                                <span>📊 查看详细数据</span>
                              </summary>
                              <div className="mt-3 overflow-x-auto">
                                {/* 供应商数据表?*/}
                                {msg.rawData.suppliers && msg.rawData.suppliers.length > 0 && (
                                  <table className="min-w-full text-sm">
                                    <thead className="bg-gray-50">
                                      <tr>
                                        <th className="px-3 py-2 text-left font-medium text-gray-600">供应商</th>
                                        <th className="px-3 py-2 text-right font-medium text-gray-600">供货重量(克)</th>
                                        <th className="px-3 py-2 text-right font-medium text-gray-600">总工费(元)</th>
                                        <th className="px-3 py-2 text-right font-medium text-gray-600">供货次数</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                      {msg.rawData.suppliers.map((s, i) => (
                                        <tr key={i} className="hover:bg-gray-50">
                                          <td className="px-3 py-2 text-gray-800">{s.name}</td>
                                          <td className="px-3 py-2 text-right text-gray-600">{s.total_weight?.toFixed(2) || '-'}</td>
                                          <td className="px-3 py-2 text-right text-gray-600">{s.total_cost?.toFixed(2) || '-'}</td>
                                          <td className="px-3 py-2 text-right text-gray-600">{s.supply_count || '-'}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                )}
                                {/* 库存数据表格 */}
                                {msg.rawData.inventory && msg.rawData.inventory.length > 0 && (
                                  <table className="min-w-full text-sm">
                                    <thead className="bg-gray-50">
                                      <tr>
                                        <th className="px-3 py-2 text-left font-medium text-gray-600">商品名称</th>
                                        <th className="px-3 py-2 text-right font-medium text-gray-600">库存重量(克)</th>
                                        <th className="px-3 py-2 text-right font-medium text-gray-600">入库次数</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                      {msg.rawData.inventory.map((inv, i) => (
                                        <tr key={i} className="hover:bg-gray-50">
                                          <td className="px-3 py-2 text-gray-800">{inv.product_name}</td>
                                          <td className="px-3 py-2 text-right text-gray-600">{inv.total_weight?.toFixed(2) || '-'}</td>
                                          <td className="px-3 py-2 text-right text-gray-600">{inv.inbound_count || '-'}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                )}
                              </div>
                            </details>
                          )}
                </div>
              </div>
            )}
                  </React.Fragment>
                )
              }
              
              return null
            })}

        {/* AI思考状态动画 */}
        {(loading || uploading) && <ThinkingIndicator uploading={uploading} />}

        <div ref={messagesEndRef} />
          </div>
      </div>

      {/* OCR识别编辑对话?*/}
      <OCRModal
        isOpen={showOCRModal}
        onClose={() => { setShowOCRModal(false); setOcrResult(''); setUploadedImage(null) }}
        ocrResult={ocrResult}
        setOcrResult={setOcrResult}
        uploadedImage={uploadedImage}
        onConfirm={handleConfirmInbound}
        loading={loading}
      />
        <InputArea
          input={input}
          setInput={setInput}
          onSend={sendMessage}
          loading={loading}
          uploading={uploading}
          userRole={userRole}
          onImageUpload={handleImageUpload}
          onQuickInbound={() => setShowQuickInboundModal(true)}
          onQuickOrder={() => setShowQuickOrderModal(true)}
          onQuickReturn={() => setShowQuickReturnModal(true)}
          onQuickReceipt={() => setShowQuickReceiptModal(true)}
          onQuickWithdrawal={() => setShowQuickWithdrawalModal(true)}
        />
          </>
        )}

        {currentPage === 'finance' && (
          <div className="flex-1 overflow-y-auto">
            <FinancePage />
          </div>
        )}

        {currentPage === 'warehouse' && (
          <div className="flex-1 overflow-y-auto">
            <WarehousePage userRole={userRole} />
          </div>
        )}

        {currentPage === 'settlement' && (
          <div className="flex-1 overflow-y-auto">
            <SettlementPage 
              onSettlementConfirmed={(data) => {
              // 结算单确认后，在聊天框显示明细
                const itemsList = (Array.isArray(data?.details) ? data.details : []).map((item, idx) => 
                  `${idx + 1}. ${item.product_name}：${item.weight}克 × ¥${item.labor_cost}/克 = ¥${item.total_labor_cost.toFixed(2)}`
                ).join('\n')
                
                const paymentMethodStr = data.payment_method === 'cash_price' ? '结价' : 
                          data.payment_method === 'mixed' ? '混合支付' : '结料'
                
                const settlementMessage = `✅ **结算单确认成功**

📋 **结算单号**：${data.settlement_no}
👤 **客户**：${data.customer_name}
🧑‍💼 **业务员**：${data.salesperson}
💸 **支付方式**：${paymentMethodStr}

📦 **商品明细**：
${itemsList}

📊 **汇总**：
- 总克重：${data.total_weight.toFixed(2)}克
- 工费合计：¥${data.labor_amount.toFixed(2)}
${data.gold_price ? `- 金价：${data.gold_price.toFixed(2)} 元/克` : ''}
${data.material_amount > 0 ? `- 金料金额：¥${data.material_amount.toFixed(2)}` : ''}
- **应收总计：¥${data.total_amount.toFixed(2)}**

<!-- SETTLEMENT_ORDER:${data.settlement_id}:${data.settlement_no} -->`

                setMessages(prev => [...prev, {
                  type: 'system',
                  content: settlementMessage,
                  settlementOrderId: data.settlement_id,
                  settlementOrderNo: data.settlement_no
                }])
                
                // 保存到聊天历史
                if (currentSessionId) {
                  const params = new URLSearchParams({
                    session_id: currentSessionId,
                    message_type: 'assistant',
                    content: settlementMessage,
                    user_role: userRole
                  })
                  fetch(`${API_BASE_URL}/api/chat-logs/message?${params}`, {
                    method: 'POST'
                  }).catch(err => console.error('Save settlement message failed:', err))
                }
                
                // 切换回聊天页?
                setCurrentPage('chat')
              }}
            />
          </div>
        )}

        {currentPage === 'analytics' && (
          <div className="flex-1 overflow-hidden">
            <AnalyticsPage onBack={() => setCurrentPage('chat')} />
          </div>
        )}

        {currentPage === 'export' && (
          <div className="flex-1 overflow-hidden">
            <ExportPage onBack={() => setCurrentPage('chat')} />
          </div>
        )}

        {currentPage === 'salesperson' && (
          <div className="flex-1 overflow-y-auto">
            <SalespersonPage />
          </div>
        )}

        {currentPage === 'customer' && (
          <div className="flex-1 overflow-y-auto">
            <CustomerPage userRole={userRole} />
          </div>
        )}

        {currentPage === 'supplier' && (
          <div className="flex-1 overflow-y-auto">
            <SupplierPage userRole={userRole} />
          </div>
        )}

        {currentPage === 'returns' && (
          <div className="flex-1 overflow-y-auto">
            <ReturnPage userRole={userRole} />
          </div>
        )}

        {currentPage === 'gold-material' && (
          <div className="flex-1 overflow-y-auto">
            <GoldMaterialPage userRole={userRole} />
          </div>
        )}

        {currentPage === 'loan' && (
          <div className="flex-1 overflow-y-auto">
            <LoanPage />
          </div>
        )}

        {currentPage === 'document-center' && (
          <div className="flex-1 overflow-y-auto">
            <DocumentCenterPage userRole={userRole} />
          </div>
        )}

        {currentPage === 'product-codes' && (
          <div className="flex-1 overflow-y-auto">
            <ProductCodePage userRole={userRole} />
          </div>
        )}

        {currentPage === 'inbound-orders' && (
          <div className="flex-1 overflow-y-auto">
            <InboundOrdersPage userRole={userRole} />
          </div>
        )}

        {currentPage === 'dashboard' && (
          <div className="flex-1 overflow-y-auto">
            {userRole === 'manager' ? (
              <ManagerDashboardPage />
            ) : (
              <DashboardPage />
            )}
          </div>
        )}
      </div>

      {/* 快捷开单弹窗 - 仅柜台可用（结算专员不需要） */}
      {userRole === 'counter' && (
        <QuickOrderModal
          isOpen={showQuickOrderModal}
          onClose={() => setShowQuickOrderModal(false)}
          onSuccess={(result) => {
            // 开单成功后在聊天栏显示销售单明细
            const itemsList = (Array.isArray(result?.items) ? result.items : []).map((item, idx) => 
              `${idx + 1}. ${item.product_name}：${item.weight}克 × ¥${item.labor_cost}/克 = ¥${(item.weight * item.labor_cost).toFixed(2)}`
            ).join('\n')
            
            const salesMessage = `✅ **销售单创建成功**

📋 **销售单号**：${result.order_no}
👤 **客户**：${result.customer_name}
🧑‍💼 **业务员**：${result.salesperson}

📦 **商品明细**：
${itemsList}

📊 **汇总**：
- 总克重：${result.total_weight.toFixed(2)}克
- 总工费：¥${result.total_labor_cost.toFixed(2)}

<!-- SALES_ORDER:${result.order_id}:${result.order_no} -->`

            setMessages(prev => [...prev, {
              type: 'system',
              content: salesMessage,
              salesOrderId: result.order_id,
              salesOrderNo: result.order_no
            }])
            
            // 保存到聊天历史
            if (currentSessionId) {
              const params = new URLSearchParams({
                session_id: currentSessionId,
                message_type: 'assistant',
                content: salesMessage,
                user_role: userRole
              })
              fetch(`${API_BASE_URL}/api/chat-logs/message?${params}`, {
                method: 'POST'
              }).catch(err => console.error('Save sales message failed:', err))
            }
          }}
        />
      )}

      {/* 快捷退货弹窗 - 商品专员和柜台可用 */}
      {(hasPermission(userRole, 'canReturnToSupplier') || hasPermission(userRole, 'canReturnToWarehouse')) && (
        <QuickReturnModal
          isOpen={showQuickReturnModal}
          onClose={() => setShowQuickReturnModal(false)}
          onSuccess={async (result) => {
            // Build return success message content (with hidden ID marker for history print button)
            const returnMessage = `\u2705 **退货单创建成功**\n\n\uD83D\uDCCB 单号：${result.return_no}\n\uD83D\uDCE6 商品数量：${result.item_count}个\n\u2696\uFE0F 总退货克重：${result.total_weight?.toFixed(2) || 0}克\n\uD83D\uDCB5 总工费：\u00A5${result.total_labor_cost?.toFixed(2) || 0}\n\uD83D\uDCDD 退货原因：${result.return_reason}${result.supplier_name ? `\n\uD83C\uDFED 供应商：${result.supplier_name}` : ''}${result.from_location_name ? `\n\uD83D\uDCCD 发起位置：${result.from_location_name}` : ''}\n\n<!-- RETURN_ORDER:${result.return_id}:${result.return_no} -->`
            
            // Add to chat history display (includes return order info for download/print)
            setMessages(prev => [...prev, {
              type: 'system',
              content: returnMessage,
              returnOrder: {
                id: result.return_id,
                return_no: result.return_no
              }
            }])
            
            // Save to backend chat history (with ID marker)
            try {
              await fetch(`${API_BASE_URL}/api/chat-logs/message?session_id=${encodeURIComponent(currentSessionId)}&message_type=assistant&content=${encodeURIComponent(returnMessage)}&user_role=${userRole}&intent=return`, {
                method: 'POST'
              })
            } catch (error) {
              console.error('Save return record to chat history failed:', error)
            }
          }}
          userRole={userRole}
        />
      )}

      {/* 快捷入库弹窗 - 需要入库权限 */}
      {hasPermission(userRole, 'canInbound') && (
        <QuickInboundModal
          isOpen={showQuickInboundModal}
          onClose={() => setShowQuickInboundModal(false)}
          onSuccess={async (result) => {
            // Build inbound message content (with hidden ID marker for history print button)
            const productList = (Array.isArray(result?.products) ? result.products : []).slice(0, 5).map(p => {
              let info = `  - ${p.name}: ${p.weight}g (工费 \u00A5${p.labor_cost}/g)`
              const pieceCount = parseInt(p.piece_count) || 0
              const pieceLaborCost = parseFloat(p.piece_labor_cost) || 0
              if (pieceCount > 0) {
                info += ` [${pieceCount}件 件工费¥${pieceLaborCost}]`
              }
              return info
            }).join('\n')
            const moreProducts = result.products.length > 5 ? `\n  ... 等共 ${result.products.length} 件商品` : ''
            // 只在有多件商品时显示件数，单件只显示克重
            const countInfo = result.total_count > 1 ? `\n📦 入库数量：${result.total_count} 件` : ''
            const inboundMessage = `✅ **入库成功**${result.order_no ? `\n\n📋 单号：${result.order_no}` : ''}\n🏪 供应商：${result.supplier_name || '未指定'}${countInfo}\n⚖️ 总克重：${result.total_weight.toFixed(2)}克\n💵 总工费：¥${result.total_labor_cost.toFixed(2)}\n\n📋 商品明细：\n${productList}${moreProducts}${result.order_id ? `\n\n<!-- INBOUND_ORDER:${result.order_id}:${result.order_no} -->` : ''}`
            
            // 添加到聊天记录显示（包含入库单信息，用于下载/打印）
            setMessages(prev => [...prev, {
              type: 'system',
              content: inboundMessage,
              inboundOrder: result.order_id ? {
                id: result.order_id,
                order_no: result.order_no
              } : null
            }])
            
            // 保存到后端聊天历史（包含ID标记）
            try {
              await fetch(`${API_BASE_URL}/api/chat-logs/message?session_id=${encodeURIComponent(currentSessionId)}&message_type=assistant&content=${encodeURIComponent(inboundMessage)}&user_role=${userRole}&intent=入库`, {
                method: 'POST'
              })
            } catch (error) {
              console.error('Save inbound record to chat history failed:', error)
            }
          }}
          userRole={userRole}
        />
      )}

      {/* 销售管理弹窗 - 柜台、结算、业务可用 */}
      {showSalesSearchModal && ['counter', 'settlement', 'sales'].includes(userRole) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"><SalesOrdersPage userRole={userRole} onClose={() => setShowSalesSearchModal(false)} /></div>
      )}

      {/* 历史回顾面板 - 所有角色可?*/}
      <ChatHistoryPanel
        isOpen={showHistoryPanel}
        onClose={() => setShowHistoryPanel(false)}
        userRole={userRole}
        onLoadSession={(sessionId, sessionMessages) => {
          // 加载历史对话到当前聊?
          if (sessionMessages && sessionMessages.length > 0) {
            const formattedMessages = sessionMessages.map(msg => ({
              type: msg.message_type === 'user' ? 'user' : 'system',  // 浣跨敤 type 鍜?system（与渲染逻辑一致）
              content: msg.content,
              timestamp: msg.created_at
            }))
            // 解析消息中的隐藏标记，恢复所有特殊消息的额外字段
            const parsedMessages = parseMessageHiddenMarkers(formattedMessages)
            setMessages(parsedMessages)
            
            // 设置当前 session_id，确保后续消息继续使用相同的会话
            setCurrentSessionId(sessionId)
            localStorage.setItem('current_session_id', sessionId)
            setCurrentConversationId(sessionId)
            
            setShowHistoryPanel(false)
          }
        }}
      />

      {/* 快捷收料弹窗 */}
      <QuickReceiptModal
        isOpen={showQuickReceiptModal}
        onClose={() => setShowQuickReceiptModal(false)}
        onSuccess={(data) => {
          // Create chat message with hidden marker (critical for history persistence)
          const downloadUrl = `${API_BASE_URL}/api/gold-material/gold-receipts/${data.id}/print`
          const receiptMessage = `✅ 收料单已生成\n\n📋 单号：${data.receipt_no}\n👤 客户：${data.customer_name}\n⚖️ 克重：${data.gold_weight.toFixed(2)} 克\n🏷️ 成色：${data.gold_fineness}${data.remark ? `\n📝 备注：${data.remark}` : ''}\n🕐 时间：${new Date().toLocaleString('zh-CN')}\n\n<!-- GOLD_RECEIPT:${data.id}:${data.receipt_no} -->`
          setMessages(prev => [...prev, {
            id: Date.now(),
            type: 'system',
            content: receiptMessage,
            goldReceiptDownloadUrl: downloadUrl,
            goldReceiptId: data.id
          }])
        }}
        showToast={showToast}
      />

      {/* 快捷提料弹窗 */}
      <QuickWithdrawalModal
        isOpen={showQuickWithdrawalModal}
        onClose={() => setShowQuickWithdrawalModal(false)}
        onSuccess={(data) => {
          // Create chat message with hidden marker (critical for history persistence)
          const downloadUrl = `${API_BASE_URL}/api/gold-material/withdrawals/${data.id}/download?format=html`
          const withdrawalMessage = `✅ 提料单已生成\n\n📋 单号：${data.withdrawal_no}\n👤 客户：${data.customer_name}\n⚖️ 克重：${data.gold_weight.toFixed(2)} 克${data.remark ? `\n📝 备注：${data.remark}` : ''}\n⏰ 时间：${new Date().toLocaleString('zh-CN')}\n\n<!-- WITHDRAWAL_ORDER:${data.id}:${data.withdrawal_no} -->`
          setMessages(prev => [...prev, {
            id: Date.now(),
            type: 'system',
            content: withdrawalMessage,
            withdrawalDownloadUrl: downloadUrl,
            withdrawalId: data.id
          }])
        }}
        userRole={userRole}
        showToast={showToast}
      />
      
      {/* Toast 閫氱煡瀹瑰櫒 */}
      <Toaster 
        position="top-center"
        toastOptions={{
          duration: 3000,
          style: {
            zIndex: 99999,
          },
          success: {
            style: {
              background: '#10b981',
              color: 'white',
            },
          },
          error: {
            style: {
              background: '#ef4444',
              color: 'white',
            },
          },
        }}
      />
      
      {/* Toast 提示组件 */}
      {toastMessage && (
        <div className="fixed bottom-20 left-1/2 transform -translate-x-1/2 z-50 animate-fade-in">
          <div className="bg-gray-800 text-white px-4 py-2 rounded-lg shadow-lg text-sm">
            {toastMessage}
          </div>
        </div>
      )}
    </div>
  )
}

export default App

