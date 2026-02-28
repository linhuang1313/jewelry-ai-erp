import { useState, useRef, useEffect, useCallback } from 'react'
import React from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import toast, { Toaster } from 'react-hot-toast'
import { API_ENDPOINTS, API_BASE_URL } from './config'
import LanguageSelector from './components/LanguageSelector'
import { hasPermission, canAccessPage, getPermissionDeniedMessage } from './config/permissions'
import { createCardFromBackend, createNewCard } from './utils/inboundHelpers'
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
import { SupplierPage } from './components/SupplierPage'
import ReturnPage from './components/ReturnPage'
import GoldMaterialPage from './components/GoldMaterialPage'
import LoanPage from './components/LoanPage'
import DocumentCenterPage from './components/DocumentCenterPage'
import ProductCodePage from './components/ProductCodePage'
import LabelDesignPage from './components/LabelDesignPage'
import InboundOrdersPage from './components/InboundOrdersPage'
import CustomerAccountPage from './components/CustomerAccountPage'
import SalesReturnPage from './components/SalesReturnPage'
import { USER_ROLES } from './constants/roles'
import { Header } from './components/layout'
import { ConversationSidebar } from './components/layout/ConversationSidebar'
import ChatView from './pages/ChatView'
import { InlineQuickReceiptModal } from './components/modals/InlineQuickReceiptModal'
import { ReceiptEditModal } from './components/modals/ReceiptEditModal'
import { InlineQuickWithdrawalModal } from './components/modals/InlineQuickWithdrawalModal'
import VoucherManagement from './components/VoucherManagement'
import FinanceSettings from './components/FinanceSettings'
import FinanceClosing from './components/FinanceClosing';
import FinanceReports from './components/FinanceReports';
import FinanceAdminManagement from './components/FinanceAdminManagement';
import { ChatHistoryPanel } from './components/ChatHistoryPanel'
import { getUserIdentifier, getHistoryKey, getLastSessionKey, safeLocalStorageSet } from './utils/userIdentifier'
import { parseMessageHiddenMarkers } from './utils/messageParser'
import { pageToPath, pathToPage } from './routes'
import AppContext from './contexts/AppContext'
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
  // 路由
  const navigate = useNavigate()
  const location = useLocation()

  // 国际化
  const { t, i18n } = useTranslation()
  const [showLanguageSelector, setShowLanguageSelector] = useState(() => {
    // 首次访问显示语言选择页
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
  const fileInputRef = useRef(null)  // 文件输入引用
  const abortControllerRef = useRef(null)  // SSE 请求取消控制器

  // 防止 loading/uploading 卡住导致输入框永久禁用：超时 2 分钟自动重置
  useEffect(() => {
    if (!loading && !uploading) return
    const timer = setTimeout(() => {
      setLoading(false)
      setUploading(false)
    }, 2 * 60 * 1000)
    return () => clearTimeout(timer)
  }, [loading, uploading])

  // OCR编辑对话框相关状态
  const [showOCRModal, setShowOCRModal] = useState(false)
  const [ocrResult, setOcrResult] = useState('')
  const [uploadedImage, setUploadedImage] = useState(null)
  const ocrTextareaRef = useRef(null)  // 用于自动聚焦

  // 转账截图收款凭证状态
  const [showPaymentProofModal, setShowPaymentProofModal] = useState(false)
  const [paymentProofData, setPaymentProofData] = useState(null)
  const [paymentProofImage, setPaymentProofImage] = useState(null)
  const [paymentProofLoading, setPaymentProofLoading] = useState(false)
  const paymentProofInputRef = useRef(null)

  // 待发送的图片附件（上传后预览，等用户输入文字再一起发送）
  const [pendingAttachment, setPendingAttachment] = useState(null) // { file, previewUrl, type }

  // 历史对话记录相关状态
  const [conversationHistory, setConversationHistory] = useState([])  // 历史对话列表
  const [currentConversationId, setCurrentConversationId] = useState(null)  // 当前对话ID

  // 后端会话ID（用于聊天记录持久化）
  const [currentSessionId, setCurrentSessionId] = useState(() => {
    // 生成或恢复 session_id
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
  // currentPage 从 URL 路径派生，保持向后兼容
  const currentPage = pathToPage(location.pathname)
  // setCurrentPage 包装为 navigate，让所有旧代码无缝工作
  const setCurrentPage = useCallback((page) => {
    if (typeof page === 'object') {
      // 特殊情况：salesOrders 带 editOrderId
      navigate('/', { state: { salesOrderEdit: page.editOrderId } })
      return
    }
    navigate(pageToPath(page))
  }, [navigate])
  const [showQuickOrderModal, setShowQuickOrderModal] = useState(false)  // 快捷开单弹窗
  const [showQuickReturnModal, setShowQuickReturnModal] = useState(false)  // 快捷退货弹窗
  const [showQuickInboundModal, setShowQuickInboundModal] = useState(false)  // 快捷入库弹窗
  const [showSalesSearchModal, setShowSalesSearchModal] = useState(false)  // 销售管理弹窗
  const [showHistoryPanel, setShowHistoryPanel] = useState(false) // 历史回顾面板
  const [showQuickReceiptModal, setShowQuickReceiptModal] = useState(false)  // 快捷收料弹窗
  const [showQuickWithdrawalModal, setShowQuickWithdrawalModal] = useState(false)  // 快捷提料弹窗
  const [toastMessage, setToastMessage] = useState('') // Toast 提示消息
  const [quickFormCustomers, setQuickFormCustomers] = useState([]) // 客户列表
  const [quickFormCustomerSearch, setQuickFormCustomerSearch] = useState('') // 客户搜索
  const [quickReceiptForm, setQuickReceiptForm] = useState({ customer_id: '', gold_weight: '', gold_fineness: '足金999', remark: '' })
  const [quickWithdrawalForm, setQuickWithdrawalForm] = useState({ customer_id: '', gold_weight: '', remark: '' })
  const [selectedCustomerDeposit, setSelectedCustomerDeposit] = useState(null) // 选中客户的存料余额
  const [depositLoading, setDepositLoading] = useState(false)
  // 收料单编辑弹窗
  const [showReceiptEditModal, setShowReceiptEditModal] = useState(false)
  const [editingReceiptId, setEditingReceiptId] = useState(null)
  const [editingReceiptMsgIdx, setEditingReceiptMsgIdx] = useState(null)
  const [receiptEditForm, setReceiptEditForm] = useState({ customer_id: '', gold_weight: '', gold_fineness: '足金999', remark: '' })
  const [receiptEditCustomerSearch, setReceiptEditCustomerSearch] = useState('')
  const [receiptEditCustomers, setReceiptEditCustomers] = useState([])
  const receiptStatusFetchedRef = useRef(new Set())

  // 用户角色相关状态
  const [userRole, setUserRole] = useState(() => {
    // 从 localStorage 读取保存的角色，默认为业务员
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('userRole') || 'sales'
      const validRoles = USER_ROLES.map(r => r.id)
      if (!validRoles.includes(saved)) {
        const normalized = saved.replace(/\d+$/, '')
        const corrected = validRoles.includes(normalized) ? normalized : 'sales'
        localStorage.setItem('userRole', corrected)
        return corrected
      }
      return saved
    }
    return 'sales'
  })
  const [roleDropdownOpen, setRoleDropdownOpen] = useState(false)
  const [roleLoading, setRoleLoading] = useState(false)  // 角色切换加载状态
  const roleDropdownRef = useRef(null)
  const roleHistoryCache = useRef({})  // 角色历史记录缓存
  const bgSyncTimerRef = useRef(null)

  // 待处理转移单数量（用于分仓库存按钮badge）
  const [pendingTransferCount, setPendingTransferCount] = useState(0)
  // 待结算销售单数量（用于结算管理按钮badge）
  const [pendingSalesCount, setPendingSalesCount] = useState(0)

  // Toast 提示函数：支持类型参数
  const showToast = (message, typeOrDuration = 3000) => {
    if (typeOrDuration === 'success') {
      toast.success(message)
    } else if (typeOrDuration === 'error') {
      toast.error(message)
    } else {
      setToastMessage(message)
      setTimeout(() => setToastMessage(''), typeof typeOrDuration === 'number' ? typeOrDuration : 3000)
    }
  }

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // 历史消息无 receiptStatus 时，拉取收料单详情补全
  useEffect(() => {
    const getReceiptId = (msg) => {
      if (msg.goldReceiptId) return msg.goldReceiptId
      const match = msg.content?.match(/<!-- GOLD_RECEIPT:(\d+):/)
      return match ? parseInt(match[1]) : null
    }
    const toFetch = []
    messages.forEach((m) => {
      const rid = getReceiptId(m)
      if (rid && !m.receiptStatus && !receiptStatusFetchedRef.current.has(rid)) {
        toFetch.push(rid)
        receiptStatusFetchedRef.current.add(rid)
      }
    })
    if (toFetch.length === 0) return
    const controller = new AbortController()
    toFetch.forEach((rid) => {
      fetch(`${API_BASE_URL}/api/gold-material/gold-receipts/${rid}`, { signal: controller.signal })
        .then(res => res.json())
        .then(data => {
          if (data.data?.status) {
            setMessages(prev => prev.map(msg =>
              getReceiptId(msg) === rid ? { ...msg, receiptStatus: data.data.status } : msg
            ))
          }
        })
        .catch((e) => {
          if (e.name !== 'AbortError') receiptStatusFetchedRef.current.delete(rid)
        })
    })
    return () => controller.abort()
  }, [messages])

  // getUserIdentifier, getHistoryKey, getLastSessionKey, parseMessageHiddenMarkers
  // 已移至 utils/userIdentifier.js 和 utils/messageParser.js，通过顶部 import 引入

  // 加载指定角色的历史记录（优化版：优先使用缓存/localStorage，后台静默同步API）
  const loadRoleHistory = async (role) => {
    const historyKey = getHistoryKey(role)

    // 1. 首先检查内存缓存（5分钟有效期）
    const cached = roleHistoryCache.current[role]
    if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
      setConversationHistory(cached.data)
      return cached.data
    }

    // 2. 立即从 localStorage 加载（快速响应）
    let localHistory = []
    try {
      const parsed = JSON.parse(localStorage.getItem(historyKey) || '[]')
      localHistory = Array.isArray(parsed) ? parsed : []
      setConversationHistory(localHistory)
    } catch {
      localHistory = []
      setConversationHistory([])
    }

    // 3. 后台静默同步 API 数据（不阻塞 UI）
    if (bgSyncTimerRef.current) clearTimeout(bgSyncTimerRef.current)
    bgSyncTimerRef.current = setTimeout(async () => {
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

          safeLocalStorageSet(historyKey, JSON.stringify(history))

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

      }
    }, 100)

    // Cache local data
    roleHistoryCache.current[role] = {
      data: localHistory,
      timestamp: Date.now()
    }

    return localHistory
  }

  // ========== 切换用户角色（增强版：保存/恢复各角色上次对话） ==========
  const PROTECTED_ROLES = ['finance', 'manager']
  const ROLE_PASSWORD = '772092'

  const changeUserRole = async (roleId) => {
    // 如果是同一角色，直接返回
    if (roleId === userRole) {
      setRoleDropdownOpen(false)
      return
    }

    if (PROTECTED_ROLES.includes(roleId)) {
      const input = window.prompt('该角色需要密码验证，请输入密码：')
      if (input !== ROLE_PASSWORD) {
        if (input !== null) {
          alert('密码错误，无法切换到该角色')
        }
        setRoleDropdownOpen(false)
        return
      }
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

        // 只保留最近50个对话
        const limitedHistory = currentHistory.slice(0, 50)
        safeLocalStorageSet(currentHistoryKey, JSON.stringify(limitedHistory))

        // 保存当前角色的上次会话ID
        const currentLastSessionKey = getLastSessionKey(userRole)
        safeLocalStorageSet(currentLastSessionKey, conversationId)
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

  // 组件卸载时取消正在进行的 SSE 请求
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [])

  // 仅在页面初始加载时加载当前角色的历史对话记录
  // 角色切换时由 changeUserRole 函数负责加载，避免重复调用
  const initialLoadRef = useRef(false)
  useEffect(() => {
    if (!initialLoadRef.current) {
      initialLoadRef.current = true
      loadRoleHistory(userRole)
    }
    return () => {
      if (bgSyncTimerRef.current) clearTimeout(bgSyncTimerRef.current)
    }
  }, [])  // 只在组件挂载时执行一次

  // ========== 页面初始化时恢复当前对话（增强版：支持后端同步兜底） ==========
  const [isRestoring, setIsRestoring] = useState(false)  // 防止重复恢复

  useEffect(() => {
    if (!userRole || isRestoring) return
    let cancelled = false

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
          if (cancelled) return
          setMessages(restoredMessages)
          setCurrentConversationId(savedSessionId)
          setCurrentSessionId(savedSessionId)
          setConversationTitle(conversation.title || '新对话')

        } else {
          try {
            const response = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/chat-history/${savedSessionId}`)
            if (cancelled) return
            if (response.ok) {
              const data = await response.json()
              if (cancelled) return
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
              }
            }
          } catch (backendError) {
            // network error, ignore
          }
        }
      } catch (error) {
        try {
          localStorage.setItem(historyKey, '[]')
        } catch { }
      } finally {
        if (!cancelled) setIsRestoring(false)
      }
    }

    restoreCurrentConversation()
    return () => { cancelled = true }
  }, [userRole])

  // 防重入锁：避免上一次请求未完成时重复发起
  const transferLoadingRef = useRef(false)
  const salesLoadingRef = useRef(false)

  // 加载待处理转移单数量（柜台角色必须看到商品部发来的转移单）
  const loadPendingTransferCount = async () => {
    if (!['counter', 'settlement', 'manager'].includes(userRole)) {
      setPendingTransferCount(0)
      return
    }
    if (transferLoadingRef.current) return
    transferLoadingRef.current = true
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    try {
      const response = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/warehouse/transfers?status=pending`, { signal: controller.signal })
      if (response.ok) {
        const transfers = await response.json()
        const roleLocationMap = { 'counter': '展厅', 'product': '商品部仓库' }
        const myLocation = roleLocationMap[userRole]
        if (myLocation) {
          const filtered = transfers.filter(t => t.to_location_name === myLocation)
          setPendingTransferCount(filtered.length)
        } else {
          setPendingTransferCount(transfers.length)
        }
      }
    } catch (error) {
      if (error.name !== 'AbortError') {

      }
    } finally {
      clearTimeout(timeout)
      transferLoadingRef.current = false
    }
  }

  // 加载待结算销售单数量（结算专员需要看到柜台开的销售单）
  const loadPendingSalesCount = async () => {
    if (!['settlement', 'manager'].includes(userRole)) {
      setPendingSalesCount(0)
      return
    }
    if (salesLoadingRef.current) return
    salesLoadingRef.current = true
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    try {
      const response = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/settlement/pending-sales`, { signal: controller.signal })
      if (response.ok) {
        const sales = await response.json()
        setPendingSalesCount(sales.length)
      }
    } catch (error) {
      if (error.name !== 'AbortError') {

      }
    } finally {
      clearTimeout(timeout)
      salesLoadingRef.current = false
    }
  }

  // 加载客户列表（用于快捷收料/提料）
  const loadQuickFormCustomers = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/customers`)
      if (response.ok) {
        const data = await response.json()

        // API返回格式: { success: true, data: { customers: [...] } }
        const customers = data.data?.customers || data.customers || []
        setQuickFormCustomers(Array.isArray(customers) ? customers : [])
      } else {

        showToast('加载客户列表失败，请刷新重试')
      }
    } catch (error) {

      showToast('加载客户列表失败，请检查网络连接')
    }
  }

  // 打开快捷收料弹窗
  const openQuickReceiptModal = () => {
    loadQuickFormCustomers()
    setQuickReceiptForm({ customer_id: '', gold_weight: '', gold_fineness: '足金999', remark: '' })
    setQuickFormCustomerSearch('')
    setShowQuickReceiptModal(true)
  }

  // 打开快捷提料弹窗
  const openQuickWithdrawalModal = () => {
    loadQuickFormCustomers()
    setQuickWithdrawalForm({ customer_id: '', gold_weight: '', remark: '' })
    setQuickFormCustomerSearch('')
    setSelectedCustomerDeposit(null)
    setShowQuickWithdrawalModal(true)
  }

  // 查询客户存料余额
  const fetchCustomerDeposit = async (customerId) => {
    if (!customerId) {
      setSelectedCustomerDeposit(null)
      return
    }
    setDepositLoading(true)
    try {
      const response = await fetch(`${API_BASE_URL}/api/gold-material/customers/${customerId}/deposit`)
      if (response.ok) {
        const result = await response.json()
        setSelectedCustomerDeposit({
          current_balance: result.data?.deposit?.current_balance || 0,
          customer_name: result.data?.customer_name || ''
        })
      } else {
        setSelectedCustomerDeposit({ current_balance: 0, customer_name: '' })
      }
    } catch (error) {

      setSelectedCustomerDeposit({ current_balance: 0, customer_name: '' })
      showToast('查询客户余额失败，显示为0')
    } finally {
      setDepositLoading(false)
    }
  }

  // 创建快捷收料单
  const handleQuickReceipt = async (e) => {
    e.preventDefault()
    if (!quickReceiptForm.customer_id) {
      alert('请选择客户')
      return
    }
    if (!quickReceiptForm.gold_weight || parseFloat(quickReceiptForm.gold_weight) <= 0) {
      alert('请输入有效的收料克重')
      return
    }
    try {
      const params = new URLSearchParams({
        customer_id: quickReceiptForm.customer_id,
        gold_weight: quickReceiptForm.gold_weight,
        gold_fineness: quickReceiptForm.gold_fineness,
        remark: quickReceiptForm.remark || '快捷收料',
        created_by: '结算专员',
        user_role: localStorage.getItem('userRole') || 'sales'
      })
      const response = await fetch(`${API_BASE_URL}/api/gold-material/gold-receipts?${params}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      if (response.ok) {
        const result = await response.json()
        const customerName = quickFormCustomers.find(c => c.id.toString() === quickReceiptForm.customer_id)?.name || '未知客户'
        const receiptWeight = parseFloat(quickReceiptForm.gold_weight)
        const remarkText = quickReceiptForm.remark || ''

        setShowQuickReceiptModal(false)
        // 重置表单
        setQuickReceiptForm({ customer_id: '', gold_weight: '', gold_fineness: '足金999', remark: '' })
        setQuickFormCustomerSearch('')

        // 添加收料单记录到聊天框（使用文本格式+隐藏标记）
        const downloadUrl = `${API_BASE_URL}/api/gold-material/gold-receipts/${result.data.id}/print`
        const receiptMessage = `✅ 收料单已生成\n\n📋 单号：${result.data.receipt_no}\n👤 客户：${customerName}\n⚖️ 克重：${receiptWeight.toFixed(2)} 克
🏷️ 成色：${quickReceiptForm.gold_fineness}${remarkText ? `\n📝 备注：${remarkText}` : ''}\n🕐 时间：${new Date().toLocaleString('zh-CN')}\n\n<!-- GOLD_RECEIPT:${result.data.id}:${result.data.receipt_no} -->`
        setMessages(prev => [...prev, {
          id: Date.now(),
          type: 'system',
          content: receiptMessage,
          goldReceiptDownloadUrl: downloadUrl,
          goldReceiptId: result.data.id,
          receiptStatus: 'pending'
        }])
      } else {
        const error = await response.json()
        alert('创建收料单失败：' + (error.detail || '未知错误'))
      }
    } catch (error) {

      alert('创建收料单失败')
    }
  }

  // 确认收料单（实际收到金料）
  const handleConfirmReceipt = async (receiptId, msgIdx) => {
    try {
      const userRole = localStorage.getItem('userRole') || 'sales'
      const res = await fetch(`${API_BASE_URL}/api/gold-material/gold-receipts/${receiptId}/receive?received_by=结算专员&user_role=${userRole}`, { method: 'POST' })
      if (!res.ok) {
        const err = await res.json()
        toast.error(err.detail || '确认失败')
        return
      }
      const getRid = (m) => { const x = m.content?.match(/<!-- GOLD_RECEIPT:(\d+):/); return m.goldReceiptId || (x ? parseInt(x[1]) : null) }
      setMessages(prev => prev.map((m, i) => {
        if (i !== msgIdx || getRid(m) !== receiptId) return m
        const newContent = (m.content || '').replace('收料单已生成', '收料单已确认')
        return { ...m, content: newContent, receiptStatus: 'received' }
      }))
      toast.success('已确认收到金料')
    } catch (e) {
      toast.error('确认失败：' + (e.message || '网络错误'))
    }
  }

  // 打开收料单编辑弹窗
  const openReceiptEditModal = async (receiptId, msgIdx) => {
    setEditingReceiptId(receiptId)
    setEditingReceiptMsgIdx(msgIdx)
    try {
      const [detailRes, customersRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/gold-material/gold-receipts/${receiptId}`),
        fetch(`${API_BASE_URL}/api/customers?page_size=500`)
      ])
      const detailData = await detailRes.json()
      const customersData = await customersRes.json()
      const detail = detailData.data
      const customerList = customersData.data?.customers || customersData.customers || []
      setReceiptEditCustomers(Array.isArray(customerList) ? customerList : [])
      setReceiptEditForm({
        customer_id: detail?.customer_id?.toString() || '',
        gold_weight: detail?.gold_weight?.toString() || '',
        gold_fineness: detail?.gold_fineness || '足金999',
        remark: detail?.remark || ''
      })
      setReceiptEditCustomerSearch(detail?.customer_name || '')
      setShowReceiptEditModal(true)
    } catch (e) {
      toast.error('加载失败：' + (e.message || '网络错误'))
    }
  }

  // 提交收料单编辑
  const handleReceiptEditSubmit = async (e) => {
    e.preventDefault()
    if (!editingReceiptId || editingReceiptMsgIdx == null) return
    if (!receiptEditForm.customer_id || !receiptEditForm.gold_weight || parseFloat(receiptEditForm.gold_weight) <= 0) {
      toast.error('请填写客户和有效克重')
      return
    }
    try {
      const params = new URLSearchParams({
        gold_weight: receiptEditForm.gold_weight,
        gold_fineness: receiptEditForm.gold_fineness,
        customer_id: receiptEditForm.customer_id,
        remark: receiptEditForm.remark || ''
      })
      const res = await fetch(`${API_BASE_URL}/api/gold-material/gold-receipts/${editingReceiptId}?${params}`, { method: 'PUT' })
      if (!res.ok) {
        const err = await res.json()
        toast.error(err.detail || '更新失败')
        return
      }
      const customerName = receiptEditCustomers.find(c => c.id.toString() === receiptEditForm.customer_id)?.name || '未知客户'
      const receiptWeight = parseFloat(receiptEditForm.gold_weight)
      const remarkText = receiptEditForm.remark || ''
      setMessages(prev => prev.map((m, i) => {
        const match = m.content?.match(/<!-- GOLD_RECEIPT:(\d+):([^>]*)-->/)
        const rid = m.goldReceiptId || (match ? parseInt(match[1]) : null)
        if (rid !== editingReceiptId || i !== editingReceiptMsgIdx) return m
        const receiptNo = (m.content?.match(/<!-- GOLD_RECEIPT:\d+:([^>]*)-->/)?.[1]) || ''
        const newContent = `✅ 收料单已生成\n\n📋 单号：${receiptNo}\n👤 客户：${customerName}\n⚖️ 克重：${receiptWeight.toFixed(2)} 克
🏷️ 成色：${receiptEditForm.gold_fineness}${remarkText ? `\n📝 备注：${remarkText}` : ''}\n🕐 时间：${new Date().toLocaleString('zh-CN')}\n\n<!-- GOLD_RECEIPT:${editingReceiptId}:${receiptNo} -->`
        return { ...m, content: newContent }
      }))
      setShowReceiptEditModal(false)
      setEditingReceiptId(null)
      setEditingReceiptMsgIdx(null)
      toast.success('已更新')
    } catch (e) {
      toast.error('更新失败：' + (e.message || '网络错误'))
    }
  }

  // 创建快捷提料单
  const handleQuickWithdrawal = async (e) => {
    e.preventDefault()
    if (!quickWithdrawalForm.customer_id) {
      alert('请选择客户')
      return
    }
    const weight = parseFloat(quickWithdrawalForm.gold_weight)
    if (!weight || weight <= 0) {
      alert('请输入有效的提料克重')
      return
    }
    if (weight > (selectedCustomerDeposit?.current_balance || 0)) {
      alert(`提料克重不能超过客户存料余额（${selectedCustomerDeposit?.current_balance?.toFixed(2) || 0}克）`)
      return
    }
    try {
      const params = new URLSearchParams({ user_role: 'settlement', created_by: '结算专员' })
      const response = await fetch(`${API_BASE_URL}/api/gold-material/withdrawals?${params}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: parseInt(quickWithdrawalForm.customer_id),
          gold_weight: weight,
          withdrawal_type: 'self',
          remark: quickWithdrawalForm.remark || '快捷提料'
        })
      })
      if (response.ok) {
        const result = await response.json()
        const customerName = quickFormCustomers.find(c => c.id.toString() === quickWithdrawalForm.customer_id)?.name || '未知客户'
        const withdrawalWeight = parseFloat(quickWithdrawalForm.gold_weight)
        const remarkText = quickWithdrawalForm.remark || ''

        setShowQuickWithdrawalModal(false)
        // 重置表单
        setQuickWithdrawalForm({ customer_id: '', gold_weight: '', remark: '' })
        setSelectedCustomerDeposit(null)
        setQuickFormCustomerSearch('')

        // 添加提料单记录到聊天框（使用文本格式+隐藏标记，确保历史记录持久化）
        const downloadUrl = `${API_BASE_URL}/api/gold-material/withdrawals/${result.id}/download?format=html`
        const withdrawalMessage = `✅ 提料单已生成\n\n📋 单号：${result.withdrawal_no}\n👤 客户：${customerName}\n⚖️ 克重：${withdrawalWeight.toFixed(2)} 克${remarkText ? `\n📝 备注：${remarkText}` : ''}\n⏰ 时间：${new Date().toLocaleString('zh-CN')}\n\n<!-- WITHDRAWAL_ORDER:${result.id}:${result.withdrawal_no} -->`
        setMessages(prev => [...prev, {
          id: Date.now(),
          type: 'system',
          content: withdrawalMessage,
          // 保留下载链接供按钮使用
          withdrawalDownloadUrl: downloadUrl,
          withdrawalId: result.id
        }])

        // 自动打开打印页面
        if (result.id) {
          window.open(`${API_BASE_URL}/api/gold-material/withdrawals/${result.id}/download?format=html`, '_blank')
        }
      } else {
        const error = await response.json()
        alert('创建提料单失败：' + (error.detail || '未知错误'))
      }
    } catch (error) {

      alert('创建提料单失败')
    }
  }

  // 筛选客户列表（确保是数组）
  const filteredQuickFormCustomers = (Array.isArray(quickFormCustomers) ? quickFormCustomers : []).filter(c => {
    if (!quickFormCustomerSearch.trim()) return true;
    const search = quickFormCustomerSearch.toLowerCase();
    return (c.name && c.name.toLowerCase().includes(search)) ||
      (c.phone && c.phone.includes(quickFormCustomerSearch));
  })

  const filteredReceiptEditCustomers = (Array.isArray(receiptEditCustomers) ? receiptEditCustomers : []).filter(c => {
    if (!receiptEditCustomerSearch.trim()) return true;
    const search = receiptEditCustomerSearch.toLowerCase();
    return (c.name && c.name.toLowerCase().includes(search)) ||
      (c.phone && c.phone.includes(receiptEditCustomerSearch));
  })

  // 角色变化时加载待处理数量
  useEffect(() => {
    loadPendingTransferCount()
    loadPendingSalesCount()
    // 每60秒刷新一次（避免请求堆积占满浏览器连接池）
    const interval = setInterval(() => {
      loadPendingTransferCount()
      loadPendingSalesCount()
    }, 60000)
    return () => clearInterval(interval)
  }, [userRole])

  // 保存对话到历史记录（保存到当前角色的历史记录）
  // ========== 保存对话（增强版：去重优化 + 保存上次会话ID） ==========
  const lastSavedRef = useRef({ messageCount: 0, lastMessageId: null })

  const saveConversation = () => {
    if (messages.length === 0) return

    // 性能优化：检查消息是否真的变化了，避免重复保存
    const lastMessage = messages[messages.length - 1]
    if (lastSavedRef.current.messageCount === messages.length &&
      lastSavedRef.current.lastMessageId === lastMessage?.id) {
      return  // 消息没有变化，不需要保存
    }

    // 获取当前角色的历史记录key
    const historyKey = getHistoryKey(userRole)
    // 从localStorage获取当前角色的最新历史记录
    const parsedData = JSON.parse(localStorage.getItem(historyKey) || '[]')
    const history = Array.isArray(parsedData) ? parsedData : []

    // 自动生成对话标题（使用第一条用户消息的前20个字符）
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

    // 只保留最近50个对话
    const limitedHistory = history.slice(0, 50)
    safeLocalStorageSet(historyKey, JSON.stringify(limitedHistory))
    setConversationHistory(limitedHistory)
    setCurrentConversationId(conversationId)

    // 保存当前角色的上次会话ID（用于角色切换时恢复）
    const lastSessionKey = getLastSessionKey(userRole)
    safeLocalStorageSet(lastSessionKey, conversationId)

    // 更新保存状态，用于去重检测
    lastSavedRef.current = { messageCount: messages.length, lastMessageId: lastMessage?.id }
  }

  // 当消息变化时自动保存（优化：去重）
  useEffect(() => {
    if (messages.length === 0) return

    // 延迟保存，避免频繁写入
    const timer = setTimeout(() => {
      saveConversation()
    }, 1000)
    return () => clearTimeout(timer)
  }, [messages])

  // 加载指定对话（从后端API加载完整消息内容）
  const loadConversation = async (conversationId) => {
    // 先尝试从localStorage加载（优先本地缓存，避免后端不可用时无法加载）
    const historyKey = getHistoryKey(userRole)
    let localConversation = null
    try {
      const parsedData = JSON.parse(localStorage.getItem(historyKey) || '[]')
      const history = Array.isArray(parsedData) ? parsedData : []
      localConversation = history.find(c => c.id === conversationId)
    } catch { }

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
            type: msg.message_type === 'user' ? 'user' : 'system',  // assistant 消息显示为 system 类型
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
            // 入库单
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
            // 结算单
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

        // 设置后端 session_id，确保后续消息继续使用相同的会话
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
  const deleteConversation = (conversationId, e) => {
    e.stopPropagation()
    // 获取当前角色的历史记录key
    const historyKey = getHistoryKey(userRole)
    const history = (Array.isArray(conversationHistory) ? conversationHistory : []).filter(c => c.id !== conversationId)
    safeLocalStorageSet(historyKey, JSON.stringify(history))
    setConversationHistory(history)
    if (currentConversationId === conversationId) {
      newConversation()
    }
  }

  // 当对话框打开时自动聚焦
  useEffect(() => {
    if (showOCRModal && ocrTextareaRef.current) {
      // 延迟聚焦，确保对话框已完全渲染
      const timer = setTimeout(() => {
        ocrTextareaRef.current?.focus()
        // 将光标移到文本末尾
        if (ocrTextareaRef.current) {
          const length = ocrTextareaRef.current.value.length
          ocrTextareaRef.current.setSelectionRange(length, length)
        }
      }, 150)

      return () => clearTimeout(timer)
    }
  }, [showOCRModal])

  const sendMessage = async () => {
    const hasText = input.trim().length > 0
    const hasAttachment = pendingAttachment !== null

    if (!hasText && !hasAttachment) return
    if (loading) return

    // 如果只有图片没有文字，直接走识别流程
    if (hasAttachment && !hasText) {
      const { file, previewUrl } = pendingAttachment
      setPendingAttachment(null)
      await sendPaymentProofForRecognition(file, previewUrl, '')
      return
    }

    // 如果有图片 + 文字，先保存附件信息再清空
    const attachmentToSend = pendingAttachment
    if (hasAttachment) setPendingAttachment(null)

    const userMessage = input.trim()
    setInput('')
    setMessages(prev => [...prev, {
      type: 'user',
      content: userMessage,
      ...(attachmentToSend ? { image: attachmentToSend.previewUrl } : {}),
    }])
    setLoading(true)

    // @角色协同消息附带图片时，由后端做 OCR 交叉验证，不走单独的 OCR 流程
    const hasRoleMention = /@(财务|结算|商品部|柜台|业务员|金料|料部|经理)/.test(userMessage)
    if (attachmentToSend && !hasRoleMention) {
      sendPaymentProofForRecognition(attachmentToSend.file, attachmentToSend.previewUrl, '').catch(err => {
        console.error('OCR识别失败:', err)
        toast.error('图片识别失败，请稍后重试')
      })
    }

    // 创建思考过程消息ID
    const thinkingMessageId = Date.now()
    let contentMessageId = null
    let currentContent = ''
    let isContentStarted = false
    let thinkingSteps = []

    try {

      // 取消之前的请求（如果有）
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
      abortControllerRef.current = new AbortController()

      const requestBody = {
        message: userMessage,
        user_role: userRole,
        session_id: currentSessionId,
        language: currentLanguage,
      }
      if (attachmentToSend && hasRoleMention) {
        requestBody.image_url = attachmentToSend.previewUrl
      }

      const response = await fetch(API_ENDPOINTS.CHAT_STREAM, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: abortControllerRef.current.signal
      })


      if (!response.ok) {
        const errorText = await response.text()

        throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`)
      }

      if (!response.body) {

        throw new Error('响应体为空')
      }


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
            setLoading(false)
            setMessages(prev => prev.filter(msg => msg.id !== thinkingMessageId))
            break
          }

          if (!value) {

            continue
          }

          chunkCount++
          if (chunkCount <= 3) {

          }

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''  // 保留不完整的行

          for (const line of lines) {
            if (line.trim() === '') continue  // 跳过空行
            if (line.startsWith('data: ')) {
              try {
                const jsonStr = line.slice(6)

                const data = JSON.parse(jsonStr)

                // 特别检查 all_products
                if (data.data?.all_products) {

                }

                // 处理思考步骤
                if (data.type === 'thinking') {
                  const stepIndex = thinkingSteps.findIndex(s => s.step === data.step)
                  if (stepIndex >= 0) {
                    // 更新现有步骤
                    thinkingSteps[stepIndex] = {
                      step: data.step,
                      message: data.message,
                      progress: data.progress || 0,
                      status: data.status || 'processing'
                    }
                  } else {
                    // 添加新步骤
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
                // 内容开始
                else if (data.type === 'content_start') {
                  if (!contentMessageId) {
                    isContentStarted = true
                    contentMessageId = Date.now()
                    setMessages(prev => [...prev, {
                      id: contentMessageId,
                      type: 'system',
                      content: '',
                      isStreaming: true
                    }])
                  }
                }
                // 内容块
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
                // 收款确认
                else if (data.type === 'payment_confirm') {

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
                // 跨角色协同卡片
                else if (data.type === 'interactive_card') {
                  setLoading(false)
                  setMessages(prev => prev.filter(msg => msg.id !== thinkingMessageId))
                  const cardPayload = data.data
                  if (cardPayload) {
                    setMessages(prev => [...prev, {
                      id: Date.now(),
                      type: 'interactive_card',
                      cardData: {
                        card_id: cardPayload.card_id,
                        card_type: cardPayload.card_type,
                        status: cardPayload.status,
                        creator_role: cardPayload.creator_role,
                        target_roles: cardPayload.target_roles,
                        payload: cardPayload.payload,
                        data: cardPayload.payload,
                        actions_taken: cardPayload.actions_taken || [],
                      },
                      content: cardPayload.message || '跨角色协同任务已创建',
                    }])
                  } else {
                    console.error('interactive_card event missing data payload')
                  }
                }
                // 完成
                else if (data.type === 'complete') {

                  setLoading(false)

                  // 如果没有内容消息（比如入库操作直接返回结果），创建一个新消息
                  if (!contentMessageId || !isContentStarted) {

                    contentMessageId = Date.now()
                    // 处理入库等操作的响应
                    if (data.data) {
                      // ========== 智能表单弹出：当信息不完整时自动弹出表单 ==========
                      if (data.data.need_form) {

                        // 根据操作类型弹出对应的表单
                        if (data.data.action === '退货') {
                          setShowQuickReturnModal(true)
                        } else if (data.data.action === '入库') {
                          setShowQuickInboundModal(true)
                        } else if (data.data.action === '创建销售单') {
                          setShowQuickOrderModal(true)
                        }

                        // 移除 thinking 消息并添加提示消息
                        setMessages(prev => [...prev.filter(msg => msg.id !== thinkingMessageId), {
                          type: 'system',
                          content: data.data.message || '📝 请在弹出的表格中填写完整信息',
                          id: contentMessageId
                        }])
                        continue
                      }

                      let messageContent = ''
                      if (data.data.message) {
                        messageContent = data.data.message
                      } else if (data.data.success !== undefined) {
                        messageContent = data.data.success
                          ? '操作成功完成'
                          : (data.data.error || '操作失败')
                      }


                      // 检查是否是入库操作，如果是则创建待确认的卡片数据
                      let inboundCard = null
                      let inboundCards = null  // 多商品入库时使用
                      // 打印完整的 data.data 对象

                      if (data.data?.success && data.data?.pending && data.data?.card_data) {
                        // 方案B：创建待确认的卡片（status: 'pending'）
                        try {
                          // 统一使用 all_products（如果没有则使用 card_data 作为单元素数组）

                          const allProducts = data.data.all_products && data.data.all_products.length > 0
                            ? data.data.all_products
                            : [data.data.card_data]

                          // 统一创建卡片数组（无论单商品还是多商品）
                          inboundCards = allProducts.map((cardData, index) => {

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

                          // 如果只有一个商品，同时设置 inboundCard（向后兼容）
                          if (inboundCards.length === 1) {
                            inboundCard = inboundCards[0]
                            inboundCards = null  // 单商品时清空数组，使用单卡片显示
                          }
                        } catch (error) {

                        }
                      } else if (data.data?.success && data.data?.order && data.data?.detail && !data.data?.pending) {
                        // 如果已经有订单和明细，且没有pending标志，说明是已确认的（向后兼容或直接入库的情况）

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

                          } catch (error) {
                          }
                        }
                      } else {

                      }

                      setMessages(prev => [...prev.filter(msg => msg.id !== thinkingMessageId), {
                        id: contentMessageId,
                        type: 'system',
                        content: messageContent,
                        isStreaming: false,
                        order: data.data.order,
                        detail: data.data.detail,
                        inventory: data.data.inventory,
                        chartData: data.data.chart_data,
                        pieData: data.data.pie_data,
                        chartType: data.data.action,
                        rawData: data.data.raw_data,
                        detectedIntent: data.data.action,
                        inboundCard: inboundCard,
                        inboundCards: inboundCards,
                      }])
                    } else {
                      setMessages(prev => prev.filter(msg => msg.id !== thinkingMessageId))
                    }
                  } else {
                    // 如果有内容消息，移除 thinking 并更新 content
                    setMessages(prev => prev.filter(msg => msg.id !== thinkingMessageId).map(msg => {
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
                                inboundCard.barcode = orderNo  // 使用订单号作为条码
                              }
                              inboundCard.status = 'confirmed'
                              updatedMsg.inboundCard = inboundCard
                            } catch (error) {
                            }
                          }
                        }

                        return updatedMsg
                      }
                      return msg
                    }))
                  }
                }
                // 错误
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

          setLoading(false)
          setMessages(prev => prev.filter(msg => msg.id !== thinkingMessageId))
          setMessages(prev => [...prev, {
            type: 'system',
            content: `❌ 读取流式响应失败：${readError.message}`
          }])
          break
        }
      }
    } catch (error) {
      // 如果是请求被取消（用户切换页面或发送新消息），静默处理
      if (error.name === 'AbortError') {
        setMessages(prev => prev.filter(msg => msg.id !== thinkingMessageId))
        return
      }

      setMessages(prev => prev.filter(msg => msg.id !== thinkingMessageId))

      let errorMessage = `❌ 网络错误：${error.message}`

      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        errorMessage = '❌ 无法连接到服务器，请检查后端服务是否运行'
      }

      setMessages(prev => [...prev, {
        type: 'system',
        content: errorMessage
      }])
    } finally {
      setLoading(false)
    }
  }

  // 处理完成响应的辅助函数
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

    // 如果有原始数据，可以用于图表等
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

        // 如果有思考过程，先显示思考过程
        if (data.thinking_steps && data.thinking_steps.length > 0) {
          systemMessage = "💡 处理过程：\n" + data.thinking_steps.join('\n') + "\n\n" + systemMessage
        }

        // 如果是图表数据（查询所有库存）
        if (data.chart_data) {
          systemMessage += `\n\n📊 库存统计：\n` +
            `商品种类：${data.summary.total_products}种\n` +
            `供应商数量：${data.summary.total_suppliers}家\n` +
            `总库存：${data.summary.total_weight.toFixed(2)}克\n`

          setMessages(prev => [...prev, {
            type: 'system',
            content: systemMessage,
            chartData: data.chart_data,
            pieData: data.pie_data,
            tableData: data.table_data
          }])
        }
        // 如果是批量入库成功
        else if (data.order && data.details && data.details.length > 0) {
          systemMessage += `\n\n📋 入库单信息：\n` +
            `入库单号：${data.order.order_no}\n` +
            `入库品类：${data.details.length}\n\n`

          // 显示每个商品的详细信息
          data.details.forEach((detail, index) => {
            systemMessage += `商品${index + 1}：\n` +
                `  商品名称：${detail.product_name}\n` +
                `  重量：${detail.weight}克\n` +
                `  工费：${detail.labor_cost}元/克\n` +
                `  供应商：${detail.supplier}\n` +
                `  该商品工费：${detail.total_cost.toFixed(2)}元\n\n`
          })

          systemMessage += `💰 合计工费：${data.total_labor_cost.toFixed(2)}元\n\n`

          // 显示库存更新
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
        // 向后兼容：单个商品入库（旧格式）
        else if (data.order && data.detail && data.inventory) {
          systemMessage += `\n\n📋 入库单信息：\n` +
            `入库单号：${data.order.order_no}\n` +
            `商品名称：${data.detail.product_name}\n` +
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

          // 显示所有工费明细
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
        // 如果是查询所有库存（返回inventories数组）保留向后兼容
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
        // 处理销售单创建成功
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
        // 处理客户创建/查询
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
        // 处理库存检查错误
        else if (data.inventory_errors && Array.isArray(data.inventory_errors)) {
          systemMessage += `\n\n❌ 库存检查失败：\n`
          data.inventory_errors.forEach((error, idx) => {
            systemMessage += `${idx + 1}. ${error.product_name}：${error.error}\n` +
                `   需要：${error.required_weight}克\n` +
                `   可用：${error.available_weight}克\n`
            if (error.reserved_weight !== undefined) {
                systemMessage += `   已预留：${error.reserved_weight}克\n`
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

        // 如果有思考过程，先显示思考过程
        if (data.thinking_steps && data.thinking_steps.length > 0) {
          errorMessage = "💡 处理过程：\n" + data.thinking_steps.join('\n') + "\n\n" + errorMessage
        }

        // 处理库存检查错误（在错误响应中）
        if (data.inventory_errors && Array.isArray(data.inventory_errors)) {
          errorMessage += `\n\n❌ 库存检查失败：\n`
          data.inventory_errors.forEach((error, idx) => {
            errorMessage += `${idx + 1}. ${error.product_name}：${error.error}\n` +
                `   需要：${error.required_weight}克\n` +
                `   可用：${error.available_weight}克\n`
            if (error.reserved_weight !== undefined) {
                errorMessage += `   已预留：${error.reserved_weight}克\n`
            }
            if (error.total_weight !== undefined) {
                errorMessage += `   总库存：${error.total_weight}克\n`
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

        // 如果有缺失字段列表，格式化显示
        if (data.missing_fields && data.missing_fields.length > 0) {
          errorMessage += `\n\n❌ 缺失的必填项：\n`
          data.missing_fields.forEach(field => {
            errorMessage += `  • ${field}\n`
          })
          errorMessage += `\n请补充完整信息后重新提交。`
        }

        // 如果是供应商错误，添加规则说明
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
      let errorMessage = `❌ 网络错误：${error.message}`

      // 提供更详细的错误信息
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        errorMessage = '❌ 无法连接到服务器，请检查后端服务是否运行'
      } else if (error.name === 'AbortError') {
        errorMessage = '❌ 请求超时，请稍后重试'
      }

      setMessages(prev => [...prev, {
        type: 'system',
        content: errorMessage
      }])
    }
  }

  // 处理图片上传
  const handleImageUpload = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    // 验证文件类型
    if (!file.type.startsWith('image/')) {
      setMessages(prev => [...prev, {
        type: 'system',
        content: '❌ 请上传图片文件（jpg、png等格式）'
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

    // 保存图片预览（使用Promise确保图片加载完成）
    const imageDataUrlPromise = new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        const imageDataUrl = e.target.result
        setUploadedImage(imageDataUrl)

        // 显示用户上传的图片
        setMessages(prev => [...prev, {
          type: 'user',
          content: `📸 上传入库单图片：${file.name}`,
          image: imageDataUrl
        }])

        resolve(imageDataUrl)
      }
      reader.readAsDataURL(file)
    })

    try {
      const formData = new FormData()
      formData.append('file', file)

      // 调用识别接口（只识别，不入库）
      const response = await fetch(API_ENDPOINTS.RECOGNIZE_INBOUND_SHEET, {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()
      setUploading(false)

      // 等待图片加载完成
      const imageDataUrl = await imageDataUrlPromise

      if (data.success) {
        // OCR完成后打开对话框
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
        errorMessage = '❌ 无法连接到服务器，请检查后端服务是否运行'
      } else if (error.name === 'AbortError') {
        errorMessage = '❌ 上传超时，请检查网络连接或稍后重试'
      }

      setMessages(prev => [...prev, {
        type: 'system',
        content: errorMessage
      }])
    }

    // 清空文件输入
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  // OCR完成后打开对话框
  const handleOCRComplete = (text, imageUrl) => {
    setOcrResult(text || '')
    setUploadedImage(imageUrl)
    setShowOCRModal(true)
  }

  // 处理转账截图上传（只预览，不立即发送）
  const handlePaymentProofUpload = (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('请上传图片文件')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('图片文件过大，请上传小于10MB的图片')
      return
    }

    const reader = new FileReader()
    reader.onload = (e) => {
      setPendingAttachment({ file, previewUrl: e.target.result, type: 'payment_proof' })
    }
    reader.readAsDataURL(file)

    if (paymentProofInputRef.current) {
      paymentProofInputRef.current.value = ''
    }
  }

  const clearPendingAttachment = () => {
    setPendingAttachment(null)
  }

  // 发送收款凭证到 AI 识别（用户点击发送时调用）
  const sendPaymentProofForRecognition = async (file, previewUrl, userText) => {
    setPaymentProofLoading(true)
    setMessages(prev => [...prev, {
      type: 'user',
      content: userText || `📸 上传收款凭证`,
      image: previewUrl,
    }])

    try {
      const formData = new FormData()
      formData.append('file', file)
      const response = await fetch(API_ENDPOINTS.RECOGNIZE_PAYMENT_PROOF, {
        method: 'POST',
        body: formData,
      })
      const data = await response.json()
      setPaymentProofLoading(false)

      if (data.success && data.parsed_data) {
        setPaymentProofData(data.parsed_data)
        setPaymentProofImage(data.image_data_url || null)
        setShowPaymentProofModal(true)
        setMessages(prev => [...prev, {
          type: 'system',
          content: `✅ 转账截图识别完成！请确认收款信息。`
        }])
      } else {
        setMessages(prev => [...prev, {
          type: 'system',
          content: `❌ ${data.message || '转账截图识别失败'}\n\n识别到的文字：\n${data.recognized_text || '无'}`
        }])
      }
    } catch (error) {
      setPaymentProofLoading(false)
      setMessages(prev => [...prev, {
        type: 'system',
        content: `❌ 上传失败：${error.message}`
      }])
    }
  }

  // 确认转账截图收款
  const handleConfirmPaymentProof = async (confirmedData) => {
    setShowPaymentProofModal(false)
    setLoading(true)
    try {
      const response = await fetch(API_ENDPOINTS.REGISTER_PAYMENT_FROM_PROOF, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_name: confirmedData.customer_name,
          amount: confirmedData.amount,
          payment_method: confirmedData.payment_method || 'bank_transfer',
          bank_name: confirmedData.bank_name || null,
          transfer_no: confirmedData.transfer_no || null,
          remark: confirmedData.remark || '转账截图收款',
          voucher_image: paymentProofImage || null,
        })
      })
      const result = await response.json()
      setLoading(false)
      if (result.success) {
        const d = result.data
        let msg = `✅ **收款登记成功**\n\n📋 单号：${d.payment_no}\n👤 客户：${d.customer_name}\n💰 金额：¥${d.amount.toFixed(2)}`
        if (d.offset_details?.length > 0) {
          msg += `\n📝 冲抵明细：\n` + d.offset_details.map(o => `   • 冲抵应收款#${o.receivable_id}：¥${o.amount.toFixed(2)}`).join('\n')
        }
        if (d.remaining > 0) {
          msg += `\n💰 剩余预收款：¥${d.remaining.toFixed(2)}`
        }
        setMessages(prev => [...prev, { type: 'system', content: msg }])
        toast.success(`收款 ¥${d.amount.toFixed(2)} 登记成功`)
      } else {
        setMessages(prev => [...prev, { type: 'system', content: `❌ ${result.message}` }])
        toast.error(result.message)
      }
    } catch (error) {
      setLoading(false)
      setMessages(prev => [...prev, { type: 'system', content: `❌ 登记失败：${error.message}` }])
    }
    setPaymentProofData(null)
    setPaymentProofImage(null)
  }

  // 确认入库
  const handleConfirmInbound = async () => {
    const textToSend = ocrResult.trim()
    if (!textToSend) {
      alert('请输入内容')
      return
    }

    // 关闭对话框
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

        // 如果有思考过程，先显示思考过程
        if (data.thinking_steps && data.thinking_steps.length > 0) {
          systemMessage = "💡 处理过程：\n" + data.thinking_steps.join('\n') + "\n\n" + systemMessage
        }

        // 如果是图表数据（查询所有库存）
        if (data.chart_data) {
          systemMessage += `\n\n📊 库存统计：\n` +
            `商品种类：${data.summary.total_products}种\n` +
            `供应商数量：${data.summary.total_suppliers}家\n` +
            `总库存：${data.summary.total_weight.toFixed(2)}克\n`

          setMessages(prev => [...prev, {
            type: 'system',
            content: systemMessage,
            chartData: data.chart_data,
            pieData: data.pie_data,
            tableData: data.table_data
          }])
        }
        // 如果是批量入库成功
        else if (data.order && data.details && data.details.length > 0 && data.order.order_no && data.order.order_no.startsWith('RK')) {
          systemMessage += `\n\n📋 入库单信息：\n` +
            `入库单号：${data.order.order_no}\n` +
            `入库品类：${data.details.length}\n\n`

          data.details.forEach((detail, index) => {
            systemMessage += `商品${index + 1}：\n` +
              `  商品名称：${detail.product_category || detail.product_name}\n` +
              `  重量：${detail.weight}克\n` +
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
        // 处理销售单创建成功（OCR确认后也可能创建销售单）
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
        // 如果是查询所有库存（返回inventories数组）
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
        // 处理库存检查错误
        else if (data.inventory_errors && Array.isArray(data.inventory_errors)) {
          systemMessage += `\n\n❌ 库存检查失败：\n`
          data.inventory_errors.forEach((error, idx) => {
            systemMessage += `${idx + 1}. ${error.product_name}：${error.error}\n` +
                `   需要：${error.required_weight}克\n` +
                `   可用：${error.available_weight}克\n`
            if (error.reserved_weight !== undefined) {
                systemMessage += `   已预留：${error.reserved_weight}克\n`
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
            systemMessage += `${idx + 1}. ${error.product_name}：${error.error}\n` +
                `   需要：${error.required_weight}克\n` +
                `   可用：${error.available_weight}克\n`
            if (error.reserved_weight !== undefined) {
                systemMessage += `   已预留：${error.reserved_weight}克\n`
            }
            systemMessage += `\n`
          })

          setMessages(prev => [...prev, {
            type: 'system',
            content: systemMessage,
            inventoryErrors: data.inventory_errors
          }])
        }
        // 其他成功响应
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

        // 处理库存检查错误（在错误响应中）
        if (data.inventory_errors && Array.isArray(data.inventory_errors)) {
          errorMessage += `\n\n❌ 库存检查失败：\n`
          data.inventory_errors.forEach((error, idx) => {
            errorMessage += `${idx + 1}. ${error.product_name}：${error.error}\n` +
                `   需要：${error.required_weight}克\n` +
                `   可用：${error.available_weight}克\n`
            if (error.reserved_weight !== undefined) {
                errorMessage += `   已预留：${error.reserved_weight}克\n`
            }
            if (error.total_weight !== undefined) {
                errorMessage += `   总库存：${error.total_weight}克\n`
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
          errorMessage += `\n\n📋 系统规则提醒：\n`
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
        content: `❌ 网络错误：${error.message}`
      }])
    }
  }

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // 语言选择页
  if (showLanguageSelector) {
    return <LanguageSelector onSelect={() => setShowLanguageSelector(false)} />
  }

  return (
    <div className="flex h-dvh bg-jewelry-gold-50 overflow-hidden">
      {/* 左侧边栏 - 历史对话记录 */}
      <ConversationSidebar
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        conversationHistory={conversationHistory}
        currentConversationId={currentConversationId}
        loadConversation={loadConversation}
        deleteConversation={deleteConversation}
        newConversation={newConversation}
        userRole={userRole}
      />

      {/* 主内容区域 */}
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
          <ChatView
            messages={messages}
            input={input}
            loading={loading}
            uploading={uploading}
            userRole={userRole}
            currentSessionId={currentSessionId}
            currentLanguage={currentLanguage}
            ocrResult={ocrResult}
            uploadedImage={uploadedImage}
            showOCRModal={showOCRModal}
            setInput={setInput}
            setMessages={setMessages}
            setCurrentPage={setCurrentPage}
            setShowOCRModal={setShowOCRModal}
            setOcrResult={setOcrResult}
            setUploadedImage={setUploadedImage}
            setShowQuickOrderModal={setShowQuickOrderModal}
            setShowQuickInboundModal={setShowQuickInboundModal}
            setShowQuickReturnModal={setShowQuickReturnModal}
            sendMessage={sendMessage}
            handleImageUpload={handleImageUpload}
            handlePaymentProofUpload={handlePaymentProofUpload}
            handleConfirmPaymentProof={handleConfirmPaymentProof}
            showPaymentProofModal={showPaymentProofModal}
            setShowPaymentProofModal={setShowPaymentProofModal}
            paymentProofData={paymentProofData}
            paymentProofImage={paymentProofImage}
            paymentProofLoading={paymentProofLoading}
            paymentProofInputRef={paymentProofInputRef}
            pendingAttachment={pendingAttachment}
            clearPendingAttachment={clearPendingAttachment}
            handleConfirmInbound={handleConfirmInbound}
            handleConfirmReceipt={handleConfirmReceipt}
            openReceiptEditModal={openReceiptEditModal}
            openQuickReceiptModal={openQuickReceiptModal}
            openQuickWithdrawalModal={openQuickWithdrawalModal}
            showToast={showToast}
            messagesEndRef={messagesEndRef}
            fileInputRef={fileInputRef}
            ocrTextareaRef={ocrTextareaRef}
            t={t}
          />
        )}

        {currentPage === 'finance' && (
          <div className="flex-1 overflow-y-auto">
            <FinancePage />
          </div>
        )}

        {currentPage === 'finance-closing' && (
          <div className="flex-1 overflow-y-auto">
            <FinanceClosing onNavigate={setCurrentPage} />
          </div>
        )}
        {currentPage === 'finance-admin' && (
          <div className="flex-1 overflow-y-auto">
            <FinanceAdminManagement onBack={() => setCurrentPage('voucher')} />
          </div>
        )}

        {currentPage === 'voucher' && (
          <div className="flex-1 overflow-y-auto">
            <VoucherManagement />
          </div>
        )}

        {currentPage === 'finance-settings' && (
          <div className="flex-1 overflow-y-auto">
            <FinanceSettings />
          </div>
        )}

        {currentPage === 'finance-reports' && (
          <div className="flex-1 overflow-y-auto">
            <FinanceReports />
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
                  }).catch(() => {})
                }

                // 切换回聊天页面
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

        {currentPage === 'sales-returns' && (
          <div className="flex-1 overflow-y-auto">
            <SalesReturnPage userRole={userRole} />
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

        {currentPage === 'label-design' && (
          <div className="flex-1 overflow-y-auto">
            <LabelDesignPage userRole={userRole} onBack={() => setCurrentPage('home')} />
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

            const fullOrder = result.order || {
              id: result.order_id,
              order_no: result.order_no,
              status: 'draft',
              customer_name: result.customer_name,
              salesperson: result.salesperson,
              store_code: null,
              order_date: new Date().toISOString(),
              total_weight: result.total_weight,
              total_labor_cost: result.total_labor_cost,
              details: (result.items || []).map((item) => ({
                product_name: item.product_name,
                weight: item.weight,
                labor_cost: item.labor_cost,
                total_labor_cost: (item.weight || 0) * (item.labor_cost || 0)
              }))
            }
            setMessages(prev => [...prev, {
              type: 'system',
              content: salesMessage,
              salesOrderId: result.order_id,
              salesOrderNo: result.order_no,
              salesOrder: fullOrder
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
              }).catch(() => {})
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
            const countInfo = result.total_count > 1 ? `\n📦 入库品类：${result.total_count}` : ''
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

            }
          }}
          userRole={userRole}
        />
      )}

      {/* 销售管理弹窗 - 柜台、结算、业务可用 */}
      {showSalesSearchModal && ['counter', 'settlement', 'sales'].includes(userRole) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"><SalesOrdersPage userRole={userRole} onClose={() => setShowSalesSearchModal(false)} /></div>
      )}

      {/* 销售单管理页面（带编辑ID跳转） */}
      {location.state?.salesOrderEdit && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <SalesOrdersPage 
            userRole={userRole} 
            onClose={() => { navigate('/', { state: {} }); }} 
            editOrderId={location.state.salesOrderEdit}
          />
        </div>
      )}

      {/* 历史回顾面板 - 所有角色可用 */}
      <ChatHistoryPanel
        isOpen={showHistoryPanel}
        onClose={() => setShowHistoryPanel(false)}
        userRole={userRole}
        onLoadSession={(sessionId, sessionMessages) => {
          // 加载历史对话到当前聊天
          if (sessionMessages && sessionMessages.length > 0) {
            const formattedMessages = sessionMessages.map(msg => ({
              type: msg.message_type === 'user' ? 'user' : 'system',  // 使用 type 和 system（与渲染逻辑一致）
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
      <InlineQuickReceiptModal
        showQuickReceiptModal={showQuickReceiptModal}
        setShowQuickReceiptModal={setShowQuickReceiptModal}
        quickReceiptForm={quickReceiptForm}
        setQuickReceiptForm={setQuickReceiptForm}
        quickFormCustomerSearch={quickFormCustomerSearch}
        setQuickFormCustomerSearch={setQuickFormCustomerSearch}
        quickFormCustomers={quickFormCustomers}
        filteredQuickFormCustomers={filteredQuickFormCustomers}
        handleQuickReceipt={handleQuickReceipt}
      />

      {/* 收料单编辑弹窗 */}
      <ReceiptEditModal
        showReceiptEditModal={showReceiptEditModal}
        setShowReceiptEditModal={setShowReceiptEditModal}
        editingReceiptId={editingReceiptId}
        setEditingReceiptId={setEditingReceiptId}
        editingReceiptMsgIdx={editingReceiptMsgIdx}
        setEditingReceiptMsgIdx={setEditingReceiptMsgIdx}
        receiptEditForm={receiptEditForm}
        setReceiptEditForm={setReceiptEditForm}
        receiptEditCustomerSearch={receiptEditCustomerSearch}
        setReceiptEditCustomerSearch={setReceiptEditCustomerSearch}
        receiptEditCustomers={receiptEditCustomers}
        filteredReceiptEditCustomers={filteredReceiptEditCustomers}
        handleReceiptEditSubmit={handleReceiptEditSubmit}
      />

      {/* 快捷提料弹窗 */}
      <InlineQuickWithdrawalModal
        showQuickWithdrawalModal={showQuickWithdrawalModal}
        setShowQuickWithdrawalModal={setShowQuickWithdrawalModal}
        quickWithdrawalForm={quickWithdrawalForm}
        setQuickWithdrawalForm={setQuickWithdrawalForm}
        quickFormCustomerSearch={quickFormCustomerSearch}
        setQuickFormCustomerSearch={setQuickFormCustomerSearch}
        quickFormCustomers={quickFormCustomers}
        filteredQuickFormCustomers={filteredQuickFormCustomers}
        selectedCustomerDeposit={selectedCustomerDeposit}
        depositLoading={depositLoading}
        fetchCustomerDeposit={fetchCustomerDeposit}
        handleQuickWithdrawal={handleQuickWithdrawal}
      />

      {/* Toast 通知容器 */}
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

