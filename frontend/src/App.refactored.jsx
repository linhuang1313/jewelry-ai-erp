/**
 * App.jsx - 重构示例版本
 * 
 * 这是一个使用新拆分组件的App.jsx示例。
 * 展示了如何逐步集成新组件，同时保持原有功能。
 * 
 * 使用方法：
 * 1. 将此文件重命名为 App.jsx
 * 2. 或参考此文件逐步替换原 App.jsx 中的代码
 */

import { useState, useRef, useEffect } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Toaster } from 'react-hot-toast'
import { Bar, Pie, Line, Doughnut } from 'react-chartjs-2'
import { API_ENDPOINTS, API_BASE_URL } from './config'
import LanguageSelector from './components/LanguageSelector'
import { hasPermission } from './config/permissions'
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
import SalesSearchModal from './components/SalesSearchModal'
import { SupplierPage } from './components/SupplierPage'
import ReturnPage from './components/ReturnPage'
import GoldMaterialPage from './components/GoldMaterialPage'
import LoanPage from './components/LoanPage'
import ProductCodePage from './components/ProductCodePage'
import InboundOrdersPage from './components/InboundOrdersPage'
import { USER_ROLES } from './constants/roles'
import { ChatHistoryPanel } from './components/ChatHistoryPanel'

// ========== 新拆分的组件 ==========
import { Sidebar, Header } from './components/layout'
import { InputArea, ThinkingIndicator, ThinkingMessage, WelcomeScreen } from './components/chat'
import { OCRModal, QuickReceiptModal, QuickWithdrawalModal } from './components/modals'
import { useConversationHistory } from './hooks'
import { parseMessageHiddenMarkers } from './utils/messageParser'
import { getUserIdentifier, getHistoryKey, getLastSessionKey, generateSessionId } from './utils/userIdentifier'

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
    if (typeof window !== 'undefined') {
      return localStorage.getItem('languageSelected') !== 'true'
    }
    return true
  })
  const currentLanguage = i18n.language || 'zh'
  
  // 聊天状态
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const messagesEndRef = useRef(null)
  const fileInputRef = useRef(null)
  const abortControllerRef = useRef(null)
  
  // OCR状态
  const [showOCRModal, setShowOCRModal] = useState(false)
  const [ocrResult, setOcrResult] = useState('')
  const [uploadedImage, setUploadedImage] = useState(null)
  
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
  
  // 使用自定义Hook管理对话历史
  const {
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
    loadConversation: loadConversationFromHook,
    newConversation: newConversationFromHook,
    deleteConversation: deleteConversationFromHook
  } = useConversationHistory(userRole)
  
  // 侧边栏状态
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth >= 1024
    }
    return true
  })
  
  // 页面状态
  const [currentPage, setCurrentPage] = useState('chat')
  const [showQuickOrderModal, setShowQuickOrderModal] = useState(false)
  const [showQuickReturnModal, setShowQuickReturnModal] = useState(false)
  const [showQuickInboundModal, setShowQuickInboundModal] = useState(false)
  const [showSalesSearchModal, setShowSalesSearchModal] = useState(false)
  const [showHistoryPanel, setShowHistoryPanel] = useState(false)
  const [showQuickReceiptModal, setShowQuickReceiptModal] = useState(false)
  const [showQuickWithdrawalModal, setShowQuickWithdrawalModal] = useState(false)
  
  // 待处理数量
  const [pendingTransferCount, setPendingTransferCount] = useState(0)
  const [pendingSalesCount, setPendingSalesCount] = useState(0)
  
  // Toast消息
  const [toastMessage, setToastMessage] = useState('')
  const showToast = (message, duration = 3000) => {
    setToastMessage(message)
    setTimeout(() => setToastMessage(''), duration)
  }

  // 获取当前角色信息
  const getCurrentRole = () => {
    return USER_ROLES.find(r => r.id === userRole) || USER_ROLES[0]
  }

  // 角色切换
  const changeUserRole = async (roleId) => {
    if (roleId === userRole) {
      setRoleDropdownOpen(false)
      return
    }
    
    setRoleLoading(true)
    setRoleDropdownOpen(false)
    
    // 保存当前对话
    if (messages.length > 0) {
      saveConversation(messages)
    }
    
    setUserRole(roleId)
    localStorage.setItem('userRole', roleId)
    
    // 加载新角色的历史记录
    await loadRoleHistory(roleId)
    
    // 尝试恢复新角色上次的对话
    const newLastSessionKey = getLastSessionKey(roleId)
    const lastSessionId = localStorage.getItem(newLastSessionKey)
    
    if (lastSessionId) {
      const result = await loadConversationFromHook(lastSessionId)
      if (result) {
        setMessages(result.messages)
      } else {
        handleNewConversation()
      }
    } else {
      handleNewConversation()
    }
    
    setRoleLoading(false)
  }

  // 新建对话
  const handleNewConversation = () => {
    setMessages([])
    newConversationFromHook()
    if (window.innerWidth < 1024) {
      setSidebarOpen(false)
    }
  }

  // 加载对话
  const handleLoadConversation = async (conversationId) => {
    const result = await loadConversationFromHook(conversationId)
    if (result) {
      setMessages(result.messages)
      if (window.innerWidth < 1024) {
        setSidebarOpen(false)
      }
    }
  }

  // 删除对话
  const handleDeleteConversation = (conversationId) => {
    const newSessionId = deleteConversationFromHook(conversationId)
    if (newSessionId) {
      setMessages([])
    }
  }

  // 滚动到底部
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // 自动保存对话
  useEffect(() => {
    if (messages.length === 0) return
    const timer = setTimeout(() => {
      saveConversation(messages)
    }, 1000)
    return () => clearTimeout(timer)
  }, [messages])

  // 初始化加载历史记录
  useEffect(() => {
    loadRoleHistory(userRole)
  }, [])

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

  // 加载待处理数量
  useEffect(() => {
    const loadPendingCounts = async () => {
      // 加载待处理转移单数量
      if (['counter', 'settlement', 'manager'].includes(userRole)) {
        try {
          const response = await fetch(`${API_BASE_URL}/api/warehouse/transfers?status=pending`)
          if (response.ok) {
            const transfers = await response.json()
            const roleLocationMap = { 'counter': '展厅', 'product': '商品部仓库' }
            const myLocation = roleLocationMap[userRole]
            if (myLocation) {
              setPendingTransferCount(transfers.filter(t => t.to_location_name === myLocation).length)
            } else {
              setPendingTransferCount(transfers.length)
            }
          }
        } catch (error) {
          console.error('加载待处理转移单数量失败:', error)
        }
      }
      
      // 加载待结算销售单数量
      if (['settlement', 'manager'].includes(userRole)) {
        try {
          const response = await fetch(`${API_BASE_URL}/api/settlement/pending-sales`)
          if (response.ok) {
            const sales = await response.json()
            setPendingSalesCount(sales.length)
          }
        } catch (error) {
          console.error('加载待结算销售单数量失败:', error)
        }
      }
    }
    
    loadPendingCounts()
    const interval = setInterval(loadPendingCounts, 3000)
    return () => clearInterval(interval)
  }, [userRole])

  // 发送消息（简化版，实际使用请保留原完整版本）
  const sendMessage = async () => {
    if (!input.trim() || loading) return
    
    const userMessage = input.trim()
    setInput('')
    setMessages(prev => [...prev, { type: 'user', content: userMessage }])
    setLoading(true)
    
    // TODO: 实现完整的sendMessage逻辑
    // 这里需要保留原App.jsx中的完整sendMessage实现
    
    setLoading(false)
  }

  // 处理图片上传
  const handleImageUpload = async (file) => {
    // TODO: 实现完整的图片上传逻辑
    console.log('上传图片:', file.name)
  }

  // 确认入库
  const handleConfirmInbound = async () => {
    // TODO: 实现完整的确认入库逻辑
  }

  // 语言选择页
  if (showLanguageSelector) {
    return <LanguageSelector onSelect={() => setShowLanguageSelector(false)} />
  }

  return (
    <div className="flex h-screen bg-jewelry-gold-50 overflow-hidden">
      {/* ========== 使用新的Sidebar组件 ========== */}
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        conversationHistory={conversationHistory}
        currentConversationId={currentConversationId}
        userRole={userRole}
        onNewConversation={handleNewConversation}
        onLoadConversation={handleLoadConversation}
        onDeleteConversation={handleDeleteConversation}
      />

      {/* 主内容区域 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* ========== 使用新的Header组件 ========== */}
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
            {/* 对话区域 */}
            <div className="flex-1 overflow-y-auto px-6 py-8">
              <div className="max-w-4xl mx-auto space-y-6">
                {/* ========== 使用新的WelcomeScreen组件 ========== */}
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

                {/* 消息列表 - 保留原有的消息渲染逻辑 */}
                {messages.map((msg, idx) => {
                  // 思考过程消息
                  if (msg.type === 'thinking' && Array.isArray(msg.steps)) {
                    return (
                      <ThinkingMessage 
                        key={msg.id || idx} 
                        steps={msg.steps} 
                        progress={msg.progress} 
                      />
                    )
                  }
                  
                  // 用户消息
                  if (msg.type === 'user') {
                    return (
                      <div key={msg.id || idx} className="flex justify-end">
                        <div className="bg-jewelry-gold text-white rounded-3xl px-5 py-3 max-w-[80%] shadow-sm">
                          <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                          {msg.image && (
                            <img src={msg.image} alt="上传的图片" className="mt-2 rounded-lg max-w-full h-auto" />
                          )}
                        </div>
                      </div>
                    )
                  }
                  
                  // 系统消息
                  if (msg.type === 'system') {
                    return (
                      <div key={msg.id || idx} className="flex justify-start items-start gap-3">
                        <img src="/ai-avatar.png" alt="AI" className="w-9 h-9 rounded-full object-cover shadow-sm flex-shrink-0" />
                        <div className="bg-white rounded-3xl px-5 py-4 shadow-sm border border-gray-200/60 max-w-[85%]">
                          <p className={`text-[15px] text-gray-800 leading-relaxed whitespace-pre-wrap ${msg.isStreaming ? 'animate-pulse' : ''}`}>
                            {msg.content}
                          </p>
                          {/* TODO: 这里需要保留原有的图表、卡片等渲染逻辑 */}
                        </div>
                      </div>
                    )
                  }
                  
                  return null
                })}

                {/* ========== 使用新的ThinkingIndicator组件 ========== */}
                {(loading || uploading) && (
                  <ThinkingIndicator uploading={uploading} />
                )}

                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* ========== 使用新的InputArea组件 ========== */}
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

        {/* 其他页面保持不变 */}
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
            <SettlementPage onSettlementConfirmed={() => setCurrentPage('chat')} />
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
            {userRole === 'manager' ? <ManagerDashboardPage /> : <DashboardPage />}
          </div>
        )}
      </div>

      {/* ========== 使用新的弹窗组件 ========== */}
      
      {/* OCR编辑弹窗 */}
      <OCRModal
        isOpen={showOCRModal}
        onClose={() => {
          setShowOCRModal(false)
          setOcrResult('')
          setUploadedImage(null)
        }}
        ocrResult={ocrResult}
        setOcrResult={setOcrResult}
        uploadedImage={uploadedImage}
        onConfirm={handleConfirmInbound}
        loading={loading}
      />

      {/* 快捷收料弹窗 */}
      <QuickReceiptModal
        isOpen={showQuickReceiptModal}
        onClose={() => setShowQuickReceiptModal(false)}
        onSuccess={(result) => {
          const downloadUrl = `${API_BASE_URL}/api/gold-material/gold-receipts/${result.id}/print`
          setMessages(prev => [...prev, {
            id: Date.now(),
            type: 'system',
            content: `✅ 收料单已生成\n\n📋 单号：${result.receipt_no}\n👤 客户：${result.customer_name}\n⚖️ 克重：${result.gold_weight.toFixed(2)} 克\n🏷️ 成色：${result.gold_fineness}\n\n<!-- GOLD_RECEIPT:${result.id}:${result.receipt_no} -->`,
            goldReceiptDownloadUrl: downloadUrl,
            goldReceiptId: result.id
          }])
        }}
        showToast={showToast}
      />

      {/* 快捷提料弹窗 */}
      <QuickWithdrawalModal
        isOpen={showQuickWithdrawalModal}
        onClose={() => setShowQuickWithdrawalModal(false)}
        onSuccess={(result) => {
          const downloadUrl = `${API_BASE_URL}/api/gold-material/withdrawals/${result.id}/download?format=html`
          setMessages(prev => [...prev, {
            id: Date.now(),
            type: 'system',
            content: `✅ 提料单已生成\n\n📋 单号：${result.withdrawal_no}\n👤 客户：${result.customer_name}\n⚖️ 克重：${result.gold_weight.toFixed(2)} 克\n\n<!-- WITHDRAWAL_ORDER:${result.id}:${result.withdrawal_no} -->`,
            withdrawalDownloadUrl: downloadUrl,
            withdrawalId: result.id
          }])
        }}
        userRole={userRole}
        showToast={showToast}
      />

      {/* 快捷开单弹窗 */}
      {userRole === 'counter' && (
        <QuickOrderModal
          isOpen={showQuickOrderModal}
          onClose={() => setShowQuickOrderModal(false)}
          onSuccess={(result) => {
            setMessages(prev => [...prev, {
              type: 'system',
              content: `✅ 销售单创建成功\n\n📋 销售单号：${result.order_no}`,
              salesOrderId: result.order_id
            }])
          }}
        />
      )}

      {/* 快捷退货弹窗 */}
      {(hasPermission(userRole, 'canReturnToSupplier') || hasPermission(userRole, 'canReturnToWarehouse')) && (
        <QuickReturnModal
          isOpen={showQuickReturnModal}
          onClose={() => setShowQuickReturnModal(false)}
          onSuccess={(result) => {
            setMessages(prev => [...prev, {
              type: 'system',
              content: `✅ 退货单创建成功\n\n📋 单号：${result.return_no}`,
              returnOrder: { id: result.return_id, return_no: result.return_no }
            }])
          }}
          userRole={userRole}
        />
      )}

      {/* 快捷入库弹窗 */}
      {hasPermission(userRole, 'canInbound') && (
        <QuickInboundModal
          isOpen={showQuickInboundModal}
          onClose={() => setShowQuickInboundModal(false)}
          onSuccess={(result) => {
            setMessages(prev => [...prev, {
              type: 'system',
              content: `✅ 入库成功\n\n📋 单号：${result.order_no}`,
              inboundOrder: result.order_id ? { id: result.order_id, order_no: result.order_no } : null
            }])
          }}
          userRole={userRole}
        />
      )}

      {/* 销售管理弹窗 */}
      {['counter', 'settlement', 'sales'].includes(userRole) && (
        <SalesSearchModal
          isOpen={showSalesSearchModal}
          onClose={() => setShowSalesSearchModal(false)}
        />
      )}

      {/* 历史回溯面板 */}
      <ChatHistoryPanel
        isOpen={showHistoryPanel}
        onClose={() => setShowHistoryPanel(false)}
        userRole={userRole}
        onLoadSession={(sessionId, sessionMessages) => {
          if (sessionMessages && sessionMessages.length > 0) {
            const formattedMessages = sessionMessages.map(msg => ({
              type: msg.message_type === 'user' ? 'user' : 'system',
              content: msg.content,
              timestamp: msg.created_at
            }))
            const parsedMessages = parseMessageHiddenMarkers(formattedMessages)
            setMessages(parsedMessages)
            setCurrentSessionId(sessionId)
            setCurrentConversationId(sessionId)
            setShowHistoryPanel(false)
          }
        }}
      />
      
      {/* Toast 通知 */}
      <Toaster 
        position="top-center"
        toastOptions={{
          duration: 3000,
          style: { zIndex: 99999 },
          success: { style: { background: '#10b981', color: 'white' } },
          error: { style: { background: '#ef4444', color: 'white' } },
        }}
      />
      
      {/* 自定义Toast */}
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
