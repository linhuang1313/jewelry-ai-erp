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
import InventoryOverview from './components/InventoryOverview'
import ManagerDashboardCard from './components/ManagerDashboardCard'
import { SupplierPage } from './components/SupplierPage'
import ReturnPage from './components/ReturnPage'
import GoldMaterialPage from './components/GoldMaterialPage'
import LoanPage from './components/LoanPage'
import ProductCodePage from './components/ProductCodePage'
import InboundOrdersPage from './components/InboundOrdersPage'
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
  // 鍥介檯鍖?
  const { t, i18n } = useTranslation()
  const [showLanguageSelector, setShowLanguageSelector] = useState(() => {
    // 棣栨璁块棶鏄剧ず璇█閫夋嫨椤?
    if (typeof window !== 'undefined') {
      return localStorage.getItem('languageSelected') !== 'true'
    }
    return true
  })
  const currentLanguage = i18n.language || 'zh'
  
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)  // 鍥剧墖涓婁紶鐘舵€?
  const messagesEndRef = useRef(null)
  const fileInputRef = useRef(null)  // 鏂囦欢杈撳叆寮曠敤
  const abortControllerRef = useRef(null)  // SSE 璇锋眰鍙栨秷鎺у埗鍣?
  
  // OCR缂栬緫瀵硅瘽妗嗙浉鍏崇姸鎬?
  const [showOCRModal, setShowOCRModal] = useState(false)
  const [ocrResult, setOcrResult] = useState('')
  const [uploadedImage, setUploadedImage] = useState(null)
  const ocrTextareaRef = useRef(null)  // 鐢ㄤ簬鑷姩鑱氱劍
  
  // 鍘嗗彶瀵硅瘽璁板綍鐩稿叧鐘舵€?
  const [conversationHistory, setConversationHistory] = useState([]) // 鍘嗗彶瀵硅瘽鍒楄〃
  const [currentConversationId, setCurrentConversationId] = useState(null) // 褰撳墠瀵硅瘽ID
  
  // 鍚庣浼氳瘽ID锛堢敤浜庤亰澶╄褰曟寔涔呭寲锛?
  const [currentSessionId, setCurrentSessionId] = useState(() => {
    // 鐢熸垚鎴栨仮澶?session_id
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('current_session_id')
      if (saved) return saved
      const newId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      localStorage.setItem('current_session_id', newId)
      return newId
    }
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  })
  // 渚ц竟鏍忓紑鍏筹紙妗岄潰绔粯璁ゆ墦寮€锛岀Щ鍔ㄧ榛樿鍏抽棴锛?
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth >= 1024
    }
    return true
  })
  const [conversationTitle, setConversationTitle] = useState('新对话') // 当前对话标题
  const [currentPage, setCurrentPage] = useState('chat') // 'chat', 'finance', 'warehouse', 'settlement', 'analytics', 'export'
  const [showQuickOrderModal, setShowQuickOrderModal] = useState(false) // 蹇嵎寮€鍗曞脊绐?
  const [showQuickReturnModal, setShowQuickReturnModal] = useState(false) // 蹇嵎閫€璐у脊绐?
  const [showQuickInboundModal, setShowQuickInboundModal] = useState(false) // 蹇嵎鍏ュ簱寮圭獥
  const [showSalesSearchModal, setShowSalesSearchModal] = useState(false) // 閿€鍞鐞嗗脊绐?
  const [showHistoryPanel, setShowHistoryPanel] = useState(false) // 鍘嗗彶鍥炴函闈㈡澘
  const [showQuickReceiptModal, setShowQuickReceiptModal] = useState(false) // 蹇嵎鏀舵枡寮圭獥
  const [showQuickWithdrawalModal, setShowQuickWithdrawalModal] = useState(false) // 蹇嵎鎻愭枡寮圭獥
  const [toastMessage, setToastMessage] = useState('') // Toast 鎻愮ず娑堟伅
  const [quickFormCustomers, setQuickFormCustomers] = useState([]) // 瀹㈡埛鍒楄〃
  const [quickFormCustomerSearch, setQuickFormCustomerSearch] = useState('') // 瀹㈡埛鎼滅储
  const [quickReceiptForm, setQuickReceiptForm] = useState({ customer_id: '', gold_weight: '', gold_fineness: '瓒抽噾999', remark: '' })
  const [quickWithdrawalForm, setQuickWithdrawalForm] = useState({ customer_id: '', gold_weight: '', remark: '' })
  const [selectedCustomerDeposit, setSelectedCustomerDeposit] = useState(null) // 閫変腑瀹㈡埛鐨勫瓨鏂欎綑棰?
  const [depositLoading, setDepositLoading] = useState(false)
  
  // 鐢ㄦ埛瑙掕壊鐩稿叧鐘舵€?
  const [userRole, setUserRole] = useState(() => {
    // 浠?localStorage 璇诲彇淇濆瓨鐨勮鑹诧紝榛樿涓轰笟鍔″憳
    if (typeof window !== 'undefined') {
      return localStorage.getItem('userRole') || 'sales'
    }
    return 'sales'
  })
  const [roleDropdownOpen, setRoleDropdownOpen] = useState(false)
  const [roleLoading, setRoleLoading] = useState(false)  // 瑙掕壊鍒囨崲鍔犺浇鐘舵€?
  const roleDropdownRef = useRef(null)
  const roleHistoryCache = useRef({})  // 瑙掕壊鍘嗗彶璁板綍缂撳瓨
  
  // 寰呭鐞嗚浆绉诲崟鏁伴噺锛堢敤浜庡垎浠撳簱瀛樻寜閽産adge锛?
  const [pendingTransferCount, setPendingTransferCount] = useState(0)
  // 寰呯粨绠楅攢鍞崟鏁伴噺锛堢敤浜庣粨绠楃鐞嗘寜閽産adge锛?
  const [pendingSalesCount, setPendingSalesCount] = useState(0)

  // Toast 鎻愮ず鍑芥暟锛?绉掑悗鑷姩娑堝け锛?
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

  // ========== 鐢ㄦ埛鏍囪瘑鎶借薄灞傦紙涓烘湭鏉ョ櫥褰曠郴缁熼鐣欙級 ==========
  // 鑾峰彇褰撳墠鐢ㄦ埛鏍囪瘑绗?
  // 闃舵1锛堝綋鍓嶏級锛氫娇鐢ㄨ澶嘔D浣滀负涓存椂鐢ㄦ埛鏍囪瘑
  // 闃舵2锛堟湭鏉ワ級锛氭帴鍏ョ櫥褰曠郴缁熷悗锛岃繑鍥炵湡瀹炵敤鎴稩D
  const getUserIdentifier = () => {
    // 鏈潵鐧诲綍绯荤粺鎺ュ叆鐐?- 鍙栨秷娉ㄩ噴浠ヤ笅浠ｇ爜
    // const authUser = getAuthUser()
    // if (authUser) return authUser.id
    
    // 褰撳墠锛氫娇鐢ㄨ澶囨寚绾逛綔涓轰复鏃剁敤鎴锋爣璇?
    if (typeof window === 'undefined') return 'anonymous'
    
    let deviceId = localStorage.getItem('jewelry_erp_device_id')
    if (!deviceId) {
      deviceId = `device_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      localStorage.setItem('jewelry_erp_device_id', deviceId)
    }
    return deviceId
  }

  // 鑾峰彇褰撳墠瑙掕壊鐨勫巻鍙茶褰昸ey锛堝寘鍚敤鎴锋爣璇嗭紝鏀寔澶氱敤鎴烽殧绂伙級
  const getHistoryKey = (role) => {
    const userId = getUserIdentifier()
    return `conversationHistory_${userId}_${role}`
  }

  // 鑾峰彇涓婃浣跨敤鐨剆ession key锛堢敤浜庢仮澶嶄笂娆″璇濓級
  const getLastSessionKey = (role) => {
    const userId = getUserIdentifier()
    return `lastSessionId_${userId}_${role}`
  }

  // ========== 娑堟伅瑙ｆ瀽浼樺寲锛堟€ц兘浼樺寲锛氬悎骞舵鍒欏尮閰嶏級 ==========
  // 瑙ｆ瀽娑堟伅涓殑闅愯棌鏍囪锛屾仮澶嶆墍鏈夌壒娈婃秷鎭殑棰濆瀛楁
  const parseMessageHiddenMarkers = (messages) => {
    // 娣诲姞鏁扮粍瀹夊叏妫€鏌?
    if (!Array.isArray(messages)) return messages || [];
    // 鍚堝苟鎵€鏈夋爣璁扮殑姝ｅ垯琛ㄨ揪寮忥紝涓€娆″尮閰嶅绉嶇被鍨?
    const combinedRegex = /<!-- (WITHDRAWAL_ORDER|GOLD_RECEIPT|INBOUND_ORDER|RETURN_ORDER|SALES_ORDER|SETTLEMENT_ORDER):(\d+):?([^>]*) -->/g
    
    return messages.map(msg => {
      if (!msg.content) return msg
      
      // 浣跨敤鍚堝苟姝ｅ垯涓€娆℃€у尮閰嶆墍鏈夋爣璁?
      const matches = [...msg.content.matchAll(combinedRegex)]
      if (matches.length === 0) return msg
      
      matches.forEach(match => {
        const [, type, id] = match
        const orderId = parseInt(id)
        
        switch (type) {
          case 'WITHDRAWAL_ORDER':
            if (!msg.withdrawalDownloadUrl) {
              msg.withdrawalId = orderId
              msg.withdrawalDownloadUrl = `${API_BASE_URL}/api/gold-material/withdrawals/${orderId}/download?format=html`
            }
            break
          case 'GOLD_RECEIPT':
            if (!msg.goldReceiptDownloadUrl) {
              msg.goldReceiptId = orderId
              msg.goldReceiptDownloadUrl = `${API_BASE_URL}/api/gold-material/gold-receipts/${orderId}/print`
            }
            break
          case 'INBOUND_ORDER':
            if (!msg.inboundOrder) {
              msg.inboundOrder = { id: orderId }
            }
            break
          case 'RETURN_ORDER':
            if (!msg.returnOrder) {
              msg.returnOrder = { id: orderId }
            }
            break
          case 'SALES_ORDER':
            if (!msg.salesOrderId) {
              msg.salesOrderId = orderId
            }
            break
          case 'SETTLEMENT_ORDER':
            if (!msg.settlementOrderId) {
              msg.settlementOrderId = orderId
            }
            break
        }
      })
      
      return msg
    })
  }

  // 鍔犺浇鎸囧畾瑙掕壊鐨勫巻鍙茶褰曪紙浼樺寲鐗堬細浼樺厛浣跨敤缂撳瓨/localStorage锛屽悗鍙伴潤榛樺悓姝PI锛?
  const loadRoleHistory = async (role) => {
    const historyKey = getHistoryKey(role)
    
    // 1. 棣栧厛妫€鏌ュ唴瀛樼紦瀛橈紙5鍒嗛挓鏈夋晥鏈燂級
    const cached = roleHistoryCache.current[role]
    if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
      setConversationHistory(cached.data)
      return cached.data
    }
    
    // 2. 绔嬪嵆浠?localStorage 鍔犺浇锛堝揩閫熷搷搴旓級
    let localHistory = []
    try {
      const parsed = JSON.parse(localStorage.getItem(historyKey) || '[]')
      localHistory = Array.isArray(parsed) ? parsed : []
      setConversationHistory(localHistory)
    } catch {
      localHistory = []
      setConversationHistory([])
    }
    
    // 3. 鍚庡彴闈欓粯鍚屾 API 鏁版嵁锛堜笉闃诲 UI锛?
    // 浣跨敤 setTimeout 璁?UI 鍏堟洿鏂?
    setTimeout(async () => {
      try {
        const response = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/chat-sessions?user_role=${role}&limit=50`)
        const data = await response.json()
        
        if (data.success && Array.isArray(data.sessions)) {
          const history = data.sessions.map(session => ({
            id: session.session_id,
            title: session.summary || '鏂板璇?,
            messages: [],
            createdAt: session.start_time || new Date().toISOString(),
            updatedAt: session.end_time || new Date().toISOString(),
            messageCount: session.message_count,
            lastIntent: session.last_intent
          }))
          
          // 鏇存柊 localStorage
          localStorage.setItem(historyKey, JSON.stringify(history))
          
          // 鏇存柊鍐呭瓨缂撳瓨
          roleHistoryCache.current[role] = {
            data: history,
            timestamp: Date.now()
          }
          
          // 鍙湁褰撳墠瑙掕壊鍖归厤鏃舵墠鏇存柊 UI
          // 閬垮厤鍒囨崲瑙掕壊鍚庢棫璇锋眰瑕嗙洊鏂版暟鎹?
          setConversationHistory(prev => {
            // 濡傛灉鏈湴宸叉湁鏁版嵁锛屽悎骞朵繚鐣欐湰鍦扮殑娑堟伅鍐呭
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
        console.log('鍚庡彴鍚屾鍘嗗彶璁板綍澶辫触锛堜笉褰卞搷浣跨敤锛?', error.message)
      }
    }, 100)
    
    // 缂撳瓨鏈湴鏁版嵁
    roleHistoryCache.current[role] = {
      data: localHistory,
      timestamp: Date.now()
    }
    
    return localHistory
  }

  // ========== 鍒囨崲鐢ㄦ埛瑙掕壊锛堝寮虹増锛氫繚瀛?鎭㈠鍚勮鑹蹭笂娆″璇濓級 ==========
  const changeUserRole = async (roleId) => {
    // 濡傛灉鏄悓涓€瑙掕壊锛岀洿鎺ヨ繑鍥?
    if (roleId === userRole) {
      setRoleDropdownOpen(false)
      return
    }
    
    // 鏄剧ず鍔犺浇鐘舵€?
    setRoleLoading(true)
    setRoleDropdownOpen(false)
    
    // 濡傛灉鍒囨崲鍒颁笉鍚岃鑹诧紝淇濆瓨褰撳墠瀵硅瘽骞跺姞杞芥柊瑙掕壊鐨勫巻鍙茶褰?
    if (roleId !== userRole) {
      // 1. 淇濆瓨褰撳墠瑙掕壊鐨勫璇濆拰浼氳瘽ID
      if (messages.length > 0) {
        // 鐩存帴淇濆瓨鍒板綋鍓嶈鑹茬殑鍘嗗彶璁板綍锛堜笉浣跨敤寤惰繜淇濆瓨锛?
        const currentHistoryKey = getHistoryKey(userRole)
        const parsedHistory = JSON.parse(localStorage.getItem(currentHistoryKey) || '[]')
        const currentHistory = Array.isArray(parsedHistory) ? parsedHistory : []
        
        // 鑷姩鐢熸垚瀵硅瘽鏍囬
        let title = conversationTitle
        if (title === '鏂板璇? || !currentConversationId) {
          const firstUserMessage = messages.find(m => m.type === 'user')
          if (firstUserMessage) {
            title = firstUserMessage.content.substring(0, 20) || '鏂板璇?
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
        
        // 淇濆瓨褰撳墠瑙掕壊鐨勪笂娆′細璇滻D
        const currentLastSessionKey = getLastSessionKey(userRole)
        localStorage.setItem(currentLastSessionKey, conversationId)
      }
      
      // 2. 鍒囨崲鍒版柊瑙掕壊锛屽姞杞芥柊瑙掕壊鐨勫巻鍙茶褰?
      await loadRoleHistory(roleId)
      
      // 3. 灏濊瘯鎭㈠鏂拌鑹蹭笂娆＄殑瀵硅瘽
      const newLastSessionKey = getLastSessionKey(roleId)
      const lastSessionId = localStorage.getItem(newLastSessionKey)
      
      if (lastSessionId) {
        // 灏濊瘯鎭㈠鏂拌鑹蹭笂娆＄殑瀵硅瘽
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
            setConversationTitle(lastConversation.title || '鏂板璇?)
            console.log('[瑙掕壊鍒囨崲] 鎭㈠涓婃瀵硅瘽:', lastSessionId)
          } else {
            // 娌℃湁鎵惧埌涓婃瀵硅瘽锛屽紑濮嬫柊瀵硅瘽
            newConversation()
          }
        } catch {
          newConversation()
        }
      } else {
        // 璇ヨ鑹叉病鏈変笂娆″璇濊褰曪紝寮€濮嬫柊瀵硅瘽
        newConversation()
      }
    }
    setUserRole(roleId)
    localStorage.setItem('userRole', roleId)
    setRoleLoading(false)  // 鍏抽棴鍔犺浇鐘舵€?
  }

  // 鑾峰彇褰撳墠瑙掕壊淇℃伅
  const getCurrentRole = () => {
    return USER_ROLES.find(r => r.id === userRole) || USER_ROLES[0]
  }

  // 鐐瑰嚮澶栭儴鍏抽棴瑙掕壊涓嬫媺鑿滃崟
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (roleDropdownRef.current && !roleDropdownRef.current.contains(event.target)) {
        setRoleDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // 缁勪欢鍗歌浇鏃跺彇娑堟鍦ㄨ繘琛岀殑 SSE 璇锋眰
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [])

  // 浠呭湪椤甸潰鍒濆鍔犺浇鏃跺姞杞藉綋鍓嶈鑹茬殑鍘嗗彶瀵硅瘽璁板綍
  // 瑙掕壊鍒囨崲鏃剁敱 changeUserRole 鍑芥暟璐熻矗鍔犺浇锛岄伩鍏嶉噸澶嶈皟鐢?
  const initialLoadRef = useRef(false)
  useEffect(() => {
    if (!initialLoadRef.current) {
      initialLoadRef.current = true
      loadRoleHistory(userRole)
    }
  }, []) // 鍙湪缁勪欢鎸傝浇鏃舵墽琛屼竴娆?

  // ========== 椤甸潰鍒濆鍖栨椂鎭㈠褰撳墠瀵硅瘽锛堝寮虹増锛氭敮鎸佸悗绔悓姝ュ厹搴曪級 ==========
  const [isRestoring, setIsRestoring] = useState(false) // 闃叉閲嶅鎭㈠
  
  useEffect(() => {
    // 纭繚 userRole 宸插垵濮嬪寲
    if (!userRole || isRestoring) return
    
    const restoreCurrentConversation = async () => {
      setIsRestoring(true)
      
      // 鑾峰彇璇ヨ鑹蹭笂娆′娇鐢ㄧ殑session
      const lastSessionKey = getLastSessionKey(userRole)
      const savedSessionId = localStorage.getItem(lastSessionKey) || localStorage.getItem('current_session_id')
      
      if (!savedSessionId) {
        setIsRestoring(false)
        return
      }
      
      // 妫€鏌ocalStorage涓槸鍚︽湁杩欎釜瀵硅瘽鐨勬秷鎭?
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
          setConversationTitle(conversation.title || '鏂板璇?)
          console.log('[鎭㈠] 浠庢湰鍦版仮澶嶅璇?', savedSessionId, '娑堟伅鏁?', restoredMessages.length)
        } else {
          // 鏈湴娌℃湁锛屽皾璇曚粠鍚庣鍚屾
          console.log('[鎭㈠] 鏈湴鏃犳暟鎹紝灏濊瘯浠庡悗绔悓姝?', savedSessionId)
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
                console.log('[鎭㈠] 浠庡悗绔仮澶嶅璇?', savedSessionId, '娑堟伅鏁?', parsedMessages.length)
              }
            }
          } catch (backendError) {
            console.error('[鎭㈠] 鍚庣鍚屾澶辫触:', backendError)
          }
        }
      } catch (error) {
        console.error('[鎭㈠] 鎭㈠瀵硅瘽澶辫触:', error)
        // 鏁版嵁鎹熷潖鏃讹紝娓呯┖璇ヨ鑹茬殑鍘嗗彶璁板綍
        try {
          localStorage.setItem(historyKey, '[]')
          console.warn('[鎭㈠] 宸叉竻绌烘崯鍧忕殑鍘嗗彶璁板綍')
        } catch {}
      } finally {
        setIsRestoring(false)
      }
    }
    
    restoreCurrentConversation()
  }, [userRole]) // 渚濊禆 userRole锛岀‘淇濊鑹插彉鍖栨椂涔熻兘姝ｇ‘鎭㈠

  // 鍔犺浇寰呭鐞嗚浆绉诲崟鏁伴噺锛堟煖鍙拌鑹查渶瑕佺湅鍒板晢鍝侀儴鍙戞潵鐨勮浆绉诲崟锛?
  const loadPendingTransferCount = async () => {
    // 鍙湁鏌滃彴銆佺粨绠椼€佺鐞嗗眰闇€瑕佺湅鍒板緟鎺ユ敹杞Щ鍗曟暟閲?
    if (!['counter', 'settlement', 'manager'].includes(userRole)) {
      setPendingTransferCount(0)
      return
    }
    try {
      const response = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/warehouse/transfers?status=pending`)
      if (response.ok) {
        const transfers = await response.json()
        
        // 鏍规嵁瑙掕壊杩囨护锛屼笌 WarehousePage 閫昏緫淇濇寔涓€鑷?
        const roleLocationMap = {
          'counter': '灞曞巺',
          'product': '鍟嗗搧閮ㄤ粨搴?
        }
        const myLocation = roleLocationMap[userRole]
        
        if (myLocation) {
          // 鍙绠楃洰鏍囨槸褰撳墠瑙掕壊绠¤緰浠撳簱鐨勮浆绉诲崟
          const filtered = transfers.filter(t => t.to_location_name === myLocation)
          setPendingTransferCount(filtered.length)
        } else {
          // 绠＄悊鍛樼湅鎵€鏈?
          setPendingTransferCount(transfers.length)
        }
      }
    } catch (error) {
      console.error('鍔犺浇寰呭鐞嗚浆绉诲崟鏁伴噺澶辫触:', error)
      // 闈炲叧閿姛鑳斤紝闈欓粯澶辫触
    }
  }

  // 鍔犺浇寰呯粨绠楅攢鍞崟鏁伴噺锛堢粨绠椾笓鍛橀渶瑕佺湅鍒版煖鍙板紑鐨勯攢鍞崟锛?
  const loadPendingSalesCount = async () => {
    // 鍙湁缁撶畻涓撳憳鍜岀鐞嗗眰闇€瑕佺湅鍒板緟缁撶畻閿€鍞崟鏁伴噺
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
      console.error('鍔犺浇寰呯粨绠楅攢鍞崟鏁伴噺澶辫触:', error)
      // 闈炲叧閿姛鑳斤紝闈欓粯澶辫触
    }
  }

  // 鍔犺浇瀹㈡埛鍒楄〃锛堢敤浜庡揩鎹锋敹鏂?鎻愭枡锛?
  const loadQuickFormCustomers = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/customers`)
      if (response.ok) {
        const data = await response.json()
        console.log('鍔犺浇瀹㈡埛鍒楄〃:', data)  // 璋冭瘯鏃ュ織
        // API杩斿洖鏍煎紡: { success: true, data: { customers: [...] } }
        const customers = data.data?.customers || data.customers || []
        setQuickFormCustomers(Array.isArray(customers) ? customers : [])
      } else {
        console.error('鍔犺浇瀹㈡埛鍒楄〃API澶辫触:', response.status)
        showToast('鍔犺浇瀹㈡埛鍒楄〃澶辫触锛岃鍒锋柊閲嶈瘯')
      }
    } catch (error) {
      console.error('鍔犺浇瀹㈡埛鍒楄〃澶辫触:', error)
      showToast('鍔犺浇瀹㈡埛鍒楄〃澶辫触锛岃妫€鏌ョ綉缁滆繛鎺?)
    }
  }

  // 鎵撳紑蹇嵎鏀舵枡寮圭獥
  const openQuickReceiptModal = () => {
    loadQuickFormCustomers()
    setQuickReceiptForm({ customer_id: '', gold_weight: '', gold_fineness: '瓒抽噾999', remark: '' })
    setQuickFormCustomerSearch('')
    setShowQuickReceiptModal(true)
  }

  // 鎵撳紑蹇嵎鎻愭枡寮圭獥
  const openQuickWithdrawalModal = () => {
    loadQuickFormCustomers()
    setQuickWithdrawalForm({ customer_id: '', gold_weight: '', remark: '' })
    setQuickFormCustomerSearch('')
    setSelectedCustomerDeposit(null)
    setShowQuickWithdrawalModal(true)
  }

  // 鏌ヨ瀹㈡埛瀛樻枡浣欓
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
      console.error('鏌ヨ瀹㈡埛瀛樻枡浣欓澶辫触:', error)
      setSelectedCustomerDeposit({ current_balance: 0, customer_name: '' })
      showToast('鏌ヨ瀹㈡埛浣欓澶辫触锛屾樉绀轰负0')
    } finally {
      setDepositLoading(false)
    }
  }

  // 鍒涘缓蹇嵎鏀舵枡鍗?
  const handleQuickReceipt = async (e) => {
    e.preventDefault()
    if (!quickReceiptForm.customer_id) {
      alert('璇烽€夋嫨瀹㈡埛')
      return
    }
    if (!quickReceiptForm.gold_weight || parseFloat(quickReceiptForm.gold_weight) <= 0) {
      alert('璇疯緭鍏ユ湁鏁堢殑鏀舵枡鍏嬮噸')
      return
    }
    try {
      const params = new URLSearchParams({
        customer_id: quickReceiptForm.customer_id,
        gold_weight: quickReceiptForm.gold_weight,
        gold_fineness: quickReceiptForm.gold_fineness,
        remark: quickReceiptForm.remark || '蹇嵎鏀舵枡',
        created_by: '缁撶畻涓撳憳'
      })
      const response = await fetch(`${API_BASE_URL}/api/gold-material/gold-receipts?${params}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      if (response.ok) {
        const result = await response.json()
        const customerName = quickFormCustomers.find(c => c.id.toString() === quickReceiptForm.customer_id)?.name || '鏈煡瀹㈡埛'
        const receiptWeight = parseFloat(quickReceiptForm.gold_weight)
        const remarkText = quickReceiptForm.remark || ''
        
        setShowQuickReceiptModal(false)
        // 閲嶇疆琛ㄥ崟
        setQuickReceiptForm({ customer_id: '', gold_weight: '', gold_fineness: '瓒抽噾999', remark: '' })
        setQuickFormCustomerSearch('')
        
        // 娣诲姞鏀舵枡鍗曡褰曞埌鑱婂ぉ妗嗭紙浣跨敤鏂囨湰鏍煎紡+闅愯棌鏍囪锛?
        const downloadUrl = `${API_BASE_URL}/api/gold-material/gold-receipts/${result.data.id}/print`
        const receiptMessage = `鉁?鏀舵枡鍗曞凡鐢熸垚\n\n馃搵 鍗曞彿锛?{result.data.receipt_no}\n馃懁 瀹㈡埛锛?{customerName}\n鈿栵笍 鍏嬮噸锛?{receiptWeight.toFixed(2)} 鍏媆n馃彿锔?鎴愯壊锛?{quickReceiptForm.gold_fineness}${remarkText ? `\n馃摑 澶囨敞锛?{remarkText}` : ''}\n鈴?鏃堕棿锛?{new Date().toLocaleString('zh-CN')}\n\n<!-- GOLD_RECEIPT:${result.data.id}:${result.data.receipt_no} -->`
        setMessages(prev => [...prev, {
          id: Date.now(),
          type: 'system',
          content: receiptMessage,
          goldReceiptDownloadUrl: downloadUrl,
          goldReceiptId: result.data.id
        }])
        
        // 鑷姩鎵撳紑鎵撳嵃椤甸潰
        if (result.data.id) {
          window.open(downloadUrl, '_blank')
        }
      } else {
        const error = await response.json()
        alert('鍒涘缓鏀舵枡鍗曞け璐ワ細' + (error.detail || '鏈煡閿欒'))
      }
    } catch (error) {
      console.error('鍒涘缓鏀舵枡鍗曞け璐?', error)
      alert('鍒涘缓鏀舵枡鍗曞け璐?)
    }
  }

  // 鍒涘缓蹇嵎鎻愭枡鍗?
  const handleQuickWithdrawal = async (e) => {
    e.preventDefault()
    if (!quickWithdrawalForm.customer_id) {
      alert('璇烽€夋嫨瀹㈡埛')
      return
    }
    const weight = parseFloat(quickWithdrawalForm.gold_weight)
    if (!weight || weight <= 0) {
      alert('璇疯緭鍏ユ湁鏁堢殑鎻愭枡鍏嬮噸')
      return
    }
    if (weight > (selectedCustomerDeposit?.current_balance || 0)) {
      alert(`鎻愭枡鍏嬮噸涓嶈兘瓒呰繃瀹㈡埛瀛樻枡浣欓锛?{selectedCustomerDeposit?.current_balance?.toFixed(2) || 0}鍏嬶級`)
      return
    }
    try {
      const params = new URLSearchParams({ user_role: 'settlement', created_by: '缁撶畻涓撳憳' })
      const response = await fetch(`${API_BASE_URL}/api/gold-material/withdrawals?${params}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: parseInt(quickWithdrawalForm.customer_id),
          gold_weight: weight,
          withdrawal_type: 'self',
          remark: quickWithdrawalForm.remark || '蹇嵎鎻愭枡'
        })
      })
      if (response.ok) {
        const result = await response.json()
        const customerName = quickFormCustomers.find(c => c.id.toString() === quickWithdrawalForm.customer_id)?.name || '鏈煡瀹㈡埛'
        const withdrawalWeight = parseFloat(quickWithdrawalForm.gold_weight)
        const remarkText = quickWithdrawalForm.remark || ''
        
        setShowQuickWithdrawalModal(false)
        // 閲嶇疆琛ㄥ崟
        setQuickWithdrawalForm({ customer_id: '', gold_weight: '', remark: '' })
        setSelectedCustomerDeposit(null)
        setQuickFormCustomerSearch('')
        
        // 娣诲姞鎻愭枡鍗曡褰曞埌鑱婂ぉ妗嗭紙浣跨敤鏂囨湰鏍煎紡+闅愯棌鏍囪锛岀‘淇濆巻鍙茶褰曟寔涔呭寲锛?
        const downloadUrl = `${API_BASE_URL}/api/gold-material/withdrawals/${result.id}/download?format=html`
        const withdrawalMessage = `鉁?鎻愭枡鍗曞凡鐢熸垚\n\n馃搵 鍗曞彿锛?{result.withdrawal_no}\n馃懁 瀹㈡埛锛?{customerName}\n鈿栵笍 鍏嬮噸锛?{withdrawalWeight.toFixed(2)} 鍏?{remarkText ? `\n馃摑 澶囨敞锛?{remarkText}` : ''}\n鈴?鏃堕棿锛?{new Date().toLocaleString('zh-CN')}\n\n<!-- WITHDRAWAL_ORDER:${result.id}:${result.withdrawal_no} -->`
        setMessages(prev => [...prev, {
          id: Date.now(),
          type: 'system',
          content: withdrawalMessage,
          // 淇濈暀涓嬭浇閾炬帴渚涙寜閽娇鐢?
          withdrawalDownloadUrl: downloadUrl,
          withdrawalId: result.id
        }])
        
        // 鑷姩鎵撳紑鎵撳嵃椤甸潰
        if (result.id) {
          window.open(`${API_BASE_URL}/api/gold-material/withdrawals/${result.id}/download?format=html`, '_blank')
        }
      } else {
        const error = await response.json()
        alert('鍒涘缓鎻愭枡鍗曞け璐ワ細' + (error.detail || '鏈煡閿欒'))
      }
    } catch (error) {
      console.error('鍒涘缓鎻愭枡鍗曞け璐?', error)
      alert('鍒涘缓鎻愭枡鍗曞け璐?)
    }
  }

  // 绛涢€夊鎴峰垪琛紙纭繚鏄暟缁勶級
  const filteredQuickFormCustomers = (Array.isArray(quickFormCustomers) ? quickFormCustomers : []).filter(c => {
    if (!quickFormCustomerSearch.trim()) return true; // 绌烘悳绱㈡樉绀哄叏閮?
    const search = quickFormCustomerSearch.toLowerCase();
    return (c.name && c.name.toLowerCase().includes(search)) ||
           (c.phone && c.phone.includes(quickFormCustomerSearch));
  })

  // 瑙掕壊鍙樺寲鏃跺姞杞藉緟澶勭悊鏁伴噺
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

  // 淇濆瓨瀵硅瘽鍒板巻鍙茶褰曪紙淇濆瓨鍒板綋鍓嶈鑹茬殑鍘嗗彶璁板綍锛?
  // ========== 淇濆瓨瀵硅瘽锛堝寮虹増锛氬幓閲嶄紭鍖?+ 淇濆瓨涓婃浼氳瘽ID锛?==========
  const lastSavedRef = useRef({ messageCount: 0, lastMessageId: null })
  
  const saveConversation = () => {
    if (messages.length === 0) return
    
    // 鎬ц兘浼樺寲锛氭鏌ユ秷鎭槸鍚︾湡鐨勫彉鍖栦簡锛岄伩鍏嶉噸澶嶄繚瀛?
    const lastMessage = messages[messages.length - 1]
    if (lastSavedRef.current.messageCount === messages.length && 
        lastSavedRef.current.lastMessageId === lastMessage?.id) {
      return // 娑堟伅娌℃湁鍙樺寲锛屼笉闇€瑕佷繚瀛?
    }
    
    // 鑾峰彇褰撳墠瑙掕壊鐨勫巻鍙茶褰昸ey
    const historyKey = getHistoryKey(userRole)
    // 浠巐ocalStorage鑾峰彇褰撳墠瑙掕壊鐨勬渶鏂板巻鍙茶褰?
    const parsedData = JSON.parse(localStorage.getItem(historyKey) || '[]')
    const history = Array.isArray(parsedData) ? parsedData : []
    
    // 鑷姩鐢熸垚瀵硅瘽鏍囬锛堜娇鐢ㄧ涓€鏉＄敤鎴锋秷鎭殑鍓?0涓瓧绗︼級
    let title = conversationTitle
    if (title === '鏂板璇? || !currentConversationId) {
      const firstUserMessage = messages.find(m => m.type === 'user')
      if (firstUserMessage) {
        title = firstUserMessage.content.substring(0, 20) || '鏂板璇?
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
    
    // 淇濆瓨褰撳墠瑙掕壊鐨勪笂娆′細璇滻D锛堢敤浜庤鑹插垏鎹㈡椂鎭㈠锛?
    const lastSessionKey = getLastSessionKey(userRole)
    localStorage.setItem(lastSessionKey, conversationId)
    
    // 鏇存柊淇濆瓨鐘舵€侊紝鐢ㄤ簬鍘婚噸妫€娴?
    lastSavedRef.current = { messageCount: messages.length, lastMessageId: lastMessage?.id }
  }

  // 褰撴秷鎭彉鍖栨椂鑷姩淇濆瓨锛堜紭鍖栵細鍘婚噸锛?
  useEffect(() => {
    if (messages.length === 0) return
    
    // 寤惰繜淇濆瓨锛岄伩鍏嶉绻佸啓鍏?
    const timer = setTimeout(() => {
      saveConversation()
    }, 1000)
    return () => clearTimeout(timer)
  }, [messages])

  // 鍔犺浇鎸囧畾瀵硅瘽锛堜粠鍚庣API鍔犺浇瀹屾暣娑堟伅鍐呭锛?
  const loadConversation = async (conversationId) => {
    try {
      // 浠庡悗绔疉PI鑾峰彇璇ヤ細璇濈殑瀹屾暣娑堟伅
      const response = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/chat-history/${conversationId}`)
      const data = await response.json()
      
      if (data.success && Array.isArray(data.messages)) {
        // 灏嗗悗绔秷鎭牸寮忚浆鎹负鍓嶇娑堟伅鏍煎紡
        const messages = data.messages.map(msg => {
          const message = {
            type: msg.message_type === 'user' ? 'user' : 'system',  // assistant 娑堟伅鏄剧ず涓?system 绫诲瀷
            content: msg.content || '',
            id: msg.id
          }
          
          // 瑙ｆ瀽鎵€鏈夌被鍨嬬殑闅愯棌鏍囪
          if (msg.content) {
            // 鎻愭枡鍗?
            const withdrawalMatch = msg.content.match(/<!-- WITHDRAWAL_ORDER:(\d+):([^>]+) -->/)
            if (withdrawalMatch) {
              const withdrawalId = parseInt(withdrawalMatch[1])
              message.withdrawalId = withdrawalId
              message.withdrawalDownloadUrl = `${API_BASE_URL}/api/gold-material/withdrawals/${withdrawalId}/download?format=html`
            }
            // 鏀舵枡鍗?
            const goldReceiptMatch = msg.content.match(/<!-- GOLD_RECEIPT:(\d+):/)
            if (goldReceiptMatch) {
              const receiptId = parseInt(goldReceiptMatch[1])
              message.goldReceiptId = receiptId
              message.goldReceiptDownloadUrl = `${API_BASE_URL}/api/gold-material/gold-receipts/${receiptId}/print`
            }
            // 鍏ュ簱鍗?
            const inboundMatch = msg.content.match(/<!-- INBOUND_ORDER:(\d+):/)
            if (inboundMatch) {
              message.inboundOrder = { id: parseInt(inboundMatch[1]) }
            }
            // 閫€璐у崟
            const returnMatch = msg.content.match(/<!-- RETURN_ORDER:(\d+):/)
            if (returnMatch) {
              message.returnOrder = { id: parseInt(returnMatch[1]) }
            }
            // 閿€鍞崟
            const salesMatch = msg.content.match(/<!-- SALES_ORDER:(\d+):/)
            if (salesMatch) {
              message.salesOrderId = parseInt(salesMatch[1])
            }
            // 缁撶畻鍗?
            const settlementMatch = msg.content.match(/<!-- SETTLEMENT_ORDER:(\d+):/)
            if (settlementMatch) {
              message.settlementOrderId = parseInt(settlementMatch[1])
            }
          }
          
          return message
        })
        
        // 浠庡巻鍙茶褰曚腑鑾峰彇瀵硅瘽鏍囬
        const history = conversationHistory
        const conversation = history.find(c => c.id === conversationId)
        const title = conversation?.title || messages.find(m => m.type === 'user')?.content?.substring(0, 20) || '鏂板璇?
        
        setMessages(messages)
        setCurrentConversationId(conversationId)
        setConversationTitle(title)
        
        // 璁剧疆鍚庣 session_id锛岀‘淇濆悗缁秷鎭户缁娇鐢ㄧ浉鍚岀殑浼氳瘽
        setCurrentSessionId(conversationId)
        localStorage.setItem('current_session_id', conversationId)
        
        // 鍙湪绉诲姩绔叧闂晶杈规爮锛屾闈㈢淇濇寔鎵撳紑
        if (window.innerWidth < 1024) {
          setSidebarOpen(false)
        } else {
          // 妗岄潰绔‘淇濅晶杈规爮鎵撳紑
          setSidebarOpen(true)
        }
      } else {
        // 濡傛灉API澶辫触锛屽皾璇曚粠localStorage鍔犺浇
        const historyKey = getHistoryKey(userRole)
        const parsedData = JSON.parse(localStorage.getItem(historyKey) || '[]')
        const history = Array.isArray(parsedData) ? parsedData : []
        const conversation = history.find(c => c.id === conversationId)
        if (conversation && conversation.messages) {
          // 瑙ｆ瀽娑堟伅涓殑闅愯棌鏍囪锛屾仮澶嶆墍鏈夌壒娈婃秷鎭殑棰濆瀛楁
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
      console.error('鍔犺浇瀵硅瘽澶辫触锛屽皾璇曚粠鏈湴鍔犺浇:', error)
      // 濡傛灉API澶辫触锛屽皾璇曚粠localStorage鍔犺浇
      const historyKey = getHistoryKey(userRole)
      const parsedData2 = JSON.parse(localStorage.getItem(historyKey) || '[]')
      const history = Array.isArray(parsedData2) ? parsedData2 : []
      const conversation = history.find(c => c.id === conversationId)
      if (conversation && conversation.messages) {
        // 瑙ｆ瀽娑堟伅涓殑闅愯棌鏍囪锛屾仮澶嶆墍鏈夌壒娈婃秷鎭殑棰濆瀛楁
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
  }

  // 鏂板缓瀵硅瘽
  const newConversation = () => {
    setMessages([])
    setCurrentConversationId(null)
    setConversationTitle('鏂板璇?)
    
    // 鐢熸垚鏂扮殑鍚庣 session_id
    const newSessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    setCurrentSessionId(newSessionId)
    localStorage.setItem('current_session_id', newSessionId)
    
    // 鍙湪绉诲姩绔叧闂晶杈规爮锛屾闈㈢淇濇寔鎵撳紑
    if (window.innerWidth < 1024) {
      setSidebarOpen(false)
    } else {
      // 妗岄潰绔‘淇濅晶杈规爮鎵撳紑
      setSidebarOpen(true)
    }
  }

  // 鍒犻櫎瀵硅瘽锛堜粠褰撳墠瑙掕壊鐨勫巻鍙茶褰曞垹闄わ級
  const deleteConversation = (conversationId, e) => {
    e.stopPropagation()
    // 鑾峰彇褰撳墠瑙掕壊鐨勫巻鍙茶褰昸ey
    const historyKey = getHistoryKey(userRole)
    const history = (Array.isArray(conversationHistory) ? conversationHistory : []).filter(c => c.id !== conversationId)
    localStorage.setItem(historyKey, JSON.stringify(history))
    setConversationHistory(history)
    if (currentConversationId === conversationId) {
      newConversation()
    }
  }

  // 褰撳璇濇鎵撳紑鏃惰嚜鍔ㄨ仛鐒?
  useEffect(() => {
    if (showOCRModal && ocrTextareaRef.current) {
      // 寤惰繜鑱氱劍锛岀‘淇濆璇濇宸插畬鍏ㄦ覆鏌?
      const timer = setTimeout(() => {
        ocrTextareaRef.current?.focus()
        // 灏嗗厜鏍囩Щ鍒版枃鏈湯灏?
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
    
    // 鍒涘缓鎬濊€冭繃绋嬫秷鎭疘D
    const thinkingMessageId = Date.now()
    let contentMessageId = null
    let currentContent = ''
    let isContentStarted = false
    let thinkingSteps = []

    try {
      console.log('鍙戦€佹祦寮忚姹傚埌:', API_ENDPOINTS.CHAT_STREAM)
      console.log('璇锋眰娑堟伅:', userMessage)
      
      // 鍙栨秷涔嬪墠鐨勮姹傦紙濡傛灉鏈夛級
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
          session_id: currentSessionId,  // 浼犻€掍細璇滻D锛岀‘淇濆悓涓€瀵硅瘽鐨勬秷鎭叧鑱斿湪涓€璧?
          language: currentLanguage  // 浼犻€掑綋鍓嶈瑷€璁剧疆
        }),
        signal: abortControllerRef.current.signal  // 娣诲姞鍙栨秷淇″彿
      })

      console.log('鏀跺埌鍝嶅簲锛岀姸鎬佺爜:', response.status)
      console.log('鍝嶅簲澶?', {
        'Content-Type': response.headers.get('Content-Type'),
        'Cache-Control': response.headers.get('Cache-Control'),
        'Connection': response.headers.get('Connection'),
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error('鍝嶅簲閿欒锛岀姸鎬佺爜:', response.status)
        console.error('閿欒鍐呭:', errorText)
        throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`)
      }
      
      if (!response.body) {
        console.error('鍝嶅簲浣撲负绌?')
        throw new Error('鍝嶅簲浣撲负绌?)
      }
      
      console.log('寮€濮嬭鍙朣SE娴?..')

      // 鍒涘缓鎬濊€冭繃绋嬫秷鎭?
      setMessages(prev => [...prev, { 
        id: thinkingMessageId,
        type: 'thinking', 
        steps: [],
        progress: 0
      }])

      // 璇诲彇SSE娴?
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      let chunkCount = 0
      while (true) {
        try {
          const { done, value } = await reader.read()
          
          if (done) {
            console.log(`SSE娴佺粨鏉燂紝鍏辨敹鍒?${chunkCount} 涓暟鎹潡`)
            setLoading(false)
            break
          }
          
          if (!value) {
            console.warn('鏀跺埌绌哄€硷紝缁х画绛夊緟...')
            continue
          }

          chunkCount++
          if (chunkCount <= 3) {
            console.log(`鏀跺埌绗?${chunkCount} 涓暟鎹潡锛岄暱搴? ${value.length} 瀛楄妭`)
          }

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || '' // 淇濈暀涓嶅畬鏁寸殑琛?

          for (const line of lines) {
                  if (line.trim() === '') continue // 璺宠繃绌鸿
                  if (line.startsWith('data: ')) {
                    try {
                      const jsonStr = line.slice(6)
                      console.log('瑙ｆ瀽SSE JSON:', jsonStr) // 鏄剧ず瀹屾暣JSON
                      const data = JSON.parse(jsonStr)
                      console.log('鏀跺埌SSE鏁版嵁:', data) // 璋冭瘯鏃ュ織
                      // 鐗瑰埆妫€鏌?all_products
                      if (data.data?.all_products) {
                        console.log('銆愰噸瑕併€戞娴嬪埌 all_products:', data.data.all_products)
                      }
                
                // 澶勭悊鎬濊€冩楠?
                if (data.type === 'thinking') {
                  const stepIndex = thinkingSteps.findIndex(s => s.step === data.step)
                  if (stepIndex >= 0) {
                    // 鏇存柊鐜版湁姝ラ
                    thinkingSteps[stepIndex] = {
                      step: data.step,
                      message: data.message,
                      progress: data.progress || 0,
                      status: data.status || 'processing'
                    }
                  } else {
                    // 娣诲姞鏂版楠?
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
                // 鍐呭寮€濮?
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
                // 鍐呭鍧?
                else if (data.type === 'content') {
                  // 濡傛灉content_start浜嬩欢杩樻病鏀跺埌锛屽厛鍒涘缓娑堟伅
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
                console.log('鏀跺埌payment_confirm浜嬩欢:', data)
                setLoading(false)
                // 绉婚櫎鎬濊€冭繃绋嬫秷鎭?
                setMessages(prev => prev.filter(msg => msg.id !== thinkingMessageId))
                // 鍒涘缓鏀舵纭鍗＄墖娑堟伅
                const confirmData = data.data
                setMessages(prev => [...prev, { 
                  id: Date.now(),
                  type: 'payment_confirm', 
                  paymentData: confirmData,
                  content: confirmData.message
                }])
              }
              // 鏀舵枡纭鍗＄墖
              else if (data.type === 'receipt_confirm') {
                setLoading(false)
                setMessages(prev => prev.filter(msg => msg.id !== thinkingMessageId))
                // 鍒涘缓鏀舵枡纭鍗＄墖娑堟伅
                const confirmData = data.data
                setMessages(prev => [...prev, { 
                  id: Date.now(),
                  type: 'receipt_confirm', 
                  receiptData: confirmData,
                  content: confirmData.message
                }])
              }
              // 鎻愭枡纭鍗＄墖
              else if (data.type === 'withdrawal_confirm') {
                setLoading(false)
                setMessages(prev => prev.filter(msg => msg.id !== thinkingMessageId))
                // 鍒涘缓鎻愭枡纭鍗＄墖娑堟伅
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
                console.log('鏀跺埌complete浜嬩欢:', data)
                setLoading(false)
                // 绉婚櫎鎬濊€冭繃绋嬫秷鎭紙濡傛灉瀛樺湪锛?
                setMessages(prev => prev.filter(msg => msg.id !== thinkingMessageId))
                
                // 濡傛灉娌℃湁鍐呭娑堟伅锛堟瘮濡傚叆搴撴搷浣滅洿鎺ヨ繑鍥炵粨鏋滐級锛屽垱寤轰竴涓柊娑堟伅
                if (!contentMessageId || !isContentStarted) {
                  console.log('鍒涘缓鏂扮殑绯荤粺娑堟伅鏉ユ樉绀虹粨鏋?)
                  contentMessageId = Date.now()
                  // 澶勭悊鍏ュ簱绛夋搷浣滅殑鍝嶅簲
                  if (data.data) {
                    // ========== 鏅鸿兘琛ㄥ崟寮瑰嚭锛氬綋淇℃伅涓嶅畬鏁存椂鑷姩寮瑰嚭琛ㄥ崟 ==========
                    if (data.data.need_form) {
                      console.log('妫€娴嬪埌need_form鏍囧織锛屽脊鍑哄搴旇〃鍗?', data.data.action)
                      
                      // 鏍规嵁鎿嶄綔绫诲瀷寮瑰嚭瀵瑰簲鐨勮〃鍗?
                      if (data.data.action === '閫€璐?) {
                        setShowQuickReturnModal(true)
                      } else if (data.data.action === '鍏ュ簱') {
                        setShowQuickInboundModal(true)
                      } else if (data.data.action === '鍒涘缓閿€鍞崟') {
                        setShowQuickOrderModal(true)
                      }
                      
                      // 娣诲姞鎻愮ず娑堟伅
                      setMessages(prev => [...prev, { 
                        type: 'system', 
                        content: data.data.message || '馃摑 璇峰湪寮瑰嚭鐨勮〃鏍间腑濉啓瀹屾暣淇℃伅',
                        id: contentMessageId
                      }])
                      return  // 涓嶅啀缁х画澶勭悊
                    }
                    
                    let messageContent = ''
                    if (data.data.message) {
                      messageContent = data.data.message
                    } else if (data.data.success !== undefined) {
                      messageContent = data.data.success 
                        ? '鎿嶄綔鎴愬姛瀹屾垚' 
                        : (data.data.error || '鎿嶄綔澶辫触')
                    }
                    
                    console.log('鍒涘缓娑堟伅锛屽唴瀹?', messageContent)
                    
                    // 妫€鏌ユ槸鍚︽槸鍏ュ簱鎿嶄綔锛屽鏋滄槸鍒欏垱寤哄緟纭鐨勫崱鐗囨暟鎹?
                    let inboundCard = null
                    let inboundCards = null  // 澶氬晢鍝佸叆搴撴椂浣跨敤
                    // 鎵撳嵃瀹屾暣鐨?data.data 瀵硅薄
                    console.log('銆愬叆搴撹皟璇曘€戝畬鏁磀ata.data:', JSON.stringify(data.data, null, 2))
                    console.log('銆愬叆搴撹皟璇曘€慳ll_products 鏄惁瀛樺湪:', 'all_products' in (data.data || {}))
                    console.log('銆愬叆搴撹皟璇曘€慳ll_products 鍊?', data.data?.all_products)
                    console.log('銆愬叆搴撹皟璇曘€慳ll_products 闀垮害:', data.data?.all_products?.length)
                    
                    if (data.data?.success && data.data?.pending && data.data?.card_data) {
                      // 鏂规B锛氬垱寤哄緟纭鐨勫崱鐗囷紙status: 'pending'锛?
                      try {
                        // 缁熶竴浣跨敤 all_products锛堝鏋滄病鏈夊垯浣跨敤 card_data 浣滀负鍗曞厓绱犳暟缁勶級
                        console.log('銆愯皟璇曘€慸ata.data.all_products 鍘熷鍊?', data.data.all_products)
                        console.log('銆愯皟璇曘€慸ata.data.card_data 鍘熷鍊?', data.data.card_data)
                        
                        const allProducts = data.data.all_products && data.data.all_products.length > 0 
                          ? data.data.all_products 
                          : [data.data.card_data]
                        console.log('鏀跺埌寰呯‘璁ゅ晢鍝佹暟鎹紝鍏?, allProducts.length, '涓晢鍝?', allProducts)
                        
                        // 缁熶竴鍒涘缓鍗＄墖鏁扮粍锛堟棤璁哄崟鍟嗗搧杩樻槸澶氬晢鍝侊級
                        inboundCards = allProducts.map((cardData, index) => {
                          console.log(`銆愯皟璇曘€戝垱寤哄崱鐗?{index+1}:`, cardData)
                          const card = createNewCard({
                            productName: cardData.product_name,
                            goldWeight: cardData.weight,
                            laborCostPerGram: cardData.labor_cost,
                            pieceCount: cardData.piece_count,
                            pieceLaborCost: cardData.piece_labor_cost,
                            totalCost: cardData.total_cost,
                            supplier: {
                              id: 0,
                              name: cardData.supplier || '鏈煡渚涘簲鍟?,
                            },
                            status: 'pending',
                            source: 'api',
                            createdAt: new Date(),
                          })
                          card.barcode = ''
                          return card
                        })
                        console.log('鍒涘缓鍏ュ簱鍗＄墖锛屽叡', inboundCards.length, '寮?', inboundCards)
                        
                        // 濡傛灉鍙湁涓€涓晢鍝侊紝鍚屾椂璁剧疆 inboundCard锛堝悜鍚庡吋瀹癸級
                        if (inboundCards.length === 1) {
                          inboundCard = inboundCards[0]
                          inboundCards = null  // 鍗曞晢鍝佹椂娓呯┖鏁扮粍锛屼娇鐢ㄥ崟鍗＄墖鏄剧ず
                        }
                      } catch (error) {
                        console.error('鍒涘缓鍏ュ簱鍗＄墖澶辫触:', error)
                      }
                    } else if (data.data?.success && data.data?.order && data.data?.detail && !data.data?.pending) {
                      // 濡傛灉宸茬粡鏈夎鍗曞拰鏄庣粏锛屼笖娌℃湁pending鏍囧織锛岃鏄庢槸宸茬‘璁ょ殑锛堝悜鍚庡吋瀹规垨鐩存帴鍏ュ簱鐨勬儏鍐碉級
                      console.log('妫€娴嬪埌宸茬‘璁ょ殑鍏ュ簱鏁版嵁锛堝悜鍚庡吋瀹癸級')
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
                          console.log('鍒涘缓宸茬‘璁ゅ叆搴撳崱鐗囷紙鍚戝悗鍏煎锛?', inboundCard)
                        } catch (error) {
                          console.error('鍒涘缓鍏ュ簱鍗＄墖澶辫触:', error)
                        }
                      }
                    } else {
                      console.log('鏈尮閰嶅埌鍏ュ簱鍗＄墖鍒涘缓鏉′欢锛屾暟鎹?', data.data)
                    }
                    
                    setMessages(prev => [...prev, {
                      id: contentMessageId,
                      type: 'system',
                      content: messageContent,
                      isStreaming: false,
                      // 娣诲姞鍏朵粬鏁版嵁锛堝璁㈠崟淇℃伅绛夛級
                      order: data.data.order,
                      detail: data.data.detail,
                      inventory: data.data.inventory,
                      chartData: data.data.chart_data,
                      pieData: data.data.pie_data,
                      chartType: data.data.action,
                      rawData: data.data.raw_data,  // 鍘熷鏁版嵁锛堢敤浜庤缁嗘暟鎹睍绀猴級
                      // AI鎰忓浘璇嗗埆缁撴灉锛堢敤浜庡彲瑙嗗寲鏄剧ず锛?
                      detectedIntent: data.data.action,
                      // 娣诲姞鍏ュ簱鍗＄墖鏁版嵁锛堝崟鍟嗗搧鎴栧鍟嗗搧锛?
                      inboundCard: inboundCard,
                      inboundCards: inboundCards,  // 澶氬晢鍝佸叆搴撴椂鐨勫崱鐗囨暟缁?
                    }])
                  } else {
                    console.warn('complete浜嬩欢娌℃湁data瀛楁')
                  }
                } else {
                  console.log('鏇存柊鐜版湁鍐呭娑堟伅')
                  // 濡傛灉鏈夊唴瀹规秷鎭紝鏇存柊瀹?
                  setMessages(prev => prev.map(msg => {
                    if (msg.id === contentMessageId) {
                      const updatedMsg = { 
                        ...msg, 
                        isStreaming: false
                      }
                      // 鍙湁鍦ㄦ湁鍥捐〃鏁版嵁鏃舵墠娣诲姞
                      if (data.data?.chart_data) {
                        updatedMsg.chartData = data.data.chart_data
                        updatedMsg.chartType = data.data.action
                      }
                      if (data.data?.pie_data) {
                        updatedMsg.pieData = data.data.pie_data
                      }
                      // 娣诲姞鍏朵粬鏁版嵁
                      if (data.data?.order) updatedMsg.order = data.data.order
                      if (data.data?.detail) updatedMsg.detail = data.data.detail
                      if (data.data?.inventory) updatedMsg.inventory = data.data.inventory
                      if (data.data?.raw_data) updatedMsg.rawData = data.data.raw_data
                      
                      // 濡傛灉鏄叆搴撴搷浣滐紝鍒涘缓鍗＄墖鏁版嵁
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
                            console.error('鍒涘缓鍏ュ簱鍗＄墖澶辫触:', error)
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
                      return { ...msg, type: 'system', content: `鉂?${data.message}`, isStreaming: false }
                    }
                    return msg
                  }))
                }
              } catch (e) {
                console.error('瑙ｆ瀽SSE鏁版嵁澶辫触:', e)
              }
            }
          }
        } catch (readError) {
          console.error('璇诲彇SSE娴佸け璐?', readError)
          setLoading(false)
          setMessages(prev => prev.filter(msg => msg.id !== thinkingMessageId))
          setMessages(prev => [...prev, { 
            type: 'system', 
            content: `鉂?璇诲彇娴佸紡鍝嶅簲澶辫触锛?{readError.message}` 
          }])
          break
        }
      }
    } catch (error) {
      // 濡傛灉鏄姹傝鍙栨秷锛堢敤鎴峰垏鎹㈤〉闈㈡垨鍙戦€佹柊娑堟伅锛夛紝闈欓粯澶勭悊
      if (error.name === 'AbortError') {
        console.log('SSE 璇锋眰宸插彇娑?)
        setLoading(false)
        setMessages(prev => prev.filter(msg => msg.id !== thinkingMessageId))
        return
      }
      
      setLoading(false)
      // 绉婚櫎鎬濊€冭繃绋嬫秷鎭?
      setMessages(prev => prev.filter(msg => msg.id !== thinkingMessageId))
      
      let errorMessage = `鉂?缃戠粶閿欒锛?{error.message}`
      
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        errorMessage = '鉂?鏃犳硶杩炴帴鍒版湇鍔″櫒锛岃妫€鏌ュ悗绔湇鍔℃槸鍚﹁繍琛岋紙http://localhost:8000锛?
      }
      
      setMessages(prev => [...prev, { 
        type: 'system', 
        content: errorMessage 
      }])
    }
  }

  // 澶勭悊瀹屾垚鍝嶅簲鐨勮緟鍔╁嚱鏁?
  const handleCompleteResponse = (data, messageId) => {
    if (!data.success) {
      setMessages(prev => prev.map(msg => {
        if (msg.id === messageId) {
          return { ...msg, content: `鉂?${data.message || '澶勭悊澶辫触'}` }
        }
        return msg
      }))
      return
    }

    // 澶勭悊鍚勭鍝嶅簲绫诲瀷锛堜繚鎸佸悜鍚庡吋瀹癸級
    let systemMessage = data.message || ''
    
    // 濡傛灉鏈夊師濮嬫暟鎹紝鍙互鐢ㄤ簬鍥捐〃绛?
    if (data.raw_data) {
      // 鍙互鏍规嵁闇€瑕佸鐞唕aw_data
    }

    // 鏇存柊娑堟伅鍐呭锛堝鏋滈渶瑕佹坊鍔犻澶栦俊鎭級
    setMessages(prev => prev.map(msg => {
      if (msg.id === messageId) {
        return { ...msg, content: systemMessage }
      }
      return msg
    }))
  }

  // 淇濈暀鏃х殑sendMessage浣滀负澶囩敤锛堝鏋滈渶瑕佸洖閫€锛?
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
        
        // 濡傛灉鏈夋€濊€冭繃绋嬶紝鍏堟樉绀烘€濊€冭繃绋?
        if (data.thinking_steps && data.thinking_steps.length > 0) {
          systemMessage = "馃挱 澶勭悊杩囩▼锛歕n" + data.thinking_steps.join('\n') + "\n\n" + systemMessage
        }

        // 濡傛灉鏄浘琛ㄦ暟鎹紙鏌ヨ鎵€鏈夊簱瀛橈級
        if (data.chart_data) {
          systemMessage += `\n\n馃搳 搴撳瓨缁熻锛歕n` +
            `鍟嗗搧绉嶇被锛?{data.summary.total_products}绉峔n` +
            `渚涘簲鍟嗘暟閲忥細${data.summary.total_suppliers}瀹禱n` +
            `鎬诲簱瀛橈細${data.summary.total_weight.toFixed(2)}鍏媆n`
          
          setMessages(prev => [...prev, { 
            type: 'system', 
            content: systemMessage,
            chartData: data.chart_data,
            pieData: data.pie_data,
            tableData: data.table_data
          }])
        }
        // 濡傛灉鏄壒閲忓叆搴撴垚鍔?
        else if (data.order && data.details && data.details.length > 0) {
          systemMessage += `\n\n馃搵 鍏ュ簱鍗曚俊鎭細\n` +
            `鍏ュ簱鍗曞彿锛?{data.order.order_no}\n` +
            `鍟嗗搧鏁伴噺锛?{data.details.length}涓猏n\n`
          
          // 鏄剧ず姣忎釜鍟嗗搧鐨勮缁嗕俊鎭?
          data.details.forEach((detail, index) => {
            systemMessage += `鍟嗗搧${index + 1}锛歕n` +
              `  鍟嗗搧鍚嶇О锛?{detail.product_name}\n` +
              `  閲嶉噺锛?{detail.weight}鍏媆n` +
              `  宸ヨ垂锛?{detail.labor_cost}鍏?鍏媆n` +
              `  渚涘簲鍟嗭細${detail.supplier}\n` +
              `  璇ュ晢鍝佸伐璐癸細${detail.total_cost.toFixed(2)}鍏僜n\n`
          })
          
          systemMessage += `馃挵 鍚堣宸ヨ垂锛?{data.total_labor_cost.toFixed(2)}鍏僜n\n`
          
          // 鏄剧ず搴撳瓨鏇存柊
          if (data.inventories && data.inventories.length > 0) {
            systemMessage += `馃摝 搴撳瓨鏇存柊锛歕n`
            data.inventories.forEach(inv => {
              systemMessage += `  ${inv.product_name}锛?{inv.total_weight}鍏媆n`
            })
          }
          
          setMessages(prev => [...prev, { 
            type: 'system', 
            content: systemMessage 
          }])
        }
        // 鍚戝悗鍏煎锛氬崟涓晢鍝佸叆搴擄紙鏃ф牸寮忥級
        else if (data.order && data.detail && data.inventory) {
          systemMessage += `\n\n馃搵 鍏ュ簱鍗曚俊鎭細\n` +
            `鍏ュ簱鍗曞彿锛?{data.order.order_no}\n` +
            `鍟嗗搧鍚嶇О锛?{data.detail.product_name}\n` +
            `閲嶉噺锛?{data.detail.weight}鍏媆n` +
            `宸ヨ垂锛?{data.detail.labor_cost}鍏?鍏媆n` +
            `渚涘簲鍟嗭細${data.detail.supplier}\n` +
            `鎬绘垚鏈細${data.detail.total_cost.toFixed(2)}鍏僜n\n` +
            `馃摝 褰撳墠搴撳瓨锛?{data.inventory.total_weight}鍏媊

          setMessages(prev => [...prev, { 
            type: 'system', 
            content: systemMessage 
          }])
        }
        // 濡傛灉鏄煡璇㈠崟涓簱瀛橈紙淇濈暀鍚戝悗鍏煎锛?
        else if (data.inventory && !data.order) {
          systemMessage += `\n\n馃摝 搴撳瓨淇℃伅锛歕n` +
            `鍟嗗搧鍚嶇О锛?{data.inventory.product_name}\n` +
            `鎬婚噸閲忥細${data.inventory.total_weight}鍏媆n`
          
          // 鏄剧ず鎵€鏈夊伐璐规槑缁?
          if (data.inventory.labor_cost_details && data.inventory.labor_cost_details.length > 0) {
            systemMessage += `\n馃挵 宸ヨ垂鏄庣粏锛歕n`
            data.inventory.labor_cost_details.forEach((detail, idx) => {
              systemMessage += `  璁板綍${idx + 1}锛氬伐璐?{detail.labor_cost.toFixed(2)}鍏?鍏嬶紝閲嶉噺${detail.weight}鍏嬶紝鎬诲伐璐?{detail.total_cost.toFixed(2)}鍏冿紙鍏ュ簱鍗曪細${detail.order_no}锛塡n`
            })
          }
          
          systemMessage += (data.inventory.last_update ? 
            `\n鏈€鍚庢洿鏂帮細${new Date(data.inventory.last_update).toLocaleString('zh-CN')}` : 
            '')

          setMessages(prev => [...prev, { 
            type: 'system', 
            content: systemMessage,
            laborCostDetails: data.inventory.labor_cost_details  // 鐢ㄤ簬琛ㄦ牸灞曠ず
          }])
          return
        }
        // 濡傛灉鏄煡璇㈡墍鏈夊簱瀛橈紙杩斿洖inventories鏁扮粍锛? 淇濈暀鍚戝悗鍏煎
        else if (data.inventories && Array.isArray(data.inventories) && data.inventories.length > 0 && !data.action) {
          systemMessage += `\n\n馃摝 鍟嗗搧鍒楄〃锛歕n`
          data.inventories.forEach((inv, idx) => {
            systemMessage += `${idx + 1}. ${inv.product_name}锛?{inv.total_weight}鍏媊
            if (inv.latest_labor_cost) {
              systemMessage += `锛屾渶鏂板伐璐癸細${inv.latest_labor_cost}鍏?鍏媊
            }
            if (inv.avg_labor_cost) {
              systemMessage += `锛屽钩鍧囧伐璐癸細${inv.avg_labor_cost.toFixed(2)}鍏?鍏媊
            }
            systemMessage += `\n`
          })
          
          if (data.total_weight) {
            systemMessage += `\n馃挵 鎬诲簱瀛橈細${data.total_weight.toFixed(2)}鍏媊
          }
          
          setMessages(prev => [...prev, { 
            type: 'system', 
            content: systemMessage 
          }])
          return
        }
        // 濡傛灉鏄煡璇㈠叆搴撳崟璇︽儏锛堜繚鐣欏悜鍚庡吋瀹癸級
        else if (data.order && data.details && !data.order.order_no.startsWith('XS')) {
          systemMessage += `\n\n馃搵 鍏ュ簱鍗曡鎯咃細\n` +
            `鍏ュ簱鍗曞彿锛?{data.order.order_no}\n` +
            `鍏ュ簱鏃堕棿锛?{new Date(data.order.create_time).toLocaleString('zh-CN')}\n` +
            `鐘舵€侊細${data.order.status}\n\n` +
            `鍟嗗搧鏄庣粏锛歕n`
          data.details.forEach((detail, idx) => {
            systemMessage += `${idx + 1}. ${detail.product_category || detail.product_name}锛?{detail.weight}鍏嬶紝宸ヨ垂${detail.labor_cost}鍏?鍏嬶紝鎬诲伐璐?{detail.total_cost.toFixed(2)}鍏僜n`
          })
          
          setMessages(prev => [...prev, { 
            type: 'system', 
            content: systemMessage 
          }])
          return
        }
        // 濡傛灉鏄煡璇㈡渶杩戠殑鍏ュ簱鍗曞垪琛紙淇濈暀鍚戝悗鍏煎锛?
        else if (data.orders && Array.isArray(data.orders) && data.orders.length > 0 && !data.orders[0].order_no.startsWith('XS')) {
          systemMessage += `\n\n馃搵 鏈€杩戠殑鍏ュ簱鍗曪細\n`
          data.orders.forEach((order, idx) => {
            systemMessage += `${idx + 1}. ${order.order_no} - ${new Date(order.create_time).toLocaleString('zh-CN')} (${order.status})\n`
          })
          
          setMessages(prev => [...prev, { 
            type: 'system', 
            content: systemMessage 
          }])
          return
        }
        // 澶勭悊閿€鍞崟鍒涘缓鎴愬姛
        else if (data.order && data.order.order_no && data.order.order_no.startsWith('XS')) {
          // 杩欐槸閿€鍞崟锛堥攢鍞崟鍙蜂互XS寮€澶达級
          systemMessage += `\n\n馃搵 閿€鍞崟淇℃伅锛歕n` +
            `閿€鍞崟鍙凤細${data.order.order_no}\n` +
            `瀹㈡埛锛?{data.order.customer_name}\n` +
            `涓氬姟鍛橈細${data.order.salesperson}\n` +
            `闂ㄥ簵浠ｇ爜锛?{data.order.store_code || '鏈～鍐?}\n` +
            `鏃ユ湡锛?{new Date(data.order.order_date).toLocaleString('zh-CN')}\n` +
            `鐘舵€侊細${data.order.status}\n\n` +
            `鍟嗗搧鏄庣粏锛歕n`
          
          if (data.order.details && data.order.details.length > 0) {
            data.order.details.forEach((detail, idx) => {
              systemMessage += `${idx + 1}. ${detail.product_name}锛?{detail.weight}鍏嬶紝宸ヨ垂${detail.labor_cost}鍏?鍏嬶紝鎬诲伐璐?{detail.total_labor_cost.toFixed(2)}鍏僜n`
            })
          }
          
          systemMessage += `\n馃挵 鍚堣锛歕n` +
            `鎬诲厠閲嶏細${data.order.total_weight}鍏媆n` +
            `鎬诲伐璐癸細${data.order.total_labor_cost.toFixed(2)}鍏僠
          
          setMessages(prev => [...prev, { 
            type: 'system', 
            content: systemMessage,
            salesOrder: data.order  // 淇濆瓨瀹屾暣鏁版嵁鐢ㄤ簬鍚庣画灞曠ず
          }])
        }
        // 澶勭悊閿€鍞崟鍒楄〃鏌ヨ
        else if (data.orders && Array.isArray(data.orders) && data.orders.length > 0 && data.orders[0].order_no && data.orders[0].order_no.startsWith('XS')) {
          systemMessage += `\n\n馃搵 閿€鍞崟鍒楄〃锛歕n`
          data.orders.forEach((order, idx) => {
            systemMessage += `${idx + 1}. ${order.order_no} - ${order.customer_name} - ${new Date(order.order_date).toLocaleString('zh-CN')} - ${order.status}\n`
          })
          
          setMessages(prev => [...prev, { 
            type: 'system', 
            content: systemMessage,
            salesOrders: data.orders
          }])
        }
        // 澶勭悊瀹㈡埛鍒涘缓/鏌ヨ
        else if (data.customer) {
          systemMessage += `\n\n馃懁 瀹㈡埛淇℃伅锛歕n` +
            `瀹㈡埛缂栧彿锛?{data.customer.customer_no}\n` +
            `瀹㈡埛濮撳悕锛?{data.customer.name}\n` +
            `鐢佃瘽锛?{data.customer.phone || '鏈～鍐?}\n` +
            `绫诲瀷锛?{data.customer.customer_type}\n` +
            `绱璐拱锛?{data.customer.total_purchase_amount.toFixed(2)}鍏僜n` +
            `璐拱娆℃暟锛?{data.customer.total_purchase_count}娆
          
          setMessages(prev => [...prev, { 
            type: 'system', 
            content: systemMessage 
          }])
        }
        // 澶勭悊瀹㈡埛鍒楄〃鏌ヨ
        else if (data.customers && Array.isArray(data.customers)) {
          systemMessage += `\n\n馃懁 瀹㈡埛鍒楄〃锛歕n` +
            `鍏?${data.customers.length} 浣嶅鎴穃n\n`
          
          data.customers.forEach((customer, idx) => {
            systemMessage += `${idx + 1}. ${customer.name} (${customer.customer_no}) - ${customer.phone || '鏃犵數璇?} - 绱璐拱${customer.total_purchase_amount.toFixed(2)}鍏僜n`
          })
          
          setMessages(prev => [...prev, { 
            type: 'system', 
            content: systemMessage 
          }])
        }
        // 澶勭悊搴撳瓨妫€鏌ラ敊璇?
        else if (data.inventory_errors && Array.isArray(data.inventory_errors)) {
          systemMessage += `\n\n鉂?搴撳瓨妫€鏌ュけ璐ワ細\n`
          data.inventory_errors.forEach((error, idx) => {
            systemMessage += `${idx + 1}. ${error.product_name}锛?{error.error}\n` +
              `   闇€瑕侊細${error.required_weight}鍏媆n` +
              `   鍙敤锛?{error.available_weight}鍏媆n`
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
        
        // 濡傛灉鏈夋€濊€冭繃绋嬶紝鍏堟樉绀烘€濊€冭繃绋?
        if (data.thinking_steps && data.thinking_steps.length > 0) {
          errorMessage = "馃挱 澶勭悊杩囩▼锛歕n" + data.thinking_steps.join('\n') + "\n\n" + errorMessage
        }
        
        // 澶勭悊搴撳瓨妫€鏌ラ敊璇紙鍦ㄩ敊璇搷搴斾腑锛?
        if (data.inventory_errors && Array.isArray(data.inventory_errors)) {
          errorMessage += `\n\n鉂?搴撳瓨妫€鏌ュけ璐ワ細\n`
          data.inventory_errors.forEach((error, idx) => {
            errorMessage += `${idx + 1}. ${error.product_name}锛?{error.error}\n` +
              `   闇€瑕侊細${error.required_weight}鍏媆n` +
              `   鍙敤锛?{error.available_weight}鍏媆n`
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
        
        // 濡傛灉鏈夌己澶卞瓧娈靛垪琛紝鏍煎紡鍖栨樉绀?
        if (data.missing_fields && data.missing_fields.length > 0) {
          errorMessage += `\n\n鉂?缂哄け鐨勫繀濉」锛歕n`
          data.missing_fields.forEach(field => {
            errorMessage += `  鈥?${field}\n`
          })
          errorMessage += `\n璇疯ˉ鍏呭畬鏁翠俊鎭悗閲嶆柊鎻愪氦銆俙
        }
        
        // 濡傛灉鏄渚涘簲鍟嗛敊璇紝娣诲姞瑙勫垯璇存槑
        if (data.suppliers && Array.isArray(data.suppliers) && data.suppliers.length > 1) {
          errorMessage += `\n\n馃搵 绯荤粺瑙勫垯鎻愰啋锛歕n`
          errorMessage += `姣忓紶鍏ュ簱鍗曞彧鑳藉搴斾竴涓緵搴斿晢銆傚鏋滀竴娆″叆搴撳寘鍚涓緵搴斿晢鐨勫晢鍝侊紝璇锋寜渚涘簲鍟嗘媶鍒嗕负澶氬紶鍏ュ簱鍗曞垎鍒彁浜ゃ€俓n`
          errorMessage += `渚嬪锛氬厛鎻愪氦"渚涘簲鍟咥鐨勫晢鍝?銆佸晢鍝?"锛屽啀鎻愪氦"渚涘簲鍟咮鐨勫晢鍝?銆佸晢鍝?"銆俙
        }
        
        setMessages(prev => [...prev, { 
          type: 'system', 
          content: errorMessage 
        }])
      }
    } catch (error) {
      setLoading(false)
      let errorMessage = `鉂?缃戠粶閿欒锛?{error.message}`
      
      // 鎻愪緵鏇磋缁嗙殑閿欒淇℃伅
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        errorMessage = '鉂?鏃犳硶杩炴帴鍒版湇鍔″櫒锛岃妫€鏌ュ悗绔湇鍔℃槸鍚﹁繍琛岋紙http://localhost:8000锛?
      } else if (error.name === 'AbortError') {
        errorMessage = '鉂?璇锋眰瓒呮椂锛岃绋嶅悗閲嶈瘯'
      }
      
      setMessages(prev => [...prev, { 
        type: 'system', 
        content: errorMessage 
      }])
    }
  }

  // 澶勭悊鍥剧墖涓婁紶
  const handleImageUpload = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    // 楠岃瘉鏂囦欢绫诲瀷
    if (!file.type.startsWith('image/')) {
      setMessages(prev => [...prev, {
        type: 'system',
        content: '鉂?璇蜂笂浼犲浘鐗囨枃浠讹紙jpg銆乸ng绛夋牸寮忥級'
      }])
      return
    }

    // 楠岃瘉鏂囦欢澶у皬锛堥檺鍒?0MB锛?
    if (file.size > 10 * 1024 * 1024) {
      setMessages(prev => [...prev, {
        type: 'system',
        content: '鉂?鍥剧墖鏂囦欢杩囧ぇ锛岃涓婁紶灏忎簬10MB鐨勫浘鐗?
      }])
      return
    }

    setUploading(true)
    
    // 淇濆瓨鍥剧墖棰勮锛堜娇鐢≒romise纭繚鍥剧墖鍔犺浇瀹屾垚锛?
    const imageDataUrlPromise = new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        const imageDataUrl = e.target.result
        setUploadedImage(imageDataUrl)
        
        // 鏄剧ず鐢ㄦ埛涓婁紶鐨勫浘鐗?
        setMessages(prev => [...prev, {
          type: 'user',
          content: `馃摲 涓婁紶鍏ュ簱鍗曞浘鐗囷細${file.name}`,
          image: imageDataUrl
        }])
        
        resolve(imageDataUrl)
      }
      reader.readAsDataURL(file)
    })

    try {
      const formData = new FormData()
      formData.append('file', file)

      // 璋冪敤璇嗗埆鎺ュ彛锛堝彧璇嗗埆锛屼笉鍏ュ簱锛?
      const response = await fetch(API_ENDPOINTS.RECOGNIZE_INBOUND_SHEET, {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()
      setUploading(false)

      // 绛夊緟鍥剧墖鍔犺浇瀹屾垚
      const imageDataUrl = await imageDataUrlPromise

      if (data.success) {
        // OCR瀹屾垚鍚庢墦寮€瀵硅瘽妗?
        handleOCRComplete(data.recognized_text, imageDataUrl)
        
        let systemMessage = "鉁?鍥剧墖璇嗗埆瀹屾垚锛乗n\n"
        
        // 鏄剧ず鎬濊€冭繃绋?
        if (data.thinking_steps && data.thinking_steps.length > 0) {
          systemMessage += "馃挱 澶勭悊杩囩▼锛歕n" + data.thinking_steps.join('\n') + "\n\n"
        }

        systemMessage += "馃摑 璇嗗埆鍑虹殑鏂囧瓧鍐呭宸叉樉绀哄湪缂栬緫瀵硅瘽妗嗕腑锛岃浠旂粏瀹℃牳骞剁紪杈戙€?

        setMessages(prev => [...prev, {
          type: 'system',
          content: systemMessage
        }])
      } else {
        let errorMessage = data.message
        
        // 鏄剧ず鎬濊€冭繃绋?
        if (data.thinking_steps && data.thinking_steps.length > 0) {
          errorMessage = "馃挱 澶勭悊杩囩▼锛歕n" + data.thinking_steps.join('\n') + "\n\n" + errorMessage
        }
        
        // 濡傛灉璇嗗埆澶辫触浣嗘湁閮ㄥ垎鏂囧瓧锛屼篃鎵撳紑瀵硅瘽妗?
        if (data.recognized_text && data.recognized_text.trim().length > 0) {
          const imageDataUrl = await imageDataUrlPromise
          handleOCRComplete(data.recognized_text, imageDataUrl)
          errorMessage += `\n\n馃摑 宸茶瘑鍒嚭閮ㄥ垎鏂囧瓧锛堝凡鏄剧ず鍦ㄧ紪杈戝璇濇涓級锛屾偍鍙互鎵嬪姩淇鍚庣‘璁ゅ叆搴撱€俙
        }

        setMessages(prev => [...prev, {
          type: 'system',
          content: errorMessage
        }])
      }
    } catch (error) {
      setUploading(false)
      let errorMessage = `鉂?涓婁紶澶辫触锛?{error.message}`
      
      // 鎻愪緵鏇磋缁嗙殑閿欒淇℃伅
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        errorMessage = '鉂?鏃犳硶杩炴帴鍒版湇鍔″櫒锛岃妫€鏌ュ悗绔湇鍔℃槸鍚﹁繍琛岋紙http://localhost:8000锛?
      } else if (error.name === 'AbortError') {
        errorMessage = '鉂?涓婁紶瓒呮椂锛岃妫€鏌ョ綉缁滆繛鎺ユ垨绋嶅悗閲嶈瘯'
      }
      
      setMessages(prev => [...prev, {
        type: 'system',
        content: errorMessage
      }])
    }

    // 娓呯┖鏂囦欢杈撳叆
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  // OCR瀹屾垚鍚庢墦寮€瀵硅瘽妗?
  const handleOCRComplete = (text, imageUrl) => {
    setOcrResult(text || '')
    setUploadedImage(imageUrl)
    setShowOCRModal(true)
  }

  // 纭鍏ュ簱
  const handleConfirmInbound = async () => {
    const textToSend = ocrResult.trim()
    if (!textToSend) {
      alert('璇疯緭鍏ュ唴瀹?)
      return
    }

    // 鍏抽棴瀵硅瘽妗?
    setShowOCRModal(false)
    setUploadedImage(null)
    const textToProcess = ocrResult
    setOcrResult('')

    // 鏄剧ず鐢ㄦ埛娑堟伅
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
        
        // 濡傛灉鏈夋€濊€冭繃绋嬶紝鍏堟樉绀烘€濊€冭繃绋?
        if (data.thinking_steps && data.thinking_steps.length > 0) {
          systemMessage = "馃挱 澶勭悊杩囩▼锛歕n" + data.thinking_steps.join('\n') + "\n\n" + systemMessage
        }

        // 濡傛灉鏄浘琛ㄦ暟鎹紙鏌ヨ鎵€鏈夊簱瀛橈級
        if (data.chart_data) {
          systemMessage += `\n\n馃搳 搴撳瓨缁熻锛歕n` +
            `鍟嗗搧绉嶇被锛?{data.summary.total_products}绉峔n` +
            `渚涘簲鍟嗘暟閲忥細${data.summary.total_suppliers}瀹禱n` +
            `鎬诲簱瀛橈細${data.summary.total_weight.toFixed(2)}鍏媆n`
          
          setMessages(prev => [...prev, { 
            type: 'system', 
            content: systemMessage,
            chartData: data.chart_data,
            pieData: data.pie_data,
            tableData: data.table_data
          }])
        }
        // 濡傛灉鏄壒閲忓叆搴撴垚鍔?
        else if (data.order && data.details && data.details.length > 0 && data.order.order_no && data.order.order_no.startsWith('RK')) {
          systemMessage += `\n\n馃搵 鍏ュ簱鍗曚俊鎭細\n` +
            `鍏ュ簱鍗曞彿锛?{data.order.order_no}\n` +
            `鍟嗗搧鏁伴噺锛?{data.details.length}涓猏n\n`
          
          data.details.forEach((detail, index) => {
            systemMessage += `鍟嗗搧${index + 1}锛歕n` +
              `  鍟嗗搧鍚嶇О锛?{detail.product_category || detail.product_name}\n` +
              `  閲嶉噺锛?{detail.weight}鍏媆n` +
              `  宸ヨ垂锛?{detail.labor_cost}鍏?鍏媆n` +
              `  渚涘簲鍟嗭細${detail.supplier}\n` +
              `  璇ュ晢鍝佸伐璐癸細${detail.total_cost.toFixed(2)}鍏僜n\n`
          })
          
          systemMessage += `馃挵 鍚堣宸ヨ垂锛?{data.total_labor_cost.toFixed(2)}鍏僜n\n`
          
          if (data.inventories && data.inventories.length > 0) {
            systemMessage += `馃摝 搴撳瓨鏇存柊锛歕n`
            data.inventories.forEach(inv => {
              systemMessage += `  ${inv.product_name}锛?{inv.total_weight}鍏媆n`
            })
          }

          setMessages(prev => [...prev, {
            type: 'system',
            content: systemMessage
          }])
        }
        // 澶勭悊閿€鍞崟鍒涘缓鎴愬姛锛圤CR纭鍚庝篃鍙兘鍒涘缓閿€鍞崟锛?
        else if (data.order && data.order.order_no && data.order.order_no.startsWith('XS')) {
          systemMessage += `\n\n馃搵 閿€鍞崟淇℃伅锛歕n` +
            `閿€鍞崟鍙凤細${data.order.order_no}\n` +
            `瀹㈡埛锛?{data.order.customer_name}\n` +
            `涓氬姟鍛橈細${data.order.salesperson}\n` +
            `闂ㄥ簵浠ｇ爜锛?{data.order.store_code || '鏈～鍐?}\n` +
            `鏃ユ湡锛?{new Date(data.order.order_date).toLocaleString('zh-CN')}\n` +
            `鐘舵€侊細${data.order.status}\n\n` +
            `鍟嗗搧鏄庣粏锛歕n`
          
          if (data.order.details && data.order.details.length > 0) {
            data.order.details.forEach((detail, idx) => {
              systemMessage += `${idx + 1}. ${detail.product_name}锛?{detail.weight}鍏嬶紝宸ヨ垂${detail.labor_cost}鍏?鍏嬶紝鎬诲伐璐?{detail.total_labor_cost.toFixed(2)}鍏僜n`
            })
          }
          
          systemMessage += `\n馃挵 鍚堣锛歕n` +
            `鎬诲厠閲嶏細${data.order.total_weight}鍏媆n` +
            `鎬诲伐璐癸細${data.order.total_labor_cost.toFixed(2)}鍏僠
          
          setMessages(prev => [...prev, { 
            type: 'system', 
            content: systemMessage,
            salesOrder: data.order
          }])
        }
        // 濡傛灉鏄煡璇㈡墍鏈夊簱瀛橈紙杩斿洖inventories鏁扮粍锛?
        else if (data.inventories && Array.isArray(data.inventories) && data.inventories.length > 0) {
          systemMessage += `\n\n馃摝 鍟嗗搧鍒楄〃锛歕n`
          data.inventories.forEach((inv, idx) => {
            systemMessage += `${idx + 1}. ${inv.product_name}锛?{inv.total_weight}鍏媊
            if (inv.latest_labor_cost) {
              systemMessage += `锛屾渶鏂板伐璐癸細${inv.latest_labor_cost}鍏?鍏媊
            }
            if (inv.avg_labor_cost) {
              systemMessage += `锛屽钩鍧囧伐璐癸細${inv.avg_labor_cost.toFixed(2)}鍏?鍏媊
            }
            systemMessage += `\n`
          })
          
          if (data.total_weight) {
            systemMessage += `\n馃挵 鎬诲簱瀛橈細${data.total_weight.toFixed(2)}鍏媊
          }
          
          setMessages(prev => [...prev, { 
            type: 'system', 
            content: systemMessage 
          }])
        }
        // 澶勭悊搴撳瓨妫€鏌ラ敊璇?
        else if (data.inventory_errors && Array.isArray(data.inventory_errors)) {
          systemMessage += `\n\n鉂?搴撳瓨妫€鏌ュけ璐ワ細\n`
          data.inventory_errors.forEach((error, idx) => {
            systemMessage += `${idx + 1}. ${error.product_name}锛?{error.error}\n` +
              `   闇€瑕侊細${error.required_weight}鍏媆n` +
              `   鍙敤锛?{error.available_weight}鍏媆n`
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
        // 澶勭悊搴撳瓨妫€鏌ラ敊璇紙閲嶅浠ｇ爜锛屼繚鐣欎互闃蹭竾涓€锛?
        else if (data.inventory_errors && Array.isArray(data.inventory_errors)) {
          systemMessage += `\n\n鉂?搴撳瓨妫€鏌ュけ璐ワ細\n`
          data.inventory_errors.forEach((error, idx) => {
            systemMessage += `${idx + 1}. ${error.product_name}锛?{error.error}\n` +
              `   闇€瑕侊細${error.required_weight}鍏媆n` +
              `   鍙敤锛?{error.available_weight}鍏媆n`
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
          errorMessage = "馃挱 澶勭悊杩囩▼锛歕n" + data.thinking_steps.join('\n') + "\n\n" + errorMessage
        }

        // 澶勭悊搴撳瓨妫€鏌ラ敊璇紙鍦ㄩ敊璇搷搴斾腑锛?
        if (data.inventory_errors && Array.isArray(data.inventory_errors)) {
          errorMessage += `\n\n鉂?搴撳瓨妫€鏌ュけ璐ワ細\n`
          data.inventory_errors.forEach((error, idx) => {
            errorMessage += `${idx + 1}. ${error.product_name}锛?{error.error}\n` +
              `   闇€瑕侊細${error.required_weight}鍏媆n` +
              `   鍙敤锛?{error.available_weight}鍏媆n`
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

        // 濡傛灉鏄渚涘簲鍟嗛敊璇紝娣诲姞瑙勫垯璇存槑
        if (data.suppliers && Array.isArray(data.suppliers) && data.suppliers.length > 1) {
          errorMessage += `\n\n馃搵 绯荤粺瑙勫垯鎻愰啋锛歕n`
          errorMessage += `姣忓紶鍏ュ簱鍗曞彧鑳藉搴斾竴涓緵搴斿晢銆傚鏋滀竴娆″叆搴撳寘鍚涓緵搴斿晢鐨勫晢鍝侊紝璇锋寜渚涘簲鍟嗘媶鍒嗕负澶氬紶鍏ュ簱鍗曞垎鍒彁浜ゃ€俓n`
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
        content: `鉂?缃戠粶閿欒锛?{error.message}`
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
      {/* 宸︿晶杈规爮 - 鍘嗗彶瀵硅瘽璁板綍 */}
      <aside className={`
        ${sidebarOpen ? 'w-80' : 'w-0'} 
        ${sidebarOpen ? 'flex' : 'hidden'}
        lg:!flex lg:w-80
        transition-all duration-300 ease-in-out
        bg-gradient-to-b from-jewelry-navy to-jewelry-navy-dark
        flex-col
        overflow-hidden
      `}>
        {/* 渚ц竟鏍忓ご閮?*/}
        <div className="px-6 py-5 border-b border-white/10 flex items-center justify-between">
          <h2 className="text-[17px] font-semibold text-white tracking-tight">{t('sidebar.title')}</h2>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden p-2 hover:bg-white/10 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        {/* 鏂板缓瀵硅瘽鎸夐挳 */}
        <div className="px-6 py-4 border-b border-white/10">
          <button
            onClick={newConversation}
            className="w-full px-4 py-2.5 bg-gradient-to-r from-jewelry-gold to-jewelry-gold-light text-white rounded-xl 
                       hover:from-jewelry-gold-dark hover:to-jewelry-gold transition-all duration-200 font-medium text-[15px] shadow-md"
          >
            {t('sidebar.newChat')}
          </button>
        </div>
        
        {/* 瀵硅瘽鍒楄〃 */}
        <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-white/20">
          {conversationHistory.length === 0 ? (
            <div className="px-6 py-8 text-center text-white/50 text-sm">
              {t('sidebar.noRecords')}
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
                      ? 'bg-jewelry-gold/20 border border-jewelry-gold/40' 
                      : 'hover:bg-white/10 border border-transparent'
                    }
                    group
                  `}
                  onClick={() => loadConversation(conv.id)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className={`text-[15px] font-medium truncate mb-1 ${currentConversationId === conv.id ? 'text-jewelry-gold-light' : 'text-white'}`}>
                        {conv.title}
                      </div>
                      <div className="text-xs text-white/50">
                        {new Date(conv.updatedAt).toLocaleDateString('zh-CN', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </div>
                    </div>
                    {/* 鍙湁绠＄悊鍛樺彲浠ュ垹闄ゅ璇濊褰?*/}
                    {userRole === 'manager' && (
                      <button
                        onClick={(e) => deleteConversation(conv.id, e)}
                        className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/20 rounded-lg transition-all"
                        title="鍒犻櫎瀵硅瘽"
                      >
                        <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

      {/* 涓诲唴瀹瑰尯鍩?*/}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 椤堕儴瀵艰埅鏍?- 鑻规灉椋庢牸 */}
        <header className="bg-white/80 backdrop-blur-xl border-b border-gray-200/60 px-6 py-4 
                           sticky top-0 z-10 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              {/* 绉诲姩绔晶杈规爮寮€鍏?*/}
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
                title={currentLanguage === 'en' ? 'Click to return home' : '鐐瑰嚮杩斿洖棣栭〉'}
              >
                <h1 className="text-[28px] font-semibold text-gray-900 tracking-tight">
                  {t('app.title')}
                </h1>
                <p className="text-[13px] text-gray-500 mt-0.5">{t('app.subtitle')}</p>
              </div>
            </div>
            
            {/* 鍙充晶鎸夐挳鍖哄煙 */}
            <div className="flex items-center space-x-3">
              {/* 瑙掕壊閫夋嫨鍣?*/}
              <div className="relative" ref={roleDropdownRef}>
                <button
                  onClick={() => !roleLoading && setRoleDropdownOpen(!roleDropdownOpen)}
                  disabled={roleLoading}
                  className={`flex items-center space-x-2 px-3 py-2 rounded-xl border border-gray-200
                             hover:bg-gray-50 transition-all duration-200 font-medium text-[14px]
                             ${getCurrentRole().bg} ${roleLoading ? 'opacity-70 cursor-wait' : ''}`}
                >
                  {roleLoading ? (
                    <svg className="animate-spin w-4 h-4 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  ) : (
                    React.createElement(getCurrentRole().icon, { 
                      className: `w-4 h-4 ${getCurrentRole().color}` 
                    })
                  )}
                  <span className={getCurrentRole().color}>
                    {roleLoading ? '鍒囨崲涓?..' : getCurrentRole().name}
                  </span>
                  <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-200 
                                          ${roleDropdownOpen ? 'rotate-180' : ''}`} />
                </button>
                
                {/* 涓嬫媺鑿滃崟 */}
                {roleDropdownOpen && (
                  <div className="absolute right-0 mt-2 w-44 bg-white rounded-xl shadow-lg border border-gray-100 
                                  py-2 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="px-3 py-2 text-xs text-gray-400 font-medium">{currentLanguage === 'en' ? 'Select Role' : '閫夋嫨瑙掕壊'}</div>
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

              {/* 閿€鍞鐞嗘寜閽?- 鏌滃彴銆佺粨绠椼€佷笟鍔″彲瑙?*/}
              {['counter', 'settlement', 'sales'].includes(userRole) && (
                <button
                  onClick={() => setShowSalesSearchModal(true)}
                  className="flex items-center space-x-1.5 px-3 py-2 rounded-xl border border-amber-200
                             bg-amber-50 hover:bg-amber-100 transition-all duration-200 font-medium text-[14px] text-amber-700"
                  title="閿€鍞鐞?
                >
                  <FileText className="w-4 h-4" />
                  <span>閿€鍞鐞?/span>
                </button>
              )}

              {/* 璇█鍒囨崲鎸夐挳 */}
              <button
                onClick={() => {
                  const newLang = currentLanguage === 'zh' ? 'en' : 'zh'
                  i18n.changeLanguage(newLang)
                  localStorage.setItem('i18nextLng', newLang)
                }}
                className="flex items-center space-x-1.5 px-3 py-2 rounded-xl border border-gray-200
                           hover:bg-gray-50 transition-all duration-200 font-medium text-[14px] text-gray-600"
                title={t('language.switchLanguage')}
              >
                <span className="text-base">{currentLanguage === 'zh' ? '馃嚚馃嚦' : '馃嚭馃嚫'}</span>
                <span>{currentLanguage === 'zh' ? '涓枃' : 'EN'}</span>
              </button>

              {/* 瀵艰埅鎸夐挳 */}
              {currentPage === 'chat' ? (
                <>
                  {/* 浠〃鐩樻寜閽?- 绠＄悊灞傚揩閫熸煡鐪?*/}
                  {hasPermission(userRole, 'canViewAnalytics') && (
                    <button
                      onClick={() => setCurrentPage('dashboard')}
                      className="flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-xl 
                                 hover:from-blue-600 hover:to-indigo-600 transition-all duration-200 font-medium text-[15px] 
                                 shadow-sm hover:shadow-md"
                    >
                      <TrendingUp className="w-4 h-4" />
                      <span>浠〃鐩?/span>
                    </button>
                  )}
                  {/* 鏁版嵁鍒嗘瀽鎸夐挳 - 浣跨敤鏉冮檺妫€鏌?*/}
                  {hasPermission(userRole, 'canViewAnalytics') && (
                    <>
                      <button
                        onClick={() => setCurrentPage('analytics')}
                        className="flex items-center space-x-2 px-4 py-2 bg-purple-500 text-white rounded-xl 
                                   hover:bg-purple-600 transition-all duration-200 font-medium text-[15px] 
                                   shadow-sm hover:shadow-md"
                      >
                        <BarChart3 className="w-4 h-4" />
                        <span>鏁版嵁鍒嗘瀽</span>
                      </button>
                      <button
                        onClick={() => setCurrentPage('export')}
                        className="flex items-center space-x-2 px-4 py-2 bg-green-500 text-white rounded-xl 
                                   hover:bg-green-600 transition-all duration-200 font-medium text-[15px] 
                                   shadow-sm hover:shadow-md"
                      >
                        <Download className="w-4 h-4" />
                        <span>鏁版嵁瀵煎嚭</span>
                      </button>
                    </>
                  )}
                  {/* 涓氬姟鍛樼鐞嗘寜閽?- 浣跨敤鏉冮檺妫€鏌?*/}
                  {hasPermission(userRole, 'canManageSalespersons') && (
                    <button
                      onClick={() => setCurrentPage('salesperson')}
                      className="flex items-center space-x-2 px-4 py-2 bg-indigo-500 text-white rounded-xl 
                                 hover:bg-indigo-600 transition-all duration-200 font-medium text-[15px] 
                                 shadow-sm hover:shadow-md"
                    >
                      <Users className="w-4 h-4" />
                      <span>涓氬姟鍛樼鐞?/span>
                    </button>
                  )}
                  {/* 鍒嗕粨搴撳瓨鎸夐挳 - 鏌滃彴(鎺ユ敹) + 鍟嗗搧涓撳憳(杞Щ) + 绠＄悊灞?*/}
                  {(hasPermission(userRole, 'canReceiveTransfer') || hasPermission(userRole, 'canTransfer')) && (
                    <button
                      onClick={() => setCurrentPage('warehouse')}
                      className="relative flex items-center space-x-2 px-4 py-2 border-2 border-jewelry-navy text-jewelry-navy rounded-xl 
                                 hover:bg-jewelry-navy hover:text-white transition-all duration-200 font-medium text-[15px]"
                    >
                      <Warehouse className="w-4 h-4" />
                      <span>{t('nav.warehouse')}</span>
                      {/* 寰呭鐞嗚浆绉诲崟鏁伴噺badge */}
                      {pendingTransferCount > 0 && (
                        <span className="absolute -top-2 -right-2 min-w-[20px] h-5 flex items-center justify-center 
                                         bg-red-500 text-white text-xs font-bold rounded-full px-1.5 
                                         shadow-lg animate-pulse">
                          {pendingTransferCount > 99 ? '99+' : pendingTransferCount}
                        </span>
                      )}
                    </button>
                  )}
                  {/* 缁撶畻绠＄悊鎸夐挳 - 浣跨敤鏉冮檺妫€鏌?*/}
                  {hasPermission(userRole, 'canCreateSettlement') && (
                    <button
                      onClick={() => setCurrentPage('settlement')}
                      className="relative flex items-center space-x-2 px-4 py-2 border-2 border-jewelry-navy text-jewelry-navy rounded-xl 
                                 hover:bg-jewelry-navy hover:text-white transition-all duration-200 font-medium text-[15px]"
                    >
                      <Calculator className="w-4 h-4" />
                      <span>{t('nav.settlement')}</span>
                      {/* 寰呯粨绠楅攢鍞崟鏁伴噺badge */}
                      {pendingSalesCount > 0 && (
                        <span className="absolute -top-2 -right-2 min-w-[20px] h-5 flex items-center justify-center 
                                         bg-red-500 text-white text-xs font-bold rounded-full px-1.5 
                                         shadow-lg animate-pulse">
                          {pendingSalesCount > 99 ? '99+' : pendingSalesCount}
                        </span>
                      )}
                    </button>
                  )}
                  {/* 蹇嵎寮€鍗曟寜閽?- 浣跨敤鏉冮檺妫€鏌?*/}
                  {hasPermission(userRole, 'canCreateSales') && (
                    <button
                      onClick={() => setShowQuickOrderModal(true)}
                      className="flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-jewelry-gold to-jewelry-gold-light text-white rounded-xl 
                                 hover:from-jewelry-gold-dark hover:to-jewelry-gold transition-all duration-200 font-medium text-[15px] 
                                 shadow-sm hover:shadow-md"
                    >
                      <FileText className="w-4 h-4" />
                      <span>{t('nav.quickOrder')}</span>
                    </button>
                  )}
                  {/* 瀹㈡埛绠＄悊鎸夐挳 - 浣跨敤鏉冮檺妫€鏌ワ紙鏌ョ湅鎴栫鐞嗘潈闄愶級 */}
                  {(hasPermission(userRole, 'canViewCustomers') || hasPermission(userRole, 'canManageCustomers')) && (
                    <button
                      onClick={() => setCurrentPage('customer')}
                      className="flex items-center space-x-2 px-4 py-2 border-2 border-jewelry-navy text-jewelry-navy rounded-xl 
                                 hover:bg-jewelry-navy hover:text-white transition-all duration-200 font-medium text-[15px]"
                    >
                      <UserPlus className="w-4 h-4" />
                      <span>{t('nav.customers')}</span>
                    </button>
                  )}
                  {/* 渚涘簲鍟嗙鐞嗘寜閽?- 浣跨敤鏉冮檺妫€鏌?*/}
                  {hasPermission(userRole, 'canManageSuppliers') && (
                    <button
                      onClick={() => setCurrentPage('supplier')}
                      className="flex items-center space-x-2 px-4 py-2 border-2 border-jewelry-navy text-jewelry-navy rounded-xl 
                                 hover:bg-jewelry-navy hover:text-white transition-all duration-200 font-medium text-[15px]"
                    >
                      <Building2 className="w-4 h-4" />
                      <span>{t('nav.suppliers')}</span>
                    </button>
                  )}
                  {/* 閫€璐х鐞嗘寜閽?- 浣跨敤鏉冮檺妫€鏌?*/}
                  {(hasPermission(userRole, 'canReturnToSupplier') || hasPermission(userRole, 'canReturnToWarehouse')) && (
                    <button
                      onClick={() => setCurrentPage('returns')}
                      className="flex items-center space-x-2 px-4 py-2 border-2 border-jewelry-navy text-jewelry-navy rounded-xl 
                                 hover:bg-jewelry-navy hover:text-white transition-all duration-200 font-medium text-[15px]"
                    >
                      <RotateCcw className="w-4 h-4" />
                      <span>{t('nav.returns')}</span>
                    </button>
                  )}
                  {/* 閲戞枡绠＄悊鎸夐挳 - 鏂欓儴鍜岀鐞嗗眰鍙 */}
                  {(hasPermission(userRole, 'canViewGoldMaterial') || hasPermission(userRole, 'canManageGoldMaterial')) && (
                    <button
                      onClick={() => setCurrentPage('gold-material')}
                      className="flex items-center space-x-2 px-4 py-2 border-2 border-jewelry-gold text-jewelry-gold rounded-xl 
                                 hover:bg-jewelry-gold hover:text-white transition-all duration-200 font-medium text-[15px]"
                    >
                      <Scale className="w-4 h-4" />
                      <span>{t('nav.goldMaterial')}</span>
                    </button>
                  )}
                  {/* 鏆傚€熺鐞嗘寜閽?- 缁撶畻涓撳憳鍜岀鐞嗗眰鍙 */}
                  {hasPermission(userRole, 'canManageLoan') && (
                    <button
                      onClick={() => setCurrentPage('loan')}
                      className="flex items-center space-x-2 px-4 py-2 border-2 border-jewelry-navy text-jewelry-navy rounded-xl 
                                 hover:bg-jewelry-navy hover:text-white transition-all duration-200 font-medium text-[15px]"
                    >
                      <Package className="w-4 h-4" />
                      <span>{t('nav.loan')}</span>
                    </button>
                  )}
                  {/* 鍟嗗搧缂栫爜鎸夐挳 - 鍟嗗搧涓撳憳鍜岀鐞嗗眰鍙 */}
                  {hasPermission(userRole, 'canManageProductCodes') && (
                    <button
                      onClick={() => setCurrentPage('product-codes')}
                      className="flex items-center space-x-2 px-4 py-2 border-2 border-jewelry-navy text-jewelry-navy rounded-xl 
                                 hover:bg-jewelry-navy hover:text-white transition-all duration-200 font-medium text-[15px]"
                    >
                      <Package className="w-4 h-4" />
                      <span>{t('nav.productCodes')}</span>
                    </button>
                  )}
                  {/* 鍏ュ簱鍗曟嵁鎸夐挳 - 鍟嗗搧涓撳憳鍜岀鐞嗗眰鍙 */}
                  {(userRole === 'product' || userRole === 'manager') && (
                    <button
                      onClick={() => setCurrentPage('inbound-orders')}
                      className="flex items-center space-x-2 px-4 py-2 border-2 border-jewelry-navy text-jewelry-navy rounded-xl 
                                 hover:bg-jewelry-navy hover:text-white transition-all duration-200 font-medium text-[15px]"
                    >
                      <FileText className="w-4 h-4" />
                      <span>{t('nav.inboundOrders')}</span>
                    </button>
                  )}
                  {/* 璐㈠姟瀵硅处鎸夐挳 - 浣跨敤鏉冮檺妫€鏌?*/}
                  {hasPermission(userRole, 'canViewFinance') && (
                    <button
                      onClick={() => setCurrentPage('finance')}
                      className="flex items-center space-x-2 px-4 py-2 border-2 border-jewelry-navy text-jewelry-navy rounded-xl 
                                 hover:bg-jewelry-navy hover:text-white transition-all duration-200 font-medium text-[15px]"
                    >
                      <DollarSign className="w-4 h-4" />
                      <span>{t('nav.finance')}</span>
                    </button>
                  )}
                  {/* 鍘嗗彶鍥炴函鎸夐挳 - 鎵€鏈夎鑹查兘鍙敤 */}
                  <button
                    onClick={() => setShowHistoryPanel(true)}
                    className="flex items-center space-x-2 px-4 py-2 border-2 border-jewelry-navy text-jewelry-navy rounded-xl 
                               hover:bg-jewelry-navy hover:text-white transition-all duration-200 font-medium text-[15px]"
                  >
                    <History className="w-4 h-4" />
                    <span>{t('nav.history')}</span>
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
                  <span>{t('nav.backToChat')}</span>
                </button>
              )}
            </div>
          </div>
      </header>

        {/* 涓诲唴瀹瑰尯鍩?- 鏍规嵁 currentPage 鍒囨崲 */}
        {currentPage === 'chat' && (
          <>
            {/* 瀵硅瘽鍖哄煙 - 鑻规灉椋庢牸 */}
            <div className="flex-1 overflow-y-auto px-6 py-8">
          <div className="max-w-4xl mx-auto space-y-6">
        {messages.length === 0 && (
              <div className="text-center pt-8">
                {/* 鏅鸿兘鏃堕棿闂€?+ AI鏍囪瘑 */}
                <div className="mb-6">
                  <div className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-amber-50 to-yellow-50 rounded-full border border-amber-200">
                    <img src="/ai-avatar.png" alt="AI" className="w-6 h-6 rounded-full object-cover" />
                    <span className="text-sm text-gray-700">
                      {(() => {
                        const hour = new Date().getHours()
                        if (hour < 9) return '鏃╀笂濂斤紒浠婂ぉ涔熻鍔犳补鍝?鈽€锔?
                        if (hour < 12) return '涓婂崍濂斤紒鏈変粈涔堝彲浠ュ府鎮ㄧ殑锛?
                        if (hour < 14) return '涓崍濂斤紒璁板緱浼戞伅涓€涓?馃嵉'
                        if (hour < 18) return '涓嬪崍濂斤紒鎴戦殢鏃跺噯澶囦负鎮ㄦ湇鍔?
                        return '鏅氫笂濂斤紒杈涜嫤浜?馃寵'
                      })()}
                    </span>
                  </div>
                </div>
                
                {/* 鏅鸿兘蹇嵎寤鸿鎸夐挳 - 鍙偣鍑荤洿鎺ュ彂閫?*/}
                <div className="flex flex-wrap justify-center gap-2 mb-6">
                  <span className="text-gray-400 text-sm">馃挕 璇曡瘯锛?/span>
                  {userRole === 'counter' && (
                    <>
                      <button onClick={() => setInput('甯垜寮€涓€寮犻攢鍞崟')} className="px-3 py-1.5 text-sm bg-blue-50 text-blue-600 rounded-full hover:bg-blue-100 transition-colors">寮€閿€鍞崟</button>
                      <button onClick={() => setInput('鏌ヨ浠婂ぉ鐨勯攢鍞儏鍐?)} className="px-3 py-1.5 text-sm bg-blue-50 text-blue-600 rounded-full hover:bg-blue-100 transition-colors">浠婃棩閿€鍞?/button>
                      <button onClick={() => setInput('搴撳瓨杩樻湁澶氬皯')} className="px-3 py-1.5 text-sm bg-blue-50 text-blue-600 rounded-full hover:bg-blue-100 transition-colors">鏌ュ簱瀛?/button>
                    </>
                  )}
                  {userRole === 'product' && (
                    <>
                      <button onClick={() => setInput('鍙ゆ硶榛勯噾鎴掓寚 100鍏?宸ヨ垂6鍏?渚涘簲鍟嗛噾婧愮彔瀹?甯垜鍏ュ簱')} className="px-3 py-1.5 text-sm bg-orange-50 text-orange-600 rounded-full hover:bg-orange-100 transition-colors">鍏ュ簱鍟嗗搧</button>
                      <button onClick={() => setInput('鏌ヨ浠婂ぉ鐨勫叆搴撳崟')} className="px-3 py-1.5 text-sm bg-orange-50 text-orange-600 rounded-full hover:bg-orange-100 transition-colors">浠婃棩鍏ュ簱</button>
                      <button onClick={() => setInput('搴撳瓨鍒嗘瀽')} className="px-3 py-1.5 text-sm bg-orange-50 text-orange-600 rounded-full hover:bg-orange-100 transition-colors">搴撳瓨鍒嗘瀽</button>
                    </>
                  )}
                  {userRole === 'settlement' && (
                    <>
                      <button onClick={() => setInput('鏌ョ湅浠婂ぉ寰呯粨绠楃殑璁㈠崟')} className="px-3 py-1.5 text-sm bg-green-50 text-green-600 rounded-full hover:bg-green-100 transition-colors">寰呯粨绠?/button>
                      <button onClick={() => setInput('寮犺€佹澘鎻?鍏?)} className="px-3 py-1.5 text-sm bg-green-50 text-green-600 rounded-full hover:bg-green-100 transition-colors">瀹㈡埛鎻愭枡</button>
                      <button onClick={() => setInput('鏀舵枡鐧昏')} className="px-3 py-1.5 text-sm bg-green-50 text-green-600 rounded-full hover:bg-green-100 transition-colors">鏀舵枡鐧昏</button>
                    </>
                  )}
                  {userRole === 'finance' && (
                    <>
                      <button onClick={() => setInput('鏌ョ湅鏈湀璐㈠姟瀵硅处鎯呭喌')} className="px-3 py-1.5 text-sm bg-purple-50 text-purple-600 rounded-full hover:bg-purple-100 transition-colors">鏈堝害瀵硅处</button>
                      <button onClick={() => setInput('浠婃棩鏀舵姹囨€?)} className="px-3 py-1.5 text-sm bg-purple-50 text-purple-600 rounded-full hover:bg-purple-100 transition-colors">鏀舵姹囨€?/button>
                    </>
                  )}
                  {userRole === 'sales' && (
                    <>
                      <button onClick={() => setInput('甯垜鏌ヨ寮犱笁浠婂ぉ鐨勯攢鍞儏鍐?)} className="px-3 py-1.5 text-sm bg-indigo-50 text-indigo-600 rounded-full hover:bg-indigo-100 transition-colors">瀹㈡埛閿€鍞?/button>
                      <button onClick={() => setInput('鐜嬩簲鏈夊灏戞瑺娆?)} className="px-3 py-1.5 text-sm bg-indigo-50 text-indigo-600 rounded-full hover:bg-indigo-100 transition-colors">娆犳鏌ヨ</button>
                      <button onClick={() => setInput('鏌ヨ閫€璐ц褰?)} className="px-3 py-1.5 text-sm bg-indigo-50 text-indigo-600 rounded-full hover:bg-indigo-100 transition-colors">閫€璐ц褰?/button>
                    </>
                  )}
                  {userRole === 'material' && (
                    <>
                      <button onClick={() => setInput('鏌ョ湅浠婃棩閲戞枡鏀朵粯鎯呭喌')} className="px-3 py-1.5 text-sm bg-yellow-50 text-yellow-600 rounded-full hover:bg-yellow-100 transition-colors">浠婃棩鏀朵粯</button>
                      <button onClick={() => setInput('閲戞枡搴撳瓨缁熻')} className="px-3 py-1.5 text-sm bg-yellow-50 text-yellow-600 rounded-full hover:bg-yellow-100 transition-colors">搴撳瓨缁熻</button>
                    </>
                  )}
                  {userRole === 'manager' && (
                    <>
                      <button onClick={() => setInput('鏌ョ湅浠婃棩閿€鍞暟鎹眹鎬?)} className="px-3 py-1.5 text-sm bg-red-50 text-red-600 rounded-full hover:bg-red-100 transition-colors">浠婃棩姹囨€?/button>
                      <button onClick={() => setInput('鏈湀涓氱哗鍒嗘瀽')} className="px-3 py-1.5 text-sm bg-red-50 text-red-600 rounded-full hover:bg-red-100 transition-colors">涓氱哗鍒嗘瀽</button>
                      <button onClick={() => setInput('搴撳瓨棰勮')} className="px-3 py-1.5 text-sm bg-red-50 text-red-600 rounded-full hover:bg-red-100 transition-colors">搴撳瓨棰勮</button>
                    </>
                  )}
                </div>
                
                {/* 搴撳瓨姒傝 - 鍟嗗搧涓撳憳銆佹煖鍙般€佺粨绠椼€佺鐞嗗眰鍙 */}
                {(userRole === 'product' || userRole === 'counter' || userRole === 'settlement' || userRole === 'manager') && (
                  <div className="max-w-2xl mx-auto mb-6">
                    <InventoryOverview userRole={userRole} />
          </div>
        )}

                {/* 瑙掕壊蹇嵎鎿嶄綔鍗＄墖 - 浣跨敤鏉冮檺鎺у埗 */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl mx-auto">
                  
                  {/* 蹇€熷紑鍗曞崱鐗?- 闇€瑕佸垱寤洪攢鍞崟鏉冮檺 */}
                  {hasPermission(userRole, 'canCreateSales') && (
                    <div 
                      onClick={() => setShowQuickOrderModal(true)}
                      className="p-6 bg-white rounded-2xl border border-gray-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
                    >
                      <div className="text-2xl mb-3">馃Ь</div>
                      <h3 className="font-semibold text-gray-900 mb-2">蹇€熷紑鍗?/h3>
                      <p className="text-sm text-gray-600">鍒涘缓閿€鍞崟</p>
                    </div>
                  )}
                  
                  {/* 鎺ユ敹搴撳瓨鍗＄墖 - 闇€瑕佹帴鏀跺簱瀛樻潈闄?*/}
                  {hasPermission(userRole, 'canReceiveTransfer') && (
                    <div 
                      onClick={() => setCurrentPage('warehouse')}
                      className="p-6 bg-white rounded-2xl border border-gray-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
                    >
                      <div className="text-2xl mb-3">馃摜</div>
                      <h3 className="font-semibold text-gray-900 mb-2">鎺ユ敹搴撳瓨</h3>
                      <p className="text-sm text-gray-600">鎺ユ敹浠庝粨搴撹浆绉荤殑鍟嗗搧</p>
                    </div>
                  )}
                  
                  {/* 蹇嵎鍏ュ簱鍗＄墖 - 闇€瑕佸叆搴撴潈闄?*/}
                  {hasPermission(userRole, 'canInbound') && (
                    <div 
                      onClick={() => setShowQuickInboundModal(true)}
                      className="p-6 bg-white rounded-2xl border border-gray-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
                    >
                      <div className="text-2xl mb-3">馃摝</div>
                      <h3 className="font-semibold text-gray-900 mb-2">蹇嵎鍏ュ簱</h3>
                      <p className="text-sm text-gray-600">琛ㄦ牸褰㈠紡鎵归噺鍏ュ簱</p>
                    </div>
                  )}
                  
                  {/* 搴撳瓨杞Щ鍗＄墖 - 闇€瑕佽浆绉绘潈闄?*/}
                  {hasPermission(userRole, 'canTransfer') && (
                    <div 
                      onClick={() => setCurrentPage('warehouse')}
                      className="p-6 bg-white rounded-2xl border border-gray-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
                    >
                      <div className="text-2xl mb-3">馃搳</div>
                      <h3 className="font-semibold text-gray-900 mb-2">鍒嗕粨搴撳瓨</h3>
                      <p className="text-sm text-gray-600">绠＄悊浠撳簱搴撳瓨鍜岃浆绉?/p>
                    </div>
                  )}
                  
                  {/* 蹇嵎閫€璐у崱鐗?- 鍟嗗搧涓撳憳锛堥€€缁欎緵搴斿晢锛?*/}
                  {hasPermission(userRole, 'canReturnToSupplier') && (
                    <div 
                      onClick={() => setShowQuickReturnModal(true)}
                      className="p-6 bg-white rounded-2xl border border-gray-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
                    >
                      <div className="text-2xl mb-3">馃攧</div>
                      <h3 className="font-semibold text-gray-900 mb-2">蹇嵎閫€璐?/h3>
                      <p className="text-sm text-gray-600">蹇€熷垱寤洪€€璐у崟锛堥€€缁欎緵搴斿晢锛?/p>
                    </div>
                  )}
                  
                  {/* 蹇嵎閫€璐у崱鐗?- 鏌滃彴锛堥€€缁欏晢鍝侀儴锛?*/}
                  {hasPermission(userRole, 'canReturnToWarehouse') && (
                    <div 
                      onClick={() => setShowQuickReturnModal(true)}
                      className="p-6 bg-white rounded-2xl border border-gray-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
                    >
                      <div className="text-2xl mb-3">馃攧</div>
                      <h3 className="font-semibold text-gray-900 mb-2">蹇嵎閫€璐?/h3>
                      <p className="text-sm text-gray-600">蹇€熷垱寤洪€€璐у崟锛堥€€缁欏晢鍝侀儴锛?/p>
                    </div>
                  )}
                  
                  {/* 缁撶畻绠＄悊鍗＄墖 - 闇€瑕佸垱寤虹粨绠楀崟鏉冮檺 */}
                  {hasPermission(userRole, 'canCreateSettlement') && (
                    <div 
                      onClick={() => setCurrentPage('settlement')}
                      className="p-6 bg-white rounded-2xl border border-gray-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
                    >
                      <div className="text-2xl mb-3">馃搵</div>
                      <h3 className="font-semibold text-gray-900 mb-2">寰呯粨绠楄鍗?/h3>
                      <p className="text-sm text-gray-600">鏌ョ湅寰呯粨绠楃殑閿€鍞崟</p>
                    </div>
                  )}
                  
                  {/* 瀹㈡埛绠＄悊鍗＄墖 - 闇€瑕佹煡鐪嬫垨绠＄悊鏉冮檺 */}
                  {(hasPermission(userRole, 'canViewCustomers') || hasPermission(userRole, 'canManageCustomers')) && (
                    <div 
                      onClick={() => setCurrentPage('customer')}
                      className="p-6 bg-white rounded-2xl border border-gray-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
                    >
                      <div className="text-2xl mb-3">馃懃</div>
                      <h3 className="font-semibold text-gray-900 mb-2">
                        {userRole === 'sales' ? '瀹㈡埛鏌ヨ' : '瀹㈡埛绠＄悊'}
                      </h3>
                      <p className="text-sm text-gray-600">
                        {userRole === 'sales' 
                          ? '鏌ヨ瀹㈡埛閿€鍞€侀€€璐с€佹瑺娆俱€佸線鏉ヨ处鐩? 
                          : '绠＄悊瀹㈡埛淇℃伅'}
                      </p>
                    </div>
                  )}
                  
                  {/* 璐㈠姟瀵硅处鍗＄墖 - 闇€瑕佽储鍔℃潈闄?*/}
                  {hasPermission(userRole, 'canViewFinance') && (
                    <div 
                      onClick={() => setCurrentPage('finance')}
                      className="p-6 bg-white rounded-2xl border border-gray-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
                    >
                      <div className="text-2xl mb-3">馃挵</div>
                      <h3 className="font-semibold text-gray-900 mb-2">璐㈠姟瀵硅处</h3>
                      <p className="text-sm text-gray-600">鏌ョ湅璐㈠姟瀵硅处鎯呭喌</p>
                    </div>
                  )}
                  
                  {/* 渚涘簲鍟嗙鐞嗗崱鐗?- 闇€瑕佷緵搴斿晢绠＄悊鏉冮檺 */}
                  {hasPermission(userRole, 'canManageSuppliers') && (
                    <div 
                      onClick={() => setCurrentPage('supplier')}
                      className="p-6 bg-white rounded-2xl border border-gray-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
                    >
                      <div className="text-2xl mb-3">馃彮</div>
                      <h3 className="font-semibold text-gray-900 mb-2">渚涘簲鍟嗙鐞?/h3>
                      <p className="text-sm text-gray-600">绠＄悊渚涘簲鍟嗕俊鎭?/p>
                    </div>
                  )}
                  
                  {/* 浠〃鐩樺崱鐗?- 绠＄悊灞傚揩閫熸煡鐪?*/}
                  {hasPermission(userRole, 'canViewAnalytics') && (
                    <div 
                      onClick={() => setCurrentPage('dashboard')}
                      className="p-6 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl border border-blue-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
                    >
                      <div className="text-2xl mb-3">馃搱</div>
                      <h3 className="font-semibold text-gray-900 mb-2">鏁版嵁浠〃鐩?/h3>
                      <p className="text-sm text-gray-600">浠婃棩閿€鍞€佷笟缁╂帓琛?/p>
                    </div>
                  )}
                  
                  {/* 鏁版嵁鍒嗘瀽鍗＄墖 - 闇€瑕佹暟鎹垎鏋愭潈闄?*/}
                  {hasPermission(userRole, 'canViewAnalytics') && (
                    <div 
                      onClick={() => setCurrentPage('analytics')}
                      className="p-6 bg-white rounded-2xl border border-gray-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
                    >
                      <div className="text-2xl mb-3">馃搳</div>
                      <h3 className="font-semibold text-gray-900 mb-2">鏁版嵁鍒嗘瀽</h3>
                      <p className="text-sm text-gray-600">鏌ョ湅涓氬姟鏁版嵁鍒嗘瀽</p>
                    </div>
                  )}
                  
                  {/* 鏁版嵁瀵煎嚭鍗＄墖 - 闇€瑕佹暟鎹鍑烘潈闄?*/}
                  {hasPermission(userRole, 'canExport') && (
                    <div 
                      onClick={() => setCurrentPage('export')}
                      className="p-6 bg-white rounded-2xl border border-gray-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
                    >
                      <div className="text-2xl mb-3">馃摜</div>
                      <h3 className="font-semibold text-gray-900 mb-2">鏁版嵁瀵煎嚭</h3>
                      <p className="text-sm text-gray-600">瀵煎嚭鍚勭被鏁版嵁鎶ヨ〃</p>
                    </div>
                  )}
                  
                  {/* 閲戞枡绠＄悊鍗＄墖 - 鏂欓儴鍜岀鐞嗗眰 */}
                  {(hasPermission(userRole, 'canViewGoldMaterial') || hasPermission(userRole, 'canManageGoldMaterial')) && (
                    <div 
                      onClick={() => setCurrentPage('gold-material')}
                      className="p-6 bg-white rounded-2xl border border-gray-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
                    >
                      <div className="text-2xl mb-3">鈿栵笍</div>
                      <h3 className="font-semibold text-gray-900 mb-2">閲戞枡绠＄悊</h3>
                      <p className="text-sm text-gray-600">閲戞枡鍙拌处銆佹敹鏂欍€佷粯鏂?/p>
                    </div>
                  )}
                  
                  {/* 鍟嗗搧缂栫爜绠＄悊鍗＄墖 - 鍟嗗搧涓撳憳鍜岀鐞嗗眰 */}
                  {hasPermission(userRole, 'canManageProductCodes') && (
                    <div 
                      onClick={() => setCurrentPage('product-codes')}
                      className="p-6 bg-white rounded-2xl border border-gray-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
                    >
                      <div className="text-2xl mb-3">馃彿锔?/div>
                      <h3 className="font-semibold text-gray-900 mb-2">鍟嗗搧缂栫爜</h3>
                      <p className="text-sm text-gray-600">绠＄悊F缂栫爜銆丗L缂栫爜</p>
                    </div>
                  )}
                  
                  {/* 鍒涘缓浠樻枡鍗曞崱鐗?- 鏂欓儴 */}
                  {hasPermission(userRole, 'canCreateGoldPayment') && (
                    <div 
                      onClick={() => {
                        setCurrentPage('gold-material');
                        // 鍙互閫氳繃鐘舵€佹帶鍒舵墦寮€鍒涘缓浠樻枡鍗曞脊绐?
                      }}
                      className="p-6 bg-white rounded-2xl border border-gray-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
                    >
                      <div className="text-2xl mb-3">馃摑</div>
                      <h3 className="font-semibold text-gray-900 mb-2">鍒涘缓浠樻枡鍗?/h3>
                      <p className="text-sm text-gray-600">鏀粯渚涘簲鍟嗛噾鏂?/p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {messages.map((msg, idx) => {
              // 鎬濊€冭繃绋嬫秷鎭?
              if (msg.type === 'thinking' && Array.isArray(msg.steps)) {
                return (
                  <div key={msg.id || idx} className="flex justify-start">
                    <div className="bg-white rounded-3xl px-5 py-4 shadow-sm border border-gray-200/60 max-w-2xl">
                      {/* 杩涘害鏉?*/}
                      {msg.steps.length > 0 && (
                        <div className="mb-3">
                          <div className="flex justify-between text-xs text-gray-600 mb-1">
                            <span>澶勭悊杩涘害</span>
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
                      
                      {/* 鎬濊€冩楠?*/}
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
              
              // 鏀舵纭鍗＄墖
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
                      
                      {/* 鍐呭鍖?*/}
                      <div className="p-5 space-y-4">
                        {/* 瀹㈡埛淇℃伅 */}
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center">
                            <span className="text-orange-600 font-bold text-lg">{pd.customer?.name?.charAt(0) || '瀹?}</span>
                          </div>
                          <div>
                            <div className="font-semibold text-gray-900">{pd.customer?.name}</div>
                            <div className="text-sm text-gray-500">{pd.customer?.customer_no}</div>
                          </div>
                        </div>
                        
                        {/* 閲戦淇℃伅 */}
                        <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-600">褰撳墠娆犳</span>
                            <span className="font-medium text-gray-900">楼{pd.current_debt?.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-600">鏈鏀舵</span>
                            <span className="font-bold text-orange-600 text-lg">楼{pd.payment_amount?.toFixed(2)}</span>
                          </div>
                          <div className="border-t border-gray-200 pt-2 flex justify-between text-sm">
                            <span className="text-gray-600">鏀舵鍚庢瑺娆?/span>
                            <span className={`font-medium ${(pd.balance_after || 0) >= 0 ? 'text-orange-600' : 'text-green-600'}`}>
                              {(pd.balance_after || 0) >= 0 
                                ? `楼${pd.balance_after?.toFixed(2)}` 
                                : `-楼${Math.abs(pd.balance_after || 0).toFixed(2)} (棰勬敹娆?`
                              }
                            </span>
                          </div>
                        </div>
                        
                        {/* 鏀舵鏂瑰紡 */}
                        <div className="flex items-center gap-2 text-sm text-gray-600">
                          <span>鏀舵鏂瑰紡锛?/span>
                          <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded">{pd.payment_method}</span>
                        </div>
                        
                        {/* 鎿嶄綔鎸夐挳 */}
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
                                  // 鏇存柊娑堟伅涓烘垚鍔熺姸鎬?
                                  const balanceText = (pd.balance_after || 0) >= 0 
                                    ? `楼${pd.balance_after.toFixed(2)}` 
                                    : `-楼${Math.abs(pd.balance_after || 0).toFixed(2)} (棰勬敹娆?`
                                  setMessages(prev => prev.map(m => 
                                    m.id === msg.id 
                                      ? { ...m, type: 'system', content: `鉁?鏀舵鐧昏鎴愬姛锛乗n\n瀹㈡埛锛?{pd.customer.name}\n鏀舵閲戦锛毬?{pd.payment_amount.toFixed(2)}\n鏀舵鏂瑰紡锛?{pd.payment_method}\n鏀舵鍚庢瑺娆撅細${balanceText}` }
                                      : m
                                  ))
                                } else {
                                  alert('鏀舵鐧昏澶辫触锛? + (result.error || '鏈煡閿欒'))
                                }
                              } catch (error) {
                                console.error('鏀舵鐧昏澶辫触:', error)
                                alert('鏀舵鐧昏澶辫触锛? + error.message)
                              }
                            }}
                            className="flex-1 bg-orange-500 hover:bg-orange-600 text-white font-medium py-2.5 px-4 rounded-xl transition-colors"
                          >
                            纭鐧昏
                          </button>
                          <button
                            onClick={() => {
                              // 鍙栨秷纭锛岀Щ闄ゆ娑堟伅
                              setMessages(prev => prev.filter(m => m.id !== msg.id))
                            }}
                            className="px-4 py-2.5 border border-gray-300 text-gray-600 rounded-xl hover:bg-gray-50 transition-colors"
                          >
                            鍙栨秷
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              }

              // 鏀舵枡纭鍗＄墖
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
                      
                      {/* 鍐呭鍖?*/}
                      <div className="p-5 space-y-4">
                        {/* 瀹㈡埛淇℃伅 */}
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-yellow-100 rounded-full flex items-center justify-center">
                            <span className="text-yellow-600 font-bold text-lg">{rd.customer?.name?.charAt(0) || '瀹?}</span>
                          </div>
                          <div>
                            <div className="font-semibold text-gray-900">{rd.customer?.name}</div>
                            <div className="text-sm text-gray-500">{rd.customer?.phone || rd.customer?.customer_no}</div>
                          </div>
                        </div>
                        
                        {/* 閲戞枡淇℃伅 */}
                        <div className="bg-yellow-50 rounded-xl p-4 space-y-3">
                          <div className="flex justify-between items-center">
                            <span className="text-gray-600">鏀舵枡鍏嬮噸</span>
                            <span className="font-bold text-yellow-700 text-2xl">{rd.gold_weight?.toFixed(2)} 鍏?/span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-600">鎴愯壊</span>
                            <span className="font-medium text-gray-900 px-2 py-0.5 bg-yellow-100 rounded">{rd.gold_fineness}</span>
                          </div>
                          {rd.remark && (
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-600">澶囨敞</span>
                              <span className="text-gray-700">{rd.remark}</span>
                            </div>
                          )}
                        </div>
                        
                        {/* 鎿嶄綔鎸夐挳 */}
                        <div className="flex gap-3 pt-2">
                          <button
                            onClick={async () => {
                              try {
                                const params = new URLSearchParams({
                                  customer_id: rd.customer.id.toString(),
                                  gold_weight: rd.gold_weight.toString(),
                                  gold_fineness: rd.gold_fineness,
                                  remark: rd.remark || '鑱婂ぉ鏀舵枡',
                                  created_by: '缁撶畻涓撳憳'
                                })
                                const response = await fetch(`${API_BASE_URL}/api/gold-material/gold-receipts?${params}`, {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' }
                                })
                                if (response.ok) {
                                  const result = await response.json()
                                  // 鏇存柊娑堟伅涓烘垚鍔熺姸鎬?
                                  setMessages(prev => prev.map(m => 
                                    m.id === msg.id 
                                      ? { ...m, type: 'system', content: `鉁?鏀舵枡鍗曞垱寤烘垚鍔燂紒\n\n鍗曞彿锛?{result.data.receipt_no}\n瀹㈡埛锛?{rd.customer.name}\n鍏嬮噸锛?{rd.gold_weight.toFixed(2)}鍏媆n鎴愯壊锛?{rd.gold_fineness}` }
                                      : m
                                  ))
                                  // 鎵撳紑鎵撳嵃椤甸潰
                                  if (result.data.id) {
                                    window.open(`${API_BASE_URL}/api/gold-material/gold-receipts/${result.data.id}/print`, '_blank')
                                  }
                                } else {
                                  const error = await response.json()
                                  alert('鏀舵枡鍗曞垱寤哄け璐ワ細' + (error.detail || '鏈煡閿欒'))
                                }
                              } catch (error) {
                                console.error('鏀舵枡鍗曞垱寤哄け璐?', error)
                                alert('鏀舵枡鍗曞垱寤哄け璐ワ細' + error.message)
                              }
                            }}
                            className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-white font-medium py-2.5 px-4 rounded-xl transition-colors"
                          >
                            纭骞舵墦鍗?
                          </button>
                          <button
                            onClick={() => {
                              // 鍙栨秷纭锛岀Щ闄ゆ娑堟伅
                              setMessages(prev => prev.filter(m => m.id !== msg.id))
                            }}
                            className="px-4 py-2.5 border border-gray-300 text-gray-600 rounded-xl hover:bg-gray-50 transition-colors"
                          >
                            鍙栨秷
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              }

              // 鎻愭枡纭鍗＄墖
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
                          <span className="font-semibold">纭鍒涘缓鎻愭枡鍗?/span>
                        </div>
                      </div>
                      
                      {/* 鍐呭鍖?*/}
                      <div className="p-5 space-y-4">
                        {/* 瀹㈡埛淇℃伅 */}
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                            <span className="text-blue-600 font-bold text-lg">{wd.customer?.name?.charAt(0) || '瀹?}</span>
                          </div>
                          <div>
                            <div className="font-semibold text-gray-900">{wd.customer?.name}</div>
                            <div className="text-sm text-gray-500">{wd.customer?.phone || wd.customer?.customer_no}</div>
                          </div>
                        </div>
                        
                        {/* 鎻愭枡淇℃伅 */}
                        <div className="bg-blue-50 rounded-xl p-4 space-y-3">
                          <div className="flex justify-between items-center">
                            <span className="text-gray-600">鎻愭枡鍏嬮噸</span>
                            <span className="font-bold text-blue-700 text-2xl">{wd.gold_weight?.toFixed(2)} 鍏?/span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-600">褰撳墠瀛樻枡</span>
                            <span className="font-medium text-gray-900">{wd.current_balance?.toFixed(2)} 鍏?/span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-600">鎻愭枡鍚庝綑棰?/span>
                            <span className="font-medium text-green-600">{wd.balance_after?.toFixed(2)} 鍏?/span>
                          </div>
                          {wd.remark && (
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-600">澶囨敞</span>
                              <span className="text-gray-700">{wd.remark}</span>
                            </div>
                          )}
                        </div>
                        
                        {/* 鎿嶄綔鎸夐挳 */}
                        <div className="flex gap-3 pt-2">
                          <button
                            onClick={async () => {
                              try {
                                const params = new URLSearchParams({
                                  user_role: 'settlement',
                                  created_by: '缁撶畻涓撳憳'
                                })
                                const response = await fetch(`${API_BASE_URL}/api/gold-material/withdrawals?${params}`, {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    customer_id: wd.customer.id,
                                    gold_weight: wd.gold_weight,
                                    withdrawal_type: 'self',
                                    remark: wd.remark || '鑱婂ぉ鎻愭枡'
                                  })
                                })
                                if (response.ok) {
                                  const result = await response.json()
                                  // 鏇存柊娑堟伅涓烘垚鍔熺姸鎬?
                                  setMessages(prev => prev.map(m => 
                                    m.id === msg.id 
                                      ? { ...m, type: 'system', content: `鉁?鎻愭枡鍗曞垱寤烘垚鍔燂紒\n\n鍗曞彿锛?{result.withdrawal_no}\n瀹㈡埛锛?{wd.customer.name}\n鍏嬮噸锛?{wd.gold_weight.toFixed(2)}鍏媆n锛堝緟鏂欓儴纭鍙戝嚭锛塦 }
                                      : m
                                  ))
                                  // 鎵撳紑鎵撳嵃椤甸潰
                                  if (result.id) {
                                    window.open(`${API_BASE_URL}/api/gold-material/withdrawals/${result.id}/download?format=html`, '_blank')
                                  }
                                } else {
                                  const error = await response.json()
                                  alert('鎻愭枡鍗曞垱寤哄け璐ワ細' + (error.detail || '鏈煡閿欒'))
                                }
                              } catch (error) {
                                console.error('鎻愭枡鍗曞垱寤哄け璐?', error)
                                alert('鎻愭枡鍗曞垱寤哄け璐ワ細' + error.message)
                              }
                            }}
                            className="flex-1 bg-blue-500 hover:bg-blue-600 text-white font-medium py-2.5 px-4 rounded-xl transition-colors"
                          >
                            纭骞舵墦鍗?
                          </button>
                          <button
                            onClick={() => {
                              // 鍙栨秷纭锛岀Щ闄ゆ娑堟伅
                              setMessages(prev => prev.filter(m => m.id !== msg.id))
                            }}
                            className="px-4 py-2.5 border border-gray-300 text-gray-600 rounded-xl hover:bg-gray-50 transition-colors"
                          >
                            鍙栨秷
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              }

              // 鎻愭枡鍗曡褰曞崱鐗囷紙宸插畬鎴愮殑鎻愭枡鍗曪級
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
                          <span className="font-semibold">鎻愭枡鍗曞凡鐢熸垚</span>
                        </div>
                      </div>
                      
                      {/* 鍐呭鍖?*/}
                      <div className="p-5 space-y-4">
                        {/* 鍗曞彿淇℃伅 */}
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-gray-500">鍗曞彿</span>
                          <span className="font-mono font-semibold text-green-700">{wd.withdrawal_no}</span>
                        </div>
                        
                        {/* 瀹㈡埛淇℃伅 */}
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                            <span className="text-green-600 font-bold text-lg">{wd.customer_name?.charAt(0) || '瀹?}</span>
                          </div>
                          <div>
                            <div className="font-semibold text-gray-900">{wd.customer_name}</div>
                            <div className="text-xs text-gray-500">{wd.created_at}</div>
                          </div>
                        </div>
                        
                        {/* 鎻愭枡淇℃伅 */}
                        <div className="bg-green-50 rounded-xl p-4 space-y-2">
                          <div className="flex justify-between items-center">
                            <span className="text-gray-600">鎻愭枡鍏嬮噸</span>
                            <span className="font-bold text-green-700 text-2xl">{wd.gold_weight?.toFixed(2)} 鍏?/span>
                          </div>
                          {wd.remark && (
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-600">澶囨敞</span>
                              <span className="text-gray-700">{wd.remark}</span>
                            </div>
                          )}
                        </div>
                        
                        {/* 鎿嶄綔鎸夐挳 */}
                        <div className="flex gap-3 pt-2">
                          <button
                            onClick={() => window.open(wd.download_url, '_blank')}
                            className="flex-1 bg-green-500 hover:bg-green-600 text-white font-medium py-2.5 px-4 rounded-xl transition-colors flex items-center justify-center gap-2"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                            </svg>
                            鎵撳嵃/涓嬭浇
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              }
              
              // 鐢ㄦ埛娑堟伅
              if (msg.type === 'user') {
                return (
                  <div key={msg.id || idx} className="flex justify-end">
                    <div className="bg-gradient-to-r from-jewelry-navy to-jewelry-navy-light text-white rounded-3xl px-5 py-4 shadow-md max-w-2xl">
                      <div className="text-[15px] leading-relaxed whitespace-pre-wrap">{msg.content}</div>
                    </div>
                  </div>
                )
              }
              
              // 绯荤粺娑堟伅锛堟祦寮忓唴瀹规垨鏅€氬唴瀹癸級- 甯I澶村儚
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
                        {/* 鎰忓浘璇嗗埆鍙鍖栨爣绛?- 鐝犲疂椋庢牸 */}
                        {msg.detectedIntent && (
                          <div className="flex items-center gap-1.5 mb-2 pb-2 border-b border-gray-100">
                            <span className="text-xs text-gray-400">馃幆 璇嗗埆鍒帮細</span>
                            <span className="px-2 py-0.5 text-xs font-medium bg-gradient-to-r from-amber-100 to-yellow-100 text-amber-700 rounded-full">
                              {msg.detectedIntent}
                            </span>
                          </div>
                        )}
                        <div className="text-[15px] leading-relaxed whitespace-pre-wrap text-gray-800">
                          {/* 闅愯棌鍐呭涓殑鐗规畩鏍囪 */}
                          {msg.content?.replace(/\n*<!-- (RETURN_ORDER|INBOUND_ORDER|SALES_ORDER|SETTLEMENT_ORDER|CUSTOMER_DEBT|EXPORT_INBOUND|WITHDRAWAL_ORDER|GOLD_RECEIPT):[^>]+ -->/g, '')}
                          {/* 娴佸紡鐢熸垚鏃剁殑闂儊鍏夋爣 */}
                          {msg.isStreaming && (
                            <span className="inline-block w-0.5 h-4 bg-blue-500 ml-1 animate-pulse"></span>
                          )}
                        </div>
                {/* 濡傛灉鏈夊浘鐗囷紝鏄剧ず棰勮 */}
                {msg.image && (
                          <div className="mt-3">
                    <img 
                      src={msg.image} 
                      alt="涓婁紶鐨勫叆搴撳崟" 
                              className="max-w-full h-auto rounded-2xl border border-gray-200/60"
                      style={{ maxHeight: '300px' }}
                    />
                  </div>
                )}
                        {/* 鎻愭枡鍗曟搷浣滄寜閽?- 鏀寔浠庡璞℃垨浠庡唴瀹硅В鏋?*/}
                        {(() => {
                          // 灏濊瘯浠庢秷鎭璞¤幏鍙栵紝鎴栦粠鍐呭涓В鏋愰殣钘忔爣璁?
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
                                鎵撳嵃鎻愭枡鍗?
                              </button>
                            </div>
                          )
                        })()}
                        {/* 鏀舵枡鍗曟搷浣滄寜閽?- 鏀寔浠庡璞℃垨浠庡唴瀹硅В鏋?*/}
                        {(() => {
                          // 灏濊瘯浠庢秷鎭璞¤幏鍙栵紝鎴栦粠鍐呭涓В鏋愰殣钘忔爣璁?
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
                                鎵撳嵃鏀舵枡鍗?
                              </button>
                            </div>
                          )
                        })()}
                        {/* 閫€璐у崟鎿嶄綔鎸夐挳 - 鏀寔浠庡璞℃垨浠庡唴瀹硅В鏋?*/}
                        {(() => {
                          // 灏濊瘯浠庢秷鎭璞¤幏鍙栵紝鎴栦粠鍐呭涓В鏋愰殣钘忔爣璁?
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
                                鎵撳嵃閫€璐у崟
                              </button>
                              <button
                                onClick={() => window.open(`${API_BASE_URL}/api/returns/${returnId}/download?format=pdf`, '_blank')}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-50 text-green-600 rounded-lg hover:bg-green-100 transition-colors"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                </svg>
                                涓嬭浇
                              </button>
                            </div>
                          )
                        })()}
                        {/* 鍏ュ簱鍗曟搷浣滄寜閽?- 鏀寔浠庡璞℃垨浠庡唴瀹硅В鏋?*/}
                        {(() => {
                          // 灏濊瘯浠庢秷鎭璞¤幏鍙栵紝鎴栦粠鍐呭涓В鏋愰殣钘忔爣璁?
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
                                鎵撳嵃鍏ュ簱鍗?
                              </button>
                              <button
                                onClick={() => window.open(`${API_BASE_URL}/api/inbound-orders/${inboundId}/download?format=pdf`, '_blank')}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-50 text-green-600 rounded-lg hover:bg-green-100 transition-colors"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                </svg>
                                涓嬭浇
                              </button>
                            </div>
                          )
                        })()}
                        {/* 閿€鍞崟鎿嶄綔鎸夐挳 - 鏀寔浠庡璞℃垨浠庡唴瀹硅В鏋?*/}
                        {(() => {
                          // 灏濊瘯浠庢秷鎭璞¤幏鍙栵紝鎴栦粠鍐呭涓В鏋愰殣钘忔爣璁?
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
                                鎵撳嵃閿€鍞崟
                              </button>
                              <button
                                onClick={() => window.open(`${API_BASE_URL}/api/sales/orders/${salesId}/download?format=pdf`, '_blank')}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-50 text-green-600 rounded-lg hover:bg-green-100 transition-colors"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                </svg>
                                涓嬭浇
                              </button>
                            </div>
                          )
                        })()}
                        {/* 缁撶畻鍗曟搷浣滄寜閽?- 鏀寔浠庡璞℃垨浠庡唴瀹硅В鏋?*/}
                        {(() => {
                          // 灏濊瘯浠庢秷鎭璞¤幏鍙栵紝鎴栦粠鍐呭涓В鏋愰殣钘忔爣璁?
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
                                鎵撳嵃缁撶畻鍗?
                              </button>
                              <button
                                onClick={() => window.open(`${API_BASE_URL}/api/settlement/orders/${settlementId}/download?format=pdf`, '_blank')}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-50 text-green-600 rounded-lg hover:bg-green-100 transition-colors"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                </svg>
                                涓嬭浇
                              </button>
                              {/* 閲嶆柊缁撶畻鎸夐挳 - 浠呯粨绠椾笓鍛樺拰绠＄悊灞傚彲瑙?*/}
                              {(userRole === 'settlement' || userRole === 'manager') && (
                                <button
                                  onClick={async () => {
                                    if (!confirm('纭畾瑕佹挙閿€姝ょ粨绠楀崟鍚楋紵鎾ら攢鍚庡彲浠ラ噸鏂伴€夋嫨鏀粯鏂瑰紡杩涜缁撶畻銆?)) return
                                    try {
                                      const response = await fetch(`${API_BASE_URL}/api/settlement/orders/${settlementId}/revert?user_role=${userRole}`, {
                                        method: 'POST'
                                      })
                                      if (response.ok) {
                                        const result = await response.json()
                                        alert(result.message || '缁撶畻鍗曞凡鎾ら攢')
                                        // 璺宠浆鍒扮粨绠楃鐞嗛〉闈?
                                        setCurrentPage('settlement')
                                      } else {
                                        const error = await response.json()
                                        alert('鎾ら攢澶辫触锛? + (error.detail || '鏈煡閿欒'))
                                      }
                                    } catch (error) {
                                      console.error('鎾ら攢缁撶畻鍗曞け璐?', error)
                                      alert('鎾ら攢澶辫触锛? + error.message)
                                    }
                                  }}
                                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-orange-50 text-orange-600 rounded-lg hover:bg-orange-100 transition-colors"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                  </svg>
                                  閲嶆柊缁撶畻
                                </button>
                              )}
                            </div>
                          )
                        })()}
                        {/* 瀹㈡埛璐﹀姟涓嬭浇鎸夐挳 - 浠庡唴瀹逛腑瑙ｆ瀽闅愯棌鏍囪 */}
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
                                涓嬭浇璐﹀姟鏄庣粏 (Excel)
                              </button>
                            </div>
                          )
                        })()}
                        {/* 鍏ュ簱鍗曟煡璇㈠鍑烘寜閽?- 浠庡唴瀹逛腑瑙ｆ瀽闅愯棌鏍囪 */}
                        {(() => {
                          if (!msg.content) return null
                          const match = msg.content.match(/<!-- EXPORT_INBOUND:([^:]*):([^:]*):([^:]*):([^>]*) -->/)
                          if (!match) return null
                          const dateStart = match[1] || ''
                          const dateEnd = match[2] || ''
                          const supplier = match[3] || ''
                          const product = match[4] || ''
                          // 鏋勫缓鏌ヨ鍙傛暟
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
                                涓嬭浇鍏ュ簱鏄庣粏 (Excel)
                              </button>
                            </div>
                          )
                        })()}
              </div>
            </div>
            {/* 宸ヨ垂鏄庣粏琛ㄦ牸锛堝崟涓晢鍝佹煡璇級 */}
            {Array.isArray(msg.laborCostDetails) && msg.laborCostDetails.length > 0 && (
                      <div className="flex justify-start mt-2">
                        <div className="max-w-4xl w-full bg-white rounded-2xl shadow-sm border border-gray-200/60 p-6">
                  <h3 className="text-lg font-semibold mb-2">宸ヨ垂鏄庣粏琛?/h3>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">搴忓彿</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">宸ヨ垂锛堝厓/鍏嬶級</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">閲嶉噺锛堝厠锛?/th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">鎬诲伐璐癸紙鍏冿級</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">鍏ュ簱鍗曞彿</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">鍏ュ簱鏃堕棿</th>
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
                    {/* 鍏ュ簱鏍稿鍗＄墖灞曠ず */}
                    {msg.inboundCard && (
                      <div className="flex justify-start mt-2">
                        <div className="max-w-2xl w-full">
                          <JewelryInboundCardComponent
                            data={msg.inboundCard}
                            actions={{
                              onConfirm: async (card) => {
                                // 鏂规B锛氳皟鐢ㄧ湡瀹炵殑鍏ュ簱API
                                console.log('纭鍏ュ簱:', card)
                                try {
                                  // 鏇存柊鍗＄墖鐘舵€佷负澶勭悊涓?
                                  setMessages(prev => prev.map(m => {
                                    if (m.id === msg.id) {
                                      return { ...m, inboundCard: updateCard(card, { status: 'processing' }) }
                                    }
                                    return m
                                  }))
                                  
                                  // 璋冪敤鍏ュ簱API
                                  const { confirmInbound } = await import('./services/inboundService')
                                  // 涓嶄娇鐢∕ock妯″紡锛岀‘淇濊幏鍙栫湡瀹炵殑orderId
                                  const useMock = false
                                  const result = await confirmInbound(card, useMock)
                                  
                                  console.log('纭鍏ュ簱缁撴灉:', result)
                                  console.log('璁㈠崟ID:', result.order?.id)
                                  console.log('璁㈠崟鍙?', result.order?.order_no)
                                  
                                  // 鏇存柊鍗＄墖鐘舵€佸拰璁㈠崟淇℃伅
                                  setMessages(prev => prev.map(m => {
                                    if (m.id === msg.id) {
                                      const updatedCard = updateCard(card, { 
                                        status: 'confirmed',
                                        orderNo: result.order?.order_no || card.orderNo,
                                        orderId: result.order?.id || card.orderId,
                                        barcode: result.order?.order_no || card.barcode || '',
                                      })
                                      console.log('鏇存柊鍚庣殑鍗＄墖:', updatedCard)
                                      console.log('鏇存柊鍚庣殑orderId:', updatedCard.orderId)
                                      return { ...m, inboundCard: updatedCard }
                                    }
                                    return m
                                  }))
                                } catch (error) {
                                  console.error('纭鍏ュ簱澶辫触:', error)
                                  // 鏇存柊鐘舵€佷负閿欒
                                  setMessages(prev => prev.map(m => {
                                    if (m.id === msg.id) {
                                      return { 
                                        ...m, 
                                        inboundCard: updateCard(card, { 
                                          status: 'error', 
                                          errorMessage: error instanceof Error ? error.message : '鍏ュ簱澶辫触'
                                        }) 
                                      }
                                    }
                                    return m
                                  }))
                                }
                              },
                              onReportError: async (card, errorReason) => {
                                // 鎶ュ憡鏁版嵁閿欒
                                console.log('鎶ュ憡鍏ュ簱鏁版嵁閿欒:', card, errorReason)
                                try {
                                  const useMock = import.meta.env.DEV && import.meta.env.VITE_USE_MOCK !== 'false'
                                  await reportError(card, errorReason, useMock)
                                  setMessages(prev => prev.map(m => {
                                    if (m.id === msg.id) {
                                      return { ...m, inboundCard: updateCard(card, { status: 'error', errorMessage: errorReason || '鏁版嵁鎶ラ敊宸叉彁浜? }) }
                                    }
                                    return m
                                  }))
                                } catch (error) {
                                  console.error('鎶ラ敊鎻愪氦澶辫触:', error)
                                }
                              },
                            }}
                          />
                        </div>
                      </div>
                    )}
                    {/* 澶氬晢鍝佸叆搴撳崱鐗囧睍绀?*/}
                    {Array.isArray(msg.inboundCards) && msg.inboundCards.length > 0 && (
                      <div className="flex justify-start mt-2">
                        <div className="max-w-4xl w-full space-y-4">
                          <div className="text-sm text-gray-600 mb-2 font-medium">
                            鍏?{msg.inboundCards.length} 涓晢鍝佸緟鍏ュ簱
                          </div>
                          {msg.inboundCards.map((card, cardIndex) => (
                            <div key={card.id || cardIndex} className="border-l-4 border-amber-400 pl-3">
                              <JewelryInboundCardComponent
                                data={card}
                                actions={{
                                  onConfirm: async (cardToConfirm) => {
                                    console.log('纭鍏ュ簱鍗曚釜鍟嗗搧:', cardToConfirm)
                                    try {
                                      // 鏇存柊褰撳墠鍗＄墖鐘舵€佷负澶勭悊涓?
                                      setMessages(prev => prev.map(m => {
                                        if (m.id === msg.id && m.inboundCards) {
                                          const updatedCards = m.inboundCards.map((c, i) => 
                                            i === cardIndex ? updateCard(c, { status: 'processing' }) : c
                                          )
                                          return { ...m, inboundCards: updatedCards }
                                        }
                                        return m
                                      }))
                                      
                                      // 璋冪敤鍏ュ簱API
                                      const { confirmInbound } = await import('./services/inboundService')
                                      const result = await confirmInbound(cardToConfirm, false)
                                      
                                      console.log('纭鍏ュ簱缁撴灉:', result)
                                      
                                      // 鏇存柊鍗＄墖鐘舵€?
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
                                      console.error('纭鍏ュ簱澶辫触:', error)
                                      setMessages(prev => prev.map(m => {
                                        if (m.id === msg.id && m.inboundCards) {
                                          const updatedCards = m.inboundCards.map((c, i) => 
                                            i === cardIndex ? updateCard(c, { 
                                              status: 'error', 
                                              errorMessage: error instanceof Error ? error.message : '鍏ュ簱澶辫触'
                                            }) : c
                                          )
                                          return { ...m, inboundCards: updatedCards }
                                        }
                                        return m
                                      }))
                                    }
                                  },
                                  onReportError: async (cardToReport, errorReason) => {
                                    console.log('鎶ュ憡鍏ュ簱鏁版嵁閿欒:', cardToReport, errorReason)
                                    try {
                                      await reportError(cardToReport, errorReason, false)
                                      setMessages(prev => prev.map(m => {
                                        if (m.id === msg.id && m.inboundCards) {
                                          const updatedCards = m.inboundCards.map((c, i) => 
                                            i === cardIndex ? updateCard(c, { 
                                              status: 'error', 
                                              errorMessage: errorReason || '鏁版嵁鎶ラ敊宸叉彁浜? 
                                            }) : c
                                          )
                                          return { ...m, inboundCards: updatedCards }
                                        }
                                        return m
                                      }))
                                    } catch (error) {
                                      console.error('鎶ラ敊鎻愪氦澶辫触:', error)
                                    }
                                  },
                                }}
                              />
                            </div>
                          ))}
                          {/* 鎵归噺纭鎸夐挳 */}
                          {msg.inboundCards.some(c => c.status === 'pending') && (
                            <div className="flex gap-3 mt-4 pt-4 border-t border-gray-200">
                              <button
                                onClick={async () => {
                                  console.log('鎵归噺纭鍏ュ簱')
                                  const { confirmInbound } = await import('./services/inboundService')
                                  
                                  for (let i = 0; i < msg.inboundCards.length; i++) {
                                    const card = msg.inboundCards[i]
                                    if (card.status !== 'pending') continue
                                    
                                    try {
                                      // 鏇存柊鐘舵€佷负澶勭悊涓?
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
                                      
                                      // 鏇存柊鐘舵€佷负宸茬‘璁?
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
                                      console.error('鎵归噺鍏ュ簱澶辫触:', error)
                                      setMessages(prev => prev.map(m => {
                                        if (m.id === msg.id && m.inboundCards) {
                                          const updatedCards = m.inboundCards.map((c, idx) => 
                                            idx === i ? updateCard(c, { 
                                              status: 'error',
                                              errorMessage: error instanceof Error ? error.message : '鍏ュ簱澶辫触'
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
                                鉁?鍏ㄩ儴纭鍏ュ簱
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    {/* 閿€鍞崟鍗＄墖灞曠ず */}
                    {msg.salesOrder && (
                      <div className="flex justify-start mt-2">
                        <div className="max-w-4xl w-full bg-gradient-to-r from-green-50 to-blue-50 rounded-2xl shadow-lg p-6 border border-green-200/60">
                          <h3 className="text-xl font-bold text-gray-800 mb-4">馃搵 閿€鍞崟璇︽儏</h3>
                          <div className="grid grid-cols-2 gap-4 mb-4">
                            <div>
                              <span className="text-gray-600">閿€鍞崟鍙凤細</span>
                              <span className="font-semibold">{msg.salesOrder.order_no}</span>
                            </div>
                            <div>
                              <span className="text-gray-600">瀹㈡埛锛?/span>
                              <span className="font-semibold">{msg.salesOrder.customer_name}</span>
                            </div>
                            <div>
                              <span className="text-gray-600">涓氬姟鍛橈細</span>
                              <span className="font-semibold">{msg.salesOrder.salesperson}</span>
                            </div>
                            <div>
                              <span className="text-gray-600">闂ㄥ簵浠ｇ爜锛?/span>
                              <span className="font-semibold">{msg.salesOrder.store_code || '鏈～鍐?}</span>
                            </div>
                            <div>
                              <span className="text-gray-600">鏃ユ湡锛?/span>
                              <span className="font-semibold">{new Date(msg.salesOrder.order_date).toLocaleString('zh-CN')}</span>
                            </div>
                            <div>
                              <span className="text-gray-600">鐘舵€侊細</span>
                              <span className={`font-semibold ${
                                msg.salesOrder.status === '宸茬粨绠? ? 'text-green-600' : 
                                msg.salesOrder.status === '寰呯粨绠? ? 'text-yellow-600' : 
                                'text-gray-600'
                              }`}>
                                {msg.salesOrder.status}
                              </span>
                            </div>
                          </div>
                          {/* 鍟嗗搧鏄庣粏琛ㄦ牸 */}
                          {Array.isArray(msg.salesOrder?.details) && msg.salesOrder.details.length > 0 && (
                            <div className="mt-4">
                              <h4 className="font-semibold mb-2 text-gray-700">鍟嗗搧鏄庣粏</h4>
                              <div className="overflow-x-auto">
                                <table className="min-w-full divide-y divide-gray-200 bg-white rounded-lg">
                                  <thead className="bg-gray-100">
                                    <tr>
                                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-700 uppercase">鍟嗗搧鍚嶇О</th>
                                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-700 uppercase">鍏嬮噸</th>
                                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-700 uppercase">宸ヨ垂</th>
                                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-700 uppercase">鎬诲伐璐?/th>
                                    </tr>
                                  </thead>
                                  <tbody className="bg-white divide-y divide-gray-200">
                                    {msg.salesOrder.details.map((detail, idx) => (
                                      <tr key={idx} className="hover:bg-gray-50">
                                        <td className="px-4 py-2 text-sm text-gray-900">{detail.product_name}</td>
                                        <td className="px-4 py-2 text-sm text-gray-900">{detail.weight}鍏?/td>
                                        <td className="px-4 py-2 text-sm text-gray-900">{detail.labor_cost}鍏?鍏?/td>
                                        <td className="px-4 py-2 text-sm font-semibold text-gray-900">{detail.total_labor_cost.toFixed(2)}鍏?/td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                              <div className="mt-4 flex justify-end space-x-6 text-lg font-bold text-gray-800">
                                <span>鎬诲厠閲嶏細<span className="text-blue-600">{msg.salesOrder.total_weight}鍏?/span></span>
                                <span>鎬诲伐璐癸細<span className="text-green-600">{msg.salesOrder.total_labor_cost.toFixed(2)}鍏?/span></span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    {/* 搴撳瓨妫€鏌ラ敊璇彁绀哄崱鐗?*/}
                    {Array.isArray(msg.inventoryErrors) && msg.inventoryErrors.length > 0 && (
                      <div className="flex justify-start mt-2">
                        <div className="max-w-4xl w-full bg-red-50 rounded-2xl shadow-sm p-6 border border-red-200/60">
                          <h3 className="text-xl font-bold text-red-800 mb-4">鉂?搴撳瓨妫€鏌ュけ璐?/h3>
                          <div className="space-y-4">
                            {msg.inventoryErrors.map((error, idx) => (
                              <div key={idx} className="bg-white rounded-lg p-4 border border-red-200">
                                <div className="font-semibold text-red-700 mb-2">
                                  {idx + 1}. {error.product_name}
                                </div>
                                <div className="text-sm text-gray-700 space-y-1">
                                  <div className="flex items-center">
                                    <span className="text-red-600 font-medium">閿欒锛?/span>
                                    <span className="ml-2">{error.error}</span>
                                  </div>
                                  <div className="flex items-center">
                                    <span className="text-gray-600">闇€瑕侊細</span>
                                    <span className="ml-2 font-semibold">{error.required_weight}鍏?/span>
                                  </div>
                                  <div className="flex items-center">
                                    <span className="text-gray-600">鍙敤锛?/span>
                                    <span className="ml-2 font-semibold text-red-600">{error.available_weight}鍏?/span>
                                  </div>
                                  {error.reserved_weight !== undefined && (
                                    <div className="flex items-center">
                                      <span className="text-gray-600">宸查鐣欙細</span>
                                      <span className="ml-2 font-semibold">{error.reserved_weight}鍏?/span>
                                    </div>
                                  )}
                                  {error.total_weight !== undefined && (
                                    <div className="flex items-center">
                                      <span className="text-gray-600">鎬诲簱瀛橈細</span>
                                      <span className="ml-2 font-semibold">{error.total_weight}鍏?/span>
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
                                        text: msg.chartTitle || '瓒嬪娍鍒嗘瀽锛堟姌绾垮浘锛?,
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
                                          if (msg.chartType === '渚涘簲鍟嗗垎鏋? || msg.chartType === '鐢熸垚鍥捐〃') {
                                            return '渚涘簲鍟嗗姣斿垎鏋愶紙鏌辩姸鍥撅級'
                                          } else if (msg.chartType === '鏌ヨ搴撳瓨') {
                                            return '馃搳 搴撳瓨缁熻鍥捐〃'
                                          }
                                          return '鏁版嵁缁熻鍥捐〃'
                                        })(),
                                        font: { size: 14, weight: 'bold' }
                        },
                        tooltip: {
                          callbacks: {
                            label: function(context) {
                              const label = context.dataset.label || '';
                              const value = context.parsed.y;
                              const unit = label.includes('宸ヨ垂') ? ' 鍏? : ' 鍏?;
                              return `${label}: ${value.toLocaleString()}${unit}`;
                            }
                          }
                        }
                      },
                      scales: {
                        y: {
                          beginAtZero: true,
                                        title: { display: true, text: '閲嶉噺锛堝厠锛? }
                        },
                        x: {
                                        title: { display: true, text: '鍟嗗搧鍚嶇О' }
                        }
                      }
                    }} 
                  />
                              )}
                            </div>
                  
                            {/* 鐜舰鍥撅紙鏇夸唬楗煎浘锛屾洿鐜颁唬锛?*/}
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
                                          if (msg.chartType === '渚涘簲鍟嗗垎鏋? || msg.chartType === '鐢熸垚鍥捐〃') {
                                            return '馃崺 渚涘簲鍟嗗崰姣斿垎甯?
                                          }
                                          return '馃崺 搴撳瓨鍗犳瘮鍒嗗竷'
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
                                  return `${label}: ${value.toLocaleString()} 鍏?(${percentage}%)`;
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
                          {/* 鏌ョ湅璇︾粏鏁版嵁鎶樺彔闈㈡澘 */}
                          {msg.rawData && (msg.rawData.suppliers || msg.rawData.inventory) && (
                            <details className="mt-4 border-t border-gray-100 pt-4">
                              <summary className="cursor-pointer text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1">
                                <span>馃搳 鏌ョ湅璇︾粏鏁版嵁</span>
                              </summary>
                              <div className="mt-3 overflow-x-auto">
                                {/* 渚涘簲鍟嗘暟鎹〃鏍?*/}
                                {msg.rawData.suppliers && msg.rawData.suppliers.length > 0 && (
                                  <table className="min-w-full text-sm">
                                    <thead className="bg-gray-50">
                                      <tr>
                                        <th className="px-3 py-2 text-left font-medium text-gray-600">渚涘簲鍟?/th>
                                        <th className="px-3 py-2 text-right font-medium text-gray-600">渚涜揣閲嶉噺(鍏?</th>
                                        <th className="px-3 py-2 text-right font-medium text-gray-600">鎬诲伐璐?鍏?</th>
                                        <th className="px-3 py-2 text-right font-medium text-gray-600">渚涜揣娆℃暟</th>
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
                                {/* 搴撳瓨鏁版嵁琛ㄦ牸 */}
                                {msg.rawData.inventory && msg.rawData.inventory.length > 0 && (
                                  <table className="min-w-full text-sm">
                                    <thead className="bg-gray-50">
                                      <tr>
                                        <th className="px-3 py-2 text-left font-medium text-gray-600">鍟嗗搧鍚嶇О</th>
                                        <th className="px-3 py-2 text-right font-medium text-gray-600">搴撳瓨閲嶉噺(鍏?</th>
                                        <th className="px-3 py-2 text-right font-medium text-gray-600">鍏ュ簱娆℃暟</th>
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

        {/* AI鎬濊€冪姸鎬佸姩鐢?- 鐝犲疂椋庢牸 */}
        {(loading || uploading) && (
          <div className="flex justify-start items-start gap-3">
            {/* AI澶村儚 + 鑴夊啿鍔ㄧ敾 */}
            <div className="relative flex-shrink-0">
              <img src="/ai-avatar.png" alt="AI" className="w-9 h-9 rounded-full object-cover shadow-lg" />
              <div className="absolute inset-0 bg-amber-400 rounded-full animate-ping opacity-30"></div>
            </div>
            {/* 鎬濊€冩皵娉?*/}
            <div className="bg-gradient-to-br from-white to-amber-50 rounded-3xl px-5 py-4 shadow-sm border border-amber-100">
              <div className="flex items-center gap-3">
                <div className="flex space-x-1.5">
                  <div className="w-2.5 h-2.5 bg-amber-500 rounded-full animate-bounce"></div>
                  <div className="w-2.5 h-2.5 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: '0.15s' }}></div>
                  <div className="w-2.5 h-2.5 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: '0.3s' }}></div>
                </div>
                <span className="text-sm text-amber-600 font-medium">
                  {uploading ? 'AI姝ｅ湪璇嗗埆鍥剧墖...' : 'AI姝ｅ湪鍒嗘瀽...'}
                </span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
          </div>
      </div>

      {/* OCR璇嗗埆缂栬緫瀵硅瘽妗?*/}
      {showOCRModal && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-2 sm:p-4"
          onClick={(e) => {
            // 鐐瑰嚮鑳屾櫙鍏抽棴瀵硅瘽妗?
            if (e.target === e.currentTarget) {
              setShowOCRModal(false)
              setOcrResult('')
              setUploadedImage(null)
            }
          }}
        >
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col">
            {/* 瀵硅瘽妗嗘爣棰樻爮 */}
            <div className="px-4 sm:px-6 py-4 border-b flex justify-between items-center bg-gray-50">
              <div className="flex items-center space-x-2">
                <span className="text-2xl">馃摑</span>
                <h2 className="text-lg sm:text-xl font-semibold text-gray-800">
                  瀹℃牳骞剁紪杈戣瘑鍒唴瀹?
                </h2>
              </div>
              <button
                onClick={() => {
                  setShowOCRModal(false)
                  setOcrResult('')
                  setUploadedImage(null)
                }}
                className="text-gray-400 hover:text-gray-600 text-3xl font-light w-8 h-8 flex items-center justify-center transition-colors"
                title="鍏抽棴"
              >
                脳
              </button>
            </div>
            
            {/* 瀵硅瘽妗嗗唴瀹瑰尯鍩?*/}
            <div className="flex-1 overflow-hidden flex flex-col sm:flex-row">
              {/* 宸︿晶锛氬浘鐗囬瑙堬紙妗岄潰绔樉绀猴紝绉诲姩绔殣钘忔垨鎶樺彔锛?*/}
              {uploadedImage && (
                <div className="hidden sm:block w-80 border-r bg-gray-50 p-4 overflow-y-auto">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">鍘熷鍥剧墖</h3>
                  <div className="bg-white rounded-lg p-2 shadow-sm">
                    <img 
                      src={uploadedImage} 
                      alt="涓婁紶鐨勫叆搴撳崟" 
                      className="w-full h-auto rounded border border-gray-200"
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-3">
                    璇峰鐓у浘鐗囨鏌ヨ瘑鍒唴瀹规槸鍚︽纭?
                  </p>
                </div>
              )}
              
              {/* 鍙充晶锛氱紪杈戝尯鍩?*/}
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* 鎻愮ず淇℃伅 */}
                <div className="px-4 sm:px-6 py-3 sm:py-4 border-b bg-blue-50">
                  <p className="text-xs sm:text-sm text-blue-800 font-medium mb-1">
                    鈿狅笍 璇锋鏌ュ苟缂栬緫璇嗗埆鍐呭锛岀‘璁ゆ棤璇悗鐐瑰嚮"纭鍏ュ簱"
                  </p>
                  <ul className="text-xs text-blue-700 list-disc list-inside space-y-0.5 mt-2">
                    <li>妫€鏌ュ晢鍝佸悕绉版槸鍚︽纭?/li>
                    <li>妫€鏌ラ噸閲忋€佸伐璐广€佷緵搴斿晢绛変俊鎭?/li>
                    <li>鍙互鎵嬪姩缂栬緫淇敼鍐呭</li>
                  </ul>
                </div>
                
                {/* 鏂囨湰缂栬緫鍖哄煙 */}
                <div className="flex-1 p-4 sm:p-6 overflow-y-auto">
                  <LineNumberedTextarea
                    ref={ocrTextareaRef}
                    value={ocrResult}
                    onChange={(e) => setOcrResult(e.target.value)}
                    placeholder="璇嗗埆鍑虹殑鏂囧瓧鍐呭灏嗘樉绀哄湪杩欓噷..."
                    className="min-h-[300px]"
                  />
                </div>
              </div>
            </div>
            
            {/* 绉诲姩绔浘鐗囬瑙堬紙鍙€夛紝鍦ㄧ紪杈戝尯鍩熶笅鏂规樉绀猴級 */}
            {uploadedImage && (
              <div className="sm:hidden border-t bg-gray-50 p-4 max-h-48 overflow-y-auto">
                <h3 className="text-xs font-semibold text-gray-700 mb-2">鍘熷鍥剧墖</h3>
                <img 
                  src={uploadedImage} 
                  alt="涓婁紶鐨勫叆搴撳崟" 
                  className="w-full h-auto rounded border border-gray-200"
                />
              </div>
            )}
            
            {/* 瀵硅瘽妗嗗簳閮ㄦ寜閽?*/}
            <div className="px-4 sm:px-6 py-4 border-t bg-gray-50 flex flex-col sm:flex-row justify-end space-y-2 sm:space-y-0 sm:space-x-4">
              <button
                onClick={() => {
                  setShowOCRModal(false)
                  setOcrResult('')
                  setUploadedImage(null)
                }}
                className="w-full sm:w-auto px-6 py-2.5 border border-gray-300 rounded-lg text-gray-700 hover:bg-white transition-colors font-medium order-2 sm:order-1"
              >
                鍙栨秷
              </button>
              <button
                onClick={handleConfirmInbound}
                disabled={loading || !ocrResult.trim()}
                className="w-full sm:w-auto px-8 py-2.5 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium order-1 sm:order-2"
              >
                {loading ? '澶勭悊涓?..' : '纭鍏ュ簱'}
              </button>
            </div>
          </div>
        </div>
      )}

        {/* 杈撳叆鍖哄煙 - 鑻规灉椋庢牸 */}
        <footer className="bg-white/80 backdrop-blur-xl border-t border-gray-200/60 px-6 py-5">
          <div className="max-w-4xl mx-auto">
            <div className="flex items-end space-x-3">
              {/* 蹇嵎鍏ュ簱鎸夐挳 - 浠呭晢鍝佷笓鍛樺彲瑙?*/}
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
                  title="蹇嵎鍏ュ簱"
                >
                  馃摝 鍏ュ簱
                </button>
              )}

              {/* 蹇€熷紑鍗曟寜閽?- 浠呮煖鍙板彲瑙侊紙缁撶畻涓撳憳涓嶉渶瑕侊級 */}
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
                  title="蹇€熷紑鍗?
                >
                  馃摑 寮€鍗?
                </button>
              )}

              {/* 蹇嵎閫€璐ф寜閽?- 鍟嗗搧涓撳憳鍜屾煖鍙板彲瑙?*/}
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
                  title="蹇嵎閫€璐?
                >
                  鈫╋笍 閫€璐?
                </button>
              )}

          {/* 鍥剧墖涓婁紶鎸夐挳 */}
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
            title="OCR璇嗗埆鍏ュ簱鍗曟嵁 - 鏀寔鎷嶇収鎴栦笂浼犲崟鎹浘鐗囪嚜鍔ㄨ瘑鍒?
                className={`
                  px-4 py-3 rounded-2xl cursor-pointer transition-all duration-200
                  h-[52px] flex items-center font-medium text-[15px]
                  ${loading || uploading
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'border-2 border-jewelry-navy text-jewelry-navy hover:bg-jewelry-navy hover:text-white'
                  }
                `}
              >
                {uploading ? `馃摲 ${t('chat.scanning')}` : `馃摲 ${t('chat.scan')}`}
          </label>

          {/* 蹇嵎鏀舵枡/鎻愭枡鎸夐挳 - 缁撶畻涓撳憳鍜岀鐞嗗眰鍙 */}
          {(userRole === 'settlement' || userRole === 'manager') && (
            <>
              <button
                onClick={openQuickReceiptModal}
                className="px-4 py-3 rounded-2xl h-[52px] flex items-center font-medium text-[15px] bg-gradient-to-r from-jewelry-gold to-jewelry-gold-light text-white hover:from-jewelry-gold-dark hover:to-jewelry-gold shadow-sm hover:shadow-md transition-all duration-200"
                title={currentLanguage === 'en' ? 'Quick Receipt' : '蹇嵎鏀舵枡'}
              >
                馃摝 {t('chat.receipt')}
              </button>
              <button
                onClick={openQuickWithdrawalModal}
                className="px-4 py-3 rounded-2xl h-[52px] flex items-center font-medium text-[15px] border-2 border-jewelry-navy text-jewelry-navy hover:bg-jewelry-navy hover:text-white transition-all duration-200"
                title={currentLanguage === 'en' ? 'Quick Withdrawal' : '蹇嵎鎻愭枡'}
              >
                猬嗭笍 {t('chat.withdrawal')}
              </button>
            </>
          )}

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
            placeholder={t('chat.inputPlaceholder')}
            rows={1}
                  className="w-full px-5 py-4 border-2 border-gray-200 rounded-2xl 
                             focus:outline-none focus:border-jewelry-gold focus:ring-4 focus:ring-jewelry-gold/10
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
                    : 'bg-gradient-to-r from-jewelry-gold to-jewelry-gold-light text-white hover:from-jewelry-gold-dark hover:to-jewelry-gold'
                  }
                `}
          >
            {t('common.send')}
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
                // 缁撶畻鍗曠‘璁ゅ悗锛屽湪鑱婂ぉ妗嗘樉绀烘槑缁?
                const itemsList = (Array.isArray(data?.details) ? data.details : []).map((item, idx) => 
                  `${idx + 1}. ${item.product_name}锛?{item.weight}鍏?脳 楼${item.labor_cost}/鍏?= 楼${item.total_labor_cost.toFixed(2)}`
                ).join('\n')
                
                const paymentMethodStr = data.payment_method === 'cash_price' ? '缁撲环' : 
                          data.payment_method === 'mixed' ? '娣峰悎鏀粯' : '缁撴枡'
                
                const settlementMessage = `鉁?**缁撶畻鍗曠‘璁ゆ垚鍔?*

馃搵 **缁撶畻鍗曞彿**锛?{data.settlement_no}
馃懁 **瀹㈡埛**锛?{data.customer_name}
馃鈥嶐煉?**涓氬姟鍛?*锛?{data.salesperson}
馃挸 **鏀粯鏂瑰紡**锛?{paymentMethodStr}

馃摝 **鍟嗗搧鏄庣粏**锛?
${itemsList}

馃搳 **姹囨€?*锛?
- 鎬诲厠閲嶏細${data.total_weight.toFixed(2)}鍏?
- 宸ヨ垂鍚堣锛毬?{data.labor_amount.toFixed(2)}
${data.gold_price ? `- 閲戜环锛?{data.gold_price.toFixed(2)} 鍏?鍏媊 : ''}
${data.material_amount > 0 ? `- 閲戞枡閲戦锛毬?{data.material_amount.toFixed(2)}` : ''}
- **搴旀敹鎬昏锛毬?{data.total_amount.toFixed(2)}**

<!-- SETTLEMENT_ORDER:${data.settlement_id}:${data.settlement_no} -->`

                setMessages(prev => [...prev, {
                  type: 'system',
                  content: settlementMessage,
                  settlementOrderId: data.settlement_id,
                  settlementOrderNo: data.settlement_no
                }])
                
                // 淇濆瓨鍒拌亰澶╁巻鍙?
                if (currentSessionId) {
                  const params = new URLSearchParams({
                    session_id: currentSessionId,
                    message_type: 'assistant',
                    content: settlementMessage,
                    user_role: userRole
                  })
                  fetch(`${API_BASE_URL}/api/chat-logs/message?${params}`, {
                    method: 'POST'
                  }).catch(err => console.error('淇濆瓨缁撶畻鍗曟秷鎭け璐?', err))
                }
                
                // 鍒囨崲鍥炶亰澶╅〉闈?
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

      {/* 蹇嵎寮€鍗曞脊绐?- 浠呮煖鍙板彲鐢紙缁撶畻涓撳憳涓嶉渶瑕侊級 */}
      {userRole === 'counter' && (
        <QuickOrderModal
          isOpen={showQuickOrderModal}
          onClose={() => setShowQuickOrderModal(false)}
          onSuccess={(result) => {
            // 寮€鍗曟垚鍔熷悗鍦ㄨ亰澶╂鏄剧ず閿€鍞崟鏄庣粏
            const itemsList = (Array.isArray(result?.items) ? result.items : []).map((item, idx) => 
              `${idx + 1}. ${item.product_name}锛?{item.weight}鍏?脳 楼${item.labor_cost}/鍏?= 楼${(item.weight * item.labor_cost).toFixed(2)}`
            ).join('\n')
            
            const salesMessage = `鉁?**閿€鍞崟鍒涘缓鎴愬姛**

馃搵 **閿€鍞崟鍙?*锛?{result.order_no}
馃懁 **瀹㈡埛**锛?{result.customer_name}
馃鈥嶐煉?**涓氬姟鍛?*锛?{result.salesperson}

馃摝 **鍟嗗搧鏄庣粏**锛?
${itemsList}

馃搳 **姹囨€?*锛?
- 鎬诲厠閲嶏細${result.total_weight.toFixed(2)}鍏?
- 鎬诲伐璐癸細楼${result.total_labor_cost.toFixed(2)}

<!-- SALES_ORDER:${result.order_id}:${result.order_no} -->`

            setMessages(prev => [...prev, {
              type: 'system',
              content: salesMessage,
              salesOrderId: result.order_id,
              salesOrderNo: result.order_no
            }])
            
            // 淇濆瓨鍒拌亰澶╁巻鍙?
            if (currentSessionId) {
              const params = new URLSearchParams({
                session_id: currentSessionId,
                message_type: 'assistant',
                content: salesMessage,
                user_role: userRole
              })
              fetch(`${API_BASE_URL}/api/chat-logs/message?${params}`, {
                method: 'POST'
              }).catch(err => console.error('淇濆瓨閿€鍞崟娑堟伅澶辫触:', err))
            }
          }}
        />
      )}

      {/* 蹇嵎閫€璐у脊绐?- 鍟嗗搧涓撳憳鍜屾煖鍙板彲鐢?*/}
      {(hasPermission(userRole, 'canReturnToSupplier') || hasPermission(userRole, 'canReturnToWarehouse')) && (
        <QuickReturnModal
          isOpen={showQuickReturnModal}
          onClose={() => setShowQuickReturnModal(false)}
          onSuccess={async (result) => {
            // 鏋勫缓閫€璐ф垚鍔熺殑娑堟伅鍐呭锛堝寘鍚殣钘忕殑ID鏍囪锛岀敤浜庡巻鍙茶褰曚腑鏄剧ず鎵撳嵃鎸夐挳锛?
            const returnMessage = `鉁?**閫€璐у崟鍒涘缓鎴愬姛**\n\n馃搵 鍗曞彿锛?{result.return_no}\n馃摝 鍟嗗搧鏁伴噺锛?{result.item_count}涓猏n鈿栵笍 鎬婚€€璐у厠閲嶏細${result.total_weight?.toFixed(2) || 0}鍏媆n馃挵 鎬诲伐璐癸細楼${result.total_labor_cost?.toFixed(2) || 0}\n馃摑 閫€璐у師鍥狅細${result.return_reason}${result.supplier_name ? `\n馃彮 渚涘簲鍟嗭細${result.supplier_name}` : ''}${result.from_location_name ? `\n馃搷 鍙戣捣浣嶇疆锛?{result.from_location_name}` : ''}\n\n<!-- RETURN_ORDER:${result.return_id}:${result.return_no} -->`
            
            // 娣诲姞鍒拌亰澶╄褰曟樉绀猴紙鍖呭惈閫€璐у崟淇℃伅锛岀敤浜庝笅杞?鎵撳嵃锛?
            setMessages(prev => [...prev, {
              type: 'system',
              content: returnMessage,
              returnOrder: {
                id: result.return_id,
                return_no: result.return_no
              }
            }])
            
            // 淇濆瓨鍒板悗绔亰澶╁巻鍙诧紙鍖呭惈ID鏍囪锛?
            try {
              await fetch(`${API_BASE_URL}/api/chat-logs/message?session_id=${encodeURIComponent(currentSessionId)}&message_type=assistant&content=${encodeURIComponent(returnMessage)}&user_role=${userRole}&intent=閫€璐, {
                method: 'POST'
              })
            } catch (error) {
              console.error('淇濆瓨閫€璐ц褰曞埌鑱婂ぉ鍘嗗彶澶辫触:', error)
            }
          }}
          userRole={userRole}
        />
      )}

      {/* 蹇嵎鍏ュ簱寮圭獥 - 闇€瑕佸叆搴撴潈闄?*/}
      {hasPermission(userRole, 'canInbound') && (
        <QuickInboundModal
          isOpen={showQuickInboundModal}
          onClose={() => setShowQuickInboundModal(false)}
          onSuccess={async (result) => {
            // 鏋勫缓鍏ュ簱鎴愬姛鐨勬秷鎭唴瀹癸紙鍖呭惈闅愯棌鐨処D鏍囪锛岀敤浜庡巻鍙茶褰曚腑鏄剧ず鎵撳嵃鎸夐挳锛?
            const productList = (Array.isArray(result?.products) ? result.products : []).slice(0, 5).map(p => {
              let info = `  鈥?${p.name}锛?{p.weight}鍏?(宸ヨ垂楼${p.labor_cost}/g)`
              const pieceCount = parseInt(p.piece_count) || 0
              const pieceLaborCost = parseFloat(p.piece_labor_cost) || 0
              if (pieceCount > 0) {
                info += ` [${pieceCount}浠? 浠跺伐璐孤?{pieceLaborCost}]`
              }
              return info
            }).join('\n')
            const moreProducts = result.products.length > 5 ? `\n  ... 绛夊叡 ${result.products.length} 浠跺晢鍝乣 : ''
            // 鍙湪鏈夊浠跺晢鍝佹椂鏄剧ず浠舵暟锛屽崟浠跺彧鏄剧ず鍏嬮噸
            const countInfo = result.total_count > 1 ? `\n馃摝 鍏ュ簱鏁伴噺锛?{result.total_count} 浠禶 : ''
            const inboundMessage = `鉁?**鍏ュ簱鎴愬姛**${result.order_no ? `\n\n馃搵 鍗曞彿锛?{result.order_no}` : ''}\n馃彮 渚涘簲鍟嗭細${result.supplier_name || '鏈寚瀹?}${countInfo}\n鈿栵笍 鎬诲厠閲嶏細${result.total_weight.toFixed(2)}鍏媆n馃挵 鎬诲伐璐癸細楼${result.total_labor_cost.toFixed(2)}\n\n馃搵 鍟嗗搧鏄庣粏锛歕n${productList}${moreProducts}${result.order_id ? `\n\n<!-- INBOUND_ORDER:${result.order_id}:${result.order_no} -->` : ''}`
            
            // 娣诲姞鍒拌亰澶╄褰曟樉绀猴紙鍖呭惈鍏ュ簱鍗曚俊鎭紝鐢ㄤ簬涓嬭浇/鎵撳嵃锛?
            setMessages(prev => [...prev, {
              type: 'system',
              content: inboundMessage,
              inboundOrder: result.order_id ? {
                id: result.order_id,
                order_no: result.order_no
              } : null
            }])
            
            // 淇濆瓨鍒板悗绔亰澶╁巻鍙诧紙鍖呭惈ID鏍囪锛?
            try {
              await fetch(`${API_BASE_URL}/api/chat-logs/message?session_id=${encodeURIComponent(currentSessionId)}&message_type=assistant&content=${encodeURIComponent(inboundMessage)}&user_role=${userRole}&intent=鍏ュ簱`, {
                method: 'POST'
              })
            } catch (error) {
              console.error('淇濆瓨鍏ュ簱璁板綍鍒拌亰澶╁巻鍙插け璐?', error)
            }
          }}
          userRole={userRole}
        />
      )}

      {/* 閿€鍞鐞嗗脊绐?- 鏌滃彴銆佺粨绠椼€佷笟鍔″彲鐢?*/}
      {showSalesSearchModal && ['counter', 'settlement', 'sales'].includes(userRole) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"><SalesOrdersPage userRole={userRole} onClose={() => setShowSalesSearchModal(false)} /></div>
      )}

      {/* 鍘嗗彶鍥炴函闈㈡澘 - 鎵€鏈夎鑹插彲鐢?*/}
      <ChatHistoryPanel
        isOpen={showHistoryPanel}
        onClose={() => setShowHistoryPanel(false)}
        userRole={userRole}
        onLoadSession={(sessionId, sessionMessages) => {
          // 鍔犺浇鍘嗗彶瀵硅瘽鍒板綋鍓嶈亰澶?
          if (sessionMessages && sessionMessages.length > 0) {
            const formattedMessages = sessionMessages.map(msg => ({
              type: msg.message_type === 'user' ? 'user' : 'system',  // 浣跨敤 type 鍜?system锛堜笌娓叉煋閫昏緫涓€鑷达級
              content: msg.content,
              timestamp: msg.created_at
            }))
            // 瑙ｆ瀽娑堟伅涓殑闅愯棌鏍囪锛屾仮澶嶆墍鏈夌壒娈婃秷鎭殑棰濆瀛楁
            const parsedMessages = parseMessageHiddenMarkers(formattedMessages)
            setMessages(parsedMessages)
            
            // 璁剧疆褰撳墠 session_id锛岀‘淇濆悗缁秷鎭户缁娇鐢ㄧ浉鍚岀殑浼氳瘽
            setCurrentSessionId(sessionId)
            localStorage.setItem('current_session_id', sessionId)
            setCurrentConversationId(sessionId)
            
            setShowHistoryPanel(false)
          }
        }}
      />

      {/* 蹇嵎鏀舵枡寮圭獥 */}
      {showQuickReceiptModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-lg w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold flex items-center">
                <span className="text-xl mr-2">馃摝</span>
                蹇嵎鏀舵枡
              </h3>
              <button onClick={() => setShowQuickReceiptModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">脳</button>
            </div>
            <form onSubmit={handleQuickReceipt} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">閫夋嫨瀹㈡埛</label>
                <input
                  type="text"
                  placeholder="鎼滅储瀹㈡埛濮撳悕鎴栫數璇?.."
                  value={quickFormCustomerSearch}
                  onChange={(e) => setQuickFormCustomerSearch(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500 mb-2"
                />
                <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg">
                  {filteredQuickFormCustomers.length === 0 ? (
                    <div className="p-3 text-center text-gray-500 text-sm">鏆傛棤鍖归厤瀹㈡埛</div>
                  ) : (
                    filteredQuickFormCustomers.slice(0, 10).map(customer => (
                      <div
                        key={customer.id}
                        onClick={() => {
                          setQuickReceiptForm({ ...quickReceiptForm, customer_id: customer.id.toString() })
                          setQuickFormCustomerSearch(customer.name) // 璁剧疆鎼滅储妗嗕负瀹㈡埛鍚嶏紝鏀惰捣涓嬫媺
                        }}
                        className={`p-3 cursor-pointer hover:bg-yellow-50 border-b last:border-b-0 flex justify-between items-center ${
                          quickReceiptForm.customer_id === customer.id.toString() ? 'bg-yellow-100' : ''
                        }`}
                      >
                        <span className="font-medium">{customer.name}</span>
                        <span className="text-sm text-gray-500">{customer.phone || '-'}</span>
                      </div>
                    ))
                  )}
                </div>
                {quickReceiptForm.customer_id && (
                  <div className="mt-2 text-sm text-green-600">
                    宸查€夋嫨锛歿quickFormCustomers.find(c => c.id.toString() === quickReceiptForm.customer_id)?.name}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">鏀舵枡鍏嬮噸 (鍏?</label>
                <input
                  type="number"
                  step="0.01"
                  value={quickReceiptForm.gold_weight}
                  onChange={(e) => setQuickReceiptForm({ ...quickReceiptForm, gold_weight: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500"
                  placeholder="杈撳叆鏀舵枡鍏嬮噸"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">鎴愯壊</label>
                <select
                  value={quickReceiptForm.gold_fineness}
                  onChange={(e) => setQuickReceiptForm({ ...quickReceiptForm, gold_fineness: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500"
                >
                  <option value="瓒抽噾999">瓒抽噾999</option>
                  <option value="瓒抽噾9999">瓒抽噾9999</option>
                  <option value="Au999">Au999</option>
                  <option value="Au9999">Au9999</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">澶囨敞锛堝彲閫夛級</label>
                <textarea
                  value={quickReceiptForm.remark}
                  onChange={(e) => setQuickReceiptForm({ ...quickReceiptForm, remark: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500"
                  rows={2}
                  placeholder="瀹㈡埛瀛樻枡 / 鍏朵粬璇存槑"
                />
              </div>
              <div className="flex space-x-3 pt-4">
                <button type="button" onClick={() => setShowQuickReceiptModal(false)} className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">鍙栨秷</button>
                <button type="submit" className="flex-1 px-4 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600">纭骞舵墦鍗?/button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 蹇嵎鎻愭枡寮圭獥 */}
      {showQuickWithdrawalModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-lg w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold flex items-center">
                <span className="text-xl mr-2">猬嗭笍</span>
                蹇嵎鎻愭枡
              </h3>
              <button onClick={() => setShowQuickWithdrawalModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">脳</button>
            </div>
            <form onSubmit={handleQuickWithdrawal} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">閫夋嫨瀹㈡埛</label>
                <input
                  type="text"
                  placeholder="鎼滅储瀹㈡埛濮撳悕鎴栫數璇?.."
                  value={quickFormCustomerSearch}
                  onChange={(e) => setQuickFormCustomerSearch(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2"
                />
                <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg">
                  {filteredQuickFormCustomers.length === 0 ? (
                    <div className="p-3 text-center text-gray-500 text-sm">鏆傛棤鍖归厤瀹㈡埛</div>
                  ) : (
                    filteredQuickFormCustomers.slice(0, 10).map(customer => (
                      <div
                        key={customer.id}
                        onClick={() => {
                          setQuickWithdrawalForm({ ...quickWithdrawalForm, customer_id: customer.id.toString() })
                          setQuickFormCustomerSearch(customer.name) // 璁剧疆鎼滅储妗嗕负瀹㈡埛鍚嶏紝鏀惰捣涓嬫媺
                          fetchCustomerDeposit(customer.id.toString())
                        }}
                        className={`p-3 cursor-pointer hover:bg-blue-50 border-b last:border-b-0 flex justify-between items-center ${
                          quickWithdrawalForm.customer_id === customer.id.toString() ? 'bg-blue-100' : ''
                        }`}
                      >
                        <span className="font-medium">{customer.name}</span>
                        <span className="text-sm text-gray-500">{customer.phone || '-'}</span>
                      </div>
                    ))
                  )}
                </div>
                {quickWithdrawalForm.customer_id && (
                  <div className="mt-2 text-sm text-green-600">
                    宸查€夋嫨锛歿quickFormCustomers.find(c => c.id.toString() === quickWithdrawalForm.customer_id)?.name}
                  </div>
                )}
              </div>
              {/* 瀛樻枡浣欓鏄剧ず */}
              {quickWithdrawalForm.customer_id && (
                <div className={`p-4 rounded-lg ${
                  depositLoading ? 'bg-gray-100' : 
                  (selectedCustomerDeposit?.current_balance || 0) > 0 ? 'bg-blue-50 border border-blue-200' : 'bg-red-50 border border-red-200'
                }`}>
                  {depositLoading ? (
                    <div className="text-center text-gray-500">鏌ヨ涓?..</div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-700">褰撳墠瀛樻枡浣欓</span>
                      <span className={`text-xl font-bold ${(selectedCustomerDeposit?.current_balance || 0) > 0 ? 'text-blue-600' : 'text-red-600'}`}>
                        {selectedCustomerDeposit?.current_balance?.toFixed(2) || '0.00'} 鍏?
                      </span>
                    </div>
                  )}
                  {!depositLoading && (selectedCustomerDeposit?.current_balance || 0) === 0 && (
                    <div className="mt-2 text-xs text-red-600">鈿狅笍 璇ュ鎴锋殏鏃犲瓨鏂欙紝鏃犳硶鎻愭枡</div>
                  )}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">鎻愭枡鍏嬮噸 (鍏?</label>
                <input
                  type="number"
                  step="0.01"
                  value={quickWithdrawalForm.gold_weight}
                  onChange={(e) => setQuickWithdrawalForm({ ...quickWithdrawalForm, gold_weight: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="杈撳叆鎻愭枡鍏嬮噸"
                  max={selectedCustomerDeposit?.current_balance || 0}
                  required
                />
                {quickWithdrawalForm.gold_weight && parseFloat(quickWithdrawalForm.gold_weight) > (selectedCustomerDeposit?.current_balance || 0) && (
                  <div className="mt-1 text-xs text-red-600">鈿狅笍 鎻愭枡鍏嬮噸涓嶈兘瓒呰繃瀛樻枡浣欓</div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">澶囨敞锛堝彲閫夛級</label>
                <textarea
                  value={quickWithdrawalForm.remark}
                  onChange={(e) => setQuickWithdrawalForm({ ...quickWithdrawalForm, remark: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={2}
                  placeholder="瀹㈡埛鎻愭枡 / 鍏朵粬璇存槑"
                />
              </div>
              <div className="flex space-x-3 pt-4">
                <button type="button" onClick={() => setShowQuickWithdrawalModal(false)} className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">鍙栨秷</button>
                <button 
                  type="submit" 
                  disabled={!quickWithdrawalForm.customer_id || 
                    !quickWithdrawalForm.gold_weight || 
                    parseFloat(quickWithdrawalForm.gold_weight) <= 0 ||
                    parseFloat(quickWithdrawalForm.gold_weight) > (selectedCustomerDeposit?.current_balance || 0)}
                  className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  纭骞舵墦鍗?
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      
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
      
      {/* Toast 鎻愮ず缁勪欢 */}
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

