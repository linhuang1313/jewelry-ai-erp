/**
 * ChatView - 聊天界面组件（从 App.jsx 抽离）
 * 包含消息列表、输入框、OCR 弹窗等聊天相关的所有 UI
 */
import React, { useState, useRef, useCallback, useEffect } from 'react'
import { Bar, Line, Doughnut } from 'react-chartjs-2'
import { API_BASE_URL } from '../config'
import { hasPermission } from '../config/permissions'
import { JewelryInboundCardComponent } from '../components/JewelryInboundCard'
import { updateCard } from '../utils/inboundHelpers'
import { reportError } from '../services/inboundService'
import InventoryOverview from '../components/InventoryOverview'
import TransferPromptCard from '../components/chat/cards/TransferPromptCard'
import ActionCardRenderer from '../components/chat/cards/ActionCardRenderer'
import { SalesOrderLogs } from '../components/chat/cards/SystemMessage'
import LineNumberedTextarea from '../components/LineNumberedTextarea'
import { getDailyQuote } from '../utils/dailyQuote'

const MENTION_ROLES = [
  { id: 'finance', label: '财务', desc: '财务核收、对账' },
  { id: 'settlement', label: '结算', desc: '结算确认、平账' },
  { id: 'product', label: '商品部', desc: '商品管理、入库' },
  { id: 'counter', label: '柜台', desc: '销售开单' },
  { id: 'sales', label: '业务员', desc: '客户跟进' },
  { id: 'material', label: '金料', desc: '金料收付' },
  { id: 'manager', label: '经理', desc: '审批管理' },
]

const MentionPopup = ({ filter, onSelect, selectedIndex }) => {
  const filtered = MENTION_ROLES.filter(
    r => r.label.includes(filter) || r.id.includes(filter.toLowerCase()) || r.desc.includes(filter)
  )
  if (filtered.length === 0) return null
  return (
    <div className="absolute bottom-full left-0 mb-2 w-64 bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden z-50" style={{ animation: 'fadeInUp 0.15s ease-out' }}>
      <div className="px-3 py-2 text-xs text-gray-400 border-b border-gray-100 font-medium">选择要 @提及 的角色</div>
      <div className="max-h-60 overflow-y-auto">
        {filtered.map((role, idx) => (
          <button
            key={role.id}
            onClick={() => onSelect(role)}
            className={`w-full px-3 py-2.5 flex items-center gap-3 text-left transition-colors cursor-pointer
              ${idx === selectedIndex ? 'bg-amber-50 text-amber-800' : 'hover:bg-gray-50 text-gray-700'}
            `}
          >
            <span className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-100 to-amber-50 flex items-center justify-center text-sm font-semibold text-amber-700">
              {role.label[0]}
            </span>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm">@{role.label}</div>
              <div className="text-xs text-gray-400 truncate">{role.desc}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

const ChatView = ({
  // State
  messages,
  input,
  loading,
  uploading,
  userRole,
  currentSessionId,
  currentLanguage,
  ocrResult,
  uploadedImage,
  showOCRModal,
  // Setters
  setInput,
  setMessages,
  setCurrentPage,
  setShowOCRModal,
  setOcrResult,
  setUploadedImage,
  setShowQuickOrderModal,
  setShowQuickInboundModal,
  setShowQuickReturnModal,
  // Handlers
  sendMessage,
  handleImageUpload,
  handlePaymentProofUpload,
  handleConfirmPaymentProof,
  handleConfirmInbound,
  handleConfirmReceipt,
  openReceiptEditModal,
  openQuickReceiptModal,
  openQuickWithdrawalModal,
  showToast,
  // Payment proof
  showPaymentProofModal,
  setShowPaymentProofModal,
  paymentProofData,
  paymentProofImage,
  paymentProofLoading,
  paymentProofInputRef,
  // 待发送附件
  pendingAttachment,
  clearPendingAttachment,
  // Refs
  messagesEndRef,
  fileInputRef,
  ocrTextareaRef,
  // i18n
  t,
}) => {
  const [showMention, setShowMention] = useState(false)
  const [mentionFilter, setMentionFilter] = useState('')
  const [mentionStart, setMentionStart] = useState(-1)
  const [mentionIdx, setMentionIdx] = useState(0)
  const chatTextareaRef = useRef(null)
  const mentionPopupRef = useRef(null)

  const getFilteredMentionRoles = useCallback(() => {
    return MENTION_ROLES.filter(
      r => r.label.includes(mentionFilter) || r.id.includes(mentionFilter.toLowerCase()) || r.desc.includes(mentionFilter)
    )
  }, [mentionFilter])

  const handleMentionInputChange = useCallback((e) => {
    const val = e.target.value
    const cursorPos = e.target.selectionStart
    setInput(val)
    const textBeforeCursor = val.slice(0, cursorPos)
    const atMatch = textBeforeCursor.match(/@([^@\s]*)$/)
    if (atMatch) {
      setShowMention(true)
      setMentionFilter(atMatch[1])
      setMentionStart(cursorPos - atMatch[0].length)
      setMentionIdx(0)
    } else {
      setShowMention(false)
      setMentionFilter('')
      setMentionStart(-1)
    }
  }, [setInput])

  const handleSelectMentionRole = useCallback((role) => {
    if (mentionStart < 0) return
    const before = input.slice(0, mentionStart)
    const afterCursor = input.slice(mentionStart).replace(/^@[^@\s]*/, '')
    const newVal = before + '@' + role.label + ' ' + afterCursor
    setInput(newVal)
    setShowMention(false)
    setMentionFilter('')
    setMentionStart(-1)
    setTimeout(() => {
      if (chatTextareaRef.current) {
        const pos = before.length + role.label.length + 2
        chatTextareaRef.current.focus()
        chatTextareaRef.current.setSelectionRange(pos, pos)
      }
    }, 0)
  }, [input, mentionStart, setInput])

  const handleChatKeyDown = useCallback((e) => {
    if (showMention) {
      const filtered = getFilteredMentionRoles()
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIdx(prev => (prev + 1) % filtered.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIdx(prev => (prev - 1 + filtered.length) % filtered.length); return }
      if ((e.key === 'Enter' || e.key === 'Tab') && filtered.length > 0) { e.preventDefault(); handleSelectMentionRole(filtered[mentionIdx]); return }
      if (e.key === 'Escape') { e.preventDefault(); setShowMention(false); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }, [showMention, getFilteredMentionRoles, handleSelectMentionRole, mentionIdx, sendMessage])

  useEffect(() => {
    if (!showMention) return
    const handler = (e) => {
      if (mentionPopupRef.current && mentionPopupRef.current.contains(e.target)) return
      if (chatTextareaRef.current && !chatTextareaRef.current.contains(e.target)) {
        setShowMention(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showMention])

  return (
          <>
            {/* 对话区域 - 苹果风格 */}
            <div className="flex-1 overflow-y-auto px-3 md:px-6 py-4 md:py-8">
              <div className="max-w-4xl mx-auto space-y-6">
                {messages.length === 0 && (
                  <div className="text-center pt-8">
                    {/* 智能时间问候 + AI标识 */}
                    <div className="mb-6">
                      <div className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-amber-50 to-yellow-50 rounded-full border border-amber-200">
                        <img src="/ai-avatar.png" alt="AI" className="w-6 h-6 rounded-full object-cover" />
                        <span className="text-sm text-gray-700">
                          {(() => {
                            const hour = new Date().getHours()
                            if (hour < 9) return '早上好！今天也要加油哦 ☀️'
                            if (hour < 12) return '上午好！有什么可以帮您的？'
                            if (hour < 14) return '中午好！记得休息一下 🍵'
                            if (hour < 18) return '下午好！我随时准备为您服务'
                            return '晚上好！辛苦了 🌙'
                          })()}
                        </span>
                      </div>
                      {/* 每日金句 */}
                      {(() => {
                        const quote = getDailyQuote()
                        return (
                          <div className="mt-3 max-w-md mx-auto">
                            <p className="text-sm text-gray-500 italic leading-relaxed">"{quote.text}"</p>
                            <p className="text-xs text-gray-400 mt-1">—— {quote.source}</p>
                          </div>
                        )
                      })()}
                    </div>

                    {/* 智能快捷建议按钮 - 可点击直接发送 */}
                    <div className="flex flex-wrap justify-center gap-2 mb-6">
                      <span className="text-gray-400 text-sm">💡 试试：</span>
                      {userRole === 'counter' && (
                        <>
                          <button onClick={() => setInput('帮我开一张销售单')} className="px-3 py-1.5 text-sm bg-blue-50 text-blue-600 rounded-full hover:bg-blue-100 transition-colors">开销售单</button>
                          <button onClick={() => setInput('查询今天的销售情况')} className="px-3 py-1.5 text-sm bg-blue-50 text-blue-600 rounded-full hover:bg-blue-100 transition-colors">今日销售</button>
                          <button onClick={() => setInput('库存还有多少')} className="px-3 py-1.5 text-sm bg-blue-50 text-blue-600 rounded-full hover:bg-blue-100 transition-colors">查库存</button>
                        </>
                      )}
                      {userRole === 'product' && (
                        <>
                          <button onClick={() => setInput('古法黄金戒指 100克 工费6元 供应商金源珠宝 帮我入库')} className="px-3 py-1.5 text-sm bg-orange-50 text-orange-600 rounded-full hover:bg-orange-100 transition-colors">入库商品</button>
                          <button onClick={() => setInput('查询今天的入库单')} className="px-3 py-1.5 text-sm bg-orange-50 text-orange-600 rounded-full hover:bg-orange-100 transition-colors">今日入库</button>
                          <button onClick={() => setInput('库存分析')} className="px-3 py-1.5 text-sm bg-orange-50 text-orange-600 rounded-full hover:bg-orange-100 transition-colors">库存分析</button>
                        </>
                      )}
                      {userRole === 'settlement' && (
                        <>
                          <button onClick={() => setInput('查看今天待结算的订单')} className="px-3 py-1.5 text-sm bg-green-50 text-green-600 rounded-full hover:bg-green-100 transition-colors">待结算</button>
                          <button onClick={() => setInput('张老板提5克')} className="px-3 py-1.5 text-sm bg-green-50 text-green-600 rounded-full hover:bg-green-100 transition-colors">客户提料</button>
                          <button onClick={() => setInput('收料登记')} className="px-3 py-1.5 text-sm bg-green-50 text-green-600 rounded-full hover:bg-green-100 transition-colors">收料登记</button>
                        </>
                      )}
                      {userRole === 'finance' && (
                        <>
                          <button onClick={() => setInput('查看本月财务对账情况')} className="px-3 py-1.5 text-sm bg-purple-50 text-purple-600 rounded-full hover:bg-purple-100 transition-colors">月度对账</button>
                          <button onClick={() => setInput('今日收款汇总')} className="px-3 py-1.5 text-sm bg-purple-50 text-purple-600 rounded-full hover:bg-purple-100 transition-colors">收款汇总</button>
                        </>
                      )}
                      {userRole === 'sales' && (
                        <>
                          <button onClick={() => setInput('帮我查询张三今天的销售情况')} className="px-3 py-1.5 text-sm bg-indigo-50 text-indigo-600 rounded-full hover:bg-indigo-100 transition-colors">客户销售</button>
                          <button onClick={() => setInput('王五有多少欠款')} className="px-3 py-1.5 text-sm bg-indigo-50 text-indigo-600 rounded-full hover:bg-indigo-100 transition-colors">欠款查询</button>
                          <button onClick={() => setInput('查询退货记录')} className="px-3 py-1.5 text-sm bg-indigo-50 text-indigo-600 rounded-full hover:bg-indigo-100 transition-colors">退货记录</button>
                        </>
                      )}
                      {userRole === 'material' && (
                        <>
                          <button onClick={() => setInput('查看今日金料收付情况')} className="px-3 py-1.5 text-sm bg-yellow-50 text-yellow-600 rounded-full hover:bg-yellow-100 transition-colors">今日收付</button>
                          <button onClick={() => setInput('金料库存统计')} className="px-3 py-1.5 text-sm bg-yellow-50 text-yellow-600 rounded-full hover:bg-yellow-100 transition-colors">库存统计</button>
                        </>
                      )}
                      {userRole === 'manager' && (
                        <>
                          <button onClick={() => setInput('查看今日销售数据汇总')} className="px-3 py-1.5 text-sm bg-red-50 text-red-600 rounded-full hover:bg-red-100 transition-colors">今日汇总</button>
                          <button onClick={() => setInput('本月业绩分析')} className="px-3 py-1.5 text-sm bg-red-50 text-red-600 rounded-full hover:bg-red-100 transition-colors">业绩分析</button>
                          <button onClick={() => setInput('库存预警')} className="px-3 py-1.5 text-sm bg-red-50 text-red-600 rounded-full hover:bg-red-100 transition-colors">库存预警</button>
                        </>
                      )}
                    </div>

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
                          <div className="text-2xl mb-3">📝</div>
                          <h3 className="font-semibold text-gray-900 mb-2">快速开单</h3>
                          <p className="text-sm text-gray-600">创建销售单</p>
                        </div>
                      )}

                      {/* 接收库存卡片 - 需要接收库存权限*/}
                      {hasPermission(userRole, 'canReceiveTransfer') && (
                        <div
                          onClick={() => setCurrentPage('warehouse')}
                          className="p-6 bg-white rounded-2xl border border-gray-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
                        >
                          <div className="text-2xl mb-3">📦</div>
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

                      {/* 财务对账卡片 - 需要财务权限*/}
                      {hasPermission(userRole, 'canViewFinance') && (
                        <div
                          onClick={() => setCurrentPage('finance')}
                          className="p-6 bg-white rounded-2xl border border-gray-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
                        >
                          <div className="text-2xl mb-3">💵</div>
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
                          <div className="text-2xl mb-3">🏢</div>
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
                      {/* 入库单据卡片 - 需要入库权限 */}
                      {hasPermission(userRole, 'canInbound') && (
                        <div
                          onClick={() => setCurrentPage('inbound-orders')}
                          className="p-6 bg-white rounded-2xl border border-gray-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
                        >
                          <div className="text-2xl mb-3">📋</div>
                          <h3 className="font-semibold text-gray-900 mb-2">入库单据</h3>
                          <p className="text-sm text-gray-600">查看所有入库单据记录</p>
                        </div>
                      )}

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

                      {/* 凭证管理卡片 - 财务人员 */}
                      {hasPermission(userRole, 'canManageVouchers') && (
                        <div
                          onClick={() => setCurrentPage('voucher')}
                          className="p-6 bg-white rounded-2xl border border-gray-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
                        >
                          <div className="text-2xl mb-3">🧾</div>
                          <h3 className="font-semibold text-gray-900 mb-2">凭证管理</h3>
                          <p className="text-sm text-gray-600">管理财务凭证</p>
                        </div>
                      )}

                      {/* 财务人员管理卡片 - 财务经理 */}
                      {hasPermission(userRole, 'canManageFinanceAdmins') && (
                        <div
                          onClick={() => setCurrentPage('finance-admins')}
                          className="p-6 bg-white rounded-2xl border border-gray-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
                        >
                          <div className="text-2xl mb-3">🧑‍💻</div>
                          <h3 className="font-semibold text-gray-900 mb-2">财务人员管理</h3>
                          <p className="text-sm text-gray-600">管理财务系统用户</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {messages.map((msg, idx) => {
                  // 跨角色协同卡片
                  if (msg.type === 'interactive_card' && msg.cardData) {
                    return (
                      <div key={`card-${idx}`}>
                        <ActionCardRenderer
                          card={msg.cardData}
                          userRole={userRole}
                          onCardUpdate={(updatedCard) => {
                            setMessages(prev => prev.map((m, i) =>
                              i === idx ? { ...m, cardData: { ...m.cardData, ...updatedCard } } : m
                            ))
                          }}
                        />
                      </div>
                    )
                  }

                  // 思考过程消息
                  if (msg.type === 'thinking' && Array.isArray(msg.steps)) {
                    return (
                      <div key={`${msg.type || 'msg'}-${idx}`} className="flex justify-start">
                        <div className="bg-white rounded-2xl rounded-bl-sm px-5 py-3.5 shadow-sm border-l-4 border-l-gray-300 border border-gray-100 max-w-2xl">
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
                                <div className={`w-2 h-2 rounded-full mt-2 ${step.status === 'complete'
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
                      <div key={`${msg.type || 'msg'}-${idx}`} className="flex justify-start">
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
                                <span className="text-gray-600">当前欠款</span>
                                <span className="font-medium text-gray-900">¥{pd.current_debt?.toFixed(2)}</span>
                              </div>
                              <div className="flex justify-between text-sm">
                                <span className="text-gray-600">本次收款</span>
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
                                    const { confirmPayment } = await import('../services/financeService')
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
                                          ? { ...m, type: 'system', content: `✅ 收款登记成功！\n\n客户：${pd.customer.name}\n收款金额：¥${pd.payment_amount.toFixed(2)}\n收款方式：${pd.payment_method}\n收款后欠款：${balanceText}` }
                                          : m
                                      ))
                                    } else {
                                      alert('收款登记失败：' + (result.error || '未知错误'))
                                    }
                                  } catch (error) {

                                    alert('收款登记失败：' + error.message)
                                  }
                                }}
                                className="flex-1 bg-orange-500 hover:bg-orange-600 text-white font-medium py-2.5 px-4 rounded-xl transition-colors"
                              >
                                确认登记
                              </button>
                              <button
                                onClick={() => {
                                  // 取消确认，移除该消息
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
                      <div key={`${msg.type || 'msg'}-${idx}`} className="flex justify-start">
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
                                          ? {
                                            ...m, type: 'system', content: `✅ 收料单创建成功！\n\n单号：${result.data.receipt_no}\n客户：${rd.customer.name}\n克重：${rd.gold_weight.toFixed(2)}克
成色：${rd.gold_fineness}` }
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

                                    alert('收料单创建失败：' + error.message)
                                  }
                                }}
                                className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-white font-medium py-2.5 px-4 rounded-xl transition-colors"
                              >
                                确认并打单
                              </button>
                              <button
                                onClick={() => {
                                  // 取消确认，移除该消息
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
                      <div key={`${msg.type || 'msg'}-${idx}`} className="flex justify-start">
                        <div className="bg-white rounded-2xl shadow-lg border border-blue-200 max-w-md overflow-hidden">
                          {/* 标题栏 */}
                          <div className="bg-gradient-to-r from-blue-500 to-indigo-500 px-5 py-3">
                            <div className="flex items-center gap-2 text-white">
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11l5-5m0 0l5 5m-5-5v12" />
                              </svg>
                              <span className="font-semibold">确认创建收料单</span>
                            </div>
                          </div>

                          {/* 内容区 */}
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

                                    alert('提料单创建失败：' + error.message)
                                  }
                                }}
                                className="flex-1 bg-blue-500 hover:bg-blue-600 text-white font-medium py-2.5 px-4 rounded-xl transition-colors"
                              >
                                确认并打单
                              </button>
                              <button
                                onClick={() => {
                                  // 取消确认，移除该消息
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
                      <div key={`${msg.type || 'msg'}-${idx}`} className="flex justify-start">
                        <div className="bg-white rounded-2xl shadow-lg border border-green-200 max-w-md overflow-hidden">
                          {/* 标题栏 */}
                          <div className="bg-gradient-to-r from-green-500 to-emerald-500 px-5 py-3">
                            <div className="flex items-center gap-2 text-white">
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                              <span className="font-semibold">提料单已生成</span>
                            </div>
                          </div>

                          {/* 内容区 */}
                          <div className="p-5 space-y-4">
                            {/* 单号信息 */}
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-gray-500">单号</span>
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
                      <div key={`${msg.type || 'msg'}-${idx}`} className="flex justify-end">
                        <div className="bg-[#1E3A5F] text-white rounded-2xl rounded-br-sm px-5 py-3.5 shadow-md max-w-2xl">
                          {msg.image && (
                            <img src={msg.image} alt="附件" className="w-48 h-auto rounded-lg mb-2 border border-white/20" />
                          )}
                          <div className="text-[15px] leading-[1.75] whitespace-pre-wrap">{msg.content}</div>
                        </div>
                      </div>
                    )
                  }

                  // 系统消息（流式内容或普通内容）- 带AI头像
                  if (msg.type === 'system') {
                    return (
                      <React.Fragment key={`${msg.type || 'msg'}-${idx}`}>
                        <div className="flex justify-start items-start gap-3">
                          {/* AI头像 - 招财猫 */}
                          <img src="/ai-avatar.png" alt="AI" className="flex-shrink-0 w-8 h-8 rounded-full object-cover shadow-md ring-2 ring-jewelry-gold/30" />
                          <div className={`
                        ${msg.id ? 'max-w-2xl' : 'max-w-[85%] md:max-w-[75%]'}
                        rounded-2xl rounded-bl-sm px-5 py-3.5 shadow-sm bg-white border-l-4 border-l-[#C9A86C] border border-gray-100
                      `}>
                            {/* 意图识别可视化标签 - 珠宝风格 */}
                            {msg.detectedIntent && (
                              <div className="flex items-center gap-1.5 mb-2 pb-2 border-b border-gray-100">
                                <span className="text-xs text-gray-400">🎯 识别到：</span>
                                <span className="px-2 py-0.5 text-xs font-medium bg-gradient-to-r from-amber-100 to-yellow-100 text-amber-700 rounded-full">
                                  {msg.detectedIntent}
                                </span>
                              </div>
                            )}
                            <div className="text-[15px] leading-[1.75] whitespace-pre-wrap text-gray-800">
                              {/* 隐藏内容中的特殊标记 */}
                              {msg.content?.replace(/\n*<!-- (RETURN_ORDER|INBOUND_ORDER|SALES_ORDER|SETTLEMENT_ORDER|CUSTOMER_DEBT|EXPORT_INBOUND|WITHDRAWAL_ORDER|GOLD_RECEIPT|PAYMENT|GOLD_PAYMENT|SUPPLIER_PAYMENT):[^>]+ -->/g, '')}
                              {/* 流式生成时的闪烁光标 */}
                              {msg.isStreaming && (
                                <span className="inline-block w-0.5 h-4 bg-[#C9A86C] ml-1 animate-pulse"></span>
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
                              // 尝试从消息对象获取，或从内容中解析隐藏标记
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
                              let receiptId = msg.goldReceiptId
                              let receiptDownloadUrl = msg.goldReceiptDownloadUrl
                              if (!receiptId && msg.content) {
                                const match = msg.content.match(/<!-- GOLD_RECEIPT:(\d+):/)
                                if (match) {
                                  receiptId = parseInt(match[1])
                                  receiptDownloadUrl = `${API_BASE_URL}/api/gold-material/gold-receipts/${receiptId}/print`
                                }
                              }
                              if (!receiptId) return null
                              const isPending = msg.receiptStatus !== 'received'
                              return (
                                <div className="mt-4 pt-3 border-t border-gray-100 flex flex-wrap gap-2">
                                  {isPending && (
                                    <>
                                      <button
                                        onClick={() => handleConfirmReceipt(receiptId, idx)}
                                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                                      >
                                        确认
                                      </button>
                                      <button
                                        onClick={() => openReceiptEditModal(receiptId, idx)}
                                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                                      >
                                        编辑
                                      </button>
                                    </>
                                  )}
                                  <button
                                    onClick={() => window.open(receiptDownloadUrl, '_blank')}
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
                                  {!msg.inboundConfirmed ? (
                                  <button
                                    onClick={async () => {
                                      try {
                                        const res = await fetch(`${API_BASE_URL}/api/inbound-orders/${inboundId}/confirm?confirmed_by=${encodeURIComponent(userRole)}&user_role=${encodeURIComponent(userRole)}`, { method: 'POST' })
                                        const data = await res.json()
                                        if (data.success || res.ok) {
                                          // 标记原始消息已确认，隐藏确认按钮
                                          setMessages(prev => prev.map(m =>
                                            m.id === msg.id ? { ...m, inboundConfirmed: true } : m
                                          ))
                                          // 获取入库单详情用于转移提示
                                          let transferPrompt = undefined
                                          try {
                                            // 从内容中解析 order_no
                                            const orderNoMatch = msg.content?.match(/<!-- INBOUND_ORDER:\d+:([^:]+):/)
                                            const orderNo = orderNoMatch?.[1] || msg.inboundOrder?.order_no
                                            if (orderNo) {
                                              const detailRes = await fetch(`${API_BASE_URL}/api/inbound-orders?order_no=${encodeURIComponent(orderNo)}&limit=1`)
                                              const detailData = await detailRes.json()
                                              const order = detailData.data?.[0]
                                              if (order?.details?.length > 0) {
                                                transferPrompt = {
                                                  items: order.details.map(d => ({ product_name: d.product_name, weight: d.weight })),
                                                  status: 'pending',
                                                  orderNos: order.order_no || ''
                                                }
                                              }
                                            }
                                          } catch (detailErr) {

                                          }
                                          setMessages(prev => [...prev, { id: Date.now(), type: 'system', content: `✅ 入库单已确认，库存已更新。`, transferPrompt }])
                                        } else {
                                          setMessages(prev => [...prev, { id: Date.now(), type: 'system', content: `⚠️ ${data.detail || data.message || '确认失败'}` }])
                                        }
                                      } catch (e) {
                                        setMessages(prev => [...prev, { id: Date.now(), type: 'system', content: `⚠️ 确认失败：${e.message}` }])
                                      }
                                    }}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-orange-50 text-orange-600 rounded-lg hover:bg-orange-100 transition-colors"
                                  >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                    确认入库
                                  </button>
                                  ) : (
                                  <span className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-green-600">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    已确认
                                  </span>
                                  )}
                                </div>
                              )
                            })()}
                            {/* 销售单操作按钮 - 支持从对象或从内容解析 */}
                            {(() => {
                              // 尝试从消息对象获取，或从内容中解析隐藏标记
                              let salesId = msg.salesOrderId
                              if (!salesId && msg.salesOrder?.id) salesId = msg.salesOrder.id
                              if (!salesId && msg.content) {
                                const match = msg.content.match(/<!-- SALES_ORDER:(\d+):/)
                                if (match) salesId = parseInt(match[1])
                              }
                              if (!salesId) return null
                              const salesStatus = msg.salesOrder?.status ?? msg.salesOrderStatus
                              const isDraft = salesStatus === 'draft' || !salesStatus
                              const isConfirmed = salesStatus === 'confirmed' || salesStatus === '待结算'
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
                                  {isDraft && (
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
                                  {isDraft && (
                                    <button
                                      onClick={async () => {
                                        if (!confirm('确认销售单？确认后将扣减库存，不可编辑。')) return
                                        try {
                                          const confirmedBy = userRole === 'counter' ? '柜台' : '管理员'
                                          const params = new URLSearchParams({ confirmed_by: confirmedBy, user_role: userRole || 'counter' })
                                          const res = await fetch(`${API_BASE_URL}/api/sales/orders/${salesId}/confirm?${params}`, { method: 'POST' })
                                          const data = await res.json()
                                          if (res.ok && data.success !== false) {
                                            showToast(data.message || '销售单已确认', 'success')
                                            setMessages(prev => prev.map(m => {
                                              if ((m.salesOrderId === salesId || m.salesOrder?.id === salesId)) {
                                                return { ...m, salesOrder: { ...m.salesOrder, id: salesId, status: '待结算' }, salesOrderStatus: '待结算' }
                                              }
                                              return m
                                            }))
                                          } else {
                                            showToast(data.message || data.detail || '确认失败', 'error')
                                          }
                                        } catch (err) {
                                          showToast('确认操作失败', 'error')
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
                                  {isConfirmed && (
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
                                            showToast(data.message || '销售单已反确认', 'success')
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
                                              showToast('已同步为可编辑状态', 'success')
                                              if (!(await syncOrderToUI())) {
                                                setMessages(prev => prev.map(m => {
                                                  if ((m.salesOrderId == salesId || m.salesOrder?.id == salesId)) {
                                                    return { ...m, salesOrder: { ...m.salesOrder, id: salesId, status: 'draft' }, salesOrderStatus: 'draft' }
                                                  }
                                                  return m
                                                }))
                                              }
                                            } else {
                                              showToast(data.message || data.detail || '反确认失败', 'error')
                                            }
                                          }
                                        } catch (err) {
                                          showToast('反确认操作失败', 'error')
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
                            {/* 入库单查询导出按钮 - 从内容中解析隐藏标记 */}
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
                                      const { confirmInbound } = await import('../services/inboundService')
                                      // 不使用Mock模式，确保获取真实的orderId
                                      const useMock = false
                                      const result = await confirmInbound(card, useMock)

                                      // 更新卡片状态和订单信息
                                      setMessages(prev => prev.map(m => {
                                        if (m.id === msg.id) {
                                          const updatedCard = updateCard(card, {
                                            status: 'confirmed',
                                            orderNo: result.order?.order_no || card.orderNo,
                                            orderId: result.order?.id || card.orderId,
                                            barcode: result.order?.order_no || card.barcode || '',
                                          })
                                          return { ...m, inboundCard: updatedCard }
                                        }
                                        return m
                                      }))
                                    } catch (error) {
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
                                  onCancel: async (card) => {
                                    try {
                                      const orderId = card.orderId
                                      if (orderId) {
                                        const userRole = localStorage.getItem('userRole') || 'product'
                                        await fetch(`${API_BASE_URL}/api/inbound-orders/${orderId}/cancel?cancelled_by=${encodeURIComponent(userRole)}&user_role=${encodeURIComponent(userRole)}`, { method: 'POST' })
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
                                    }
                                  },
                                }}
                              />
                            </div>
                          </div>
                        )}
                        {/* 多商品入库卡片展示 */}
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
                                          const { confirmInbound } = await import('../services/inboundService')
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
                                            const userRole = localStorage.getItem('userRole') || 'product'
                                            await fetch(`${API_BASE_URL}/api/inbound-orders/${orderId}/cancel?cancelled_by=${encodeURIComponent(userRole)}&user_role=${encodeURIComponent(userRole)}`, { method: 'POST' })
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
                                      const { confirmInbound } = await import('../services/inboundService')

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
                                            items: confirmedCards.map(c => ({ product_name: c.productName, weight: c.goldWeight })),
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
                                  <span className={`font-semibold ${msg.salesOrder.status === 'confirmed' || msg.salesOrder.status === '已结算' ? 'text-blue-600' :
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
                                {(msg.salesOrder.status === 'draft' || !msg.salesOrder.status) && (
                                  <>
                                  <button
                                    onClick={() => setCurrentPage({ name: 'salesOrders', editOrderId: msg.salesOrder.id })}
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
                                          showToast(data.message || '销售单已确认', 'success')
                                          setMessages(prev => prev.map(m => {
                                            if (m.salesOrder?.id === msg.salesOrder.id) {
                                              return { ...m, salesOrder: { ...m.salesOrder, status: '待结算' } }
                                            }
                                            return m
                                          }))
                                        } else {
                                          showToast(data.message || data.detail || '确认失败', 'error')
                                        }
                                      } catch (err) {
                                        showToast('确认操作失败', 'error')
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
                                {(msg.salesOrder.status === 'confirmed' || msg.salesOrder.status === '待结算') && (
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
                                                return { ...m, salesOrder: { ...m.salesOrder, ...freshOrder, status: freshOrder.status }, salesOrderStatus: freshOrder.status, salesOrderId: orderId }
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
                                          showToast(data.message || '销售单已反确认', 'success')
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
                                            showToast('已同步为可编辑状态', 'success')
                                            if (!(await syncOrderToUI())) {
                                              setMessages(prev => prev.map(m => {
                                                if (m.salesOrder?.id == orderId || m.salesOrderId == orderId) {
                                                  return { ...m, salesOrder: { ...m.salesOrder, status: 'draft' }, salesOrderStatus: 'draft' }
                                                }
                                                return m
                                              }))
                                            }
                                          } else {
                                            showToast(data.message || data.detail || '反确认失败', 'error')
                                          }
                                        }
                                      } catch (err) {
                                        showToast('反确认操作失败', 'error')
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
                        {/* 库存检查错误提示卡片 */}
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
                                              label: function (context) {
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
                                                return '🍪 供应商占比分布'
                                              }
                                              return '🍪 库存占比分布'
                                            })(),
                                            font: { size: 14, weight: 'bold' }
                                          },
                                          tooltip: {
                                            callbacks: {
                                              label: function (context) {
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
                                    {/* 供应商数据表格 */}
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

                {/* AI思考状态动画 - 珠宝风格 */}
                {(loading || uploading) && (
                  <div className="flex justify-start items-start gap-3">
                    {/* AI头像 + 脉冲动画 */}
                    <div className="relative flex-shrink-0">
                      <img src="/ai-avatar.png" alt="AI" className="w-9 h-9 rounded-full object-cover shadow-lg" />
                      <div className="absolute inset-0 bg-amber-400 rounded-full animate-ping opacity-30"></div>
                    </div>
                    {/* 思考气泡 */}
                    <div className="bg-gradient-to-br from-white to-amber-50 rounded-3xl px-5 py-4 shadow-sm border border-amber-100">
                      <div className="flex items-center gap-3">
                        <div className="flex space-x-1.5">
                          <div className="w-2.5 h-2.5 bg-amber-500 rounded-full animate-bounce"></div>
                          <div className="w-2.5 h-2.5 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: '0.15s' }}></div>
                          <div className="w-2.5 h-2.5 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: '0.3s' }}></div>
                        </div>
                        <span className="text-sm text-amber-600 font-medium">
                          {uploading ? 'AI正在识别图片...' : 'AI正在分析...'}
                        </span>
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
                          请对照图片核查识别内容是否正确
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
            <footer className="bg-white/80 backdrop-blur-xl border-t border-gray-200/60 px-2 md:px-6 py-2 md:py-5">
              <div className="max-w-4xl mx-auto space-y-1.5 md:space-y-0">
                {/* 手机端：工具按钮独立一行；桌面端：隐藏（合并到下面一行） */}
                <div className="flex md:hidden items-center space-x-1.5 overflow-x-auto scrollbar-hide pb-0.5">
                  {userRole === 'product' && (
                    <button
                      onClick={() => setShowQuickInboundModal(true)}
                      disabled={loading || uploading}
                      className={`
                        px-2 py-1.5 rounded-xl cursor-pointer transition-all duration-200
                        h-[32px] flex items-center font-medium text-[11px] flex-shrink-0 whitespace-nowrap
                        ${loading || uploading
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          : 'bg-orange-500 text-white hover:bg-orange-600 shadow-sm'
                        }
                      `}
                      title="快捷入库"
                    >
                      📦 入库
                    </button>
                  )}
                  {userRole === 'counter' && (
                    <button
                      onClick={() => setShowQuickOrderModal(true)}
                      disabled={loading || uploading}
                      className={`
                        px-2 py-1.5 rounded-xl cursor-pointer transition-all duration-200
                        h-[32px] flex items-center font-medium text-[11px] flex-shrink-0 whitespace-nowrap
                        ${loading || uploading
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          : 'bg-blue-500 text-white hover:bg-blue-600 shadow-sm'
                        }
                      `}
                      title="快速开单"
                    >
                      📝 开单
                    </button>
                  )}
                  {(userRole === 'product' || userRole === 'counter') && (
                    <button
                      onClick={() => setShowQuickReturnModal(true)}
                      disabled={loading || uploading}
                      className={`
                        px-2 py-1.5 rounded-xl cursor-pointer transition-all duration-200
                        h-[32px] flex items-center font-medium text-[11px] flex-shrink-0 whitespace-nowrap
                        ${loading || uploading
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          : 'bg-red-500 text-white hover:bg-red-600 shadow-sm'
                        }
                      `}
                      title="快捷退货"
                    >
                      ↩️ 退货
                    </button>
                  )}
                  {(userRole === 'product' || userRole === 'manager') && (
                    <>
                      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" id="image-upload-mobile" disabled={loading || uploading} />
                      <label
                        htmlFor="image-upload-mobile"
                        title="OCR识别入库单据"
                        className={`
                          px-2 py-1.5 rounded-xl cursor-pointer transition-all duration-200
                          h-[32px] flex items-center font-medium text-[11px] flex-shrink-0 whitespace-nowrap
                          ${loading || uploading
                            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                            : 'border border-jewelry-navy text-jewelry-navy hover:bg-jewelry-navy hover:text-white'
                          }
                        `}
                      >
                        {uploading ? `📲 ${t('chat.scanning')}` : `📲 ${t('chat.scan')}`}
                      </label>
                    </>
                  )}
                  {(userRole === 'settlement' || userRole === 'manager' || userRole === 'sales' || userRole === 'finance') && (
                    <>
                      <input ref={paymentProofInputRef} type="file" accept="image/*" onChange={handlePaymentProofUpload} className="hidden" id="payment-proof-upload-mobile" disabled={loading || paymentProofLoading} />
                      <label
                        htmlFor="payment-proof-upload-mobile"
                        title="上传转账截图"
                        className={`
                          px-2 py-1.5 rounded-xl cursor-pointer transition-all duration-200
                          h-[32px] flex items-center font-medium text-[11px] flex-shrink-0 whitespace-nowrap
                          ${loading || paymentProofLoading
                            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                            : 'border border-green-500 text-green-600 hover:bg-green-500 hover:text-white'
                          }
                        `}
                      >
                        {paymentProofLoading ? '🔍 识别中...' : '💳 收款凭证'}
                      </label>
                    </>
                  )}
                  {(userRole === 'settlement' || userRole === 'manager') && (
                    <>
                      <button
                        onClick={openQuickReceiptModal}
                        className="px-2 py-1.5 rounded-xl h-[32px] flex items-center font-medium text-[11px] flex-shrink-0 whitespace-nowrap bg-gradient-to-r from-jewelry-gold to-jewelry-gold-light text-white shadow-sm transition-all duration-200"
                        title="快捷收料"
                      >
                        📦 {t('chat.receipt')}
                      </button>
                      <button
                        onClick={openQuickWithdrawalModal}
                        className="px-2 py-1.5 rounded-xl h-[32px] flex items-center font-medium text-[11px] flex-shrink-0 whitespace-nowrap border border-jewelry-navy text-jewelry-navy transition-all duration-200"
                        title="快捷提料"
                      >
                        ⬆️ {t('chat.withdrawal')}
                      </button>
                    </>
                  )}
                </div>

                {/* 桌面端：所有按钮 + 输入框 + 发送在一行；手机端：仅输入框 + 发送 */}
                <div className="flex items-end space-x-1.5 md:space-x-3">
                  {/* 桌面端工具按钮（手机端隐藏，已在上面单独显示） */}
                  <div className="hidden md:contents">
                    {userRole === 'product' && (
                      <button
                        onClick={() => setShowQuickInboundModal(true)}
                        disabled={loading || uploading}
                        className={`
                          px-3 py-3 rounded-2xl cursor-pointer transition-all duration-200
                          h-[52px] flex items-center font-medium text-[14px] flex-shrink-0 whitespace-nowrap
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
                    {userRole === 'counter' && (
                      <button
                        onClick={() => setShowQuickOrderModal(true)}
                        disabled={loading || uploading}
                        className={`
                          px-3 py-3 rounded-2xl cursor-pointer transition-all duration-200
                          h-[52px] flex items-center font-medium text-[14px] flex-shrink-0 whitespace-nowrap
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
                    {(userRole === 'product' || userRole === 'counter') && (
                      <button
                        onClick={() => setShowQuickReturnModal(true)}
                        disabled={loading || uploading}
                        className={`
                          px-3 py-3 rounded-2xl cursor-pointer transition-all duration-200
                          h-[52px] flex items-center font-medium text-[14px] flex-shrink-0 whitespace-nowrap
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
                    {(userRole === 'product' || userRole === 'manager') && (
                      <>
                        <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" id="image-upload" disabled={loading || uploading} />
                        <label
                          htmlFor="image-upload"
                          title="OCR识别入库单据 - 支持拍照或上传单据图片自动识别"
                          className={`
                            px-4 py-3 rounded-2xl cursor-pointer transition-all duration-200
                            h-[52px] flex items-center font-medium text-[15px] flex-shrink-0 whitespace-nowrap
                            ${loading || uploading
                              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                              : 'border-2 border-jewelry-navy text-jewelry-navy hover:bg-jewelry-navy hover:text-white'
                            }
                          `}
                        >
                          {uploading ? `📲 ${t('chat.scanning')}` : `📲 ${t('chat.scan')}`}
                        </label>
                      </>
                    )}
                    {(userRole === 'settlement' || userRole === 'manager' || userRole === 'sales' || userRole === 'finance') && (
                      <>
                        <input ref={paymentProofInputRef} type="file" accept="image/*" onChange={handlePaymentProofUpload} className="hidden" id="payment-proof-upload" disabled={loading || paymentProofLoading} />
                        <label
                          htmlFor="payment-proof-upload"
                          title="上传转账截图 - 自动识别收款信息"
                          className={`
                            px-4 py-3 rounded-2xl cursor-pointer transition-all duration-200
                            h-[52px] flex items-center font-medium text-[15px] flex-shrink-0 whitespace-nowrap
                            ${loading || paymentProofLoading
                              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                              : 'border-2 border-green-500 text-green-600 hover:bg-green-500 hover:text-white'
                            }
                          `}
                        >
                          {paymentProofLoading ? '🔍 识别中...' : '💳 收款凭证'}
                        </label>
                      </>
                    )}
                    {(userRole === 'settlement' || userRole === 'manager') && (
                      <>
                        <button
                          onClick={openQuickReceiptModal}
                          className="px-4 py-3 rounded-2xl h-[52px] flex items-center font-medium text-[15px] flex-shrink-0 whitespace-nowrap bg-gradient-to-r from-jewelry-gold to-jewelry-gold-light text-white hover:from-jewelry-gold-dark hover:to-jewelry-gold shadow-sm hover:shadow-md transition-all duration-200"
                          title={currentLanguage === 'en' ? 'Quick Receipt' : '快捷收料'}
                        >
                          📦 {t('chat.receipt')}
                        </button>
                        <button
                          onClick={openQuickWithdrawalModal}
                          className="px-4 py-3 rounded-2xl h-[52px] flex items-center font-medium text-[15px] flex-shrink-0 whitespace-nowrap border-2 border-jewelry-navy text-jewelry-navy hover:bg-jewelry-navy hover:text-white transition-all duration-200"
                          title={currentLanguage === 'en' ? 'Quick Withdrawal' : '快捷提料'}
                        >
                          ⬆️ {t('chat.withdrawal')}
                        </button>
                      </>
                    )}
                  </div>

                  <div className="flex-1 relative">
                    {pendingAttachment && (
                      <div className="flex items-center gap-2 px-3 py-2 mb-2 bg-gray-50 border border-gray-200 rounded-xl">
                        <img
                          src={pendingAttachment.previewUrl}
                          alt="待发送"
                          className="w-16 h-16 object-cover rounded-lg border border-gray-300"
                        />
                        <div className="flex-1 text-sm text-gray-600">
                          📎 已附带收款凭证，请在下方输入文字说明后发送
                        </div>
                        <button
                          onClick={clearPendingAttachment}
                          className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                          title="移除附件"
                        >
                          ✕
                        </button>
                      </div>
                    )}
                    {showMention && (
                      <div ref={mentionPopupRef}>
                        <MentionPopup
                          filter={mentionFilter}
                          onSelect={handleSelectMentionRole}
                          selectedIndex={mentionIdx}
                        />
                      </div>
                    )}
                    <textarea
                      ref={chatTextareaRef}
                      value={input}
                      onChange={handleMentionInputChange}
                      onKeyDown={handleChatKeyDown}
                      placeholder={t('chat.inputPlaceholder')}
                      rows={1}
                      className="w-full px-3 md:px-5 py-2 md:py-4 border-2 border-gray-200 rounded-2xl 
                             focus:outline-none focus:border-jewelry-gold focus:ring-4 focus:ring-jewelry-gold/10
                             resize-none min-h-[36px] md:min-h-[52px] max-h-[200px] overflow-y-auto
                             text-[14px] md:text-[15px] bg-white transition-all duration-200"
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
                    disabled={loading || uploading || (!input.trim() && !pendingAttachment)}
                    className={`
                      px-3 md:px-6 py-2 md:py-3 rounded-2xl font-medium text-[13px] md:text-[15px] h-[36px] md:h-[52px] flex-shrink-0
                      transition-all duration-200 shadow-sm hover:shadow-md
                      ${loading || uploading || (!input.trim() && !pendingAttachment)
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

          {/* 收款凭证确认弹窗 */}
          {showPaymentProofModal && paymentProofData && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
                <div className="bg-gradient-to-r from-green-500 to-emerald-500 px-6 py-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-white font-semibold text-lg flex items-center gap-2">
                      <span>💳</span> 确认收款信息
                    </h3>
                    <button onClick={() => setShowPaymentProofModal(false)} className="text-white/80 hover:text-white text-2xl">&times;</button>
                  </div>
                  <p className="text-green-100 text-sm mt-1">以下信息由 AI 从转账截图中自动识别，请核对后确认</p>
                </div>

                <div className="p-6 space-y-4">
                  {paymentProofImage && (
                    <div className="mb-4">
                      <p className="text-xs text-gray-500 mb-2">原始截图</p>
                      <img src={paymentProofImage} alt="转账截图" className="w-full max-h-48 object-contain rounded-lg border border-gray-200 bg-gray-50" />
                    </div>
                  )}

                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-600 mb-1">客户名称（付款人）</label>
                      <input
                        type="text"
                        defaultValue={paymentProofData.payer_name || ''}
                        id="proof-customer-name"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                        placeholder="请输入客户名称"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-600 mb-1">收款金额</label>
                        <input
                          type="number"
                          defaultValue={paymentProofData.amount || ''}
                          id="proof-amount"
                          step="0.01"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                          placeholder="金额"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-600 mb-1">银行</label>
                        <input
                          type="text"
                          defaultValue={paymentProofData.bank_name || ''}
                          id="proof-bank-name"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                          placeholder="银行名称"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-600 mb-1">流水号/交易号</label>
                      <input
                        type="text"
                        defaultValue={paymentProofData.transfer_no || ''}
                        id="proof-transfer-no"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                        placeholder="流水号（可选）"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-600 mb-1">备注</label>
                      <input
                        type="text"
                        defaultValue={paymentProofData.remark || ''}
                        id="proof-remark"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                        placeholder="备注（可选）"
                      />
                    </div>
                    {paymentProofData.confidence && (
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-gray-500">识别信心：</span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          paymentProofData.confidence === 'high' ? 'bg-green-100 text-green-700' :
                          paymentProofData.confidence === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                          'bg-red-100 text-red-700'
                        }`}>
                          {paymentProofData.confidence === 'high' ? '高' : paymentProofData.confidence === 'medium' ? '中' : '低'}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="px-6 py-4 bg-gray-50 border-t flex justify-end gap-3">
                  <button
                    onClick={() => setShowPaymentProofModal(false)}
                    className="px-5 py-2.5 border border-gray-300 rounded-lg text-gray-700 hover:bg-white transition-colors font-medium"
                  >
                    取消
                  </button>
                  <button
                    onClick={() => {
                      const customerName = document.getElementById('proof-customer-name')?.value?.trim()
                      const amount = parseFloat(document.getElementById('proof-amount')?.value)
                      if (!customerName) { alert('请填写客户名称'); return }
                      if (!amount || amount <= 0) { alert('请填写有效金额'); return }
                      handleConfirmPaymentProof({
                        customer_name: customerName,
                        amount: amount,
                        payment_method: 'bank_transfer',
                        bank_name: document.getElementById('proof-bank-name')?.value?.trim() || null,
                        transfer_no: document.getElementById('proof-transfer-no')?.value?.trim() || null,
                        remark: document.getElementById('proof-remark')?.value?.trim() || '转账截图收款',
                      })
                    }}
                    className="px-6 py-2.5 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors font-medium shadow-sm"
                  >
                    确认登记收款
                  </button>
                </div>
              </div>
            </div>
          )}
          </>
  )
}

export default ChatView
