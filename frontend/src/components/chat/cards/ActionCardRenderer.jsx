import React, { useState, lazy, Suspense } from 'react'
import { API_BASE_URL } from '../../../config'
import { hasPermission } from '../../../config/permissions'
import { apiPost } from '../../../utils/api'

const ReceiptPreview = lazy(() => import('../../finance/ReceiptPreview'))

const ROLE_LABELS = {
  finance: '财务',
  settlement: '结算',
  product: '商品部',
  counter: '柜台',
  sales: '业务员',
  material: '料部',
  manager: '经理',
}

const STATUS_STYLES = {
  pending: { bg: 'bg-amber-100', text: 'text-amber-700', label: '进行中' },
  completed: { bg: 'bg-green-100', text: 'text-green-700', label: '已完成' },
  rejected: { bg: 'bg-red-100', text: 'text-red-700', label: '已拒绝' },
}

const CARD_TYPE_CONFIG = {
  payment_confirm: {
    icon: '💰',
    title: '收款确认单',
    gradient: 'from-amber-500 to-yellow-500',
    border: 'border-amber-200',
  },
  settlement_confirm: {
    icon: '📋',
    title: '结算确认单',
    gradient: 'from-blue-500 to-indigo-500',
    border: 'border-blue-200',
  },
  withdrawal_confirm: {
    icon: '⚖️',
    title: '提料确认单',
    gradient: 'from-purple-500 to-violet-500',
    border: 'border-purple-200',
  },
}

export const ActionCardRenderer = ({ card, userRole, onCardUpdate }) => {
  const [executing, setExecuting] = useState(false)
  const [comment, setComment] = useState('')
  const [showCommentInput, setShowCommentInput] = useState(false)
  const [showReceipt, setShowReceipt] = useState(false)

  const config = CARD_TYPE_CONFIG[card.card_type] || {
    icon: '📋',
    title: '协同任务',
    gradient: 'from-blue-500 to-indigo-500',
    border: 'border-blue-200',
  }

  const statusStyle = STATUS_STYLES[card.status] || STATUS_STYLES.pending
  const canExecute = (card.target_roles || []).includes(userRole) && card.status === 'pending'
  const hasActed = (card.actions_taken || []).some(a => a.role === userRole)
  const payload = card.data || card.payload || {}

  const handleExecute = async (action) => {
    if (executing) return
    setExecuting(true)
    try {
      const result = await apiPost(
        `/api/action-cards/${card.card_id}/execute`,
        { action, comment: comment || null },
        { showSuccessToast: true, showErrorToast: true }
      )
      if (result && action === 'confirm' && card.card_type === 'withdrawal_confirm') {
        const wdId = result.card?.business_result?.withdrawal_id || payload.withdrawal_id
        if (wdId) {
          window.open(`${API_BASE_URL}/api/gold-material/withdrawals/${wdId}/download?format=html`, '_blank')
        }
      }
      if (result && onCardUpdate) {
        onCardUpdate(result.card || { ...card, status: result.status })
      }
    } finally {
      setExecuting(false)
      setShowCommentInput(false)
      setComment('')
    }
  }

  const confirmedRoles = (card.actions_taken || [])
    .filter(a => a.action === 'confirm')
    .map(a => a.role)

  const rejectedAction = (card.actions_taken || []).find(a => a.action === 'reject')

  return (
    <div className="flex justify-start">
      <div className={`bg-white rounded-2xl shadow-lg border ${config.border} max-w-lg w-full overflow-hidden`}>
        {/* 标题栏 */}
        <div className={`bg-gradient-to-r ${config.gradient} px-5 py-3 flex items-center justify-between`}>
          <div className="flex items-center gap-2 text-white">
            <span className="text-lg">{config.icon}</span>
            <span className="font-semibold">{config.title}</span>
            <span className="text-white/80 text-sm">{card.card_id}</span>
          </div>
          <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusStyle.bg} ${statusStyle.text}`}>
            {statusStyle.label}
          </span>
        </div>

        {/* 内容 */}
        <div className="p-5 space-y-4">
          {/* 客户信息 */}
          {payload.customer_name && (
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
                <span className="text-amber-600 font-bold text-lg">
                  {payload.customer_name.charAt(0)}
                </span>
              </div>
              <div>
                <div className="font-semibold text-gray-900">{payload.customer_name}</div>
                {payload.sales_order_no && (
                  <div className="text-sm text-gray-500">销售单: {payload.sales_order_no}</div>
                )}
                {payload.settlement_no && (
                  <div className="text-sm text-gray-500">结算单: {payload.settlement_no}</div>
                )}
              </div>
            </div>
          )}

          {/* 卡片详情 - 按类型渲染 */}
          {card.card_type === 'payment_confirm' && (
            <>
              <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">总金额</span>
                  <span className="font-bold text-amber-600 text-lg">
                    ¥{Number(payload.total_amount || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
                  </span>
                </div>
                {payload.gold_amount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">├─ 金款</span>
                    <span className="font-medium text-gray-900">
                      ¥{Number(payload.gold_amount).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
                {payload.labor_amount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">└─ 工费</span>
                    <span className="font-medium text-gray-900">
                      ¥{Number(payload.labor_amount).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
              </div>

              {payload.image_url && payload.ocr_verified && (
                <div className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-green-50 text-green-700">
                  <span>✅</span>
                  <span>凭证已核验，截图金额与口述金额一致</span>
                </div>
              )}

              {payload.image_url && (
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <img
                    src={payload.image_url.startsWith('data:') ? payload.image_url : `${API_BASE_URL}${payload.image_url}`}
                    alt="转账截图"
                    className="w-full max-h-48 object-contain bg-gray-50"
                  />
                </div>
              )}
            </>
          )}

          {card.card_type === 'settlement_confirm' && (
            <div className="bg-gray-50 rounded-xl p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">结算方式</span>
                <span className="font-bold text-blue-600">
                  {payload.payment_method === '结价' || payload.payment_method === 'cash_price' ? '结价' : '结料'}
                </span>
              </div>
              {(payload.gold_weight > 0) && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">克重</span>
                  <span className="font-medium text-gray-900">{Number(payload.gold_weight).toFixed(2)}克</span>
                </div>
              )}
              {(payload.gold_price > 0) && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">金价</span>
                  <span className="font-medium text-gray-900">¥{Number(payload.gold_price).toFixed(0)}/克</span>
                </div>
              )}
            </div>
          )}

          {card.card_type === 'withdrawal_confirm' && (
            <div className="bg-gray-50 rounded-xl p-4 space-y-2">
              {payload.withdrawal_no && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">提料单号</span>
                  <span className="font-medium text-gray-900">{payload.withdrawal_no}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">提料克重</span>
                <span className="font-bold text-purple-600 text-lg">
                  {Number(payload.gold_weight || 0).toFixed(3)}克
                </span>
              </div>
              {payload.current_balance !== undefined && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">当前存料</span>
                  <span className="font-medium text-gray-900">{Number(payload.current_balance).toFixed(3)}克</span>
                </div>
              )}
              {payload.balance_after !== undefined && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">确认后余额</span>
                  <span className="font-medium text-green-600">{Number(payload.balance_after).toFixed(3)}克</span>
                </div>
              )}
            </div>
          )}

          {/* 审批进度 */}
          <div className="border-t border-gray-100 pt-3">
            <div className="text-sm font-medium text-gray-700 mb-2">📋 审批进度</div>
            <div className="space-y-2">
              {(card.target_roles || []).map(role => {
                const action = (card.actions_taken || []).find(a => a.role === role)
                const isConfirmed = action?.action === 'confirm'
                const isRejected = action?.action === 'reject'
                return (
                  <div key={role} className="flex items-center gap-3 text-sm">
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${
                      isConfirmed ? 'bg-green-500 text-white' :
                      isRejected ? 'bg-red-500 text-white' :
                      'bg-gray-200 text-gray-500'
                    }`}>
                      {isConfirmed ? '✓' : isRejected ? '✗' : '○'}
                    </span>
                    <span className="text-gray-700 font-medium w-16">
                      {ROLE_LABELS[role] || role}
                    </span>
                    <span className="text-gray-400 flex-1 border-b border-dotted border-gray-200" />
                    <span className={`${
                      isConfirmed ? 'text-green-600' :
                      isRejected ? 'text-red-600' :
                      'text-gray-400'
                    }`}>
                      {isConfirmed ? `已确认 ${action.time ? new Date(action.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : ''}` :
                       isRejected ? `已拒绝` :
                       card.status === 'rejected' ? '── 已终止' :
                       '⏳ 等待中'}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* 拒绝原因 */}
          {rejectedAction?.comment && (
            <div className="bg-red-50 rounded-lg p-3 text-sm text-red-700">
              <span className="font-medium">拒绝原因：</span>{rejectedAction.comment}
            </div>
          )}

          {/* 完成消息 + 收据/凭证 */}
          {card.status === 'completed' && card.business_result?.summary && (
            <div className="bg-green-50 rounded-lg p-3 text-sm text-green-700 space-y-2">
              <div>✅ {card.business_result.summary}</div>

              {card.business_result?.detail && (
                <div className="text-xs text-green-600">{card.business_result.detail}</div>
              )}

              {/* FBL 凭证信息 (payment_confirm) */}
              {card.business_result?.fbl_voucher?.success && (
                <div className="bg-white/70 border border-green-200 rounded-lg px-3 py-2 text-xs text-green-800 space-y-1">
                  <div className="font-medium">📄 收款凭证已自动生成</div>
                  <div className="flex justify-between">
                    <span>凭证号：{card.business_result.fbl_voucher.voucher_code}</span>
                    <span>类别：{card.business_result.fbl_voucher.voucher_type}</span>
                  </div>
                  <div className="text-green-600">
                    借：{card.business_result.fbl_voucher.debit_account} ¥{Number(card.business_result.fbl_voucher.amount).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
                  </div>
                  <div className="text-green-600">
                    贷：{card.business_result.fbl_voucher.credit_account} ¥{Number(card.business_result.fbl_voucher.amount).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
                    {card.business_result.fbl_voucher.partner_name && (
                      <span className="ml-1 text-green-500">（{card.business_result.fbl_voucher.partner_name}）</span>
                    )}
                  </div>
                </div>
              )}

              {card.business_result?.fbl_voucher && !card.business_result.fbl_voucher.success && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
                  ⚠️ 凭证未自动生成：{card.business_result.fbl_voucher.message || '请手动在凭证管理中补录'}
                </div>
              )}

              {/* 结算单编号 (settlement_confirm) */}
              {card.business_result?.settlement_no && (
                <div className="bg-white/70 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-800">
                  <span className="font-medium">📋 结算单号：</span>{card.business_result.settlement_no}
                  {card.business_result?.sales_order_no && (
                    <span className="ml-2">| 销售单：{card.business_result.sales_order_no}</span>
                  )}
                </div>
              )}

              {/* 提料单信息 (withdrawal_confirm) */}
              {card.business_result?.balance_after !== undefined && (
                <div className="bg-white/70 border border-purple-200 rounded-lg px-3 py-2 text-xs text-purple-800 space-y-1">
                  {card.business_result?.withdrawal_no && (
                    <div className="font-medium">📋 提料单号：{card.business_result.withdrawal_no}</div>
                  )}
                  <div>⚖️ 存料余额：{Number(card.business_result.balance_after).toFixed(3)}克</div>
                  {card.business_result?.withdrawal_id && (
                    <a
                      href={`${API_BASE_URL}/api/gold-material/withdrawals/${card.business_result.withdrawal_id}/download?format=html`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2 py-1 bg-purple-100 text-purple-700 rounded text-xs font-medium hover:bg-purple-200 transition-colors mt-1"
                    >
                      🖨️ 打印提料单
                    </a>
                  )}
                </div>
              )}

              {/* 收据按钮 (payment_confirm) */}
              {card.business_result?.payment_no && (
                <button
                  onClick={() => setShowReceipt(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-green-300 text-green-700 rounded-lg text-xs font-medium hover:bg-green-50 transition-colors"
                >
                  🧾 查看收据
                </button>
              )}
            </div>
          )}

          {/* 备注输入 */}
          {showCommentInput && (
            <div className="space-y-2">
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="添加备注（可选）..."
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 resize-none"
                rows={2}
              />
            </div>
          )}

          {/* 操作按钮 */}
          {card.status === 'pending' && (
            <div className="flex gap-3 pt-1">
              {canExecute && !hasActed ? (
                <>
                  <button
                    onClick={() => handleExecute('confirm')}
                    disabled={executing}
                    className="flex-1 px-4 py-2.5 bg-gradient-to-r from-green-500 to-emerald-500 text-white font-medium rounded-lg shadow-sm hover:from-green-600 hover:to-emerald-600 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {executing ? '处理中...' : card.card_type === 'withdrawal_confirm' ? '✅ 确认并打印' : `✅ ${ROLE_LABELS[userRole] || userRole}已确认`}
                  </button>
                  <button
                    onClick={() => {
                      if (showCommentInput) {
                        handleExecute('reject')
                      } else {
                        setShowCommentInput(true)
                      }
                    }}
                    disabled={executing}
                    className="px-4 py-2.5 border border-red-300 text-red-600 font-medium rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    ❌ 拒绝
                  </button>
                </>
              ) : hasActed ? (
                <div className="w-full text-center text-sm text-green-600 py-2">
                  ✅ 你已确认此卡片
                </div>
              ) : (
                <div className="w-full text-center text-sm text-gray-400 py-2">
                  等待 {(card.target_roles || []).map(r => ROLE_LABELS[r] || r).join('、')} 确认
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 收据预览弹窗 */}
      {showReceipt && card.business_result?.payment_no && (
        <Suspense fallback={null}>
          <ReceiptPreview
            paymentNo={card.business_result.payment_no}
            onClose={() => setShowReceipt(false)}
          />
        </Suspense>
      )}
    </div>
  )
}

export default ActionCardRenderer
