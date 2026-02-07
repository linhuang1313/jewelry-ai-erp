import React from 'react'

export const PaymentConfirmCard = ({ msg, setMessages }) => {
  const pd = msg.paymentData
  return (
    <div className="flex justify-start">
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
        
        {/* 内容 */}
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
                  const { confirmPayment } = await import('../../../services/financeService')
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
                  console.error('Receipt registration failed:', error)
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

export default PaymentConfirmCard
