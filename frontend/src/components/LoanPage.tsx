import React, { useState, useEffect } from 'react';
import { API_ENDPOINTS } from '../config';
import {
  FileText, Check, Clock, AlertCircle, RefreshCw, X, Package, User, Calendar, 
  Download, Search, Filter, RotateCcw, Undo2, History, Printer
} from 'lucide-react';
import toast from 'react-hot-toast';

// 类型定义
interface LoanOrder {
  id: number;
  loan_no: string;
  customer_id: number;
  customer_name: string;
  product_name: string;
  weight: number;
  labor_cost: number;
  total_labor_cost: number;
  salesperson: string;
  loan_date: string;
  status: string;
  created_by: string | null;
  created_at: string;
  confirmed_at: string | null;
  returned_at: string | null;
  returned_by: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  printed_at: string | null;
  remark: string | null;
}

interface LoanOrderLog {
  id: number;
  loan_order_id: number;
  action: string;
  operator: string;
  action_time: string;
  old_status: string | null;
  new_status: string;
  remark: string | null;
}

interface Customer {
  id: number;
  name: string;
  phone: string | null;
}

// 状态徽章
const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    pending: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: '待确认' },
    borrowed: { bg: 'bg-blue-100', text: 'text-blue-700', label: '已借出' },
    returned: { bg: 'bg-green-100', text: 'text-green-700', label: '已归还' },
    cancelled: { bg: 'bg-red-100', text: 'text-red-700', label: '已撤销' },
  };
  const { bg, text, label } = config[status] || { bg: 'bg-gray-100', text: 'text-gray-700', label: status };
  
  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${bg} ${text}`}>
      {label}
    </span>
  );
};

// Tab 组件
const TabButton: React.FC<{
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count?: number;
}> = ({ active, onClick, icon, label, count }) => (
  <button
    onClick={onClick}
    className={`flex items-center space-x-2 px-5 py-3 rounded-xl font-medium transition-all ${
      active
        ? 'bg-gradient-to-r from-amber-500 to-yellow-500 text-white shadow-lg shadow-amber-200/50'
        : 'bg-white text-gray-600 hover:bg-amber-50 border border-gray-200'
    }`}
  >
    {icon}
    <span>{label}</span>
    {count !== undefined && count > 0 && (
      <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-bold ${
        active ? 'bg-white/20' : 'bg-red-500 text-white'
      }`}>
        {count}
      </span>
    )}
  </button>
);

// 主组件
const LoanPage: React.FC = () => {
  // 状态
  const [activeTab, setActiveTab] = useState<'pending' | 'borrowed' | 'returned' | 'cancelled' | 'all'>('pending');
  const [loanOrders, setLoanOrders] = useState<LoanOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showLogsModal, setShowLogsModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [selectedLoan, setSelectedLoan] = useState<LoanOrder | null>(null);
  const [logs, setLogs] = useState<LoanOrderLog[]>([]);
  const [cancelReason, setCancelReason] = useState('');
  
  // 客户相关状态
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [filteredCustomers, setFilteredCustomers] = useState<Customer[]>([]);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  
  // 搜索筛选
  const [searchFilters, setSearchFilters] = useState({
    customer_name: '',
    product_name: '',
  });
  
  // 创建表单
  const [createForm, setCreateForm] = useState({
    customer_id: 0,
    customer_name: '',
    product_name: '',
    weight: '',
    labor_cost: '',
    salesperson: '',
    loan_date: new Date().toISOString().split('T')[0],
    remark: '',
  });

  // API 基础 URL
  const API_BASE = API_ENDPOINTS.API_BASE_URL;

  // 加载客户列表
  const loadCustomers = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/customers`);
      if (response.ok) {
        const data = await response.json();
        setCustomers(data);
      }
    } catch (error) {
      console.error('加载客户列表失败:', error);
    }
  };

  // 加载暂借单列表
  const loadLoanOrders = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (activeTab !== 'all') {
        params.append('status', activeTab);
      }
      if (searchFilters.customer_name) {
        params.append('customer_name', searchFilters.customer_name);
      }
      if (searchFilters.product_name) {
        params.append('product_name', searchFilters.product_name);
      }
      
      const response = await fetch(`${API_BASE}/api/loan/orders?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        setLoanOrders(data);
      } else {
        toast.error('加载暂借单失败');
      }
    } catch (error) {
      console.error('加载暂借单失败:', error);
      toast.error('网络错误');
    } finally {
      setLoading(false);
    }
  };

  // 客户搜索过滤
  useEffect(() => {
    if (customerSearch.trim()) {
      const filtered = customers.filter(c => 
        c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
        (c.phone && c.phone.includes(customerSearch))
      );
      setFilteredCustomers(filtered.slice(0, 10));
    } else {
      setFilteredCustomers(customers.slice(0, 10));
    }
  }, [customerSearch, customers]);

  // 选择客户
  const handleSelectCustomer = (customer: Customer) => {
    setCreateForm({
      ...createForm,
      customer_id: customer.id,
      customer_name: customer.name,
    });
    setCustomerSearch(customer.name);
    setShowCustomerDropdown(false);
  };

  // 创建暂借单
  const handleCreate = async () => {
    if (!createForm.customer_id || !createForm.product_name || !createForm.weight || !createForm.salesperson) {
      toast.error('请填写必填项');
      return;
    }
    
    try {
      const response = await fetch(`${API_BASE}/api/loan/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: createForm.customer_id,
          product_name: createForm.product_name,
          weight: parseFloat(createForm.weight),
          labor_cost: parseFloat(createForm.labor_cost) || 0,
          salesperson: createForm.salesperson,
          loan_date: new Date(createForm.loan_date).toISOString(),
          remark: createForm.remark || null,
          created_by: '结算专员',
        }),
      });
      
      if (response.ok) {
        toast.success('暂借单创建成功');
        setShowCreateModal(false);
        setCreateForm({
          customer_id: 0,
          customer_name: '',
          product_name: '',
          weight: '',
          labor_cost: '',
          salesperson: '',
          loan_date: new Date().toISOString().split('T')[0],
          remark: '',
        });
        setCustomerSearch('');
        loadLoanOrders();
      } else {
        const error = await response.json();
        toast.error(error.detail || '创建失败');
      }
    } catch (error) {
      console.error('创建暂借单失败:', error);
      toast.error('网络错误');
    }
  };

  // 确认借出
  const handleConfirm = async (loan: LoanOrder) => {
    if (!confirm('确认借出？将扣减对应库存。')) return;
    
    try {
      const response = await fetch(`${API_BASE}/api/loan/orders/${loan.id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operator: '结算专员' }),
      });
      
      if (response.ok) {
        toast.success('确认借出成功');
        loadLoanOrders();
      } else {
        const error = await response.json();
        toast.error(error.detail || '操作失败');
      }
    } catch (error) {
      console.error('确认借出失败:', error);
      toast.error('网络错误');
    }
  };

  // 确认归还
  const handleReturn = async (loan: LoanOrder) => {
    if (!confirm('确认归还？将恢复对应库存。')) return;
    
    try {
      const response = await fetch(`${API_BASE}/api/loan/orders/${loan.id}/return`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operator: '结算专员' }),
      });
      
      if (response.ok) {
        toast.success('确认归还成功');
        loadLoanOrders();
      } else {
        const error = await response.json();
        toast.error(error.detail || '操作失败');
      }
    } catch (error) {
      console.error('确认归还失败:', error);
      toast.error('网络错误');
    }
  };

  // 撤销暂借单
  const handleCancel = async () => {
    if (!selectedLoan || !cancelReason.trim()) {
      toast.error('请填写撤销原因');
      return;
    }
    
    try {
      const response = await fetch(`${API_BASE}/api/loan/orders/${selectedLoan.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operator: '结算专员',
          reason: cancelReason.trim(),
        }),
      });
      
      if (response.ok) {
        toast.success('撤销成功');
        setShowCancelModal(false);
        setSelectedLoan(null);
        setCancelReason('');
        loadLoanOrders();
      } else {
        const error = await response.json();
        toast.error(error.detail || '撤销失败');
      }
    } catch (error) {
      console.error('撤销失败:', error);
      toast.error('网络错误');
    }
  };

  // 查看操作日志
  const handleViewLogs = async (loan: LoanOrder) => {
    setSelectedLoan(loan);
    try {
      const response = await fetch(`${API_BASE}/api/loan/orders/${loan.id}/logs`);
      if (response.ok) {
        const data = await response.json();
        setLogs(data);
        setShowLogsModal(true);
      } else {
        toast.error('加载日志失败');
      }
    } catch (error) {
      console.error('加载日志失败:', error);
      toast.error('网络错误');
    }
  };

  // 打印暂借单
  const handlePrint = (loan: LoanOrder) => {
    window.open(`${API_BASE}/api/loan/orders/${loan.id}/download?format=html`, '_blank');
  };

  // 效果
  useEffect(() => {
    loadLoanOrders();
  }, [activeTab]);

  useEffect(() => {
    loadCustomers();
  }, []);

  // 统计各状态数量
  const pendingCount = loanOrders.filter(o => o.status === 'pending').length;
  const borrowedCount = loanOrders.filter(o => o.status === 'borrowed').length;

  // 格式化日期
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('zh-CN');
  };

  const formatDateTime = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString('zh-CN');
  };

  // 获取操作类型标签
  const getActionLabel = (action: string) => {
    const labels: Record<string, string> = {
      create: '创建',
      confirm: '确认借出',
      return: '归还',
      cancel: '撤销',
    };
    return labels[action] || action;
  };

  return (
    <div className="p-6 space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center space-x-2">
            <Package className="w-7 h-7 text-amber-500" />
            <span>暂借管理</span>
          </h1>
          <p className="text-gray-500 mt-1">管理产品的临时借出和归还</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-6 py-3 bg-gradient-to-r from-amber-500 to-yellow-500 text-white rounded-xl font-medium shadow-lg shadow-amber-200/50 hover:shadow-xl transition-all flex items-center space-x-2"
        >
          <FileText className="w-5 h-5" />
          <span>创建暂借单</span>
        </button>
      </div>

      {/* Tab 切换 */}
      <div className="flex space-x-3 flex-wrap gap-y-2">
        <TabButton
          active={activeTab === 'pending'}
          onClick={() => setActiveTab('pending')}
          icon={<Clock className="w-4 h-4" />}
          label="待确认"
          count={pendingCount}
        />
        <TabButton
          active={activeTab === 'borrowed'}
          onClick={() => setActiveTab('borrowed')}
          icon={<Package className="w-4 h-4" />}
          label="已借出"
          count={borrowedCount}
        />
        <TabButton
          active={activeTab === 'returned'}
          onClick={() => setActiveTab('returned')}
          icon={<Check className="w-4 h-4" />}
          label="已归还"
        />
        <TabButton
          active={activeTab === 'cancelled'}
          onClick={() => setActiveTab('cancelled')}
          icon={<X className="w-4 h-4" />}
          label="已撤销"
        />
        <TabButton
          active={activeTab === 'all'}
          onClick={() => setActiveTab('all')}
          icon={<FileText className="w-4 h-4" />}
          label="全部"
        />
      </div>

      {/* 搜索筛选 */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
        <div className="flex items-center space-x-4 flex-wrap gap-y-2">
          <div className="flex items-center space-x-2">
            <User className="w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="客户姓名"
              value={searchFilters.customer_name}
              onChange={(e) => setSearchFilters({ ...searchFilters, customer_name: e.target.value })}
              className="px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-200 focus:border-amber-400"
            />
          </div>
          <div className="flex items-center space-x-2">
            <Package className="w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="产品名称"
              value={searchFilters.product_name}
              onChange={(e) => setSearchFilters({ ...searchFilters, product_name: e.target.value })}
              className="px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-200 focus:border-amber-400"
            />
          </div>
          <button
            onClick={loadLoanOrders}
            className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors flex items-center space-x-1"
          >
            <Filter className="w-4 h-4" />
            <span>搜索</span>
          </button>
          <button
            onClick={() => {
              setSearchFilters({ customer_name: '', product_name: '' });
              loadLoanOrders();
            }}
            className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors flex items-center space-x-1"
          >
            <RefreshCw className="w-4 h-4" />
            <span>重置</span>
          </button>
        </div>
      </div>

      {/* 暂借单列表 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2" />
            <span>加载中...</span>
          </div>
        ) : loanOrders.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <Package className="w-12 h-12 mx-auto mb-2 text-gray-300" />
            <span>暂无暂借单</span>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">单号</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">客户</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">产品</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">克重</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">工费</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">业务员</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">日期</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">状态</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loanOrders.map((loan) => (
                <tr key={loan.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <span className="font-mono text-sm text-amber-600">{loan.loan_no}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-medium">{loan.customer_name}</span>
                  </td>
                  <td className="px-4 py-3 text-sm">{loan.product_name}</td>
                  <td className="px-4 py-3 text-right font-medium">{loan.weight.toFixed(2)}克</td>
                  <td className="px-4 py-3 text-right text-sm text-gray-600">¥{loan.total_labor_cost.toFixed(2)}</td>
                  <td className="px-4 py-3 text-sm">{loan.salesperson}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{formatDate(loan.loan_date)}</td>
                  <td className="px-4 py-3 text-center">
                    <StatusBadge status={loan.status} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center space-x-2">
                      {/* 待确认 -> 确认借出 */}
                      {loan.status === 'pending' && (
                        <button
                          onClick={() => handleConfirm(loan)}
                          className="p-2 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 transition-colors"
                          title="确认借出"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                      )}
                      
                      {/* 已借出 -> 确认归还 */}
                      {loan.status === 'borrowed' && (
                        <button
                          onClick={() => handleReturn(loan)}
                          className="p-2 bg-green-100 text-green-600 rounded-lg hover:bg-green-200 transition-colors"
                          title="确认归还"
                        >
                          <RotateCcw className="w-4 h-4" />
                        </button>
                      )}
                      
                      {/* 待确认/已借出 -> 撤销 */}
                      {(loan.status === 'pending' || loan.status === 'borrowed') && (
                        <button
                          onClick={() => {
                            setSelectedLoan(loan);
                            setShowCancelModal(true);
                          }}
                          className="p-2 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 transition-colors"
                          title="撤销"
                        >
                          <Undo2 className="w-4 h-4" />
                        </button>
                      )}
                      
                      {/* 打印 */}
                      <button
                        onClick={() => handlePrint(loan)}
                        className="p-2 bg-amber-100 text-amber-600 rounded-lg hover:bg-amber-200 transition-colors"
                        title="打印"
                      >
                        <Printer className="w-4 h-4" />
                      </button>
                      
                      {/* 查看日志 */}
                      <button
                        onClick={() => handleViewLogs(loan)}
                        className="p-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors"
                        title="操作日志"
                      >
                        <History className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 创建暂借单弹窗 */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl">
            <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center space-x-2">
              <FileText className="w-6 h-6 text-amber-500" />
              <span>创建暂借单</span>
            </h3>
            
            <div className="space-y-4">
              {/* 客户选择 */}
              <div className="relative">
                <label className="block text-sm font-medium text-gray-700 mb-1">客户 *</label>
                <input
                  type="text"
                  value={customerSearch}
                  onChange={(e) => {
                    setCustomerSearch(e.target.value);
                    setShowCustomerDropdown(true);
                    // 如果手动输入，清除已选客户
                    if (createForm.customer_name !== e.target.value) {
                      setCreateForm({ ...createForm, customer_id: 0, customer_name: '' });
                    }
                  }}
                  onFocus={() => setShowCustomerDropdown(true)}
                  placeholder="搜索并选择客户"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-200 focus:border-amber-400"
                />
                {createForm.customer_id > 0 && (
                  <span className="absolute right-3 top-8 text-green-500 text-sm">✓ 已选择</span>
                )}
                
                {/* 客户下拉列表 */}
                {showCustomerDropdown && filteredCustomers.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {filteredCustomers.map((customer) => (
                      <div
                        key={customer.id}
                        onClick={() => handleSelectCustomer(customer)}
                        className="px-3 py-2 hover:bg-amber-50 cursor-pointer flex justify-between items-center"
                      >
                        <span className="font-medium">{customer.name}</span>
                        {customer.phone && (
                          <span className="text-gray-400 text-sm">{customer.phone}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              
              {/* 产品名称 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">产品品类 *</label>
                <input
                  type="text"
                  value={createForm.product_name}
                  onChange={(e) => setCreateForm({ ...createForm, product_name: e.target.value })}
                  placeholder="请输入产品品类"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-200 focus:border-amber-400"
                />
              </div>
              
              {/* 克重和工费 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">克重 *</label>
                  <input
                    type="number"
                    step="0.01"
                    value={createForm.weight}
                    onChange={(e) => setCreateForm({ ...createForm, weight: e.target.value })}
                    placeholder="0.00"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-200 focus:border-amber-400"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">工费（元/克）</label>
                  <input
                    type="number"
                    step="0.01"
                    value={createForm.labor_cost}
                    onChange={(e) => setCreateForm({ ...createForm, labor_cost: e.target.value })}
                    placeholder="0.00"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-200 focus:border-amber-400"
                  />
                </div>
              </div>
              
              {/* 业务员和日期 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">业务员 *</label>
                  <input
                    type="text"
                    value={createForm.salesperson}
                    onChange={(e) => setCreateForm({ ...createForm, salesperson: e.target.value })}
                    placeholder="请输入业务员姓名"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-200 focus:border-amber-400"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">暂借日期 *</label>
                  <input
                    type="date"
                    value={createForm.loan_date}
                    onChange={(e) => setCreateForm({ ...createForm, loan_date: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-200 focus:border-amber-400"
                  />
                </div>
              </div>
              
              {/* 备注 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
                <textarea
                  value={createForm.remark}
                  onChange={(e) => setCreateForm({ ...createForm, remark: e.target.value })}
                  placeholder="其他备注信息（可选）"
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-200 focus:border-amber-400"
                />
              </div>
            </div>
            
            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setCustomerSearch('');
                  setShowCustomerDropdown(false);
                }}
                className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleCreate}
                className="px-6 py-2 bg-gradient-to-r from-amber-500 to-yellow-500 text-white rounded-lg hover:shadow-lg transition-all"
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 撤销确认弹窗 */}
      {showCancelModal && selectedLoan && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
            <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center space-x-2">
              <AlertCircle className="w-6 h-6 text-red-500" />
              <span>撤销暂借单</span>
            </h3>
            
            <p className="text-gray-600 mb-4">
              确定要撤销暂借单 <span className="font-mono font-medium text-amber-600">{selectedLoan.loan_no}</span> 吗？
              {selectedLoan.status === 'borrowed' && (
                <span className="block text-sm text-red-500 mt-1">撤销后将恢复库存。</span>
              )}
            </p>
            
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">撤销原因 *</label>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="请填写撤销原因（必填，用于留痕）"
                rows={3}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-red-200 focus:border-red-400"
              />
            </div>
            
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowCancelModal(false);
                  setSelectedLoan(null);
                  setCancelReason('');
                }}
                className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleCancel}
                className="px-6 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
              >
                确认撤销
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 操作日志弹窗 */}
      {showLogsModal && selectedLoan && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl max-h-[80vh] overflow-hidden flex flex-col">
            <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center space-x-2">
              <History className="w-6 h-6 text-amber-500" />
              <span>操作日志</span>
              <span className="text-sm font-normal text-gray-500">- {selectedLoan.loan_no}</span>
            </h3>
            
            <div className="flex-1 overflow-y-auto">
              {logs.length === 0 ? (
                <p className="text-gray-500 text-center py-8">暂无操作日志</p>
              ) : (
                <div className="space-y-3">
                  {logs.map((log) => (
                    <div key={log.id} className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-gray-800">{getActionLabel(log.action)}</span>
                        <span className="text-xs text-gray-400">{formatDateTime(log.action_time)}</span>
                      </div>
                      <div className="text-sm text-gray-600">
                        <span>操作人：{log.operator}</span>
                        {log.old_status && (
                          <span className="ml-3">
                            状态：<StatusBadge status={log.old_status} /> → <StatusBadge status={log.new_status} />
                          </span>
                        )}
                      </div>
                      {log.remark && (
                        <div className="text-sm text-gray-500 mt-1 italic">{log.remark}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            <div className="flex justify-end mt-4 pt-4 border-t border-gray-100">
              <button
                onClick={() => {
                  setShowLogsModal(false);
                  setSelectedLoan(null);
                  setLogs([]);
                }}
                className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* 点击外部关闭客户下拉 */}
      {showCustomerDropdown && (
        <div 
          className="fixed inset-0 z-40" 
          onClick={() => setShowCustomerDropdown(false)}
        />
      )}
    </div>
  );
};

export default LoanPage;
