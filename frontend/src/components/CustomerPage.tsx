import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../config';
import {
  Users, Plus, Trash2, Edit2, Check, X, RefreshCw, User,
  MapPin, Search, UserPlus
} from 'lucide-react';
import toast from 'react-hot-toast';

interface Customer {
  id: number;
  customer_no: string;
  name: string;
  phone: string | null;
  wechat: string | null;
  address: string | null;
  customer_type: string;
  total_purchase_amount: number;
  total_purchase_count: number;
  last_purchase_time: string | null;
  status: string;
  create_time: string;
  remark: string | null;
}

export const CustomerPage: React.FC = () => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchName, setSearchName] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  // 新客户表单
  const [newCustomer, setNewCustomer] = useState({
    name: '',
    address: '',
    customer_type: '个人',
    remark: ''
  });

  // 编辑客户表单
  const [editForm, setEditForm] = useState({
    name: '',
    address: '',
    remark: ''
  });

  // 获取客户列表
  const fetchCustomers = async () => {
    setLoading(true);
    try {
      const url = searchName 
        ? `${API_BASE_URL}/api/customers?name=${encodeURIComponent(searchName)}`
        : `${API_BASE_URL}/api/customers`;
      const response = await fetch(url);
      const data = await response.json();
      if (data.success) {
        setCustomers(data.customers || []);
      } else {
        toast.error(data.message || '获取客户列表失败');
      }
    } catch (error) {
      toast.error('网络错误，请检查后端服务');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCustomers();
  }, []);

  // 搜索
  const handleSearch = () => {
    fetchCustomers();
  };

  // 添加客户
  const handleAdd = async () => {
    if (!newCustomer.name.trim()) {
      toast.error('请输入客户姓名');
      return;
    }

    setAdding(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/customers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newCustomer.name.trim(),
          address: newCustomer.address.trim() || null,
          customer_type: newCustomer.customer_type,
          remark: newCustomer.remark.trim() || null
        }),
      });
      const data = await response.json();
      if (data.success) {
        toast.success(data.message || '添加成功');
        setNewCustomer({ name: '', address: '', customer_type: '个人', remark: '' });
        setShowAddForm(false);
        fetchCustomers();
      } else {
        toast.error(data.message || '添加失败');
      }
    } catch (error) {
      toast.error('网络错误');
    } finally {
      setAdding(false);
    }
  };

  // 删除客户
  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`确定要删除客户【${name}】吗？`)) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/customers/${id}`, {
        method: 'DELETE',
      });
      const data = await response.json();
      if (data.success) {
        toast.success(data.message || '删除成功');
        fetchCustomers();
      } else {
        toast.error(data.message || '删除失败');
      }
    } catch (error) {
      toast.error('网络错误');
    }
  };

  // 开始编辑
  const startEdit = (customer: Customer) => {
    setEditingId(customer.id);
    setEditForm({
      name: customer.name,
      address: customer.address || '',
      remark: customer.remark || ''
    });
  };

  // 保存编辑
  const saveEdit = async (id: number) => {
    if (!editForm.name.trim()) {
      toast.error('姓名不能为空');
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/customers/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editForm.name.trim(),
          address: editForm.address.trim() || null,
          remark: editForm.remark.trim() || null
        }),
      });
      const data = await response.json();
      if (data.success) {
        toast.success('修改成功');
        setEditingId(null);
        fetchCustomers();
      } else {
        toast.error(data.message || '修改失败');
      }
    } catch (error) {
      toast.error('网络错误');
    }
  };

  // 取消编辑
  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({ name: '', address: '', remark: '' });
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* 标题 */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-3">
          <div className="p-3 bg-blue-100 rounded-xl">
            <Users className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">客户名单管理</h1>
            <p className="text-sm text-gray-500">管理系统中的客户信息</p>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-xl
                       hover:bg-blue-700 transition-all"
          >
            <UserPlus className="w-4 h-4" />
            <span>新增客户</span>
          </button>
          <button
            onClick={fetchCustomers}
            className="flex items-center space-x-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-xl
                       hover:bg-gray-200 transition-all"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span>刷新</span>
          </button>
        </div>
      </div>

      {/* 搜索栏 */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 mb-6">
        <div className="flex items-center space-x-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchName}
              onChange={(e) => setSearchName(e.target.value)}
              placeholder="输入客户姓名搜索..."
              className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-xl focus:outline-none 
                         focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
            />
          </div>
          <button
            onClick={handleSearch}
            className="px-6 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all"
          >
            搜索
          </button>
          {searchName && (
            <button
              onClick={() => { setSearchName(''); fetchCustomers(); }}
              className="px-4 py-2.5 bg-gray-100 text-gray-600 rounded-xl hover:bg-gray-200 transition-all"
            >
              清除
            </button>
          )}
        </div>
      </div>

      {/* 添加新客户表单 */}
      {showAddForm && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center">
            <Plus className="w-5 h-5 mr-2 text-green-600" />
            添加新客户
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">姓名 *</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={newCustomer.name}
                  onChange={(e) => setNewCustomer({...newCustomer, name: e.target.value})}
                  placeholder="客户姓名"
                  className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-xl focus:outline-none 
                             focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">客户类型</label>
              <select
                value={newCustomer.customer_type}
                onChange={(e) => setNewCustomer({...newCustomer, customer_type: e.target.value})}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:outline-none 
                           focus:ring-2 focus:ring-blue-500"
              >
                <option value="个人">个人</option>
                <option value="企业">企业</option>
                <option value="批发商">批发商</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">地址</label>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={newCustomer.address}
                  onChange={(e) => setNewCustomer({...newCustomer, address: e.target.value})}
                  placeholder="地址"
                  className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-xl focus:outline-none 
                             focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">备注</label>
              <input
                type="text"
                value={newCustomer.remark}
                onChange={(e) => setNewCustomer({...newCustomer, remark: e.target.value})}
                placeholder="备注信息"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:outline-none 
                           focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div className="flex justify-end space-x-3 mt-4">
            <button
              onClick={() => setShowAddForm(false)}
              className="px-6 py-2.5 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition-all"
            >
              取消
            </button>
            <button
              onClick={handleAdd}
              disabled={adding || !newCustomer.name.trim()}
              className="px-6 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 
                         transition-all disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              {adding ? '添加中...' : '确认添加'}
            </button>
          </div>
        </div>
      )}

      {/* 客户列表 */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
          <h2 className="text-lg font-semibold text-gray-800">
            客户列表 ({customers.length}人)
          </h2>
        </div>

        {loading ? (
          <div className="p-12 text-center text-gray-500">
            <RefreshCw className="w-8 h-8 mx-auto mb-3 animate-spin text-blue-500" />
            <p>加载中...</p>
          </div>
        ) : customers.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <Users className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p>暂无客户数据</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">客户编号</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">姓名</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">类型</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">地址</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">备注</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">累计购买</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {customers.map((customer) => (
                  <tr key={customer.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-sm text-gray-600 font-mono">{customer.customer_no}</td>
                    <td className="px-4 py-3">
                      {editingId === customer.id ? (
                        <input
                          type="text"
                          value={editForm.name}
                          onChange={(e) => setEditForm({...editForm, name: e.target.value})}
                          className="px-2 py-1 border border-blue-300 rounded-lg focus:outline-none 
                                     focus:ring-2 focus:ring-blue-500 text-sm w-24"
                          autoFocus
                        />
                      ) : (
                        <span className="font-medium text-gray-900">{customer.name}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 text-xs rounded-full ${
                        customer.customer_type === '企业' ? 'bg-purple-100 text-purple-700' :
                        customer.customer_type === '批发商' ? 'bg-orange-100 text-orange-700' :
                        'bg-blue-100 text-blue-700'
                      }`}>
                        {customer.customer_type}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {editingId === customer.id ? (
                        <input
                          type="text"
                          value={editForm.address}
                          onChange={(e) => setEditForm({...editForm, address: e.target.value})}
                          className="px-2 py-1 border border-blue-300 rounded-lg focus:outline-none 
                                     focus:ring-2 focus:ring-blue-500 text-sm w-28"
                          placeholder="地址"
                        />
                      ) : (
                        <span className="text-sm text-gray-600">{customer.address || '-'}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {editingId === customer.id ? (
                        <input
                          type="text"
                          value={editForm.remark}
                          onChange={(e) => setEditForm({...editForm, remark: e.target.value})}
                          className="px-2 py-1 border border-blue-300 rounded-lg focus:outline-none 
                                     focus:ring-2 focus:ring-blue-500 text-sm w-28"
                          placeholder="备注"
                        />
                      ) : (
                        <span className="text-sm text-gray-600">{customer.remark || '-'}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-green-600">
                      ¥{customer.total_purchase_amount.toFixed(2)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center space-x-2">
                        {editingId === customer.id ? (
                          <>
                            <button
                              onClick={() => saveEdit(customer.id)}
                              className="p-1.5 bg-green-100 text-green-600 rounded-lg hover:bg-green-200 transition-colors"
                              title="保存"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="p-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors"
                              title="取消"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => startEdit(customer)}
                              className="p-1.5 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 transition-colors"
                              title="编辑"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDelete(customer.id, customer.name)}
                              className="p-1.5 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 transition-colors"
                              title="删除"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 提示信息 */}
      <div className="mt-6 p-4 bg-blue-50 rounded-xl border border-blue-100">
        <p className="text-sm text-blue-800">
          💡 <strong>提示：</strong>客户信息用于开销售单时自动匹配。删除客户不会影响历史销售单记录。
        </p>
      </div>
    </div>
  );
};

export default CustomerPage;

