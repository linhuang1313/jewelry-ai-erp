import React, { useState, useEffect } from 'react'
import { API_ENDPOINTS } from '../config'
import { Search, Plus, Edit2, Trash2, X, Building2, Phone, MapPin, User, RefreshCw } from 'lucide-react'

/**
 * 供应商管理页面
 * - 管理层：可添加、编辑、删除
 * - 商品专员：可添加、编辑，不可删除
 */
export function SupplierPage({ userRole = 'manager' }) {
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(false)
  const [searchKeyword, setSearchKeyword] = useState('')
  
  // 弹窗状态
  const [showModal, setShowModal] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState(null)
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    address: '',
    contact_person: ''
  })
  const [submitting, setSubmitting] = useState(false)

  // 权限检查
  const canDelete = userRole === 'manager'
  const canEdit = userRole === 'manager' || userRole === 'product'

  // 获取供应商列表
  const fetchSuppliers = async () => {
    setLoading(true)
    try {
      const url = searchKeyword 
        ? `${API_ENDPOINTS.API_BASE_URL}/api/suppliers?keyword=${encodeURIComponent(searchKeyword)}`
        : `${API_ENDPOINTS.API_BASE_URL}/api/suppliers`
      const response = await fetch(url)
      const data = await response.json()
      if (data.success) {
        setSuppliers(data.suppliers || [])
      }
    } catch (error) {
      console.error('获取供应商列表失败:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSuppliers()
  }, [])

  // 搜索
  const handleSearch = () => {
    fetchSuppliers()
  }

  // 打开添加弹窗
  const openAddModal = () => {
    setEditingSupplier(null)
    setFormData({
      name: '',
      phone: '',
      address: '',
      contact_person: ''
    })
    setShowModal(true)
  }

  // 打开编辑弹窗
  const openEditModal = (supplier) => {
    setEditingSupplier(supplier)
    setFormData({
      name: supplier.name || '',
      phone: supplier.phone || '',
      address: supplier.address || '',
      contact_person: supplier.contact_person || ''
    })
    setShowModal(true)
  }

  // 提交表单
  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!formData.name.trim()) {
      alert('请输入供应商姓名')
      return
    }

    setSubmitting(true)
    try {
      const url = editingSupplier
        ? `${API_ENDPOINTS.API_BASE_URL}/api/suppliers/${editingSupplier.id}`
        : `${API_ENDPOINTS.API_BASE_URL}/api/suppliers`
      
      const response = await fetch(url, {
        method: editingSupplier ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      })
      
      const data = await response.json()
      if (data.success) {
        setShowModal(false)
        fetchSuppliers()
      } else {
        alert(data.message || '操作失败')
      }
    } catch (error) {
      console.error('提交失败:', error)
      alert('操作失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  // 删除供应商
  const handleDelete = async (supplier) => {
    if (!confirm(`确定要删除供应商【${supplier.name}】吗？`)) {
      return
    }

    try {
      const response = await fetch(
        `${API_ENDPOINTS.API_BASE_URL}/api/suppliers/${supplier.id}`,
        { method: 'DELETE' }
      )
      const data = await response.json()
      if (data.success) {
        fetchSuppliers()
      } else {
        alert(data.message || '删除失败')
      }
    } catch (error) {
      console.error('删除失败:', error)
      alert('删除失败，请重试')
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* 页面标题 */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900 flex items-center">
          <Building2 className="w-7 h-7 mr-3 text-amber-600" />
          供应商管理
        </h1>
        <p className="text-gray-500 mt-1">管理供应商信息，支持添加、编辑{canDelete ? '、删除' : ''}操作</p>
      </div>

      {/* 搜索和操作栏 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
        <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-80">
              <input
                type="text"
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="搜索供应商姓名、联系人、电话..."
                className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              />
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            </div>
            <button
              onClick={handleSearch}
              className="px-4 py-2.5 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition-colors"
            >
              搜索
            </button>
            <button
              onClick={fetchSuppliers}
              disabled={loading}
              className="p-2.5 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
          
          {canEdit && (
            <button
              onClick={openAddModal}
              className="flex items-center gap-2 px-5 py-2.5 bg-amber-600 text-white rounded-xl hover:bg-amber-700 transition-colors font-medium"
            >
              <Plus className="w-4 h-4" />
              添加供应商
            </button>
          )}
        </div>
      </div>

      {/* 供应商列表 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">供应商姓名</th>
              <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">地址</th>
              <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">电话</th>
              <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">联系人</th>
              <th className="px-6 py-4 text-center text-sm font-semibold text-gray-900">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan="5" className="px-6 py-12 text-center text-gray-400">
                  <RefreshCw className="w-6 h-6 mx-auto mb-2 animate-spin" />
                  加载中...
                </td>
              </tr>
            ) : suppliers.length === 0 ? (
              <tr>
                <td colSpan="5" className="px-6 py-12 text-center text-gray-400">
                  <Building2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>暂无供应商数据</p>
                  {canEdit && (
                    <button
                      onClick={openAddModal}
                      className="mt-3 text-amber-600 hover:text-amber-700"
                    >
                      + 添加第一个供应商
                    </button>
                  )}
                </td>
              </tr>
            ) : (
              suppliers.map((supplier) => (
                <tr key={supplier.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center">
                      <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center mr-3">
                        <Building2 className="w-5 h-5 text-amber-600" />
                      </div>
                      <div>
                        <div className="font-medium text-gray-900">{supplier.name}</div>
                        <div className="text-xs text-gray-400">{supplier.supplier_no}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center text-gray-600">
                      <MapPin className="w-4 h-4 mr-1.5 text-gray-400" />
                      {supplier.address || '-'}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center text-gray-600">
                      <Phone className="w-4 h-4 mr-1.5 text-gray-400" />
                      {supplier.phone || '-'}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center text-gray-600">
                      <User className="w-4 h-4 mr-1.5 text-gray-400" />
                      {supplier.contact_person || '-'}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-center gap-2">
                      {canEdit && (
                        <button
                          onClick={() => openEditModal(supplier)}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="编辑"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                      )}
                      {canDelete && (
                        <button
                          onClick={() => handleDelete(supplier)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="删除"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        
        {/* 底部统计 */}
        {suppliers.length > 0 && (
          <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 text-sm text-gray-500">
            共 {suppliers.length} 个供应商
          </div>
        )}
      </div>

      {/* 添加/编辑弹窗 */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div 
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={() => setShowModal(false)}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 animate-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">
                {editingSupplier ? '编辑供应商' : '添加供应商'}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  供应商姓名 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="请输入供应商姓名"
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  地址
                </label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  placeholder="请输入地址"
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  电话
                </label>
                <input
                  type="text"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="请输入电话"
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  联系人
                </label>
                <input
                  type="text"
                  value={formData.contact_person}
                  onChange={(e) => setFormData({ ...formData, contact_person: e.target.value })}
                  placeholder="请输入联系人"
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                />
              </div>
              
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 px-4 py-2.5 bg-amber-600 text-white rounded-xl hover:bg-amber-700 transition-colors disabled:opacity-50"
                >
                  {submitting ? '保存中...' : '保存'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default SupplierPage

