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
import { QuickReceiptModal } from './components/modals/QuickReceiptModal'
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
import LoginPage from './pages/LoginPage'
import { isAuthenticated, saveAuth, logout as authLogout, getAuthUser } from './utils/auth'
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

function App({ onLogout }) {
  // 路由
  const navigate = useNavigate()
  const location = useLocation()


  const { t, i18n } = useTranslation()
  const [currentLanguage, setCurrentLanguage] = useState(() => {
    return localStorage.getItem('i18nextLng') || 'zh'
  })

  // 用户角色
  const [userRole, setUserRole] = useState(() => {
    const saved = localStorage.getItem('userRole')
    return saved || 'counter'
  })

  const [sidebarOpen, setSidebarOpen] = useState(false)

  // 对话状态
  const [messages, setMessages] = useState([])
  const [currentConversationId, setCurrentConversationId] = useState(null)
  const [currentSessionId, setCurrentSessionId] = useState(null)
  const [conversationTitle, setConversationTitle] = useState('新对话')

  // Modal 状态
  const [showQuickOrderModal, setShowQuickOrderModal] = useState(false)
  const [showQuickReturnModal, setShowQuickReturnModal] = useState(false)
  const [showQuickInboundModal, setShowQuickInboundModal] = useState(false)
  const [showSalesSearchModal, setShowSalesSearchModal] = useState(false)
  const [showHistoryPanel, setShowHistoryPanel] = useState(false)
  const [showReceiptModal, setShowReceiptModal] = useState(false)
  const [showReceiptEditModal, setShowReceiptEditModal] = useState(false)
  const [showWithdrawalModal, setShowWithdrawalModal] = useState(false)

  const [receiptEditData, setReceiptEditData] = useState(null)
  const [withdrawalData, setWithdrawalData] = useState(null)

  // 页面状态
  const [currentPage, setCurrentPage] = useState(() => {
    const path = location.pathname
    return pathToPage(path)
  })

  // Toast
  const [toastMessage, setToastMessage] = useState('')

  // 侧边栏历史记录
  const [sidebarConversations, setSidebarConversations] = useState([])

  // 导航角色下拉
  const [roleDropdownOpen, setRoleDropdownOpen] = useState(false)
  const [roleLoading, setRoleLoading] = useState(false)
  const roleDropdownRef = useRef(null)

  // 待办任务计数
  const [pendingTransferCount, setPendingTransferCount] = useState(0)
  const [pendingSalesCount, setPendingSalesCount] = useState(0)

  // 路由监听
  useEffect(() => {
    const page = pathToPage(location.pathname)
    if (page !== currentPage) {
      setCurrentPage(page)
    }
  }, [location.pathname])

  useEffect(() => {
    const newPath = pageToPath(currentPage)
    if (location.pathname !== newPath) {
      navigate(newPath)
    }
  }, [currentPage])

  // 语言监听
  useEffect(() => {
    const handleLangChange = (lng) => {
      setCurrentLanguage(lng)
      localStorage.setItem('i18nextLng', lng)
    }
    i18n.on('languageChanged', handleLangChange)
    return () => i18n.off('languageChanged', handleLangChange)
  }, [i18n])

  // ---- 对话管理 ----
  const loadRoleHistory = useCallback(async (roleId) => {
    const historyKey = getHistoryKey(roleId)
    try {
      const raw = localStorage.getItem(historyKey)
      const parsed = raw ? JSON.parse(raw) : []
      const hist = Array.isArray(parsed) ? parsed : []
      setSidebarConversations(hist)
    } catch {
      setSidebarConversations([])
    }
  }, [])

  const newConversation = useCallback(() => {
    setMessages([])
    setCurrentConversationId(null)
    setCurrentSessionId(null)
    setConversationTitle('新对话')
  }, [])

  const conversationState = {
    conversationTitle,
    currentConversationId,
    currentSessionId,
    loadRoleHistory,
    setCurrentConversationId,
    setCurrentSessionId,
    setConversationTitle,
    newConversation
  }

  // ---- 角色切换 ----
  const getCurrentRole = () => USER_ROLES.find(r => r.id === userRole) || USER_ROLES[0]

  const changeUserRole = async (roleId) => {
    if (roleId === userRole) {
      setRoleDropdownOpen(false)
      return
    }
    setRoleLoading(true)
    setRoleDropdownOpen(false)

    if (messages.length > 0) {
      const currentHistoryKey = getHistoryKey(userRole)
      const parsedHistory = JSON.parse(localStorage.getItem(currentHistoryKey) || '[]')
      const currentHistory = Array.isArray(parsedHistory) ? parsedHistory : []

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
        title,
        messages,
        createdAt: currentConversationId
          ? (currentHistory.find(c => c.id === currentConversationId)?.createdAt || new Date().toISOString())
          : new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }

      const existingIndex = currentHistory.findIndex(h => h.id === conversation.id)
      if (existingIndex >= 0) {
        currentHistory[existingIndex] = conversation
      } else {
        currentHistory.unshift(conversation)
      }
      safeLocalStorageSet(currentHistoryKey, JSON.stringify(currentHistory.slice(0, 50)))

      const currentLastSessionKey = getLastSessionKey(userRole)
      localStorage.setItem(currentLastSessionKey, conversationId)
    }

    await loadRoleHistory(roleId)

    const newLastSessionKey = getLastSessionKey(roleId)
    const lastSessionId = localStorage.getItem(newLastSessionKey)

    if (lastSessionId) {
      const newHistoryKey = getHistoryKey(roleId)
      try {
        const parsedData = JSON.parse(localStorage.getItem(newHistoryKey) || '[]')
        const history = Array.isArray(parsedData) ? parsedData : []
        const lastConversation = history.find(c => c.id === lastSessionId)
        if (lastConversation?.messages?.length > 0) {
          setMessages(parseMessageHiddenMarkers(lastConversation.messages))
          setCurrentConversationId(lastSessionId)
          setCurrentSessionId(lastSessionId)
          setConversationTitle(lastConversation.title || '新对话')
        } else {
          newConversation()
        }
      } catch {
        newConversation()
      }
    } else {
      newConversation()
    }

    setUserRole(roleId)
    localStorage.setItem('userRole', roleId)
    setRoleLoading(false)
  }

  // ---- 待办计数 ----
  const loadPendingCounts = useCallback(async () => {
    try {
      const [tRes, sRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/warehouse/pending-count?role=${userRole}`),
        fetch(`${API_BASE_URL}/api/sales/pending-settlement-count?role=${userRole}`)
      ])
      if (tRes.ok) { const d = await tRes.json(); setPendingTransferCount(d.count || 0) }
      if (sRes.ok) { const d = await sRes.json(); setPendingSalesCount(d.count || 0) }
    } catch {}
  }, [userRole])

  useEffect(() => {
    loadPendingCounts()
    const interval = setInterval(loadPendingCounts, 30000)
    return () => clearInterval(interval)
  }, [loadPendingCounts])

  // ---- 侧边栏历史 ----
  useEffect(() => {
    loadRoleHistory(userRole)
  }, [userRole, loadRoleHistory])

  const handleSelectConversation = useCallback((conv) => {
    if (!conv?.messages?.length) return
    setMessages(parseMessageHiddenMarkers(conv.messages))
    setCurrentConversationId(conv.id)
    setCurrentSessionId(conv.id)
    setConversationTitle(conv.title || '新对话')
    setSidebarOpen(false)
  }, [])

  // ---- 页面渲染 ----
  const renderPage = () => {
    if (!canAccessPage(userRole, currentPage)) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center p-8">
            <div className="text-6xl mb-4">🔒</div>
            <h2 className="text-xl font-semibold text-gray-700 mb-2">权限不足</h2>
            <p className="text-gray-500">{getPermissionDeniedMessage(userRole, currentPage)}</p>
          </div>
        </div>
      )
    }

    switch (currentPage) {
      case 'chat':
        return (
          <ChatView
            userRole={userRole}
            messages={messages}
            setMessages={setMessages}
            currentConversationId={currentConversationId}
            setCurrentConversationId={setCurrentConversationId}
            currentSessionId={currentSessionId}
            setCurrentSessionId={setCurrentSessionId}
            conversationTitle={conversationTitle}
            setConversationTitle={setConversationTitle}
            newConversation={newConversation}
            loadRoleHistory={loadRoleHistory}
            sidebarConversations={sidebarConversations}
            setSidebarConversations={setSidebarConversations}
          />
        )
      case 'finance': return <FinancePage userRole={userRole} />
      case 'analytics': return <AnalyticsPage userRole={userRole} />
      case 'dashboard': return userRole === 'manager' ? <ManagerDashboardPage userRole={userRole} /> : <DashboardPage userRole={userRole} />
      case 'export': return <ExportPage userRole={userRole} />
      case 'warehouse': return <WarehousePage userRole={userRole} />
      case 'settlement': return <SettlementPage userRole={userRole} />
      case 'salesperson': return <SalespersonPage userRole={userRole} />
      case 'customer': return <CustomerPage userRole={userRole} />
      case 'customer-account': return <CustomerAccountPage userRole={userRole} />
      case 'supplier': return <SupplierPage userRole={userRole} />
      case 'returns': return <ReturnPage userRole={userRole} />
      case 'sales-returns': return <SalesReturnPage userRole={userRole} />
      case 'gold-material': return <GoldMaterialPage userRole={userRole} />
      case 'loan': return <LoanPage userRole={userRole} />
      case 'document-center': return <DocumentCenterPage userRole={userRole} />
      case 'product-codes': return <ProductCodePage userRole={userRole} />
      case 'label-design': return <LabelDesignPage userRole={userRole} />
      case 'inbound-orders': return <InboundOrdersPage userRole={userRole} />
      case 'voucher': return <VoucherManagement userRole={userRole} />
      case 'finance-settings': return <FinanceSettings userRole={userRole} />
      case 'finance-closing': return <FinanceClosing userRole={userRole} />
      case 'finance-reports': return <FinanceReports userRole={userRole} />
      case 'finance-admin': return <FinanceAdminManagement userRole={userRole} />
      default: return (
        <ChatView
          userRole={userRole}
          messages={messages}
          setMessages={setMessages}
          currentConversationId={currentConversationId}
          setCurrentConversationId={setCurrentConversationId}
          currentSessionId={currentSessionId}
          setCurrentSessionId={setCurrentSessionId}
          conversationTitle={conversationTitle}
          setConversationTitle={setConversationTitle}
          newConversation={newConversation}
          loadRoleHistory={loadRoleHistory}
          sidebarConversations={sidebarConversations}
          setSidebarConversations={setSidebarConversations}
        />
      )
    }
  }

  return (
    <AppContext.Provider value={{ userRole, setUserRole, currentPage, setCurrentPage }}>
      <div className="flex h-screen bg-gray-50 overflow-hidden">
        {/* 侧边栏 */}
        <ConversationSidebar
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          userRole={userRole}
          conversations={sidebarConversations}
          currentConversationId={currentConversationId}
          onSelectConversation={handleSelectConversation}
          onNewConversation={newConversation}
        />

        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
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
            onLogout={onLogout}
          />

          <main className="flex-1 overflow-hidden">
            {renderPage()}
          </main>
        </div>

        {/* Modals */}
        {showQuickOrderModal && (
          <QuickOrderModal
            isOpen={showQuickOrderModal}
            onClose={() => setShowQuickOrderModal(false)}
            userRole={userRole}
          />
        )}
        {showQuickReturnModal && (
          <QuickReturnModal
            isOpen={showQuickReturnModal}
            onClose={() => setShowQuickReturnModal(false)}
            userRole={userRole}
          />
        )}
        {showQuickInboundModal && (
          <QuickInboundModal
            isOpen={showQuickInboundModal}
            onClose={() => setShowQuickInboundModal(false)}
            userRole={userRole}
          />
        )}
        {showReceiptModal && (
          <QuickReceiptModal
            isOpen={showReceiptModal}
            onClose={() => setShowReceiptModal(false)}
            userRole={userRole}
          />
        )}
        {showReceiptEditModal && receiptEditData && (
          <ReceiptEditModal
            isOpen={showReceiptEditModal}
            onClose={() => { setShowReceiptEditModal(false); setReceiptEditData(null) }}
            receiptData={receiptEditData}
            userRole={userRole}
          />
        )}
        {showWithdrawalModal && withdrawalData && (
          <InlineQuickWithdrawalModal
            isOpen={showWithdrawalModal}
            onClose={() => { setShowWithdrawalModal(false); setWithdrawalData(null) }}
            withdrawalData={withdrawalData}
            userRole={userRole}
          />
        )}

        <Toaster position="top-right" toastOptions={{ duration: 3000 }} />

        {toastMessage && (
          <div className="fixed bottom-20 left-1/2 transform -translate-x-1/2 z-50 animate-fade-in">
            <div className="bg-gray-800 text-white px-4 py-2 rounded-lg shadow-lg text-sm">
              {toastMessage}
            </div>
          </div>
        )}
      </div>
    </AppContext.Provider>
  )
}

function AuthenticatedApp() {
  const [loggedIn, setLoggedIn] = React.useState(() => isAuthenticated())

  const handleLoginSuccess = ({ token, username, role, role_name }) => {
    saveAuth(token, { username, role, role_name })
    localStorage.setItem('userRole', role)
    setLoggedIn(true)
  }

  const handleLogout = () => {
    authLogout()
    localStorage.removeItem('userRole')
    setLoggedIn(false)
  }

  if (!loggedIn) {
    return <LoginPage onLoginSuccess={handleLoginSuccess} />
  }

  return <App onLogout={handleLogout} />
}

export default AuthenticatedApp
