/**
 * 快捷收料弹窗组件
 */
import React, { useState, useEffect, useCallback } from 'react'
import { API_BASE_URL } from '../../config'
import AsyncSearchSelect from '../ui/AsyncSearchSelect'

export const QuickReceiptModal = ({
  isOpen,
  onClose,
  onSuccess,
  showToast
}) => {
  const [selectedCustomerName, setSelectedCustomerName] = useState('')
  const [form, setForm] = useState({
    customer_id: '',
    gold_weight: '',
    gold_fineness: '足金999',
    remark: ''
  })

  useEffect(() => {
    if (isOpen) {
      setForm({ customer_id: '', gold_weight: '', gold_fineness: '足金999', remark: '' })
      setSelectedCustomerName('')
    }
  }, [isOpen])

  const fetchCustomers = useCallback(async (search) => {
    const url = search
      ? `${API_BASE_URL}/api/customers?name=${encodeURIComponent(search)}&page_size=50`
      : `${API_BASE_URL}/api/customers?page_size=50`
    const response = await fetch(url, {
      headers: { 'X-User-Role': localStorage.getItem('userRole') || 'sales' }
    })
    const data = await response.json()
    const customers = data.data?.customers || data.customers || []
    return customers.map((c) => ({
      value: c.id,
      label: c.name,
      sublabel: c.phone || undefined,
    }))
  }, [])

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
      const userRole = localStorage.getItem('userRole') || 'sales'
      const params = new URLSearchParams({
        customer_id: form.customer_id,
        gold_weight: form.gold_weight,
        gold_fineness: form.gold_fineness,
        remark: form.remark || '快捷收料',
        created_by: '结算专员',
        user_role: userRole
      })
      const response = await fetch(`${API_BASE_URL}/api/gold-material/gold-receipts?${params}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Role': userRole
        }
      })
      
      if (response.ok) {
        const result = await response.json()
        const customerName = selectedCustomerName || '未知客户'
        
        onClose()
        onSuccess?.({
          ...result.data,
          customer_name: customerName,
          gold_weight: parseFloat(form.gold_weight),
          gold_fineness: form.gold_fineness,
          remark: form.remark
        })
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
            <AsyncSearchSelect
              value={form.customer_id ? parseInt(form.customer_id) : null}
              onChange={(value, option) => {
                setForm({ ...form, customer_id: value ? value.toString() : '' })
                setSelectedCustomerName(option?.label || '')
              }}
              fetchOptions={fetchCustomers}
              placeholder="搜索客户姓名或电话..."
            />
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
              <option value="板料">板料</option>
              <option value="旧料">旧料</option>
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
              创建收料单
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default QuickReceiptModal
