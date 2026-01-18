import { useState, useRef, useEffect } from 'react'
import React from 'react'
import { Toaster } from 'react-hot-toast'
import { Bar, Pie, Line, Doughnut } from 'react-chartjs-2'
import { API_ENDPOINTS, API_BASE_URL } from './config'
import { hasPermission, canAccessPage, getPermissionDeniedMessage } from './config/permissions'
import { JewelryInboundCardComponent } from './components/JewelryInboundCard'
import { createCardFromBackend, updateCard, createNewCard } from './utils/inboundHelpers'
import { confirmInbound, reportError } from './services/inboundService'
import { FinancePage } from './components/finance'
import { AnalyticsPage } from './components/AnalyticsPage'
import DashboardPage from './components/DashboardPage'
import { ExportPage } from './components/ExportPage'
import { WarehousePage } from './components/WarehousePage'
import { SettlementPage } from './components/SettlementPage'
import { SalespersonPage } from './components/SalespersonPage'
import { CustomerPage } from './components/CustomerPage'
import { QuickOrderModal } from './components/QuickOrderModal'
import { QuickReturnModal } from './components/QuickReturnModal'
import QuickInboundModal from './components/QuickInboundModal'
import InventoryOverview from './components/InventoryOverview'
import { SupplierPage } from './components/SupplierPage'
import ReturnPage from './components/ReturnPage'
import GoldMaterialPage from './components/GoldMaterialPage'
import ProductCodePage from './components/ProductCodePage'
import LineNumberedTextarea from './components/LineNumberedTextarea'
import { USER_ROLES } from './constants/roles'
import { DollarSign, ArrowLeft, ChevronDown, BarChart3, Download, Warehouse, Users, UserPlus, FileText, History, Building2, RotateCcw, Package, Calculator, Scale, TrendingUp } from 'lucide-react'
import { ChatHistoryPanel } from './components/ChatHistoryPanel'
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
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)  // 图片上传状态
  const messagesEndRef = useRef(null)
  const fileInputRef = useRef(null)  // 文件输入引用
  
  // OCR编辑对话框相关状态
  const [showOCRModal, setShowOCRModal] = useState(false)
  const [ocrResult, setOcrResult] = useState('')
  const [uploadedImage, setUploadedImage] = useState(null)
  const ocrTextareaRef = useRef(null)  // 用于自动聚焦
  
  // 历史对话记录相关状态
  const [conversationHistory, setConversationHistory] = useState([]) // 历史对话列表
  const [currentConversationId, setCurrentConversationId] = useState(null) // 当前对话ID
  
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
  const [conversationTitle, setConversationTitle] = useState('新对话') // 当前对话标题
  const [currentPage, setCurrentPage] = useState('chat') // 'chat', 'finance', 'warehouse', 'settlement', 'analytics', 'export'
  const [showQuickOrderModal, setShowQuickOrderModal] = useState(false) // 快捷开单弹窗
  const [showQuickReturnModal, setShowQuickReturnModal] = useState(false) // 快捷退货弹窗
  const [showQuickInboundModal, setShowQuickInboundModal] = useState(false) // 快捷入库弹窗
  const [showHistoryPanel, setShowHistoryPanel] = useState(false) // 历史回溯面板
  
  // 用户角色相关状态
  const [userRole, setUserRole] = useState(() => {
    // 从 localStorage 读取保存的角色，默认为业务员
    if (typeof window !== 'undefined') {
      return localStorage.getItem('userRole') || 'sales'
    }
    return 'sales'
  })
  const [roleDropdownOpen, setRoleDropdownOpen] = useState(false)
  const roleDropdownRef = useRef(null)
  
  // 待处理转移单数量（用于分仓库存按钮badge）
  const [pendingTransferCount, setPendingTransferCount] = useState(0)
  // 待结算销售单数量（用于结算管理按钮badge）
  const [pendingSalesCount, setPendingSalesCount] = useState(0)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // 获取当前角色的历史记录key
  const getHistoryKey = (role) => {
    return `conversationHistory_${role}`
  }

  // 加载指定角色的历史记录（从后端API获取并同步到localStorage）
  const loadRoleHistory = async (role) => {
    try {
      // 先从后端API获取该角色的会话列表
      const response = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/chat-sessions?user_role=${role}&limit=50`)
      const data = await response.json()
      
      if (data.success && data.sessions) {
        // 将后端会话数据转换为前端对话记录格式
        const history = data.sessions.map(session => ({
          id: session.session_id,
          title: session.summary || '新对话',
          messages: [], // 消息内容在加载时再获取
          createdAt: session.start_time || new Date().toISOString(),
          updatedAt: session.end_time || new Date().toISOString(),
          messageCount: session.message_count,
          lastIntent: session.last_intent
        }))
        
        // 同步到localStorage
        const historyKey = getHistoryKey(role)
        localStorage.setItem(historyKey, JSON.stringify(history))
        setConversationHistory(history)
        return history
      } else {
        // 如果API失败，从localStorage读取
        const historyKey = getHistoryKey(role)
        const history = JSON.parse(localStorage.getItem(historyKey) || '[]')
        setConversationHistory(history)
        return history
      }
    } catch (error) {
      console.error('从后端加载历史记录失败，使用本地缓存:', error)
      // 如果API失败，从localStorage读取
      const historyKey = getHistoryKey(role)
      const history = JSON.parse(localStorage.getItem(historyKey) || '[]')
      setConversationHistory(history)
      return history
    }
  }

  // 切换用户角色
  const changeUserRole = (roleId) => {
    // 如果切换到不同角色，保存当前对话并加载新角色的历史记录
    if (roleId !== userRole) {
      // 先保存当前角色的对话（如果有消息）
      if (messages.length > 0) {
        // 直接保存到当前角色的历史记录（不使用延迟保存）
        const currentHistoryKey = getHistoryKey(userRole)
        const currentHistory = JSON.parse(localStorage.getItem(currentHistoryKey) || '[]')
        
        // 自动生成对话标题
        let title = conversationTitle
        if (title === '新对话' || !currentConversationId) {
          const firstUserMessage = messages.find(m => m.type === 'user')
          if (firstUserMessage) {
            title = firstUserMessage.content.substring(0, 20) || '新对话'
            if (firstUserMessage.content.length > 20) title += '...'
          }
        }
        
        const conversation = {
          id: currentConversationId || Date.now().toString(),
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
        localStorage.setItem(currentHistoryKey, JSON.stringify(limitedHistory))
      }
      
      // 切换到新角色，加载新角色的历史记录
      loadRoleHistory(roleId)
      // 开始新对话
      newConversation()
    }
    setUserRole(roleId)
    localStorage.setItem('userRole', roleId)
    setRoleDropdownOpen(false)
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

  // 加载当前角色的历史对话记录
  useEffect(() => {
    loadRoleHistory(userRole)
  }, [userRole]) // 当角色变化时重新加载

  // 加载待处理转移单数量（柜台角色需要看到商品部发来的转移单）
  const loadPendingTransferCount = async () => {
    // 只有柜台、结算、管理层需要看到待接收转移单数量
    if (!['counter', 'settlement', 'manager'].includes(userRole)) {
      setPendingTransferCount(0)
      return
    }
    try {
      const response = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/warehouse/transfers?status=pending`)
      if (response.ok) {
        const transfers = await response.json()
        setPendingTransferCount(transfers.length)
      }
    } catch (error) {
      console.error('加载待处理转移单数量失败:', error)
    }
  }

  // 加载待结算销售单数量（结算专员需要看到柜台开的销售单）
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
      console.error('加载待结算销售单数量失败:', error)
    }
  }

  // 角色变化时加载待处理数量
  useEffect(() => {
    loadPendingTransferCount()
    loadPendingSalesCount()
    // 每60秒刷新一次
    const interval = setInterval(() => {
      loadPendingTransferCount()
      loadPendingSalesCount()
    }, 60000)
    return () => clearInterval(interval)
  }, [userRole])

  // 保存对话到历史记录（保存到当前角色的历史记录）
  const saveConversation = () => {
    if (messages.length === 0) return
    
    // 获取当前角色的历史记录key
    const historyKey = getHistoryKey(userRole)
    // 从localStorage获取当前角色的最新历史记录
    const history = JSON.parse(localStorage.getItem(historyKey) || '[]')
    
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
    
    const conversation = {
      id: currentConversationId || Date.now().toString(),
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
    localStorage.setItem(historyKey, JSON.stringify(limitedHistory))
    setConversationHistory(limitedHistory)
    setCurrentConversationId(conversation.id)
  }

  // 当消息变化时自动保存
  useEffect(() => {
    if (messages.length > 0) {
      // 延迟保存，避免频繁写入
      const timer = setTimeout(() => {
        saveConversation()
      }, 1000)
      return () => clearTimeout(timer)
    }
  }, [messages])

  // 加载指定对话（从后端API加载完整消息内容）
  const loadConversation = async (conversationId) => {
    try {
      // 从后端API获取该会话的完整消息
      const response = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/chat-history/${conversationId}`)
      const data = await response.json()
      
      if (data.success && data.messages) {
        // 将后端消息格式转换为前端消息格式
        const messages = data.messages.map(msg => ({
          type: msg.message_type === 'user' ? 'user' : 'system',  // assistant 消息显示为 system 类型
          content: msg.content || '',
          id: msg.id
        }))
        
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
        const history = JSON.parse(localStorage.getItem(historyKey) || '[]')
        const conversation = history.find(c => c.id === conversationId)
        if (conversation && conversation.messages) {
          setMessages(conversation.messages)
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
      console.error('加载对话失败，尝试从本地加载:', error)
      // 如果API失败，尝试从localStorage加载
      const historyKey = getHistoryKey(userRole)
      const history = JSON.parse(localStorage.getItem(historyKey) || '[]')
      const conversation = history.find(c => c.id === conversationId)
      if (conversation && conversation.messages) {
        setMessages(conversation.messages)
        setCurrentConversationId(conversation.id)
        setConversationTitle(conversation.title)
        if (window.innerWidth < 1024) {
          setSidebarOpen(false)
        } else {
          setSidebarOpen(true)
        }
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
    const history = conversationHistory.filter(c => c.id !== conversationId)
    localStorage.setItem(historyKey, JSON.stringify(history))
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
      console.log('发送流式请求到:', API_ENDPOINTS.CHAT_STREAM)
      console.log('请求消息:', userMessage)
      
      const response = await fetch(API_ENDPOINTS.CHAT_STREAM, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          message: userMessage, 
          user_role: userRole,
          session_id: currentSessionId  // 传递会话ID，确保同一对话的消息关联在一起
        }),
      })

      console.log('收到响应，状态码:', response.status)
      console.log('响应头:', {
        'Content-Type': response.headers.get('Content-Type'),
        'Cache-Control': response.headers.get('Cache-Control'),
        'Connection': response.headers.get('Connection'),
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error('响应错误，状态码:', response.status)
        console.error('错误内容:', errorText)
        throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`)
      }
      
      if (!response.body) {
        console.error('响应体为空!')
        throw new Error('响应体为空')
      }
      
      console.log('开始读取SSE流...')

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
            console.log(`SSE流结束，共收到 ${chunkCount} 个数据块`)
            setLoading(false)
            break
          }
          
          if (!value) {
            console.warn('收到空值，继续等待...')
            continue
          }

          chunkCount++
          if (chunkCount <= 3) {
            console.log(`收到第 ${chunkCount} 个数据块，长度: ${value.length} 字节`)
          }

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || '' // 保留不完整的行

          for (const line of lines) {
                  if (line.trim() === '') continue // 跳过空行
                  if (line.startsWith('data: ')) {
                    try {
                      const jsonStr = line.slice(6)
                      console.log('解析SSE JSON:', jsonStr) // 显示完整JSON
                      const data = JSON.parse(jsonStr)
                      console.log('收到SSE数据:', data) // 调试日志
                      // 特别检查 all_products
                      if (data.data?.all_products) {
                        console.log('【重要】检测到 all_products:', data.data.all_products)
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
                  isContentStarted = true
                  contentMessageId = Date.now()
                  setMessages(prev => [...prev, { 
                    id: contentMessageId,
                    type: 'system', 
                    content: '',
                    isStreaming: true
                  }])
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
                console.log('收到payment_confirm事件:', data)
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
              // 完成
              else if (data.type === 'complete') {
                console.log('收到complete事件:', data)
                setLoading(false)
                // 移除思考过程消息（如果存在）
                setMessages(prev => prev.filter(msg => msg.id !== thinkingMessageId))
                
                // 如果没有内容消息（比如入库操作直接返回结果），创建一个新消息
                if (!contentMessageId || !isContentStarted) {
                  console.log('创建新的系统消息来显示结果')
                  contentMessageId = Date.now()
                  // 处理入库等操作的响应
                  if (data.data) {
                    // ========== 智能表单弹出：当信息不完整时自动弹出表单 ==========
                    if (data.data.need_form) {
                      console.log('检测到need_form标志，弹出对应表单:', data.data.action)
                      
                      // 根据操作类型弹出对应的表单
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
                    
                    console.log('创建消息，内容:', messageContent)
                    
                    // 检查是否是入库操作，如果是则创建待确认的卡片数据
                    let inboundCard = null
                    let inboundCards = null  // 多商品入库时使用
                    // 打印完整的 data.data 对象
                    console.log('【入库调试】完整data.data:', JSON.stringify(data.data, null, 2))
                    console.log('【入库调试】all_products 是否存在:', 'all_products' in (data.data || {}))
                    console.log('【入库调试】all_products 值:', data.data?.all_products)
                    console.log('【入库调试】all_products 长度:', data.data?.all_products?.length)
                    
                    if (data.data?.success && data.data?.pending && data.data?.card_data) {
                      // 方案B：创建待确认的卡片（status: 'pending'）
                      try {
                        // 统一使用 all_products（如果没有则使用 card_data 作为单元素数组）
                        console.log('【调试】data.data.all_products 原始值:', data.data.all_products)
                        console.log('【调试】data.data.card_data 原始值:', data.data.card_data)
                        
                        const allProducts = data.data.all_products && data.data.all_products.length > 0 
                          ? data.data.all_products 
                          : [data.data.card_data]
                        console.log('收到待确认商品数据，共', allProducts.length, '个商品:', allProducts)
                        
                        // 统一创建卡片数组（无论单商品还是多商品）
                        inboundCards = allProducts.map((cardData, index) => {
                          console.log(`【调试】创建卡片${index+1}:`, cardData)
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
                        console.log('创建入库卡片，共', inboundCards.length, '张:', inboundCards)
                        
                        // 如果只有一个商品，同时设置 inboundCard（向后兼容）
                        if (inboundCards.length === 1) {
                          inboundCard = inboundCards[0]
                          inboundCards = null  // 单商品时清空数组，使用单卡片显示
                        }
                      } catch (error) {
                        console.error('创建入库卡片失败:', error)
                      }
                    } else if (data.data?.success && data.data?.order && data.data?.detail && !data.data?.pending) {
                      // 如果已经有订单和明细，且没有pending标志，说明是已确认的（向后兼容或直接入库的情况）
                      console.log('检测到已确认的入库数据（向后兼容）')
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
                          console.log('创建已确认入库卡片（向后兼容）:', inboundCard)
                        } catch (error) {
                          console.error('创建入库卡片失败:', error)
                        }
                      }
                    } else {
                      console.log('未匹配到入库卡片创建条件，数据:', data.data)
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
                      // 添加入库卡片数据（单商品或多商品）
                      inboundCard: inboundCard,
                      inboundCards: inboundCards,  // 多商品入库时的卡片数组
                    }])
                  } else {
                    console.warn('complete事件没有data字段')
                  }
                } else {
                  console.log('更新现有内容消息')
                  // 如果有内容消息，更新它
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
                      
                      // 如果是入库操作，创建卡片数据
                      if (data.data?.success && data.data?.order && data.data?.detail) {
                        const orderNo = data.data.order.order_no || ''
                        if (orderNo.startsWith('RK')) {
                          try {
                            const inboundCard = createCardFromBackend(data.data.detail, null)
                            inboundCard.orderNo = orderNo
                            inboundCard.orderId = data.data.order.id
                            if (!inboundCard.barcode) {
                              inboundCard.barcode = orderNo // 使用订单号作为条码
                            }
                            inboundCard.status = 'confirmed'
                            updatedMsg.inboundCard = inboundCard
                          } catch (error) {
                            console.error('创建入库卡片失败:', error)
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
                console.error('解析SSE数据失败:', e)
              }
            }
          }
        } catch (readError) {
          console.error('读取SSE流失败:', readError)
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
      setLoading(false)
      // 移除思考过程消息
      setMessages(prev => prev.filter(msg => msg.id !== thinkingMessageId))
      
      let errorMessage = `❌ 网络错误：${error.message}`
      
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
          systemMessage = "💭 处理过程：\n" + data.thinking_steps.join('\n') + "\n\n" + systemMessage
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
            `商品数量：${data.details.length}个\n\n`
          
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
            systemMessage += `\n💰 工费明细：\n`
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
        // 如果是查询所有库存（返回inventories数组）- 保留向后兼容
        else if (data.inventories && Array.isArray(data.inventories) && data.inventories.length > 0 && !data.action) {
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
            systemMessage += `\n💰 总库存：${data.total_weight.toFixed(2)}克`
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
          
          systemMessage += `\n💰 合计：\n` +
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
            `客户姓名：${data.customer.name}\n` +
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
          errorMessage = "💭 处理过程：\n" + data.thinking_steps.join('\n') + "\n\n" + errorMessage
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
      let errorMessage = `❌ 网络错误：${error.message}`
      
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
          content: `📷 上传入库单图片：${file.name}`,
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
          systemMessage += "💭 处理过程：\n" + data.thinking_steps.join('\n') + "\n\n"
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
          errorMessage = "💭 处理过程：\n" + data.thinking_steps.join('\n') + "\n\n" + errorMessage
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
          systemMessage = "💭 处理过程：\n" + data.thinking_steps.join('\n') + "\n\n" + systemMessage
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
            `商品数量：${data.details.length}个\n\n`
          
          data.details.forEach((detail, index) => {
            systemMessage += `商品${index + 1}：\n` +
              `  商品名称：${detail.product_category || detail.product_name}\n` +
              `  重量：${detail.weight}克\n` +
              `  工费：${detail.labor_cost}元/克\n` +
              `  供应商：${detail.supplier}\n` +
              `  该商品工费：${detail.total_cost.toFixed(2)}元\n\n`
          })
          
          systemMessage += `💰 合计工费：${data.total_labor_cost.toFixed(2)}元\n\n`
          
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
          
          systemMessage += `\n💰 合计：\n` +
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
            systemMessage += `\n💰 总库存：${data.total_weight.toFixed(2)}克`
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
          errorMessage = "💭 处理过程：\n" + data.thinking_steps.join('\n') + "\n\n" + errorMessage
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

  return (
    <div className="flex h-screen bg-[#f5f5f7] overflow-hidden">
      {/* 左侧边栏 - 历史对话记录 */}
      <aside className={`
        ${sidebarOpen ? 'w-80' : 'w-0'} 
        ${sidebarOpen ? 'flex' : 'hidden'}
        lg:!flex lg:w-80
        transition-all duration-300 ease-in-out
        bg-white border-r border-gray-200/60
        flex-col
        overflow-hidden
        shadow-[0_0_24px_rgba(0,0,0,0.08)]
      `}>
        {/* 侧边栏头部 */}
        <div className="px-6 py-5 border-b border-gray-200/60 flex items-center justify-between">
          <h2 className="text-[17px] font-semibold text-gray-900 tracking-tight">对话记录</h2>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        {/* 新建对话按钮 */}
        <div className="px-6 py-4 border-b border-gray-200/60">
          <button
            onClick={newConversation}
            className="w-full px-4 py-2.5 bg-[#007aff] text-white rounded-xl hover:bg-[#0051d5] 
                       transition-all duration-200 font-medium text-[15px] shadow-sm hover:shadow-md"
          >
            + 新建对话
          </button>
        </div>
        
        {/* 对话列表 */}
        <div className="flex-1 overflow-y-auto">
          {conversationHistory.length === 0 ? (
            <div className="px-6 py-8 text-center text-gray-400 text-sm">
              暂无对话记录
            </div>
          ) : (
            <div className="py-2">
              {conversationHistory.map((conv) => (
                <div
                  key={conv.id}
                  className={`
                    mx-3 mb-1 px-4 py-3 rounded-xl cursor-pointer
                    transition-all duration-200
                    ${currentConversationId === conv.id 
                      ? 'bg-[#007aff]/10 border border-[#007aff]/20' 
                      : 'hover:bg-gray-50 border border-transparent'
                    }
                    group
                  `}
                  onClick={() => loadConversation(conv.id)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="text-[15px] font-medium text-gray-900 truncate mb-1">
                        {conv.title}
                      </div>
                      <div className="text-xs text-gray-500">
                        {new Date(conv.updatedAt).toLocaleDateString('zh-CN', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </div>
                    </div>
                    {/* 只有管理员可以删除对话记录 */}
                    {userRole === 'manager' && (
                      <button
                        onClick={(e) => deleteConversation(conv.id, e)}
                        className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-100 rounded-lg transition-all"
                        title="删除对话"
                      >
                        <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* 主内容区域 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 顶部导航栏 - 苹果风格 */}
        <header className="bg-white/80 backdrop-blur-xl border-b border-gray-200/60 px-6 py-4 
                           sticky top-0 z-10 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              {/* 移动端侧边栏开关 */}
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="lg:hidden p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              
              <div 
                className="cursor-pointer hover:opacity-80 transition-opacity"
                onClick={() => setCurrentPage('chat')}
                title="点击返回首页"
              >
                <h1 className="text-[28px] font-semibold text-gray-900 tracking-tight">
                  珠宝ERP系统
                </h1>
                <p className="text-[13px] text-gray-500 mt-0.5">智能对话助手</p>
              </div>
            </div>
            
            {/* 右侧按钮区域 */}
            <div className="flex items-center space-x-3">
              {/* 角色选择器 */}
              <div className="relative" ref={roleDropdownRef}>
                <button
                  onClick={() => setRoleDropdownOpen(!roleDropdownOpen)}
                  className={`flex items-center space-x-2 px-3 py-2 rounded-xl border border-gray-200
                             hover:bg-gray-50 transition-all duration-200 font-medium text-[14px]
                             ${getCurrentRole().bg}`}
                >
                  {React.createElement(getCurrentRole().icon, { 
                    className: `w-4 h-4 ${getCurrentRole().color}` 
                  })}
                  <span className={getCurrentRole().color}>{getCurrentRole().name}</span>
                  <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-200 
                                          ${roleDropdownOpen ? 'rotate-180' : ''}`} />
                </button>
                
                {/* 下拉菜单 */}
                {roleDropdownOpen && (
                  <div className="absolute right-0 mt-2 w-44 bg-white rounded-xl shadow-lg border border-gray-100 
                                  py-2 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="px-3 py-2 text-xs text-gray-400 font-medium">选择角色</div>
                    {USER_ROLES.map((role) => {
                      const IconComponent = role.icon
                      const isActive = userRole === role.id
                      return (
                        <button
                          key={role.id}
                          onClick={() => changeUserRole(role.id)}
                          className={`w-full flex items-center space-x-3 px-3 py-2.5 text-left
                                     hover:bg-gray-50 transition-colors duration-150
                                     ${isActive ? role.bg : ''}`}
                        >
                          <IconComponent className={`w-4 h-4 ${role.color}`} />
                          <span className={`text-[14px] font-medium ${isActive ? role.color : 'text-gray-700'}`}>
                            {role.name}
                          </span>
                          {isActive && (
                            <span className="ml-auto">
                              <svg className={`w-4 h-4 ${role.color}`} fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* 导航按钮 */}
              {currentPage === 'chat' ? (
                <>
                  {/* 仪表盘按钮 - 管理层快速查看 */}
                  {hasPermission(userRole, 'canViewAnalytics') && (
                    <button
                      onClick={() => setCurrentPage('dashboard')}
                      className="flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-xl 
                                 hover:from-blue-600 hover:to-indigo-600 transition-all duration-200 font-medium text-[15px] 
                                 shadow-sm hover:shadow-md"
                    >
                      <TrendingUp className="w-4 h-4" />
                      <span>仪表盘</span>
                    </button>
                  )}
                  {/* 数据分析按钮 - 使用权限检查 */}
                  {hasPermission(userRole, 'canViewAnalytics') && (
                    <>
                      <button
                        onClick={() => setCurrentPage('analytics')}
                        className="flex items-center space-x-2 px-4 py-2 bg-purple-500 text-white rounded-xl 
                                   hover:bg-purple-600 transition-all duration-200 font-medium text-[15px] 
                                   shadow-sm hover:shadow-md"
                      >
                        <BarChart3 className="w-4 h-4" />
                        <span>数据分析</span>
                      </button>
                      <button
                        onClick={() => setCurrentPage('export')}
                        className="flex items-center space-x-2 px-4 py-2 bg-green-500 text-white rounded-xl 
                                   hover:bg-green-600 transition-all duration-200 font-medium text-[15px] 
                                   shadow-sm hover:shadow-md"
                      >
                        <Download className="w-4 h-4" />
                        <span>数据导出</span>
                      </button>
                    </>
                  )}
                  {/* 业务员管理按钮 - 使用权限检查 */}
                  {hasPermission(userRole, 'canManageSalespersons') && (
                    <button
                      onClick={() => setCurrentPage('salesperson')}
                      className="flex items-center space-x-2 px-4 py-2 bg-indigo-500 text-white rounded-xl 
                                 hover:bg-indigo-600 transition-all duration-200 font-medium text-[15px] 
                                 shadow-sm hover:shadow-md"
                    >
                      <Users className="w-4 h-4" />
                      <span>业务员管理</span>
                    </button>
                  )}
                  {/* 分仓库存按钮 - 柜台(接收) + 商品专员(转移) + 管理层 */}
                  {(hasPermission(userRole, 'canReceiveTransfer') || hasPermission(userRole, 'canTransfer')) && (
                    <button
                      onClick={() => setCurrentPage('warehouse')}
                      className="relative flex items-center space-x-2 px-4 py-2 bg-orange-500 text-white rounded-xl 
                                 hover:bg-orange-600 transition-all duration-200 font-medium text-[15px] 
                                 shadow-sm hover:shadow-md"
                    >
                      <Warehouse className="w-4 h-4" />
                      <span>分仓库存</span>
                      {/* 待处理转移单数量badge */}
                      {pendingTransferCount > 0 && (
                        <span className="absolute -top-2 -right-2 min-w-[20px] h-5 flex items-center justify-center 
                                         bg-red-500 text-white text-xs font-bold rounded-full px-1.5 
                                         shadow-lg animate-pulse">
                          {pendingTransferCount > 99 ? '99+' : pendingTransferCount}
                        </span>
                      )}
                    </button>
                  )}
                  {/* 结算管理按钮 - 使用权限检查 */}
                  {hasPermission(userRole, 'canCreateSettlement') && (
                    <button
                      onClick={() => setCurrentPage('settlement')}
                      className="relative flex items-center space-x-2 px-4 py-2 bg-cyan-500 text-white rounded-xl 
                                 hover:bg-cyan-600 transition-all duration-200 font-medium text-[15px] 
                                 shadow-sm hover:shadow-md"
                    >
                      <Calculator className="w-4 h-4" />
                      <span>结算管理</span>
                      {/* 待结算销售单数量badge */}
                      {pendingSalesCount > 0 && (
                        <span className="absolute -top-2 -right-2 min-w-[20px] h-5 flex items-center justify-center 
                                         bg-red-500 text-white text-xs font-bold rounded-full px-1.5 
                                         shadow-lg animate-pulse">
                          {pendingSalesCount > 99 ? '99+' : pendingSalesCount}
                        </span>
                      )}
                    </button>
                  )}
                  {/* 快捷开单按钮 - 使用权限检查 */}
                  {hasPermission(userRole, 'canCreateSales') && (
                    <button
                      onClick={() => setShowQuickOrderModal(true)}
                      className="flex items-center space-x-2 px-4 py-2 bg-emerald-500 text-white rounded-xl 
                                 hover:bg-emerald-600 transition-all duration-200 font-medium text-[15px] 
                                 shadow-sm hover:shadow-md"
                    >
                      <FileText className="w-4 h-4" />
                      <span>快捷开单</span>
                    </button>
                  )}
                  {/* 客户管理按钮 - 使用权限检查（查看或管理权限） */}
                  {(hasPermission(userRole, 'canViewCustomers') || hasPermission(userRole, 'canManageCustomers')) && (
                    <button
                      onClick={() => setCurrentPage('customer')}
                      className="flex items-center space-x-2 px-4 py-2 bg-teal-500 text-white rounded-xl 
                                 hover:bg-teal-600 transition-all duration-200 font-medium text-[15px] 
                                 shadow-sm hover:shadow-md"
                    >
                      <UserPlus className="w-4 h-4" />
                      <span>客户管理</span>
                    </button>
                  )}
                  {/* 供应商管理按钮 - 使用权限检查 */}
                  {hasPermission(userRole, 'canManageSuppliers') && (
                    <button
                      onClick={() => setCurrentPage('supplier')}
                      className="flex items-center space-x-2 px-4 py-2 bg-amber-500 text-white rounded-xl 
                                 hover:bg-amber-600 transition-all duration-200 font-medium text-[15px] 
                                 shadow-sm hover:shadow-md"
                    >
                      <Building2 className="w-4 h-4" />
                      <span>供应商管理</span>
                    </button>
                  )}
                  {/* 退货管理按钮 - 使用权限检查 */}
                  {(hasPermission(userRole, 'canReturnToSupplier') || hasPermission(userRole, 'canReturnToWarehouse')) && (
                    <button
                      onClick={() => setCurrentPage('returns')}
                      className="flex items-center space-x-2 px-4 py-2 bg-red-500 text-white rounded-xl 
                                 hover:bg-red-600 transition-all duration-200 font-medium text-[15px] 
                                 shadow-sm hover:shadow-md"
                    >
                      <RotateCcw className="w-4 h-4" />
                      <span>退货管理</span>
                    </button>
                  )}
                  {/* 金料管理按钮 - 料部和管理层可见 */}
                  {(hasPermission(userRole, 'canViewGoldMaterial') || hasPermission(userRole, 'canManageGoldMaterial')) && (
                    <button
                      onClick={() => setCurrentPage('gold-material')}
                      className="flex items-center space-x-2 px-4 py-2 bg-yellow-500 text-white rounded-xl 
                                 hover:bg-yellow-600 transition-all duration-200 font-medium text-[15px] 
                                 shadow-sm hover:shadow-md"
                    >
                      <Scale className="w-4 h-4" />
                      <span>金料管理</span>
                    </button>
                  )}
                  {/* 商品编码按钮 - 商品专员和管理层可见 */}
                  {hasPermission(userRole, 'canManageProductCodes') && (
                    <button
                      onClick={() => setCurrentPage('product-codes')}
                      className="flex items-center space-x-2 px-4 py-2 bg-amber-500 text-white rounded-xl 
                                 hover:bg-amber-600 transition-all duration-200 font-medium text-[15px] 
                                 shadow-sm hover:shadow-md"
                    >
                      <Package className="w-4 h-4" />
                      <span>商品编码</span>
                    </button>
                  )}
                  {/* 财务对账按钮 - 使用权限检查 */}
                  {hasPermission(userRole, 'canViewFinance') && (
                    <button
                      onClick={() => setCurrentPage('finance')}
                      className="flex items-center space-x-2 px-4 py-2 bg-[#007aff] text-white rounded-xl 
                                 hover:bg-[#0051d5] transition-all duration-200 font-medium text-[15px] 
                                 shadow-sm hover:shadow-md"
                    >
                      <DollarSign className="w-4 h-4" />
                      <span>财务对账</span>
                    </button>
                  )}
                  {/* 历史回溯按钮 - 所有角色都可用 */}
                  <button
                    onClick={() => setShowHistoryPanel(true)}
                    className="flex items-center space-x-2 px-4 py-2 bg-slate-600 text-white rounded-xl 
                               hover:bg-slate-700 transition-all duration-200 font-medium text-[15px] 
                               shadow-sm hover:shadow-md"
                  >
                    <History className="w-4 h-4" />
                    <span>历史回溯</span>
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setCurrentPage('chat')}
                  className="flex items-center space-x-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-xl 
                             hover:bg-gray-200 transition-all duration-200 font-medium text-[15px] 
                             shadow-sm hover:shadow-md"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>返回聊天</span>
                </button>
              )}
            </div>
          </div>
      </header>

        {/* 主内容区域 - 根据 currentPage 切换 */}
        {currentPage === 'chat' && (
          <>
            {/* 对话区域 - 苹果风格 */}
            <div className="flex-1 overflow-y-auto px-6 py-8">
          <div className="max-w-4xl mx-auto space-y-6">
        {messages.length === 0 && (
              <div className="text-center pt-20">
                <div className="inline-block p-6 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-3xl mb-6">
                  <svg className="w-16 h-16 text-[#007aff]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} 
                          d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>
            </div>
                <h2 className="text-[32px] font-semibold text-gray-900 mb-3 tracking-tight">
                  开始新的对话
                </h2>
                {/* 角色提示文字 */}
                <p className="text-[17px] text-gray-600 mb-8 max-w-md mx-auto">
                  {userRole === 'counter' && '试试说："帮我开一张销售单，客户张三，业务员李四，古法戒指 50克 工费8元"'}
                  {userRole === 'product' && '试试说："古法黄金戒指 100克 工费6元 供应商是金源珠宝，帮我做个入库"'}
                  {userRole === 'settlement' && '试试说："查看今天待结算的订单"'}
                  {userRole === 'finance' && '试试说："查看本月财务对账情况"'}
                  {userRole === 'sales' && '试试说："帮我查询张三今天的销售情况" 或 "王五有多少欠款"'}
                  {userRole === 'manager' && '试试说："查看今日销售数据汇总"'}
                </p>
                
                {/* 库存概览 - 商品专员、柜台、结算、管理层可见 */}
                {(userRole === 'product' || userRole === 'counter' || userRole === 'settlement' || userRole === 'manager') && (
                  <div className="max-w-2xl mx-auto mb-6">
                    <InventoryOverview userRole={userRole} />
          </div>
        )}

                {/* 角色快捷操作卡片 - 使用权限控制 */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl mx-auto">
                  
                  {/* 快速开单卡片 - 需要创建销售单权限 */}
                  {hasPermission(userRole, 'canCreateSales') && (
                    <div 
                      onClick={() => setShowQuickOrderModal(true)}
                      className="p-6 bg-white rounded-2xl border border-gray-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
                    >
                      <div className="text-2xl mb-3">🧾</div>
                      <h3 className="font-semibold text-gray-900 mb-2">快速开单</h3>
                      <p className="text-sm text-gray-600">创建销售单</p>
                    </div>
                  )}
                  
                  {/* 接收库存卡片 - 需要接收库存权限 */}
                  {hasPermission(userRole, 'canReceiveTransfer') && (
                    <div 
                      onClick={() => setCurrentPage('warehouse')}
                      className="p-6 bg-white rounded-2xl border border-gray-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
                    >
                      <div className="text-2xl mb-3">📥</div>
                      <h3 className="font-semibold text-gray-900 mb-2">接收库存</h3>
                      <p className="text-sm text-gray-600">接收从仓库转移的商品</p>
                    </div>
                  )}
                  
                  {/* 快捷入库卡片 - 需要入库权限 */}
                  {hasPermission(userRole, 'canInbound') && (
                    <div 
                      onClick={() => setShowQuickInboundModal(true)}
                      className="p-6 bg-white rounded-2xl border border-gray-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
                    >
                      <div className="text-2xl mb-3">📦</div>
                      <h3 className="font-semibold text-gray-900 mb-2">快捷入库</h3>
                      <p className="text-sm text-gray-600">表格形式批量入库</p>
                    </div>
                  )}
                  
                  {/* 库存转移卡片 - 需要转移权限 */}
                  {hasPermission(userRole, 'canTransfer') && (
                    <div 
                      onClick={() => setCurrentPage('warehouse')}
                      className="p-6 bg-white rounded-2xl border border-gray-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
                    >
                      <div className="text-2xl mb-3">📊</div>
                      <h3 className="font-semibold text-gray-900 mb-2">分仓库存</h3>
                      <p className="text-sm text-gray-600">管理仓库库存和转移</p>
                    </div>
                  )}
                  
                  {/* 快捷退货卡片 - 商品专员（退给供应商） */}
                  {hasPermission(userRole, 'canReturnToSupplier') && (
                    <div 
                      onClick={() => setShowQuickReturnModal(true)}
                      className="p-6 bg-white rounded-2xl border border-gray-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
                    >
                      <div className="text-2xl mb-3">🔄</div>
                      <h3 className="font-semibold text-gray-900 mb-2">快捷退货</h3>
                      <p className="text-sm text-gray-600">快速创建退货单（退给供应商）</p>
                    </div>
                  )}
                  
                  {/* 快捷退货卡片 - 柜台（退给商品部） */}
                  {hasPermission(userRole, 'canReturnToWarehouse') && (
                    <div 
                      onClick={() => setShowQuickReturnModal(true)}
                      className="p-6 bg-white rounded-2xl border border-gray-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
                    >
                      <div className="text-2xl mb-3">🔄</div>
                      <h3 className="font-semibold text-gray-900 mb-2">快捷退货</h3>
                      <p className="text-sm text-gray-600">快速创建退货单（退给商品部）</p>
                    </div>
                  )}
                  
                  {/* 结算管理卡片 - 需要创建结算单权限 */}
                  {hasPermission(userRole, 'canCreateSettlement') && (
                    <div 
                      onClick={() => setCurrentPage('settlement')}
                      className="p-6 bg-white rounded-2xl border border-gray-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
                    >
                      <div className="text-2xl mb-3">📋</div>
                      <h3 className="font-semibold text-gray-900 mb-2">待结算订单</h3>
                      <p className="text-sm text-gray-600">查看待结算的销售单</p>
                    </div>
                  )}
                  
                  {/* 客户管理卡片 - 需要查看或管理权限 */}
                  {(hasPermission(userRole, 'canViewCustomers') || hasPermission(userRole, 'canManageCustomers')) && (
                    <div 
                      onClick={() => setCurrentPage('customer')}
                      className="p-6 bg-white rounded-2xl border border-gray-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
                    >
                      <div className="text-2xl mb-3">👥</div>
                      <h3 className="font-semibold text-gray-900 mb-2">
                        {userRole === 'sales' ? '客户查询' : '客户管理'}
                      </h3>
                      <p className="text-sm text-gray-600">
                        {userRole === 'sales' 
                          ? '查询客户销售、退货、欠款、往来账目' 
                          : '管理客户信息'}
                      </p>
                    </div>
                  )}
                  
                  {/* 财务对账卡片 - 需要财务权限 */}
                  {hasPermission(userRole, 'canViewFinance') && (
                    <div 
                      onClick={() => setCurrentPage('finance')}
                      className="p-6 bg-white rounded-2xl border border-gray-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
                    >
                      <div className="text-2xl mb-3">💰</div>
                      <h3 className="font-semibold text-gray-900 mb-2">财务对账</h3>
                      <p className="text-sm text-gray-600">查看财务对账情况</p>
                    </div>
                  )}
                  
                  {/* 供应商管理卡片 - 需要供应商管理权限 */}
                  {hasPermission(userRole, 'canManageSuppliers') && (
                    <div 
                      onClick={() => setCurrentPage('supplier')}
                      className="p-6 bg-white rounded-2xl border border-gray-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
                    >
                      <div className="text-2xl mb-3">🏭</div>
                      <h3 className="font-semibold text-gray-900 mb-2">供应商管理</h3>
                      <p className="text-sm text-gray-600">管理供应商信息</p>
                    </div>
                  )}
                  
                  {/* 仪表盘卡片 - 管理层快速查看 */}
                  {hasPermission(userRole, 'canViewAnalytics') && (
                    <div 
                      onClick={() => setCurrentPage('dashboard')}
                      className="p-6 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl border border-blue-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
                    >
                      <div className="text-2xl mb-3">📈</div>
                      <h3 className="font-semibold text-gray-900 mb-2">数据仪表盘</h3>
                      <p className="text-sm text-gray-600">今日销售、业绩排行</p>
                    </div>
                  )}
                  
                  {/* 数据分析卡片 - 需要数据分析权限 */}
                  {hasPermission(userRole, 'canViewAnalytics') && (
                    <div 
                      onClick={() => setCurrentPage('analytics')}
                      className="p-6 bg-white rounded-2xl border border-gray-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
                    >
                      <div className="text-2xl mb-3">📊</div>
                      <h3 className="font-semibold text-gray-900 mb-2">数据分析</h3>
                      <p className="text-sm text-gray-600">查看业务数据分析</p>
                    </div>
                  )}
                  
                  {/* 数据导出卡片 - 需要数据导出权限 */}
                  {hasPermission(userRole, 'canExport') && (
                    <div 
                      onClick={() => setCurrentPage('export')}
                      className="p-6 bg-white rounded-2xl border border-gray-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
                    >
                      <div className="text-2xl mb-3">📥</div>
                      <h3 className="font-semibold text-gray-900 mb-2">数据导出</h3>
                      <p className="text-sm text-gray-600">导出各类数据报表</p>
                    </div>
                  )}
                  
                  {/* 金料管理卡片 - 料部和管理层 */}
                  {(hasPermission(userRole, 'canViewGoldMaterial') || hasPermission(userRole, 'canManageGoldMaterial')) && (
                    <div 
                      onClick={() => setCurrentPage('gold-material')}
                      className="p-6 bg-white rounded-2xl border border-gray-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
                    >
                      <div className="text-2xl mb-3">⚖️</div>
                      <h3 className="font-semibold text-gray-900 mb-2">金料管理</h3>
                      <p className="text-sm text-gray-600">金料台账、收料、付料</p>
                    </div>
                  )}
                  
                  {/* 商品编码管理卡片 - 商品专员和管理层 */}
                  {hasPermission(userRole, 'canManageProductCodes') && (
                    <div 
                      onClick={() => setCurrentPage('product-codes')}
                      className="p-6 bg-white rounded-2xl border border-gray-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
                    >
                      <div className="text-2xl mb-3">🏷️</div>
                      <h3 className="font-semibold text-gray-900 mb-2">商品编码</h3>
                      <p className="text-sm text-gray-600">管理F编码、FL编码</p>
                    </div>
                  )}
                  
                  {/* 创建付料单卡片 - 料部 */}
                  {hasPermission(userRole, 'canCreateGoldPayment') && (
                    <div 
                      onClick={() => {
                        setCurrentPage('gold-material');
                        // 可以通过状态控制打开创建付料单弹窗
                      }}
                      className="p-6 bg-white rounded-2xl border border-gray-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
                    >
                      <div className="text-2xl mb-3">📝</div>
                      <h3 className="font-semibold text-gray-900 mb-2">创建付料单</h3>
                      <p className="text-sm text-gray-600">支付供应商金料</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {messages.map((msg, idx) => {
              // 思考过程消息
              if (msg.type === 'thinking' && msg.steps) {
                return (
                  <div key={msg.id || idx} className="flex justify-start">
                    <div className="bg-white rounded-3xl px-5 py-4 shadow-sm border border-gray-200/60 max-w-2xl">
                      {/* 进度条 */}
                      {msg.steps.length > 0 && (
                        <div className="mb-3">
                          <div className="flex justify-between text-xs text-gray-600 mb-1">
                            <span>处理进度</span>
                            <span>{msg.steps[msg.steps.length - 1]?.progress || 0}%</span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-1.5">
                            <div 
                              className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
                              style={{ width: `${msg.steps[msg.steps.length - 1]?.progress || 0}%` }}
                            ></div>
                          </div>
                        </div>
                      )}
                      
                      {/* 思考步骤 */}
                      <div className="space-y-2">
                        {msg.steps.map((step, stepIdx) => (
                          <div key={stepIdx} className="flex items-start space-x-3">
                            <div className={`w-2 h-2 rounded-full mt-2 ${
                              step.status === 'complete' 
                                ? 'bg-green-500' 
                                : 'bg-blue-500 animate-pulse'
                            }`}></div>
                            <div className="flex-1">
                              <div className="text-sm font-medium text-gray-700">{step.step}</div>
                              <div className="text-sm text-gray-500">{step.message}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )
              }
              
              // 收款确认卡片
              if (msg.type === 'payment_confirm' && msg.paymentData) {
                const pd = msg.paymentData
                return (
                  <div key={msg.id || idx} className="flex justify-start">
                    <div className="bg-white rounded-2xl shadow-lg border border-orange-200 max-w-md overflow-hidden">
                      {/* 标题栏 */}
                      <div className="bg-gradient-to-r from-orange-500 to-amber-500 px-5 py-3">
                        <div className="flex items-center gap-2 text-white">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span className="font-semibold">确认登记收款</span>
                        </div>
                      </div>
                      
                      {/* 内容区 */}
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
                            <span className="text-gray-600">当前欠款</span>
                            <span className="font-medium text-gray-900">¥{pd.current_debt?.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-600">本次收款</span>
                            <span className="font-bold text-orange-600 text-lg">¥{pd.payment_amount?.toFixed(2)}</span>
                          </div>
                          <div className="border-t border-gray-200 pt-2 flex justify-between text-sm">
                            <span className="text-gray-600">收款后欠款</span>
                            <span className="font-medium text-green-600">¥{pd.balance_after?.toFixed(2)}</span>
                          </div>
                        </div>
                        
                        {/* 收款方式 */}
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
                                  setMessages(prev => prev.map(m => 
                                    m.id === msg.id 
                                      ? { ...m, type: 'system', content: `✅ 收款登记成功！\n\n客户：${pd.customer.name}\n收款金额：¥${pd.payment_amount.toFixed(2)}\n收款方式：${pd.payment_method}\n收款后欠款：¥${pd.balance_after.toFixed(2)}` }
                                      : m
                                  ))
                                } else {
                                  alert('收款登记失败：' + (result.error || '未知错误'))
                                }
                              } catch (error) {
                                console.error('收款登记失败:', error)
                                alert('收款登记失败：' + error.message)
                              }
                            }}
                            className="flex-1 bg-orange-500 hover:bg-orange-600 text-white font-medium py-2.5 px-4 rounded-xl transition-colors"
                          >
                            确认登记
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
                      {/* 标题栏 */}
                      <div className="bg-gradient-to-r from-yellow-500 to-amber-500 px-5 py-3">
                        <div className="flex items-center gap-2 text-white">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                          </svg>
                          <span className="font-semibold">确认开具收料单</span>
                        </div>
                      </div>
                      
                      {/* 内容区 */}
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
                                      ? { ...m, type: 'system', content: `✅ 收料单创建成功！\n\n单号：${result.data.receipt_no}\n客户：${rd.customer.name}\n克重：${rd.gold_weight.toFixed(2)}克\n成色：${rd.gold_fineness}` }
                                      : m
                                  ))
                                  // 打开打印页面
                                  if (result.data.id) {
                                    window.open(`${API_BASE_URL}/api/gold-material/gold-receipts/${result.data.id}/print`, '_blank')
                                  }
                                } else {
                                  const error = await response.json()
                                  alert('收料单创建失败：' + (error.detail || '未知错误'))
                                }
                              } catch (error) {
                                console.error('收料单创建失败:', error)
                                alert('收料单创建失败：' + error.message)
                              }
                            }}
                            className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-white font-medium py-2.5 px-4 rounded-xl transition-colors"
                          >
                            确认并打印
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
              
              // 用户消息
              if (msg.type === 'user') {
                return (
                  <div key={msg.id || idx} className="flex justify-end">
                    <div className="bg-[#007aff] text-white rounded-3xl px-5 py-4 shadow-sm max-w-2xl">
                      <div className="text-[15px] leading-relaxed whitespace-pre-wrap">{msg.content}</div>
                    </div>
                  </div>
                )
              }
              
              // 系统消息（流式内容或普通内容）
              if (msg.type === 'system') {
                return (
                  <React.Fragment key={msg.id || idx}>
                    <div className="flex justify-start">
                      <div className={`
                        ${msg.id ? 'max-w-2xl' : 'max-w-[85%] md:max-w-[75%]'}
                        rounded-3xl px-5 py-4 shadow-sm border border-gray-200/60 bg-white
                      `}>
                        <div className="text-[15px] leading-relaxed whitespace-pre-wrap text-gray-800">
                          {/* 隐藏内容中的特殊标记 */}
                          {msg.content?.replace(/\n*<!-- (RETURN_ORDER|INBOUND_ORDER|SALES_ORDER|SETTLEMENT_ORDER|CUSTOMER_DEBT):[^>]+ -->/g, '')}
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
                        {/* 退货单操作按钮 - 支持从对象或从内容解析 */}
                        {(() => {
                          // 尝试从消息对象获取，或从内容中解析隐藏标记
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
                          // 尝试从消息对象获取，或从内容中解析隐藏标记
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
                          // 尝试从消息对象获取，或从内容中解析隐藏标记
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
                          // 尝试从消息对象获取，或从内容中解析隐藏标记
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
                              {/* 重新结算按钮 - 仅结算专员和管理层可见 */}
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
                                        // 跳转到结算管理页面
                                        setCurrentPage('settlement')
                                      } else {
                                        const error = await response.json()
                                        alert('撤销失败：' + (error.detail || '未知错误'))
                                      }
                                    } catch (error) {
                                      console.error('撤销结算单失败:', error)
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
                        {/* 客户账务下载按钮 - 从内容中解析隐藏标记 */}
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
              </div>
            </div>
            {/* 工费明细表格（单个商品查询） */}
            {msg.laborCostDetails && msg.laborCostDetails.length > 0 && (
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
                                // 方案B：调用真实的入库API
                                console.log('确认入库:', card)
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
                                  // 不使用Mock模式，确保获取真实的orderId
                                  const useMock = false
                                  const result = await confirmInbound(card, useMock)
                                  
                                  console.log('确认入库结果:', result)
                                  console.log('订单ID:', result.order?.id)
                                  console.log('订单号:', result.order?.order_no)
                                  
                                  // 更新卡片状态和订单信息
                                  setMessages(prev => prev.map(m => {
                                    if (m.id === msg.id) {
                                      const updatedCard = updateCard(card, { 
                                        status: 'confirmed',
                                        orderNo: result.order?.order_no || card.orderNo,
                                        orderId: result.order?.id || card.orderId,
                                        barcode: result.order?.order_no || card.barcode || '',
                                      })
                                      console.log('更新后的卡片:', updatedCard)
                                      console.log('更新后的orderId:', updatedCard.orderId)
                                      return { ...m, inboundCard: updatedCard }
                                    }
                                    return m
                                  }))
                                } catch (error) {
                                  console.error('确认入库失败:', error)
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
                                console.log('报告入库数据错误:', card, errorReason)
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
                    {/* 多商品入库卡片展示 */}
                    {msg.inboundCards && msg.inboundCards.length > 0 && (
                      <div className="flex justify-start mt-2">
                        <div className="max-w-4xl w-full space-y-4">
                          <div className="text-sm text-gray-600 mb-2 font-medium">
                            共 {msg.inboundCards.length} 个商品待入库
                          </div>
                          {msg.inboundCards.map((card, cardIndex) => (
                            <div key={card.id || cardIndex} className="border-l-4 border-amber-400 pl-3">
                              <JewelryInboundCardComponent
                                data={card}
                                actions={{
                                  onConfirm: async (cardToConfirm) => {
                                    console.log('确认入库单个商品:', cardToConfirm)
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
                                      
                                      console.log('确认入库结果:', result)
                                      
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
                                      console.error('确认入库失败:', error)
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
                                    console.log('报告入库数据错误:', cardToReport, errorReason)
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
                                  console.log('批量确认入库')
                                  const { confirmInbound } = await import('./services/inboundService')
                                  
                                  for (let i = 0; i < msg.inboundCards.length; i++) {
                                    const card = msg.inboundCards[i]
                                    if (card.status !== 'pending') continue
                                    
                                    try {
                                      // 更新状态为处理中
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
                                      
                                      // 更新状态为已确认
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
                                      console.error('批量入库失败:', error)
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
                                ✓ 全部确认入库
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
                                msg.salesOrder.status === '已结算' ? 'text-green-600' : 
                                msg.salesOrder.status === '待结算' ? 'text-yellow-600' : 
                                'text-gray-600'
                              }`}>
                                {msg.salesOrder.status}
                              </span>
                            </div>
                          </div>
                          {/* 商品明细表格 */}
                          {msg.salesOrder.details && msg.salesOrder.details.length > 0 && (
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
                    {/* 库存检查错误提示卡片 */}
                    {msg.inventoryErrors && msg.inventoryErrors.length > 0 && (
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
            {/* 图表展示 */}
            {msg.chartData && (
                      <div className="flex justify-start mt-2">
                        <div className="max-w-5xl w-full bg-white rounded-2xl shadow-sm border border-gray-200/60 p-6">
                          {/* 图表网格布局 */}
                          <div className={`grid gap-6 ${msg.pieData ? 'md:grid-cols-2' : 'grid-cols-1'}`}>
                            {/* 柱状图/折线图 */}
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
                                            return '供应商对比分析（柱状图）'
                                          } else if (msg.chartType === '查询库存') {
                                            return '📊 库存统计图表'
                                          }
                                          return '数据统计图表'
                                        })(),
                                        font: { size: 14, weight: 'bold' }
                        },
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
                  
                            {/* 环形图（替代饼图，更现代） */}
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
                                            return '🍩 供应商占比分布'
                                          }
                                          return '🍩 库存占比分布'
                                        })(),
                                        font: { size: 14, weight: 'bold' }
                                      },
                                    },
                                    cutout: '50%',
                        }} 
                      />
                    </div>
                  )}
                      </div>
                </div>
              </div>
            )}
                  </React.Fragment>
                )
              }
              
              return null
            })}

        {(loading || uploading) && (
          <div className="flex justify-start">
                <div className="bg-white rounded-3xl px-5 py-4 shadow-sm border border-gray-200/60">
              <div className="flex space-x-2">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
          </div>
      </div>

      {/* OCR识别编辑对话框 */}
      {showOCRModal && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-2 sm:p-4"
          onClick={(e) => {
            // 点击背景关闭对话框
            if (e.target === e.currentTarget) {
              setShowOCRModal(false)
              setOcrResult('')
              setUploadedImage(null)
            }
          }}
        >
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col">
            {/* 对话框标题栏 */}
            <div className="px-4 sm:px-6 py-4 border-b flex justify-between items-center bg-gray-50">
              <div className="flex items-center space-x-2">
                <span className="text-2xl">📝</span>
                <h2 className="text-lg sm:text-xl font-semibold text-gray-800">
                  审核并编辑识别内容
                </h2>
              </div>
              <button
                onClick={() => {
                  setShowOCRModal(false)
                  setOcrResult('')
                  setUploadedImage(null)
                }}
                className="text-gray-400 hover:text-gray-600 text-3xl font-light w-8 h-8 flex items-center justify-center transition-colors"
                title="关闭"
              >
                ×
              </button>
            </div>
            
            {/* 对话框内容区域 */}
            <div className="flex-1 overflow-hidden flex flex-col sm:flex-row">
              {/* 左侧：图片预览（桌面端显示，移动端隐藏或折叠） */}
              {uploadedImage && (
                <div className="hidden sm:block w-80 border-r bg-gray-50 p-4 overflow-y-auto">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">原始图片</h3>
                  <div className="bg-white rounded-lg p-2 shadow-sm">
                    <img 
                      src={uploadedImage} 
                      alt="上传的入库单" 
                      className="w-full h-auto rounded border border-gray-200"
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-3">
                    请对照图片检查识别内容是否正确
                  </p>
                </div>
              )}
              
              {/* 右侧：编辑区域 */}
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* 提示信息 */}
                <div className="px-4 sm:px-6 py-3 sm:py-4 border-b bg-blue-50">
                  <p className="text-xs sm:text-sm text-blue-800 font-medium mb-1">
                    ⚠️ 请检查并编辑识别内容，确认无误后点击"确认入库"
                  </p>
                  <ul className="text-xs text-blue-700 list-disc list-inside space-y-0.5 mt-2">
                    <li>检查商品名称是否正确</li>
                    <li>检查重量、工费、供应商等信息</li>
                    <li>可以手动编辑修改内容</li>
                  </ul>
                </div>
                
                {/* 文本编辑区域 */}
                <div className="flex-1 p-4 sm:p-6 overflow-y-auto">
                  <LineNumberedTextarea
                    ref={ocrTextareaRef}
                    value={ocrResult}
                    onChange={(e) => setOcrResult(e.target.value)}
                    placeholder="识别出的文字内容将显示在这里..."
                    className="min-h-[300px]"
                  />
                </div>
              </div>
            </div>
            
            {/* 移动端图片预览（可选，在编辑区域下方显示） */}
            {uploadedImage && (
              <div className="sm:hidden border-t bg-gray-50 p-4 max-h-48 overflow-y-auto">
                <h3 className="text-xs font-semibold text-gray-700 mb-2">原始图片</h3>
                <img 
                  src={uploadedImage} 
                  alt="上传的入库单" 
                  className="w-full h-auto rounded border border-gray-200"
                />
              </div>
            )}
            
            {/* 对话框底部按钮 */}
            <div className="px-4 sm:px-6 py-4 border-t bg-gray-50 flex flex-col sm:flex-row justify-end space-y-2 sm:space-y-0 sm:space-x-4">
              <button
                onClick={() => {
                  setShowOCRModal(false)
                  setOcrResult('')
                  setUploadedImage(null)
                }}
                className="w-full sm:w-auto px-6 py-2.5 border border-gray-300 rounded-lg text-gray-700 hover:bg-white transition-colors font-medium order-2 sm:order-1"
              >
                取消
              </button>
              <button
                onClick={handleConfirmInbound}
                disabled={loading || !ocrResult.trim()}
                className="w-full sm:w-auto px-8 py-2.5 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium order-1 sm:order-2"
              >
                {loading ? '处理中...' : '确认入库'}
              </button>
            </div>
          </div>
        </div>
      )}

        {/* 输入区域 - 苹果风格 */}
        <footer className="bg-white/80 backdrop-blur-xl border-t border-gray-200/60 px-6 py-5">
          <div className="max-w-4xl mx-auto">
            <div className="flex items-end space-x-3">
              {/* 快捷入库按钮 - 仅商品专员可见 */}
              {userRole === 'product' && (
                <button
                  onClick={() => setShowQuickInboundModal(true)}
                  disabled={loading || uploading}
                  className={`
                    px-3 py-3 rounded-2xl cursor-pointer transition-all duration-200
                    h-[52px] flex items-center font-medium text-[14px]
                    ${loading || uploading
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'bg-orange-500 text-white hover:bg-orange-600 shadow-sm hover:shadow-md'
                    }
                  `}
                  title="快捷入库"
                >
                  📦 入库
                </button>
              )}

              {/* 快速开单按钮 - 仅柜台可见（结算专员不需要） */}
              {userRole === 'counter' && (
                <button
                  onClick={() => setShowQuickOrderModal(true)}
                  disabled={loading || uploading}
                  className={`
                    px-3 py-3 rounded-2xl cursor-pointer transition-all duration-200
                    h-[52px] flex items-center font-medium text-[14px]
                    ${loading || uploading
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'bg-blue-500 text-white hover:bg-blue-600 shadow-sm hover:shadow-md'
                    }
                  `}
                  title="快速开单"
                >
                  📝 开单
                </button>
              )}

              {/* 快捷退货按钮 - 商品专员和柜台可见 */}
              {(userRole === 'product' || userRole === 'counter') && (
                <button
                  onClick={() => setShowQuickReturnModal(true)}
                  disabled={loading || uploading}
                  className={`
                    px-3 py-3 rounded-2xl cursor-pointer transition-all duration-200
                    h-[52px] flex items-center font-medium text-[14px]
                    ${loading || uploading
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'bg-red-500 text-white hover:bg-red-600 shadow-sm hover:shadow-md'
                    }
                  `}
                  title="快捷退货"
                >
                  ↩️ 退货
                </button>
              )}

          {/* 图片上传按钮 */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            className="hidden"
            id="image-upload"
            disabled={loading || uploading}
          />
          <label
            htmlFor="image-upload"
                className={`
                  px-4 py-3 rounded-2xl cursor-pointer transition-all duration-200
                  h-[52px] flex items-center font-medium text-[15px]
                  ${loading || uploading
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'bg-[#34c759] text-white hover:bg-[#28a745] shadow-sm hover:shadow-md'
                  }
                `}
              >
                {uploading ? '📷 识别中...' : '📷'}
          </label>

              <div className="flex-1 relative">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                sendMessage()
              }
            }}
            placeholder="输入您的指令...（Shift+Enter换行）"
            rows={1}
                  className="w-full px-5 py-4 border-2 border-gray-200 rounded-2xl 
                             focus:outline-none focus:border-[#007aff] focus:ring-4 focus:ring-blue-500/10
                             resize-none min-h-[52px] max-h-[200px] overflow-y-auto
                             text-[15px] bg-white transition-all duration-200"
            disabled={loading || uploading}
            onInput={(e) => {
              const target = e.target
              target.style.height = 'auto'
              target.style.height = Math.min(target.scrollHeight, 200) + 'px'
            }}
          />
              </div>
              
          <button
            onClick={sendMessage}
            disabled={loading || uploading || !input.trim()}
                className={`
                  px-6 py-3 rounded-2xl font-medium text-[15px] h-[52px]
                  transition-all duration-200 shadow-sm hover:shadow-md
                  ${loading || uploading || !input.trim()
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    : 'bg-[#007aff] text-white hover:bg-[#0051d5]'
                  }
                `}
          >
            发送
          </button>
            </div>
        </div>
      </footer>
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
                const itemsList = data.details.map((item, idx) => 
                  `${idx + 1}. ${item.product_name}：${item.weight}克 × ¥${item.labor_cost}/克 = ¥${item.total_labor_cost.toFixed(2)}`
                ).join('\n')
                
                const paymentMethodStr = data.payment_method === 'cash_price' ? '结价' : 
                          data.payment_method === 'mixed' ? '混合支付' : '结料'
                
                const settlementMessage = `✅ **结算单确认成功**

📋 **结算单号**：${data.settlement_no}
👤 **客户**：${data.customer_name}
🧑‍💼 **业务员**：${data.salesperson}
💳 **支付方式**：${paymentMethodStr}

📦 **商品明细**：
${itemsList}

📊 **汇总**：
- 总克重：${data.total_weight.toFixed(2)}克
- 工费合计：¥${data.labor_amount.toFixed(2)}
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
                  }).catch(err => console.error('保存结算单消息失败:', err))
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

        {currentPage === 'product-codes' && (
          <div className="flex-1 overflow-y-auto">
            <ProductCodePage userRole={userRole} />
          </div>
        )}

        {currentPage === 'dashboard' && (
          <div className="flex-1 overflow-y-auto">
            <DashboardPage />
          </div>
        )}
      </div>

      {/* 快捷开单弹窗 - 仅柜台可用（结算专员不需要） */}
      {userRole === 'counter' && (
        <QuickOrderModal
          isOpen={showQuickOrderModal}
          onClose={() => setShowQuickOrderModal(false)}
          onSuccess={(result) => {
            // 开单成功后在聊天框显示销售单明细
            const itemsList = result.items.map((item, idx) => 
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
              }).catch(err => console.error('保存销售单消息失败:', err))
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
            // 构建退货成功的消息内容（包含隐藏的ID标记，用于历史记录中显示打印按钮）
            const returnMessage = `✅ **退货单创建成功**\n\n📋 单号：${result.return_no}\n📦 商品名称：${result.product_name}\n⚖️ 退货克重：${result.return_weight}克\n📝 退货原因：${result.return_reason}${result.supplier_name ? `\n🏭 供应商：${result.supplier_name}` : ''}${result.from_location_name ? `\n📍 发起位置：${result.from_location_name}` : ''}\n\n<!-- RETURN_ORDER:${result.return_id}:${result.return_no} -->`
            
            // 添加到聊天记录显示（包含退货单信息，用于下载/打印）
            setMessages(prev => [...prev, {
              type: 'system',
              content: returnMessage,
              returnOrder: {
                id: result.return_id,
                return_no: result.return_no
              }
            }])
            
            // 保存到后端聊天历史（包含ID标记）
            try {
              await fetch(`${API_BASE_URL}/api/chat-logs/message?session_id=${encodeURIComponent(currentSessionId)}&message_type=assistant&content=${encodeURIComponent(returnMessage)}&user_role=${userRole}&intent=退货`, {
                method: 'POST'
              })
            } catch (error) {
              console.error('保存退货记录到聊天历史失败:', error)
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
            // 构建入库成功的消息内容（包含隐藏的ID标记，用于历史记录中显示打印按钮）
            const productList = result.products.slice(0, 5).map(p => {
              let info = `  • ${p.name}：${p.weight}克 (工费¥${p.labor_cost}/g)`
              const pieceCount = parseInt(p.piece_count) || 0
              const pieceLaborCost = parseFloat(p.piece_labor_cost) || 0
              if (pieceCount > 0) {
                info += ` [${pieceCount}件, 件工费¥${pieceLaborCost}]`
              }
              return info
            }).join('\n')
            const moreProducts = result.products.length > 5 ? `\n  ... 等共 ${result.products.length} 件商品` : ''
            // 只在有多件商品时显示件数，单件只显示克重
            const countInfo = result.total_count > 1 ? `\n📦 入库数量：${result.total_count} 件` : ''
            const inboundMessage = `✅ **入库成功**${result.order_no ? `\n\n📋 单号：${result.order_no}` : ''}\n🏭 供应商：${result.supplier_name || '未指定'}${countInfo}\n⚖️ 总克重：${result.total_weight.toFixed(2)}克\n💰 总工费：¥${result.total_labor_cost.toFixed(2)}\n\n📋 商品明细：\n${productList}${moreProducts}${result.order_id ? `\n\n<!-- INBOUND_ORDER:${result.order_id}:${result.order_no} -->` : ''}`
            
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
              console.error('保存入库记录到聊天历史失败:', error)
            }
          }}
          userRole={userRole}
        />
      )}

      {/* 历史回溯面板 - 所有角色可用 */}
      <ChatHistoryPanel
        isOpen={showHistoryPanel}
        onClose={() => setShowHistoryPanel(false)}
        userRole={userRole}
        onLoadSession={(sessionId, messages) => {
          // 加载历史对话到当前聊天
          if (messages && messages.length > 0) {
            const formattedMessages = messages.map(msg => ({
              type: msg.message_type === 'user' ? 'user' : 'system',  // 使用 type 和 system（与渲染逻辑一致）
              content: msg.content,
              timestamp: msg.created_at
            }))
            setMessages(formattedMessages)
            
            // 设置当前 session_id，确保后续消息继续使用相同的会话
            setCurrentSessionId(sessionId)
            localStorage.setItem('current_session_id', sessionId)
            setCurrentConversationId(sessionId)
            
            setShowHistoryPanel(false)
          }
        }}
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
    </div>
  )
}

export default App

