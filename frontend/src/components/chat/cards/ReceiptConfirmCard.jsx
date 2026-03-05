import React from 'react'

export const ReceiptConfirmCard = ({ msg, setMessages, API_BASE_URL }) => {
  const rd = msg.receiptData
  return (
    <div className="flex justify-start">
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
        
        {/* 内容 */}
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
                        ? { ...m, type: 'system', content: `✅ 收料单创建成功！\n\n单号：${result.data.receipt_no}\n客户：${rd.customer.name}\n克重：${rd.gold_weight.toFixed(2)}克\n成色：${rd.gold_fineness}\n\n请到金料管理确认生效` }
                        : m
                    ))
                  } else {
                    const error = await response.json()
                    alert('收料单创建失败：' + (error.detail || '未知错误'))
                  }
                } catch (error) {
                  console.error('Receipt order creation failed:', error)
                  alert('收料单创建失败：' + error.message)
                }
              }}
              className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-white font-medium py-2.5 px-4 rounded-xl transition-colors"
            >
              创建收料单
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

export default ReceiptConfirmCard
