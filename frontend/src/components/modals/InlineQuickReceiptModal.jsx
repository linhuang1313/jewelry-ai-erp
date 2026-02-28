/**
 * 快捷收料弹窗（从 App.jsx 抽离）
 */
import React from 'react'

export const InlineQuickReceiptModal = ({
  showQuickReceiptModal,
  setShowQuickReceiptModal,
  quickReceiptForm,
  setQuickReceiptForm,
  quickFormCustomerSearch,
  setQuickFormCustomerSearch,
  quickFormCustomers,
  filteredQuickFormCustomers,
  handleQuickReceipt,
}) => {
  if (!showQuickReceiptModal) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl p-6 max-w-lg w-full mx-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold flex items-center">
            <span className="text-xl mr-2">📦</span>
            快捷收料
          </h3>
          <button onClick={() => setShowQuickReceiptModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>
        <form onSubmit={handleQuickReceipt} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">选择客户</label>
            <input
              type="text"
              placeholder="搜索客户姓名或电话..."
              value={quickFormCustomerSearch}
              onChange={(e) => {
                setQuickFormCustomerSearch(e.target.value)
                if (quickReceiptForm.customer_id) setQuickReceiptForm(prev => ({ ...prev, customer_id: '' }))
              }}
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500 mb-2"
            />
            {!quickReceiptForm.customer_id && (
              <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg">
                {filteredQuickFormCustomers.length === 0 ? (
                  <div className="p-3 text-center text-gray-500 text-sm">暂无匹配客户</div>
                ) : (
                  filteredQuickFormCustomers.slice(0, 10).map(customer => (
                    <div
                      key={customer.id}
                      onClick={() => {
                        setQuickReceiptForm({ ...quickReceiptForm, customer_id: customer.id.toString() })
                        setQuickFormCustomerSearch(customer.name)
                      }}
                      className="p-3 cursor-pointer hover:bg-yellow-50 border-b last:border-b-0 flex justify-between items-center"
                    >
                      <span className="font-medium">{customer.name}</span>
                      <span className="text-sm text-gray-500">{customer.phone || '-'}</span>
                    </div>
                  ))
                )}
              </div>
            )}
            {quickReceiptForm.customer_id && (
              <div className="mt-2 text-sm text-green-600 flex items-center gap-2">
                已选择：{quickFormCustomers.find(c => c.id.toString() === quickReceiptForm.customer_id)?.name}
                <button type="button" onClick={() => { setQuickReceiptForm(prev => ({ ...prev, customer_id: '' })); setQuickFormCustomerSearch('') }} className="text-amber-600 hover:underline">重选</button>
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">收料克重 (克)</label>
            <input
              type="number"
              step="0.01"
              value={quickReceiptForm.gold_weight}
              onChange={(e) => setQuickReceiptForm({ ...quickReceiptForm, gold_weight: e.target.value })}
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500"
              placeholder="输入收料克重"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">成色</label>
            <select
              value={quickReceiptForm.gold_fineness}
              onChange={(e) => setQuickReceiptForm({ ...quickReceiptForm, gold_fineness: e.target.value })}
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500"
            >
              <option value="足金999">足金999</option>
              <option value="足金9999">足金9999</option>
              <option value="Au999">Au999</option>
              <option value="Au9999">Au9999</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">备注（可选）</label>
            <textarea
              value={quickReceiptForm.remark}
              onChange={(e) => setQuickReceiptForm({ ...quickReceiptForm, remark: e.target.value })}
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500"
              rows={2}
              placeholder="客户存料 / 其他说明"
            />
          </div>
          <div className="flex space-x-3 pt-4">
            <button type="button" onClick={() => setShowQuickReceiptModal(false)} className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">取消</button>
            <button type="submit" className="flex-1 px-4 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600">确认</button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default InlineQuickReceiptModal
