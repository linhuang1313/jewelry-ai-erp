/**
 * 快捷提料弹窗（从 App.jsx 抽离）
 */
import React from 'react'

export const InlineQuickWithdrawalModal = ({
  showQuickWithdrawalModal,
  setShowQuickWithdrawalModal,
  quickWithdrawalForm,
  setQuickWithdrawalForm,
  quickFormCustomerSearch,
  setQuickFormCustomerSearch,
  quickFormCustomers,
  filteredQuickFormCustomers,
  selectedCustomerDeposit,
  depositLoading,
  fetchCustomerDeposit,
  handleQuickWithdrawal,
}) => {
  if (!showQuickWithdrawalModal) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl p-6 max-w-lg w-full mx-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold flex items-center">
            <span className="text-xl mr-2">⬆️</span>
            快捷提料
          </h3>
          <button onClick={() => setShowQuickWithdrawalModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>
        <form onSubmit={handleQuickWithdrawal} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">选择客户</label>
            <input
              type="text"
              placeholder="搜索客户姓名或电话..."
              value={quickFormCustomerSearch}
              onChange={(e) => {
                setQuickFormCustomerSearch(e.target.value)
                if (quickWithdrawalForm.customer_id) setQuickWithdrawalForm(prev => ({ ...prev, customer_id: '' }))
              }}
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2"
            />
            {!quickWithdrawalForm.customer_id && (
            <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg">
              {filteredQuickFormCustomers.length === 0 ? (
                <div className="p-3 text-center text-gray-500 text-sm">暂无匹配客户</div>
              ) : (
                filteredQuickFormCustomers.slice(0, 10).map(customer => (
                  <div
                    key={customer.id}
                    onClick={() => {
                      setQuickWithdrawalForm({ ...quickWithdrawalForm, customer_id: customer.id.toString() })
                      setQuickFormCustomerSearch(customer.name)
                      fetchCustomerDeposit(customer.id.toString())
                    }}
                    className="p-3 cursor-pointer hover:bg-blue-50 border-b last:border-b-0 flex justify-between items-center"
                  >
                    <span className="font-medium">{customer.name}</span>
                    <span className="text-sm text-gray-500">{customer.phone || '-'}</span>
                  </div>
                ))
              )}
            </div>
            )}
            {quickWithdrawalForm.customer_id && (
              <div className="mt-2 text-sm text-green-600 flex items-center gap-2">
                已选择：{quickFormCustomers.find(c => c.id.toString() === quickWithdrawalForm.customer_id)?.name}
                <button type="button" onClick={() => { setQuickWithdrawalForm(prev => ({ ...prev, customer_id: '' })); setQuickFormCustomerSearch('') }} className="text-amber-600 hover:underline">重选</button>
              </div>
            )}
          </div>
          {/* 存料余额显示 */}
          {quickWithdrawalForm.customer_id && (
            <div className={`p-4 rounded-lg ${depositLoading ? 'bg-gray-100' :
              (selectedCustomerDeposit?.current_balance || 0) > 0 ? 'bg-blue-50 border border-blue-200' : 'bg-red-50 border border-red-200'
              }`}>
              {depositLoading ? (
                <div className="text-center text-gray-500">查询中...</div>
              ) : (
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">当前存料余额</span>
                  <span className={`text-xl font-bold ${(selectedCustomerDeposit?.current_balance || 0) > 0 ? 'text-blue-600' : 'text-red-600'}`}>
                    {selectedCustomerDeposit?.current_balance?.toFixed(2) || '0.00'} 克
                  </span>
                </div>
              )}
              {!depositLoading && (selectedCustomerDeposit?.current_balance || 0) === 0 && (
                <div className="mt-2 text-xs text-red-600">⚠️ 该客户暂无存料，无法提料</div>
              )}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">提料克重 (克)</label>
            <input
              type="number"
              step="0.01"
              value={quickWithdrawalForm.gold_weight}
              onChange={(e) => setQuickWithdrawalForm({ ...quickWithdrawalForm, gold_weight: e.target.value })}
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="输入提料克重"
              max={selectedCustomerDeposit?.current_balance || 0}
              required
            />
            {quickWithdrawalForm.gold_weight && parseFloat(quickWithdrawalForm.gold_weight) > (selectedCustomerDeposit?.current_balance || 0) && (
              <div className="mt-1 text-xs text-red-600">⚠️ 提料克重不能超过存料余额</div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">备注（可选）</label>
            <textarea
              value={quickWithdrawalForm.remark}
              onChange={(e) => setQuickWithdrawalForm({ ...quickWithdrawalForm, remark: e.target.value })}
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={2}
              placeholder="客户提料 / 其他说明"
            />
          </div>
          <div className="flex space-x-3 pt-4">
            <button type="button" onClick={() => setShowQuickWithdrawalModal(false)} className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">取消</button>
            <button
              type="submit"
              disabled={!quickWithdrawalForm.customer_id ||
                !quickWithdrawalForm.gold_weight ||
                parseFloat(quickWithdrawalForm.gold_weight) <= 0 ||
                parseFloat(quickWithdrawalForm.gold_weight) > (selectedCustomerDeposit?.current_balance || 0)}
              className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              确认并打单
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default InlineQuickWithdrawalModal
