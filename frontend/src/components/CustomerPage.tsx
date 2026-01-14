import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../config';
import { hasPermission } from '../config/permissions';
import {
  Users, Plus, Trash2, Edit2, Check, X, RefreshCw, User,
  MapPin, Search, UserPlus, Eye, ShoppingBag, RotateCcw, 
  Wallet, FileText, ChevronRight, ArrowLeft
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

interface SalesRecord {
  id: number;
  order_no: string;
  product_name: string;
  weight: number;
  labor_cost: number;
  total_amount: number;
  status: string;
  created_at: string;
}

interface ReturnRecord {
  id: number;
  return_no: string;
  product_name: string;
  return_weight: number;
  return_reason: string;
  status: string;
  created_at: string;
}

interface CustomerBalance {
  cash_debt: number;       // 现金欠款
  gold_debt: number;       // 金料欠款（克）
  gold_deposit: number;    // 存料余额（克）
}

interface TransactionRecord {
  id: number;
  type: string;            // 'sale', 'return', 'payment', 'gold_receipt'
  description: string;
  amount: number | null;
  gold_weight: number | null;
  created_at: string;
}

interface CustomerDetail {
  customer: Customer;
  sales: SalesRecord[];
  returns: ReturnRecord[];
  balance: CustomerBalance;
  transactions: TransactionRecord[];
}

interface CustomerPageProps {
  userRole?: string;
}

export const CustomerPage: React.FC<CustomerPageProps> = ({ userRole = 'manager' }) => {
  // 权限检查
  const canDelete = hasPermission(userRole, 'canDelete');
  const canEdit = hasPermission(userRole, 'canManageCustomers'); // 可以编辑客户
  const canAdd = hasPermission(userRole, 'canManageCustomers'); // 可以添加客户
  const canView = hasPermission(userRole, 'canViewCustomers') || hasPermission(userRole, 'canManageCustomers'); // 可以查看客户（查看权限或管理权限）
  const canViewDetail = hasPermission(userRole, 'canQueryCustomerSales') || hasPermission(userRole, 'canViewCustomers'); // 可以查看客户详情
  
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchName, setSearchName] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  
  // 客户详情相关状态
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerDetail, setCustomerDetail] = useState<CustomerDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<'sales' | 'returns' | 'balance' | 'transactions'>('sales');

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
      const params = new URLSearchParams();
      if (searchName) {
        params.append('name', searchName);
      }
      params.append('user_role', userRole);
      const url = `${API_BASE_URL}/api/customers?${params.toString()}`;
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
      const response = await fetch(`${API_BASE_URL}/api/customers?user_role=${encodeURIComponent(userRole)}`, {
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
      const response = await fetch(`${API_BASE_URL}/api/customers/${id}?user_role=${encodeURIComponent(userRole)}`, {
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
      const response = await fetch(`${API_BASE_URL}/api/customers/${id}?user_role=${encodeURIComponent(userRole)}`, {
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

  // 获取客户详情
  const fetchCustomerDetail = async (customer: Customer) => {
    setSelectedCustomer(customer);
    setDetailLoading(true);
    setDetailTab('sales');
    
    try {
      const response = await fetch(`${API_BASE_URL}/api/customers/${customer.id}/detail?user_role=${encodeURIComponent(userRole)}`);
      const data = await response.json();
      
      if (data.success) {
        setCustomerDetail(data.detail);
      } else {
        toast.error(data.message || '获取客户详情失败');
        setCustomerDetail({
          customer,
          sales: [],
          returns: [],
          balance: { cash_debt: 0, gold_debt: 0, gold_deposit: 0 },
          transactions: []
        });
      }
    } catch (error) {
      toast.error('网络错误');
      setCustomerDetail({
        customer,
        sales: [],
        returns: [],
        balance: { cash_debt: 0, gold_debt: 0, gold_deposit: 0 },
        transactions: []
      });
    } finally {
      setDetailLoading(false);
    }
  };

  // 关闭详情弹窗
  const closeDetail = () => {
    setSelectedCustomer(null);
    setCustomerDetail(null);
  };

  // 渲染客户详情弹窗
  const renderDetailModal = () => {
    if (!selectedCustomer) return null;

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          {/* 弹窗头部 */}
          <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <button
                  onClick={closeDetail}
                  className="p-2 hover:bg-white/50 rounded-lg transition-colors"
                >
                  <ArrowLeft className="w-5 h-5 text-gray-600" />
                </button>
                <div>
                  <h2 className="text-xl font-bold text-gray-900">{selectedCustomer.name}</h2>
                  <p className="text-sm text-gray-500">{selectedCustomer.customer_no} · {selectedCustomer.customer_type}</p>
                </div>
              </div>
              <button
                onClick={closeDetail}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
          </div>

          {/* Tab 切换 */}
          <div className="px-6 py-3 border-b border-gray-200 bg-gray-50">
            <div className="flex space-x-1">
              {[
                { key: 'sales', label: '销售记录', icon: ShoppingBag },
                { key: 'returns', label: '退货记录', icon: RotateCcw },
                { key: 'balance', label: '欠款/存料', icon: Wallet },
                { key: 'transactions', label: '往来账目', icon: FileText },
              ].map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setDetailTab(key as typeof detailTab)}
                  className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-all ${
                    detailTab === key
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="text-sm font-medium">{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 内容区域 */}
          <div className="flex-1 overflow-y-auto p-6">
            {detailLoading ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
                <span className="ml-3 text-gray-500">加载中...</span>
              </div>
            ) : (
              <>
                {/* 销售记录 */}
                {detailTab === 'sales' && (
                  <div>
                    <h3 className="text-lg font-semibold text-gray-800 mb-4">销售记录</h3>
                    {customerDetail?.sales && customerDetail.sales.length > 0 ? (
                      <div className="space-y-3">
                        {customerDetail.sales.map((sale) => (
                          <div key={sale.id} className="p-4 bg-gray-50 rounded-xl border border-gray-200">
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="font-medium text-gray-900">{sale.product_name}</p>
                                <p className="text-sm text-gray-500">
                                  {sale.order_no} · {new Date(sale.created_at).toLocaleDateString()}
                                </p>
                              </div>
                              <div className="text-right">
                                <p className="font-semibold text-green-600">¥{sale.total_amount.toFixed(2)}</p>
                                <p className="text-sm text-gray-500">{sale.weight}g · 工费¥{sale.labor_cost}/g</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-12 text-gray-500">
                        <ShoppingBag className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                        <p>暂无销售记录</p>
                      </div>
                    )}
                  </div>
                )}

                {/* 退货记录 */}
                {detailTab === 'returns' && (
                  <div>
                    <h3 className="text-lg font-semibold text-gray-800 mb-4">退货记录</h3>
                    {customerDetail?.returns && customerDetail.returns.length > 0 ? (
                      <div className="space-y-3">
                        {customerDetail.returns.map((ret) => (
                          <div key={ret.id} className="p-4 bg-gray-50 rounded-xl border border-gray-200">
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="font-medium text-gray-900">{ret.product_name}</p>
                                <p className="text-sm text-gray-500">
                                  {ret.return_no} · {new Date(ret.created_at).toLocaleDateString()}
                                </p>
                              </div>
                              <div className="text-right">
                                <p className="font-semibold text-orange-600">{ret.return_weight}g</p>
                                <p className="text-sm text-gray-500">{ret.return_reason}</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-12 text-gray-500">
                        <RotateCcw className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                        <p>暂无退货记录</p>
                      </div>
                    )}
                  </div>
                )}

                {/* 欠款/存料 */}
                {detailTab === 'balance' && (
                  <div>
                    <h3 className="text-lg font-semibold text-gray-800 mb-4">账户余额</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="p-6 bg-red-50 rounded-xl border border-red-200">
                        <p className="text-sm text-red-600 mb-1">现金欠款</p>
                        <p className="text-2xl font-bold text-red-700">
                          ¥{(customerDetail?.balance?.cash_debt || 0).toFixed(2)}
                        </p>
                      </div>
                      <div className="p-6 bg-orange-50 rounded-xl border border-orange-200">
                        <p className="text-sm text-orange-600 mb-1">金料欠款</p>
                        <p className="text-2xl font-bold text-orange-700">
                          {(customerDetail?.balance?.gold_debt || 0).toFixed(2)}克
                        </p>
                      </div>
                      <div className="p-6 bg-green-50 rounded-xl border border-green-200">
                        <p className="text-sm text-green-600 mb-1">存料余额</p>
                        <p className="text-2xl font-bold text-green-700">
                          {(customerDetail?.balance?.gold_deposit || 0).toFixed(2)}克
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* 往来账目 */}
                {detailTab === 'transactions' && (
                  <div>
                    <h3 className="text-lg font-semibold text-gray-800 mb-4">往来账目</h3>
                    {customerDetail?.transactions && customerDetail.transactions.length > 0 ? (
                      <div className="space-y-3">
                        {customerDetail.transactions.map((tx) => (
                          <div key={tx.id} className="p-4 bg-gray-50 rounded-xl border border-gray-200 flex items-center justify-between">
                            <div className="flex items-center space-x-3">
                              <div className={`p-2 rounded-lg ${
                                tx.type === 'sale' ? 'bg-green-100' :
                                tx.type === 'return' ? 'bg-orange-100' :
                                tx.type === 'payment' ? 'bg-blue-100' :
                                'bg-yellow-100'
                              }`}>
                                {tx.type === 'sale' && <ShoppingBag className="w-4 h-4 text-green-600" />}
                                {tx.type === 'return' && <RotateCcw className="w-4 h-4 text-orange-600" />}
                                {tx.type === 'payment' && <Wallet className="w-4 h-4 text-blue-600" />}
                                {tx.type === 'gold_receipt' && <FileText className="w-4 h-4 text-yellow-600" />}
                              </div>
                              <div>
                                <p className="font-medium text-gray-900">{tx.description}</p>
                                <p className="text-sm text-gray-500">{new Date(tx.created_at).toLocaleString()}</p>
                              </div>
                            </div>
                            <div className="text-right">
                              {tx.amount !== null && (
                                <p className={`font-semibold ${tx.amount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                  {tx.amount >= 0 ? '+' : ''}¥{tx.amount.toFixed(2)}
                                </p>
                              )}
                              {tx.gold_weight !== null && (
                                <p className={`text-sm ${tx.gold_weight >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                  {tx.gold_weight >= 0 ? '+' : ''}{tx.gold_weight.toFixed(2)}g
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-12 text-gray-500">
                        <FileText className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                        <p>暂无往来账目</p>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    );
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
          {canAdd && (
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-xl
                         hover:bg-blue-700 transition-all"
            >
              <UserPlus className="w-4 h-4" />
              <span>新增客户</span>
            </button>
          )}
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
      {showAddForm && canAdd && (
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
                            {/* 查看详情按钮 - 所有可查看客户的角色都可以点击 */}
                            {canViewDetail && (
                              <button
                                onClick={() => fetchCustomerDetail(customer)}
                                className="p-1.5 bg-indigo-100 text-indigo-600 rounded-lg hover:bg-indigo-200 transition-colors"
                                title="查看详情"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                            )}
                            {canEdit && (
                              <button
                                onClick={() => startEdit(customer)}
                                className="p-1.5 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 transition-colors"
                                title="编辑"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                            )}
                            {canDelete && (
                              <button
                                onClick={() => handleDelete(customer.id, customer.name)}
                                className="p-1.5 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 transition-colors"
                                title="删除"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
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
          💡 <strong>提示：</strong>
          {userRole === 'sales' 
            ? '您可以点击"查看详情"按钮查询客户的销售、退货、欠款和往来账目信息。'
            : '客户信息用于开销售单时自动匹配。删除客户不会影响历史销售单记录。'}
        </p>
      </div>

      {/* 客户详情弹窗 */}
      {renderDetailModal()}
    </div>
  );
};

export default CustomerPage;

