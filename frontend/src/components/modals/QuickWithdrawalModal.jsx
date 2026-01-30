/**
 * 快捷提料弹窗组件
 */
import React, { useState, useEffect } from 'react'
import { API_BASE_URL } from '../../config'

export const QuickWithdrawalModal = ({
  isOpen,
  onClose,
  onSuccess,
  userRole,
  showToast
}) => {
  const [customers, setCustomers] = useState([])
  const [customerSearch, setCustomerSearch] = useState('')
  const [selectedCustomerDeposit, setSelectedCustomerDeposit] = useState(null)
  const [depositLoading, setDepositLoading] = useState(false)
  const [form, setForm] = useState({
    customer_id: '',
    gold_weight: '',
    remark: ''
  })

  // 加载客户列表
  useEffect(() => {
    if (isOpen) {
      loadCustomers()
      setForm({ customer_id: '', gold_weight: '', remark: '' })
      setCustomerSearch('')
      setSelectedCustomerDeposit(null)
    }
  }, [isOpen])

  const loadCustomers = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/customers`)
      if (response.ok) {
        const data = await response.json()
        const customerList = data.data?.customers || data.customers || []
        setCustomers(Array.isArray(customerList) ? customerList : [])
      }
    } catch (error) {
      console.error('加载客户列表失败:', error)
      showToast?.('加载客户列表失败')
    }
  }

  // 查询客户存料余额
  const fetchCustomerDeposit = async (customerId) => {
    if (!customerId) {
      setSelectedCustomerDeposit(null)
      return
    }
    setDepositLoading(true)
    try {
      const response = await fetch(`${API_BASE_URL}/api/gold-material/customers/${customerId}/deposit`)
      if (response.ok) {
        const result = await response.json()
        setSelectedCustomerDeposit({
          current_balance: result.deposit.current_balance,
          customer_name: result.customer_name
        })
      } else {
        setSelectedCustomerDeposit({ current_balance: 0, customer_name: '' })
      }
    } catch (error) {
      console.error('查询客户存料余额失败:', error)
      setSelectedCustomerDeposit({ current_balance: 0, customer_name: '' })
      showToast?.('查询客户余额失败')
    } finally {
      setDepositLoading(false)
    }
  }

  const filteredCustomers = customers.filter(c => {
    if (!customerSearch.trim()) return true
    const search = customerSearch.toLowerCase()
    return (c.name && c.name.toLowerCase().includes(search)) ||
           (c.phone && c.phone.includes(customerSearch))
  })

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.customer_id) {
      alert('请选择客户')
      return
    }
    const weight = parseFloat(form.gold_weight)
    if (!weight || weight <= 0) {
      alert('请输入有效的提料克重')
      return
    }
    if (weight > (selectedCustomerDeposit?.current_balance || 0)) {
      alert(`提料克重不能超过客户存料余额（${selectedCustomerDeposit?.current_balance?.toFixed(2) || 0}克）`)
      return
    }

    try {
      const params = new URLSearchParams({ user_role: userRole, created_by: '结算专员' })
      const response = await fetch(`${API_BASE_URL}/api/gold-material/withdrawals?${params}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: parseInt(form.customer_id),
          gold_weight: weight,
          withdrawal_type: 'self',
          remark: form.remark || '快捷提料'
        })
      })
      
      if (response.ok) {
        const result = await response.json()
        const customerName = customers.find(c => c.id.toString() === form.customer_id)?.name || '未知客户'
        
        onClose()
        onSuccess?.({
          ...result,
          customer_name: customerName,
          gold_weight: weight,
          remark: form.remark
        })
        
        // 自动打开打印页面
        if (result.id) {
          window.open(`${API_BASE_URL}/api/gold-material/withdrawals/${result.id}/download?format=html`, '_blank')
        }
      } else {
        const error = await response.json()
        alert('创建提料单失败：' + (error.detail || '未知错误'))
      }
    } catch (error) {
      console.error('创建提料单失败:', error)
      alert('创建提料单失败')
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl p-6 max-w-lg w-full mx-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold flex items-center">
            <span className="text-xl mr-2">⬆️</span>
            快捷提料
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">选择客户</label>
            <input
              type="text"
              placeholder="搜索客户姓名或电话..."
              value={customerSearch}
              onChange={(e) => setCustomerSearch(e.target.value)}
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2"
            />
            <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg">
              {filteredCustomers.length === 0 ? (
                <div className="p-3 text-center text-gray-500 text-sm">暂无匹配客户</div>
              ) : (
                filteredCustomers.slice(0, 10).map(customer => (
                  <div
                    key={customer.id}
                    onClick={() => {
                      setForm({ ...form, customer_id: customer.id.toString() })
                      setCustomerSearch(customer.name)
                      fetchCustomerDeposit(customer.id.toString())
                    }}
                    className={`p-3 cursor-pointer hover:bg-blue-50 border-b last:border-b-0 flex justify-between items-center ${
                      form.customer_id === customer.id.toString() ? 'bg-blue-100' : ''
                    }`}
                  >
                    <span className="font-medium">{customer.name}</span>
                    <span className="text-sm text-gray-500">{customer.phone || '-'}</span>
                  </div>
                ))
              )}
            </div>
            {form.customer_id && (
              <div className="mt-2 text-sm text-green-600">
                已选择：{customers.find(c => c.id.toString() === form.customer_id)?.name}
              </div>
            )}
          </div>
          
          {/* 存料余额显示 */}
          {form.customer_id && (
            <div className={`p-4 rounded-lg ${
              depositLoading ? 'bg-gray-100' : 
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
              value={form.gold_weight}
              onChange={(e) => setForm({ ...form, gold_weight: e.target.value })}
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="输入提料克重"
              max={selectedCustomerDeposit?.current_balance || 0}
              required
            />
            {form.gold_weight && parseFloat(form.gold_weight) > (selectedCustomerDeposit?.current_balance || 0) && (
              <div className="mt-1 text-xs text-red-600">⚠️ 提料克重不能超过存料余额</div>
            )}
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">备注（可选）</label>
            <textarea
              value={form.remark}
              onChange={(e) => setForm({ ...form, remark: e.target.value })}
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={2}
              placeholder="客户提料 / 其他说明"
            />
          </div>
          
          <div className="flex space-x-3 pt-4">
            <button 
              type="button" 
              onClick={onClose} 
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
            >
              取消
            </button>
            <button 
              type="submit" 
              disabled={!form.customer_id || 
                !form.gold_weight || 
                parseFloat(form.gold_weight) <= 0 ||
                parseFloat(form.gold_weight) > (selectedCustomerDeposit?.current_balance || 0)}
              className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              确认并打印
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default QuickWithdrawalModal
