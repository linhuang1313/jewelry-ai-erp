import React, { useState } from 'react'

export const WithdrawalConfirmCard = ({ msg, setMessages, API_BASE_URL }) => {
  const wd = msg.withdrawalData
  const [loading, setLoading] = useState(false)

  // 确认提料单（调用 /complete 接口，扣减余额）
  const handleConfirm = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        user_role: 'settlement'
      })
      const response = await fetch(`${API_BASE_URL}/api/gold-material/withdrawals/${wd.withdrawal_id}/complete?${params}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          completed_by: '结算专员'
        })
      })
      if (response.ok) {
        // 更新消息为成功状态
        setMessages(prev => prev.map(m => 
          m.id === msg.id 
            ? { 
                ...m, 
                type: 'system', 
                content: `✅ 提料单已确认！\n\n单号：${wd.withdrawal_no}\n客户：${wd.customer?.name}\n克重：${wd.gold_weight?.toFixed(2)}克\n确认后余额：${wd.balance_after?.toFixed(2)}克`,
                withdrawalId: wd.withdrawal_id,
                withdrawalDownloadUrl: `${API_BASE_URL}/api/gold-material/withdrawals/${wd.withdrawal_id}/download?format=html`
              }
            : m
        ))
        // 打开打印页面
        window.open(`${API_BASE_URL}/api/gold-material/withdrawals/${wd.withdrawal_id}/download?format=html`, '_blank')
      } else {
        const error = await response.json()
        alert('确认提料单失败：' + (error.detail || '未知错误'))
      }
    } catch (error) {
      console.error('确认提料单失败', error)
      alert('确认提料单失败：' + error.message)
    } finally {
      setLoading(false)
    }
  }

  // 取消提料单（调用 /cancel 接口）
  const handleCancel = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        user_role: 'settlement',
        cancelled_by: '结算专员'
      })
      const response = await fetch(`${API_BASE_URL}/api/gold-material/withdrawals/${wd.withdrawal_id}/cancel?${params}`, {
        method: 'POST'
      })
      if (response.ok) {
        // 更新消息为取消状态
        setMessages(prev => prev.map(m => 
          m.id === msg.id 
            ? { ...m, type: 'system', content: `❌ 提料单已取消\n\n单号：${wd.withdrawal_no}\n客户：${wd.customer?.name}` }
            : m
        ))
      } else {
        const error = await response.json()
        alert('取消提料单失败：' + (error.detail || '未知错误'))
      }
    } catch (error) {
      console.error('取消提料单失败', error)
      alert('取消提料单失败：' + error.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex justify-start">
      <div className="bg-white rounded-2xl shadow-lg border border-blue-200 max-w-md overflow-hidden">
        {/* 标题栏 */}
        <div className="bg-gradient-to-r from-blue-500 to-indigo-500 px-5 py-3">
          <div className="flex items-center gap-2 text-white">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11l5-5m0 0l5 5m-5-5v12" />
            </svg>
            <span className="font-semibold">提料单待确认</span>
          </div>
          {wd.withdrawal_no && (
            <div className="text-blue-100 text-xs mt-1">单号：{wd.withdrawal_no}</div>
          )}
        </div>
        
        {/* 内容 */}
        <div className="p-5 space-y-4">
          {/* 客户信息 */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
              <span className="text-blue-600 font-bold text-lg">{wd.customer?.name?.charAt(0) || '客'}</span>
            </div>
            <div>
              <div className="font-semibold text-gray-900">{wd.customer?.name}</div>
              <div className="text-sm text-gray-500">{wd.customer?.phone || ''}</div>
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
              <span className="text-gray-600">确认后余额</span>
              <span className="font-medium text-green-600">{wd.balance_after?.toFixed(2)} 克</span>
            </div>
            {wd.remark && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">备注</span>
                <span className="text-gray-700">{wd.remark}</span>
              </div>
            )}
          </div>

          {/* 提示信息 */}
          <div className="text-xs text-amber-600 bg-amber-50 rounded-lg p-2">
            提料单已创建，确认后将扣减客户存料余额
          </div>
          
          {/* 操作按钮 */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={handleConfirm}
              disabled={loading}
              className="flex-1 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white font-medium py-2.5 px-4 rounded-xl transition-colors"
            >
              {loading ? '处理中...' : '确认并打印'}
            </button>
            <button
              onClick={handleCancel}
              disabled={loading}
              className="px-4 py-2.5 border border-gray-300 text-gray-600 rounded-xl hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              取消
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default WithdrawalConfirmCard
