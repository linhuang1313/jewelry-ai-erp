import { useState, useRef, useEffect } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Toaster } from 'react-hot-toast'
import { API_ENDPOINTS, API_BASE_URL } from './config'
import LanguageSelector from './components/LanguageSelector'
import { hasPermission } from './config/permissions'
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
import InboundOrdersPage from './components/InboundOrdersPage'
import { Header, Sidebar } from './components/layout'
import { ThinkingIndicator, WelcomeScreen, InputArea, MessageRenderer } from './components/chat'
import { OCRModal, QuickReceiptModal, QuickWithdrawalModal } from './components/modals'
import { ChatHistoryPanel } from './components/ChatHistoryPanel'
import { parseMessageHiddenMarkers } from './utils/messageParser'
import { saveChatMessage } from './services/chatService'
import { useConversationHistory, useUserRole, useChatStream } from './hooks'

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
  const [uploading, setUploading] = useState(false)  // 图片上传状态
  const messagesEndRef = useRef(null)
  
  // OCR编辑对话框相关状态
  const [showOCRModal, setShowOCRModal] = useState(false)
  const [ocrResult, setOcrResult] = useState('')
  const [uploadedImage, setUploadedImage] = useState(null)
  
  // 侧边栏开关（桌面端默认打开，移动端默认关闭）
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth >= 1024
    }
    return true
  })
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
    // 从 localStorage 读取保存的角色，默认为业务员
    if (typeof window !== 'undefined') {
      return localStorage.getItem('userRole') || 'sales'
    }
    return 'sales'
  })
  // Toast 提示函数：几秒后自动消失
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


  // ========== Conversation History Hook ==========
  const conversation = useConversationHistory(userRole, messages, setMessages, setSidebarOpen, showToast)
  const {
    conversationHistory, currentConversationId, setCurrentConversationId, conversationTitle,
    currentSessionId, setCurrentSessionId, loadRoleHistory, saveConversation, loadConversation,
    newConversation, deleteConversation
  } = conversation

  // ========== User Role Hook ==========
  const role = useUserRole(userRole, setUserRole, conversation, messages, setMessages, setSidebarOpen)
  const {
    roleDropdownOpen, setRoleDropdownOpen, roleLoading,
    roleDropdownRef, pendingTransferCount, pendingSalesCount,
    getCurrentRole, changeUserRole
  } = role

  // ========== Chat Stream Hook ==========
  const { input, setInput, loading, sendMessage } = useChatStream({
    messages,
    setMessages,
    userRole,
    currentSessionId: conversation.currentSessionId,
    currentLanguage,
    onNeedForm: (action) => {
      if (action === '退货') setShowQuickReturnModal(true)
      else if (action === '入库') setShowQuickInboundModal(true)
      else if (action === '创建销售单') setShowQuickOrderModal(true)
    }
  })

  // 处理图片上传（接收 File 对象，由 InputArea 组件传入）
  const handleImageUpload = async (file) => {
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
    
    // 保存图片预览（使用Promise确保图片加载完成功
    const imageDataUrlPromise = new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        const imageDataUrl = e.target.result
        setUploadedImage(imageDataUrl)
        
        // 显示用户上传的图片?
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
        // 如果是批量入库成功?
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
        // 处理销售单（OCR确认后也可能创建销售单
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
        // 如果是查询所有库存（返回inventories数组：
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

        // 处理库存检查错误（在错误响应中
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

      // 语言选择页面
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
            {messages.map((msg, idx) => (
              <MessageRenderer
                key={msg.id || idx}
                msg={msg}
                idx={idx}
                setMessages={setMessages}
                setCurrentPage={setCurrentPage}
                userRole={userRole}
                API_BASE_URL={API_BASE_URL}
              />
            ))}

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
              saveChatMessage(currentSessionId, 'assistant', settlementMessage, userRole)
                .catch(err => console.error('Save settlement message failed:', err))
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
              saveChatMessage(currentSessionId, 'assistant', salesMessage, userRole)
                .catch(err => console.error('Save sales message failed:', err))
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
              await saveChatMessage(currentSessionId, 'assistant', returnMessage, userRole, 'return')
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
              await saveChatMessage(currentSessionId, 'assistant', inboundMessage, userRole, '入库')
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

