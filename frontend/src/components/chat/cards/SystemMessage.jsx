import React from 'react'
import toast from 'react-hot-toast'
import { Bar, Line, Doughnut } from 'react-chartjs-2'
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
import { JewelryInboundCardComponent } from '../../JewelryInboundCard'
import { updateCard } from '../../../utils/inboundHelpers'
import { reportError } from '../../../services/inboundService'
import TransferPromptCard from './TransferPromptCard'

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

// 销售单操作日志子组件
export const SalesOrderLogs = ({ salesOrderId, salesOrderStatus, API_BASE_URL }) => {
  const [expanded, setExpanded] = React.useState(false)
  const [logs, setLogs] = React.useState([])
  const [loading, setLoading] = React.useState(false)
  const [loaded, setLoaded] = React.useState(false)

  const fetchLogs = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE_URL}/api/order-logs/sales/${salesOrderId}`)
      if (res.ok) {
        const data = await res.json()
        setLogs(data.logs || [])
      }
    } catch (e) {
      console.error('加载操作记录失败:', e)
    } finally {
      setLoading(false)
      setLoaded(true)
    }
  }

  const handleToggle = async () => {
    if (!expanded && !loaded) {
      await fetchLogs()
    }
    setExpanded(!expanded)
  }

  // 当销售单状态变化时（确认/反确认），自动刷新已加载的日志
  React.useEffect(() => {
    if (loaded) {
      fetchLogs()
    }
  }, [salesOrderStatus])

  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      <button
        onClick={handleToggle}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        <svg className={`w-4 h-4 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        操作记录{loaded && !loading ? ` (${logs.length}条)` : ''}
        {loading && <span className="ml-1 text-xs text-gray-400">加载中...</span>}
      </button>
      {expanded && (
        <div className="mt-2 space-y-1.5 pl-2">
          {loading ? (
            <div className="text-xs text-gray-400 py-2">加载中...</div>
          ) : logs.length === 0 ? (
            <div className="text-xs text-gray-400 py-2">暂无操作记录</div>
          ) : (
            logs.map((log) => (
              <div key={log.id} className="flex items-start gap-2 text-xs">
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded font-medium ${
                  log.action === 'confirm' ? 'bg-green-100 text-green-700' :
                  log.action === 'unconfirm' ? 'bg-amber-100 text-amber-700' :
                  log.action === 'edit' ? 'bg-blue-100 text-blue-700' :
                  'bg-gray-100 text-gray-700'
                }`}>
                  {log.action_label}
                </span>
                <span className="text-gray-600">{log.operated_by || '系统'}</span>
                <span className="text-gray-400">
                  {log.operated_at ? new Date(log.operated_at).toLocaleString('zh-CN') : '—'}
                </span>
                {log.remark && <span className="text-gray-500 italic">({log.remark})</span>}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

export const SystemMessage = ({ msg, setMessages, setCurrentPage, userRole, API_BASE_URL }) => {
  return (
    <React.Fragment>
      <div className="flex justify-start items-start gap-3">
        {/* AI头像 - 招财猫 */}
        <img src="/ai-avatar.png" alt="AI" className="flex-shrink-0 w-8 h-8 rounded-full object-cover shadow-md ring-2 ring-jewelry-gold/30" />
        <div className={`
          ${msg.id ? 'max-w-2xl' : 'max-w-[85%] md:max-w-[75%]'}
          rounded-3xl px-5 py-4 shadow-sm border border-jewelry-gold/20 bg-gradient-to-br from-amber-50/80 to-yellow-50/80
        `}>
          {/* 意图识别可视化标签? - 珠宝风格 */}
          {msg.detectedIntent && (
            <div className="flex items-center gap-1.5 mb-2 pb-2 border-b border-gray-100">
                <span className="text-xs text-gray-400">🎯 识别到：</span>
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
            if (!salesId && msg.salesOrder?.id) salesId = msg.salesOrder.id
            if (!salesId && msg.content) {
              const match = msg.content.match(/<!-- SALES_ORDER:(\d+):/)
              if (match) salesId = parseInt(match[1])
            }
            if (!salesId) return null
            const salesStatus = msg.salesOrder?.status ?? msg.salesOrderStatus
            const isDraft = salesStatus === 'draft' || !salesStatus
            return (
              <div className="mt-4 pt-3 border-t border-gray-100 flex gap-2 flex-wrap">
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
                {isDraft && setCurrentPage && (
                  <button
                    onClick={() => setCurrentPage({ name: 'salesOrders', editOrderId: salesId })}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-yellow-50 text-yellow-600 rounded-lg hover:bg-yellow-100 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    编辑
                  </button>
                )}
                {isDraft && setMessages && (
                  <button
                    onClick={async () => {
                      if (!confirm('确认销售单？确认后将扣减库存，不可编辑。')) return
                      try {
                        const confirmedBy = userRole === 'counter' ? '柜台' : '管理员'
                        const params = new URLSearchParams({ confirmed_by: confirmedBy, user_role: userRole || 'counter' })
                        const res = await fetch(`${API_BASE_URL}/api/sales/orders/${salesId}/confirm?${params}`, { method: 'POST' })
                        const data = await res.json()
                        if (res.ok && data.success !== false) {
                          toast.success(data.message || '销售单已确认')
                          setMessages(prev => prev.map(m => {
                            if ((m.salesOrderId === salesId || m.salesOrder?.id === salesId) && (m.salesOrder?.status === 'draft' || !m.salesOrder?.status && !m.salesOrderStatus)) {
                              return { ...m, salesOrder: { ...m.salesOrder, id: salesId, status: '待结算' }, salesOrderStatus: '待结算' }
                            }
                            return m
                          }))
                        } else {
                          toast.error(data.message || data.detail || '确认失败')
                        }
                      } catch (err) {
                        toast.error('确认操作失败')
                      }
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    确认
                  </button>
                )}
                {(salesStatus === 'confirmed' || salesStatus === '待结算') && setMessages && (
                  <button
                    onClick={async () => {
                      if (!confirm('反确认销售单？将恢复为未确认状态，可重新编辑。')) return
                      const syncOrderToUI = async () => {
                        const detailRes = await fetch(`${API_BASE_URL}/api/sales/orders/${salesId}`)
                        if (detailRes.ok) {
                          const detailData = await detailRes.json()
                          const freshOrder = detailData.order
                          if (freshOrder) {
                            setMessages(prev => prev.map(m => {
                              if ((m.salesOrderId == salesId || m.salesOrder?.id == salesId)) {
                                return { ...m, salesOrder: { ...m.salesOrder, ...freshOrder, status: freshOrder.status }, salesOrderStatus: freshOrder.status }
                              }
                              return m
                            }))
                            return true
                          }
                        }
                        return false
                      }
                      try {
                        const operatedBy = userRole === 'counter' ? '柜台' : '管理员'
                        const params = new URLSearchParams({ operated_by: operatedBy, user_role: userRole || 'counter' })
                        const res = await fetch(`${API_BASE_URL}/api/sales/orders/${salesId}/unconfirm?${params}`, { method: 'POST' })
                        const data = await res.json()
                        if (res.ok && data.success !== false) {
                          toast.success(data.message || '销售单已反确认')
                          if (!(await syncOrderToUI())) {
                            setMessages(prev => prev.map(m => {
                              if ((m.salesOrderId == salesId || m.salesOrder?.id == salesId)) {
                                return { ...m, salesOrder: { ...m.salesOrder, id: salesId, status: 'draft' }, salesOrderStatus: 'draft' }
                              }
                              return m
                            }))
                          }
                        } else {
                          const msgText = (data.message || data.detail || '').toString()
                          if (msgText.includes('draft') || msgText.includes('已是')) {
                            toast.success('已同步为可编辑状态')
                            if (!(await syncOrderToUI())) {
                              setMessages(prev => prev.map(m => {
                                if ((m.salesOrderId == salesId || m.salesOrder?.id == salesId)) {
                                  return { ...m, salesOrder: { ...m.salesOrder, id: salesId, status: 'draft' }, salesOrderStatus: 'draft' }
                                }
                                return m
                              }))
                            }
                          } else {
                            toast.error(data.message || data.detail || '反确认失败')
                          }
                        }
                      } catch (err) {
                        toast.error('反确认操作失败')
                      }
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors font-medium"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    反确认
                  </button>
                )}
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
                {/* 按钮 - 仅结算专员和管理层可? */}
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
          {/* 入库单查询导出按钮? - 从内容中解析隐藏标记 */}
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
                  try {
                    // 更新卡片状态为处理中
                    setMessages(prev => prev.map(m => {
                      if (m.id === msg.id) {
                        return { ...m, inboundCard: updateCard(card, { status: 'processing' }) }
                      }
                      return m
                    }))
                    
                    // 调用入库API
                    const { confirmInbound } = await import('../../../services/inboundService')
                    const useMock = false
                    const result = await confirmInbound(card, useMock)
                    
                    // 更新卡片状态和订单信息
                    const confirmedOrderNo = result.order?.order_no || card.orderNo
                    setMessages(prev => {
                      const updated = prev.map(m => {
                        if (m.id === msg.id) {
                          const updatedCard = updateCard(card, { 
                            status: 'confirmed',
                            orderNo: confirmedOrderNo,
                            orderId: result.order?.id || card.orderId,
                            barcode: result.order?.order_no || card.barcode || '',
                          })
                          return { ...m, inboundCard: updatedCard }
                        }
                        return m
                      })
                      // 添加转移提示消息
                      updated.push({
                        id: Date.now(),
                        type: 'system',
                        content: '✅ 入库单已确认，库存已更新。',
                        transferPrompt: {
                          items: [{
                            product_name: card.productName,
                            product_code: card.productCode || card.barcode || '',
                            weight: card.goldWeight,
                            barcode: card.barcode,
                            labor_cost: card.laborCostPerGram,
                            piece_count: card.pieceCount,
                            piece_labor_cost: card.pieceLaborCost,
                            main_stone_weight: card.mainStoneWeight,
                            main_stone_count: card.mainStoneCount,
                            sub_stone_weight: card.subStoneWeight,
                            sub_stone_count: card.subStoneCount,
                            main_stone_mark: card.mainStoneMark,
                            sub_stone_mark: card.subStoneMark,
                            pearl_weight: card.pearlWeight,
                            bearing_weight: card.bearingWeight,
                            sale_labor_cost: card.saleLaborCost,
                            sale_piece_labor_cost: card.salePieceLaborCost,
                          }],
                          status: 'pending',
                          orderNos: confirmedOrderNo || ''
                        }
                      })
                      return updated
                    })
                  } catch (error) {
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
                onCancel: async (card) => {
                  try {
                    const orderId = card.orderId
                    if (orderId) {
                      const role = userRole || 'product'
                      await fetch(`${API_BASE_URL}/api/inbound-orders/${orderId}/cancel?cancelled_by=${encodeURIComponent(role)}&user_role=${encodeURIComponent(role)}`, { method: 'POST' })
                    }
                  } catch (e) {
                    console.error('取消入库API调用失败:', e)
                  }
                  setMessages(prev => prev.map(m => {
                    if (m.id === msg.id) {
                      return { ...m, inboundCard: updateCard(card, { status: 'cancelled' }) }
                    }
                    return m
                  }))
                },
                onReportError: async (card, errorReason) => {
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
      {/* 多商品入库卡片展示? */}
      {Array.isArray(msg.inboundCards) && msg.inboundCards.length > 0 && (
        <div className="flex justify-start mt-2">
          <div className="max-w-4xl w-full space-y-4">
            <div className="text-sm text-gray-600 mb-2 font-medium">
              共{msg.inboundCards.length} 个商品待入库
            </div>
            {msg.inboundCards.map((card, cardIndex) => (
              <div key={card.id || cardIndex} className="border-l-4 border-amber-400 pl-3">
                <JewelryInboundCardComponent
                  data={card}
                  actions={{
                    onConfirm: async (cardToConfirm) => {
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
                        const { confirmInbound } = await import('../../../services/inboundService')
                        const result = await confirmInbound(cardToConfirm, false)
                        
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
                    onCancel: async (cardToCancel) => {
                      try {
                        const orderId = cardToCancel.orderId
                        if (orderId) {
                          const role = userRole || 'product'
                          await fetch(`${API_BASE_URL}/api/inbound-orders/${orderId}/cancel?cancelled_by=${encodeURIComponent(role)}&user_role=${encodeURIComponent(role)}`, { method: 'POST' })
                        }
                      } catch (e) {
                        console.error('取消入库API调用失败:', e)
                      }
                      setMessages(prev => prev.map(m => {
                        if (m.id === msg.id && m.inboundCards) {
                          const updatedCards = m.inboundCards.map((c, i) =>
                            i === cardIndex ? updateCard(c, { status: 'cancelled' }) : c
                          )
                          return { ...m, inboundCards: updatedCards }
                        }
                        return m
                      }))
                    },
                    onReportError: async (cardToReport, errorReason) => {
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
                    const { confirmInbound } = await import('../../../services/inboundService')
                    
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
                    // 批量确认完成后，收集所有已确认的卡片，添加转移提示
                    setMessages(prev => {
                      const currentMsg = prev.find(m => m.id === msg.id)
                      if (!currentMsg || !currentMsg.inboundCards) return prev
                      const confirmedCards = currentMsg.inboundCards.filter(c => c.status === 'confirmed')
                      if (confirmedCards.length === 0) return prev
                      return [...prev, {
                        id: Date.now(),
                        type: 'system',
                        content: `✅ ${confirmedCards.length} 个商品入库已确认，库存已更新。`,
                        transferPrompt: {
                          items: confirmedCards.map(c => ({
                            product_name: c.productName,
                            product_code: c.productCode || c.barcode || '',
                            weight: c.goldWeight,
                            barcode: c.barcode,
                            labor_cost: c.laborCostPerGram,
                            piece_count: c.pieceCount,
                            piece_labor_cost: c.pieceLaborCost,
                            main_stone_weight: c.mainStoneWeight,
                            main_stone_count: c.mainStoneCount,
                            sub_stone_weight: c.subStoneWeight,
                            sub_stone_count: c.subStoneCount,
                            main_stone_mark: c.mainStoneMark,
                            sub_stone_mark: c.subStoneMark,
                            pearl_weight: c.pearlWeight,
                            bearing_weight: c.bearingWeight,
                            sale_labor_cost: c.saleLaborCost,
                            sale_piece_labor_cost: c.salePieceLaborCost,
                          })),
                          status: 'pending',
                          orderNos: confirmedCards.map(c => c.orderNo).filter(Boolean).join(', ')
                        }
                      }]
                    })
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
      {/* 转移提示卡片 */}
      {msg.transferPrompt && (
        <TransferPromptCard
          data={msg.transferPrompt}
          onStatusChange={(newStatus, extra) => {
            setMessages(prev => prev.map(m =>
              m.id === msg.id
                ? { ...m, transferPrompt: { ...m.transferPrompt, status: newStatus, ...extra } }
                : m
            ))
          }}
        />
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
                <span className="font-semibold">{msg.salesOrder.customer_name || '—'}</span>
              </div>
              <div>
                <span className="text-gray-600">业务员：</span>
                <span className="font-semibold">{msg.salesOrder.salesperson || '—'}</span>
              </div>
              <div>
                <span className="text-gray-600">门店代码：</span>
                <span className="font-semibold">{msg.salesOrder.store_code || '未填写'}</span>
              </div>
              <div>
                <span className="text-gray-600">日期：</span>
                <span className="font-semibold">{
                  msg.salesOrder.order_date
                    ? (() => {
                        const d = new Date(msg.salesOrder.order_date)
                        return isNaN(d.getTime()) ? '—' : d.toLocaleString('zh-CN')
                      })()
                    : '—'
                }</span>
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
              {(msg.salesOrder.remark || '').trim() && (
                <div className="col-span-2">
                  <span className="text-gray-600">备注：</span>
                  <span className="font-semibold text-gray-800 whitespace-pre-wrap">{msg.salesOrder.remark}</span>
                </div>
              )}
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
                      {msg.salesOrder.details.map((detail, detailIdx) => (
                        <tr key={detailIdx} className="hover:bg-gray-50">
                          <td className="px-4 py-2 text-sm text-gray-900">{detail.product_name}</td>
                          <td className="px-4 py-2 text-sm text-gray-900">{Number(detail.weight).toFixed(3)}克</td>
                          <td className="px-4 py-2 text-sm text-gray-900">{detail.labor_cost}元/克</td>
                          <td className="px-4 py-2 text-sm font-semibold text-gray-900">{detail.total_labor_cost.toFixed(2)}元</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-4 flex justify-end space-x-6 text-lg font-bold text-gray-800">
                  <span>总克重：<span className="text-blue-600">{Number(msg.salesOrder.total_weight).toFixed(3)}克</span></span>
                  <span>总工费：<span className="text-green-600">{msg.salesOrder.total_labor_cost.toFixed(2)}元</span></span>
                </div>
              </div>
            )}
            {/* 操作按钮 */}
            <div className="mt-4 pt-3 border-t border-gray-200 flex gap-2 flex-wrap">
              <button
                onClick={() => window.open(`${API_BASE_URL}/api/sales/orders/${msg.salesOrder.id}/download?format=html`, '_blank')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                </svg>
                打印
              </button>
              <button
                onClick={() => window.open(`${API_BASE_URL}/api/sales/orders/${msg.salesOrder.id}/download?format=pdf`, '_blank')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-50 text-green-600 rounded-lg hover:bg-green-100 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                下载
              </button>
              {(msg.salesOrder.status === 'draft' || !msg.salesOrder.status) && setMessages && (
                <>
                <button
                  onClick={() => setCurrentPage?.({ name: 'salesOrders', editOrderId: msg.salesOrder.id })}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-yellow-50 text-yellow-600 rounded-lg hover:bg-yellow-100 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  编辑
                </button>
                <button
                  onClick={async () => {
                    if (!confirm('确认销售单？确认后将扣减库存，不可编辑。')) return
                    try {
                      const confirmedBy = userRole === 'counter' ? '柜台' : '管理员'
                      const params = new URLSearchParams({ confirmed_by: confirmedBy, user_role: userRole || 'counter' })
                      const res = await fetch(`${API_BASE_URL}/api/sales/orders/${msg.salesOrder.id}/confirm?${params}`, { method: 'POST' })
                      const data = await res.json()
                      if (res.ok && data.success !== false) {
                        toast.success(data.message || '销售单已确认')
                        setMessages(prev => prev.map(m => {
                          if (m.salesOrder?.id === msg.salesOrder.id) {
                            return { ...m, salesOrder: { ...m.salesOrder, status: '待结算' } }
                          }
                          return m
                        }))
                      } else {
                        toast.error(data.message || data.detail || '确认失败')
                      }
                    } catch (err) {
                      toast.error('确认操作失败')
                    }
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors font-medium"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  确认
                </button>
                </>
              )}
              {msg.salesOrder.status === '已结算' && (
                <div className="text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg border border-amber-200">
                  该销售单已结算，如需修改请先对结算单「反确认」撤销结算，再「撤单」，销售单回到待开结算后方可反确认。
                </div>
              )}
              {(msg.salesOrder.status === 'confirmed' || msg.salesOrder.status === '待结算') && setMessages && (
                <button
                  onClick={async () => {
                    if (!confirm('反确认销售单？将恢复为未确认状态，可重新编辑。')) return
                    const orderId = msg.salesOrder.id
                    const syncOrderToUI = async () => {
                      const detailRes = await fetch(`${API_BASE_URL}/api/sales/orders/${orderId}`)
                      if (detailRes.ok) {
                        const detailData = await detailRes.json()
                        const freshOrder = detailData.order
                        if (freshOrder) {
                          setMessages(prev => prev.map(m => {
                            if (m.salesOrder?.id == orderId || m.salesOrderId == orderId) {
                              return { ...m, salesOrder: { ...m.salesOrder, ...freshOrder, status: freshOrder.status }, salesOrderStatus: freshOrder.status }
                            }
                            return m
                          }))
                          return true
                        }
                      }
                      return false
                    }
                    try {
                      const operatedBy = userRole === 'counter' ? '柜台' : '管理员'
                      const params = new URLSearchParams({ operated_by: operatedBy, user_role: userRole || 'counter' })
                      const res = await fetch(`${API_BASE_URL}/api/sales/orders/${orderId}/unconfirm?${params}`, { method: 'POST' })
                      const data = await res.json()
                      if (res.ok && data.success !== false) {
                        toast.success(data.message || '销售单已反确认')
                        if (!(await syncOrderToUI())) {
                          setMessages(prev => prev.map(m => {
                            if (m.salesOrder?.id == orderId || m.salesOrderId == orderId) {
                              return { ...m, salesOrder: { ...m.salesOrder, status: 'draft' }, salesOrderStatus: 'draft' }
                            }
                            return m
                          }))
                        }
                      } else {
                        const msgText = (data.message || data.detail || '').toString()
                        if (msgText.includes('draft') || msgText.includes('已是')) {
                          toast.success('已同步为可编辑状态')
                          if (!(await syncOrderToUI())) {
                            setMessages(prev => prev.map(m => {
                              if (m.salesOrder?.id == orderId || m.salesOrderId == orderId) {
                                return { ...m, salesOrder: { ...m.salesOrder, status: 'draft' }, salesOrderStatus: 'draft' }
                              }
                              return m
                            }))
                          }
                        } else {
                          toast.error(data.message || data.detail || '反确认失败')
                        }
                      }
                    } catch (err) {
                      toast.error('反确认操作失败')
                    }
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors font-medium"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  反确认
                </button>
              )}
            </div>
            {/* 操作日志 */}
            <SalesOrderLogs salesOrderId={msg.salesOrder.id} salesOrderStatus={msg.salesOrder.status} API_BASE_URL={API_BASE_URL} />
          </div>
        </div>
      )}
      {/* 库存检查错误提示卡片? */}
      {Array.isArray(msg.inventoryErrors) && msg.inventoryErrors.length > 0 && (
        <div className="flex justify-start mt-2">
          <div className="max-w-4xl w-full bg-red-50 rounded-2xl shadow-sm p-6 border border-red-200/60">
            <h3 className="text-xl font-bold text-red-800 mb-4">❌ 库存检查失败</h3>
            <div className="space-y-4">
              {msg.inventoryErrors.map((error, errorIdx) => (
                <div key={errorIdx} className="bg-white rounded-lg p-4 border border-red-200">
                  <div className="font-semibold text-red-700 mb-2">
                    {errorIdx + 1}. {error.product_name}
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
                        <span className="ml-2 font-semibold">{Number(error.total_weight).toFixed(3)}克</span>
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
              
            {/* 圆形图（替代饼图，更现代） */}
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
                  {/* 供应商数据表? */}
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

export default SystemMessage
