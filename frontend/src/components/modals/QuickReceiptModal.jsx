/**
 * 快捷收料弹窗组件
 */
import React, { useState, useEffect } from 'react'
import { API_BASE_URL } from '../../config'

export const QuickReceiptModal = ({
  isOpen,
  onClose,
  onSuccess,
  showToast
}) => {
  const [customers, setCustomers] = useState([])
  const [customerSearch, setCustomerSearch] = useState('')
  const [form, setForm] = useState({
    customer_id: '',
    gold_weight: '',
    gold_fineness: '足金999',
    remark: ''
  })

  // 加载客户列表
  useEffect(() => {
    if (isOpen) {
      loadCustomers()
      setForm({ customer_id: '', gold_weight: '', gold_fineness: '足金999', remark: '' })
      setCustomerSearch('')
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
    if (!form.gold_weight || parseFloat(form.gold_weight) <= 0) {
      alert('请输入有效的收料克重')
      return
    }

    try {
      const params = new URLSearchParams({
        customer_id: form.customer_id,
        gold_weight: form.gold_weight,
        gold_fineness: form.gold_fineness,
        remark: form.remark || '快捷收料',
        created_by: '结算专员'
      })
      
      const response = await fetch(`${API_BASE_URL}/api/gold-material/gold-receipts?${params}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      
      if (response.ok) {
        const result = await response.json()
        const customerName = customers.find(c => c.id.toString() === form.customer_id)?.name || '未知客户'
        
        onClose()
        onSuccess?.({
          ...result.data,
          customer_name: customerName,
          gold_weight: parseFloat(form.gold_weight),
          gold_fineness: form.gold_fineness,
          remark: form.remark
        })
        
        // 自动打开打印页面
        if (result.data?.id) {
          window.open(`${API_BASE_URL}/api/gold-material/gold-receipts/${result.data.id}/print`, '_blank')
        }
      } else {
        const error = await response.json()
        alert('创建收料单失败：' + (error.detail || '未知错误'))
      }
    } catch (error) {
      console.error('创建收料单失败:', error)
      alert('创建收料单失败')
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl p-6 max-w-lg w-full mx-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold flex items-center">
            <span className="text-xl mr-2">📦</span>
            快捷收料
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
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500 mb-2"
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
                    }}
                    className={`p-3 cursor-pointer hover:bg-yellow-50 border-b last:border-b-0 flex justify-between items-center ${
                      form.customer_id === customer.id.toString() ? 'bg-yellow-100' : ''
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
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">收料克重 (克)</label>
            <input
              type="number"
              step="0.01"
              value={form.gold_weight}
              onChange={(e) => setForm({ ...form, gold_weight: e.target.value })}
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500"
              placeholder="输入收料克重"
              required
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">成色</label>
            <select
              value={form.gold_fineness}
              onChange={(e) => setForm({ ...form, gold_fineness: e.target.value })}
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
              value={form.remark}
              onChange={(e) => setForm({ ...form, remark: e.target.value })}
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500"
              rows={2}
              placeholder="客户存料 / 其他说明"
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
              className="flex-1 px-4 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600"
            >
              确认并打印
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default QuickReceiptModal
