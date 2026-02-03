import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../config';
import { hasPermission } from '../config/permissions';
import {
  Users, Plus, Trash2, Edit2, Check, X, RefreshCw, User,
  MapPin, Search, UserPlus, Eye, ShoppingBag, RotateCcw, 
  Wallet, FileText, ChevronRight, ArrowLeft, Upload, 
  CreditCard, TrendingDown, ArrowUpDown, Clock, Download,
  Diamond, CheckCircle, AlertCircle, Calculator
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
  id: number | string;
  type: string;            // 'sales_labor', 'customer_receipt', 'customer_withdrawal', 'settle_cash', 'settle_gold', 'settle_mixed', 'customer_payment'
  type_label?: string;     // 类型标签：销售结算、客户来料、客户提料、欠料结价、欠料结料、客户来款等
  description: string;
  amount: number | null;
  gold_weight: number | null;
  created_at: string;
  remark?: string;         // 备注信息
}

interface CustomerDetail {
  customer: Customer;
  sales: SalesRecord[];
  returns: ReturnRecord[];
  balance: CustomerBalance;
  transactions: TransactionRecord[];
  opening_balance?: TransactionRecord | null;  // 期初余额
  date_range?: { start: string | null; end: string | null } | null;
}

// 欠款汇总数据类型
interface DebtSummaryItem {
  customer_id: number;
  customer_no: string;
  customer_name: string;
  phone: string | null;
  cash_debt: number;
  gold_balance: number;    // 金料净额：正数=客人欠我们，负数=客人有存料
  gold_debt: number;       // 兼容旧字段
  gold_deposit: number;    // 兼容旧字段
  last_transaction_date: string | null;
}

interface DebtSummary {
  total_cash_debt: number;
  total_gold_balance: number;  // 金料净额总计
  total_gold_debt: number;     // 兼容旧字段
  customer_count: number;
}

// 欠款历史交易记录
interface DebtTransaction {
  id: string;
  type: string;
  type_label: string;
  order_no: string;
  description: string;
  cash_amount: number;
  gold_amount: number;
  gold_debt_before?: number;
  gold_debt_after?: number;
  status: string;
  created_at: string | null;
  operator: string | null;
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
  
  // 主页面 Tab 切换
  const [mainTab, setMainTab] = useState<'list' | 'debt'>('list');
  
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchName, setSearchName] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  
  // 分页状态
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCustomers, setTotalCustomers] = useState(0);
  const pageSize = 20;
  
  // 批量导入相关状态
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  
  // 客户详情相关状态
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerDetail, setCustomerDetail] = useState<CustomerDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<'sales' | 'returns' | 'balance' | 'transactions'>('sales');
  
  // 往来账目日期筛选
  const [transDateStart, setTransDateStart] = useState<string>('');
  const [transDateEnd, setTransDateEnd] = useState<string>('');
  
  // 欠款查询相关状态
  const [debtList, setDebtList] = useState<DebtSummaryItem[]>([]);
  const [debtSummary, setDebtSummary] = useState<DebtSummary>({ total_cash_debt: 0, total_gold_balance: 0, total_gold_debt: 0, customer_count: 0 });
  const [debtLoading, setDebtLoading] = useState(false);
  const [debtSearch, setDebtSearch] = useState('');
  const [debtSortBy, setDebtSortBy] = useState<'cash_debt' | 'gold_balance' | 'name'>('cash_debt');
  const [debtSortOrder, setDebtSortOrder] = useState<'asc' | 'desc'>('desc');
  
  // 欠款历史弹窗
  const [selectedDebtCustomer, setSelectedDebtCustomer] = useState<DebtSummaryItem | null>(null);
  const [debtHistory, setDebtHistory] = useState<DebtTransaction[]>([]);
  const [debtHistoryLoading, setDebtHistoryLoading] = useState(false);
  const [customerCurrentBalance, setCustomerCurrentBalance] = useState<CustomerBalance | null>(null);

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

  // 获取客户列表（带分页和重试机制）
  const fetchCustomers = async (page = currentPage, retryCount = 0) => {
    setLoading(true);
    const maxRetries = 2;
    const retryDelay = 1000; // 1秒
    
    try {
      const params = new URLSearchParams();
      if (searchName) {
        params.append('name', searchName);
      }
      params.append('page', page.toString());
      params.append('page_size', pageSize.toString());
      params.append('user_role', userRole);
      const url = `${API_BASE_URL}/api/customers?${params.toString()}`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.success) {
        // 后端返回格式: { success: true, data: { customers: [...], total, page, total_pages } }
        const responseData = data.data || {};
        const customersData = responseData.customers || data.customers || [];
        const customersArray = Array.isArray(customersData) ? customersData : [];
        setCustomers(customersArray);
        setTotalCustomers(responseData.total || customersArray.length);
        setTotalPages(responseData.total_pages || 1);
        setCurrentPage(responseData.page || page);
        
        // 调试信息（仅在开发环境）
        if (customersArray.length === 0 && !searchName) {
          console.log('客户列表为空，API响应:', data);
        }
      } else {
        console.error('获取客户列表失败:', data);
        toast.error(data.message || '获取客户列表失败');
        setCustomers([]);
      }
    } catch (error) {
      console.error(`获取客户列表失败 (尝试 ${retryCount + 1}/${maxRetries + 1}):`, error);
      
      // 如果是网络错误且还有重试次数，则重试
      if (retryCount < maxRetries && (error.message.includes('fetch') || error.message.includes('network') || error.message.includes('CORS'))) {
        console.log(`${retryDelay}ms 后重试...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        return fetchCustomers(page, retryCount + 1);
      }
      
      // 最终失败
      toast.error('网络错误，请检查后端服务连接');
      setCustomers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCustomers(1);
  }, []);

  // 搜索
  const handleSearch = () => {
    setCurrentPage(1);
    fetchCustomers(1);
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
  const fetchCustomerDetail = async (customer: Customer, dateStart?: string, dateEnd?: string) => {
    setSelectedCustomer(customer);
    setDetailLoading(true);
    if (!dateStart && !dateEnd) {
      setDetailTab('sales');
      // 清空日期筛选
      setTransDateStart('');
      setTransDateEnd('');
    }
    
    try {
      let url = `${API_BASE_URL}/api/customers/${customer.id}/detail?user_role=${encodeURIComponent(userRole)}`;
      if (dateStart) url += `&date_start=${dateStart}`;
      if (dateEnd) url += `&date_end=${dateEnd}`;
      
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.success) {
        setCustomerDetail(data.data);
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
  
  // 筛选往来账目（按日期）
  const filterTransactions = () => {
    if (selectedCustomer) {
      fetchCustomerDetail(selectedCustomer, transDateStart || undefined, transDateEnd || undefined);
    }
  };

  // 关闭详情弹窗
  const closeDetail = () => {
    setSelectedCustomer(null);
    setCustomerDetail(null);
  };

  // ============= 欠款查询相关函数 =============
  
  // 获取欠款汇总列表
  const fetchDebtSummary = async () => {
    setDebtLoading(true);
    try {
      const params = new URLSearchParams();
      if (debtSearch) params.append('search', debtSearch);
      params.append('sort_by', debtSortBy);
      params.append('sort_order', debtSortOrder);
      params.append('hide_zero', 'true');
      params.append('user_role', userRole);
      
      const response = await fetch(`${API_BASE_URL}/api/customers/debt-summary?${params.toString()}`);
      const data = await response.json();
      
      if (data.success) {
        setDebtList(data.data?.items || []);
        setDebtSummary(data.data?.summary || { total_cash_debt: 0, total_gold_balance: 0, total_gold_debt: 0, customer_count: 0 });
      } else {
        toast.error(data.message || '获取欠款列表失败');
      }
    } catch (error) {
      toast.error('网络错误，请检查后端服务');
    } finally {
      setDebtLoading(false);
    }
  };
  
  // 获取客户欠款历史
  const fetchDebtHistory = async (customer: DebtSummaryItem) => {
    setSelectedDebtCustomer(customer);
    setDebtHistoryLoading(true);
    
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/customers/${customer.customer_id}/debt-history?user_role=${encodeURIComponent(userRole)}`
      );
      const data = await response.json();
      
      if (data.success) {
        setDebtHistory(data.data?.transactions || []);
        setCustomerCurrentBalance(data.data?.current_balance || null);
      } else {
        toast.error(data.message || '获取欠款历史失败');
        setDebtHistory([]);
      }
    } catch (error) {
      toast.error('网络错误');
      setDebtHistory([]);
    } finally {
      setDebtHistoryLoading(false);
    }
  };
  
  // 关闭欠款历史弹窗
  const closeDebtHistory = () => {
    setSelectedDebtCustomer(null);
    setDebtHistory([]);
    setCustomerCurrentBalance(null);
  };
  
  // 切换排序
  const toggleDebtSort = (field: 'cash_debt' | 'gold_balance' | 'name') => {
    if (debtSortBy === field) {
      setDebtSortOrder(debtSortOrder === 'desc' ? 'asc' : 'desc');
    } else {
      setDebtSortBy(field);
      setDebtSortOrder('desc');
    }
  };
  
  // 切换到欠款查询 Tab 时自动加载数据
  useEffect(() => {
    if (mainTab === 'debt') {
      fetchDebtSummary();
    }
  }, [mainTab, debtSortBy, debtSortOrder]);

  // 批量导入客户
  const handleBatchImport = async () => {
    if (!importFile) {
      toast.error('请选择文件');
      return;
    }

    setImporting(true);
    setImportResult(null);
    
    const formData = new FormData();
    formData.append('file', importFile);

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/customers/batch-import?user_role=${encodeURIComponent(userRole)}`,
        {
          method: 'POST',
          body: formData,
        }
      );

      const result = await response.json();
      setImportResult(result);

      if (result.success) {
        toast.success(result.message || `成功导入 ${result.created} 个客户`);
        // 刷新客户列表
        fetchCustomers();
        // 3秒后自动关闭
        setTimeout(() => {
          setShowImportModal(false);
          setImportFile(null);
          setImportResult(null);
        }, 3000);
      } else {
        toast.error(result.message || '导入失败');
      }
    } catch (error) {
      console.error('导入失败:', error);
      toast.error('导入失败，请检查文件格式和网络连接');
    } finally {
      setImporting(false);
    }
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
                    <h3 className="text-lg font-semibold text-gray-900 mb-6">账户状态</h3>
                    {(() => {
                      const cashDebt = customerDetail?.balance?.cash_debt || 0;
                      const goldDebt = customerDetail?.balance?.gold_debt || 0;
                      const goldDeposit = customerDetail?.balance?.gold_deposit || 0;
                      const netGold = goldDeposit - goldDebt;
                      
                      return (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          {/* 现金账户卡片 - 使用金色主题 */}
                          <div className={`p-6 rounded-xl border-2 transition-all duration-200 ${
                            cashDebt > 0 
                              ? 'bg-gradient-to-br from-amber-50 via-yellow-50 to-orange-50 border-amber-300 shadow-md hover:shadow-lg' 
                              : 'bg-gradient-to-br from-emerald-50 via-green-50 to-teal-50 border-emerald-300 shadow-sm hover:shadow-md'
                          }`}>
                            <div className="flex items-center justify-between mb-4">
                              <div className="flex items-center gap-3">
                                <div className={`p-3 rounded-lg ${
                                  cashDebt > 0 ? 'bg-amber-100' : 'bg-emerald-100'
                                }`}>
                                  <Wallet className={`w-5 h-5 ${
                                    cashDebt > 0 ? 'text-amber-600' : 'text-emerald-600'
                                  }`} />
                                </div>
                                <span className="text-sm font-medium text-gray-700">现金账户</span>
                              </div>
                              {cashDebt === 0 && (
                                <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-emerald-100 text-emerald-700 flex items-center gap-1">
                                  <CheckCircle className="w-3 h-3" />
                                  已结清
                                </span>
                              )}
                            </div>
                            <div className="mt-2">
                              {cashDebt > 0 ? (
                                <div>
                                  <p className="text-xs text-amber-700 mb-1 font-medium">欠款金额</p>
                                  <p className="text-2xl font-bold text-amber-900 font-mono">
                                    ¥{cashDebt.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </p>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <CheckCircle className="w-6 h-6 text-emerald-600" />
                                  <p className="text-xl font-bold text-emerald-700">无欠款</p>
                                </div>
                              )}
                            </div>
                          </div>
                          
                          {/* 金料账户卡片 - 使用蓝色/金色主题 */}
                          <div className={`p-6 rounded-xl border-2 transition-all duration-200 ${
                            netGold > 0 
                              ? 'bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 border-blue-300 shadow-sm hover:shadow-md' 
                              : netGold < 0 
                                ? 'bg-gradient-to-br from-amber-50 via-yellow-50 to-orange-50 border-amber-300 shadow-md hover:shadow-lg'
                                : 'bg-gray-50 border-gray-200 shadow-sm'
                          }`}>
                            <div className="flex items-center justify-between mb-4">
                              <div className="flex items-center gap-3">
                                <div className={`p-3 rounded-lg ${
                                  netGold > 0 ? 'bg-blue-100' : netGold < 0 ? 'bg-amber-100' : 'bg-gray-100'
                                }`}>
                                  <Diamond className={`w-5 h-5 ${
                                    netGold > 0 ? 'text-blue-600' : netGold < 0 ? 'text-amber-600' : 'text-gray-400'
                                  }`} />
                                </div>
                                <span className="text-sm font-medium text-gray-700">金料账户</span>
                              </div>
                              {netGold === 0 && (
                                <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-600">
                                  已结清
                                </span>
                              )}
                            </div>
                            <div className="mt-2">
                              {netGold > 0 ? (
                                <div>
                                  <p className="text-xs text-blue-700 mb-1 font-medium">净存料</p>
                                  <p className="text-2xl font-bold text-blue-900 font-mono">
                                    +{netGold.toFixed(2)}<span className="text-sm ml-1 font-normal">克</span>
                                  </p>
                                </div>
                              ) : netGold < 0 ? (
                                <div>
                                  <p className="text-xs text-amber-700 mb-1 font-medium">净欠料</p>
                                  <p className="text-2xl font-bold text-amber-900 font-mono">
                                    {netGold.toFixed(2)}<span className="text-sm ml-1 font-normal">克</span>
                                  </p>
                                </div>
                              ) : (
                                <div>
                                  <p className="text-xs text-gray-600 mb-1 font-medium">存料余额</p>
                                  <p className="text-lg font-semibold text-gray-500 font-mono">
                                    0.00<span className="text-sm ml-1 font-normal">克</span>
                                  </p>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* 往来账目 */}
                {detailTab === 'transactions' && (
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold text-gray-800">往来账目</h3>
                      <button
                        onClick={() => {
                          if (selectedCustomer) {
                            let url = `${API_BASE_URL}/api/export/customer-transactions/${selectedCustomer.id}`;
                            if (transDateStart || transDateEnd) {
                              url += `?date_start=${transDateStart || ''}&date_end=${transDateEnd || ''}`;
                            }
                            window.open(url, '_blank');
                          }
                        }}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm bg-green-50 text-green-600 rounded-lg hover:bg-green-100 transition-colors"
                      >
                        <Download className="w-4 h-4" />
                        <span>导出Excel</span>
                      </button>
                    </div>
                    
                    {/* 日期筛选 */}
                    <div className="flex items-center gap-3 mb-4 p-3 bg-gray-50 rounded-lg">
                      <span className="text-sm text-gray-600">日期范围：</span>
                      <input
                        type="date"
                        value={transDateStart}
                        onChange={(e) => setTransDateStart(e.target.value)}
                        className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <span className="text-gray-400">至</span>
                      <input
                        type="date"
                        value={transDateEnd}
                        onChange={(e) => setTransDateEnd(e.target.value)}
                        className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <button
                        onClick={filterTransactions}
                        className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                      >
                        查询
                      </button>
                      {(transDateStart || transDateEnd) && (
                        <button
                          onClick={() => {
                            setTransDateStart('');
                            setTransDateEnd('');
                            if (selectedCustomer) {
                              fetchCustomerDetail(selectedCustomer);
                            }
                          }}
                          className="px-3 py-1.5 text-sm bg-gray-200 text-gray-600 rounded-lg hover:bg-gray-300 transition-colors"
                        >
                          清除
                        </button>
                      )}
                    </div>
                    {(customerDetail?.transactions && customerDetail.transactions.length > 0) || customerDetail?.opening_balance ? (
                      <div className="space-y-3">
                        {/* 期初余额行 */}
                        {customerDetail?.opening_balance && (
                          <div className="p-4 bg-gray-200 rounded-xl border border-gray-300 flex items-center justify-between">
                            <div className="flex items-center space-x-3">
                              <div className="p-2 rounded-lg bg-gray-300">
                                <Clock className="w-4 h-4 text-gray-600" />
                              </div>
                              <div className="flex-1">
                                <p className="font-medium text-gray-700">{customerDetail.opening_balance.description}</p>
                                <p className="text-sm text-gray-500">统计起始点</p>
                              </div>
                            </div>
                            <div className="text-right">
                              {customerDetail.opening_balance.amount !== null && customerDetail.opening_balance.amount !== undefined && (
                                <p className={`font-semibold ${customerDetail.opening_balance.amount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                  {customerDetail.opening_balance.amount >= 0 ? '+' : ''}{customerDetail.opening_balance.amount.toFixed(2)}元
                                </p>
                              )}
                              {customerDetail.opening_balance.gold_weight !== null && customerDetail.opening_balance.gold_weight !== undefined && (
                                <p className={`text-sm ${customerDetail.opening_balance.gold_weight >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                  {customerDetail.opening_balance.gold_weight >= 0 ? '+' : ''}{customerDetail.opening_balance.gold_weight.toFixed(2)}g
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                        
                        {/* 往来记录 */}
                        {customerDetail?.transactions?.map((tx) => (
                          <div key={tx.id} className="p-4 bg-gray-50 rounded-xl border border-gray-200 flex items-center justify-between">
                            <div className="flex items-center space-x-3">
                              <div className={`p-2 rounded-lg ${
                                tx.type === 'sales_labor' ? 'bg-green-100' :
                                tx.type === 'customer_receipt' ? 'bg-yellow-100' :
                                tx.type === 'customer_withdrawal' ? 'bg-purple-100' :
                                tx.type === 'settle_cash' ? 'bg-cyan-100' :
                                tx.type === 'settle_gold' ? 'bg-orange-100' :
                                tx.type === 'settle_mixed' ? 'bg-pink-100' :
                                tx.type === 'customer_payment' ? 'bg-blue-100' :
                                'bg-gray-100'
                              }`}>
                                {tx.type === 'sales_labor' && <ShoppingBag className="w-4 h-4 text-green-600" />}
                                {tx.type === 'customer_receipt' && <Diamond className="w-4 h-4 text-yellow-600" />}
                                {tx.type === 'customer_withdrawal' && <TrendingDown className="w-4 h-4 text-purple-600" />}
                                {tx.type === 'settle_cash' && <Calculator className="w-4 h-4 text-cyan-600" />}
                                {tx.type === 'settle_gold' && <Diamond className="w-4 h-4 text-orange-600" />}
                                {tx.type === 'settle_mixed' && <Calculator className="w-4 h-4 text-pink-600" />}
                                {tx.type === 'customer_payment' && <Wallet className="w-4 h-4 text-blue-600" />}
                              </div>
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <p className="font-medium text-gray-900">{tx.description}</p>
                                  {tx.type_label && (
                                    <span className="text-xs px-2 py-0.5 bg-gray-200 text-gray-600 rounded">{tx.type_label}</span>
                                  )}
                                </div>
                                <p className="text-sm text-gray-500">{new Date(tx.created_at).toLocaleString()}</p>
                                {tx.remark && (
                                  <p className="text-sm text-gray-600 mt-1 bg-gray-100 px-2 py-1 rounded inline-block">
                                    📝 {tx.remark}
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="text-right">
                              {tx.amount !== null && (
                                <p className={`font-semibold ${tx.amount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                  {tx.amount >= 0 ? '+' : ''}{tx.amount.toFixed(2)}元
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
            <h1 className="text-2xl font-bold text-gray-900">客户管理</h1>
            <p className="text-sm text-gray-500">管理客户信息和欠款查询</p>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          {mainTab === 'list' && canAdd && (
            <>
              <button
                onClick={() => setShowImportModal(true)}
                className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-xl
                           hover:bg-green-700 transition-all"
              >
                <Upload className="w-4 h-4" />
                <span>批量导入</span>
              </button>
              <button
                onClick={() => setShowAddForm(!showAddForm)}
                className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-xl
                           hover:bg-blue-700 transition-all"
              >
                <UserPlus className="w-4 h-4" />
                <span>新增客户</span>
              </button>
            </>
          )}
          <button
            onClick={mainTab === 'list' ? () => fetchCustomers(currentPage) : fetchDebtSummary}
            className="flex items-center space-x-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-xl
                       hover:bg-gray-200 transition-all"
          >
            <RefreshCw className={`w-4 h-4 ${(loading || debtLoading) ? 'animate-spin' : ''}`} />
            <span>刷新</span>
          </button>
        </div>
      </div>
      
      {/* 主 Tab 切换 */}
      <div className="flex space-x-2 mb-6">
        <button
          onClick={() => setMainTab('list')}
          className={`flex items-center space-x-2 px-5 py-3 rounded-xl font-medium transition-all ${
            mainTab === 'list'
              ? 'bg-blue-600 text-white shadow-md'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>客户列表</span>
        </button>
        <button
          onClick={() => setMainTab('debt')}
          className={`flex items-center space-x-2 px-5 py-3 rounded-xl font-medium transition-all ${
            mainTab === 'debt'
              ? 'bg-orange-600 text-white shadow-md'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          <CreditCard className="w-4 h-4" />
          <span>欠款查询</span>
          {debtSummary.customer_count > 0 && mainTab !== 'debt' && (
            <span className="ml-1 px-2 py-0.5 text-xs bg-red-500 text-white rounded-full">
              {debtSummary.customer_count}
            </span>
          )}
        </button>
      </div>
      
      {/* ============= 客户列表 Tab ============= */}
      {mainTab === 'list' && (
        <>

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
              onClick={() => { setSearchName(''); setCurrentPage(1); fetchCustomers(1); }}
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
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
          <h2 className="text-lg font-semibold text-gray-800">
            客户列表 (共{totalCustomers}人，第{currentPage}/{totalPages}页)
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
            
            {/* 分页控件 */}
            {totalPages > 1 && (
              <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between bg-gray-50">
                <div className="text-sm text-gray-600">
                  显示 {(currentPage - 1) * pageSize + 1}-{Math.min(currentPage * pageSize, totalCustomers)} 条，共 {totalCustomers} 条
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => fetchCustomers(1)}
                    disabled={currentPage === 1}
                    className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                      currentPage === 1 
                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                        : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    首页
                  </button>
                  <button
                    onClick={() => fetchCustomers(currentPage - 1)}
                    disabled={currentPage === 1}
                    className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                      currentPage === 1 
                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                        : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    上一页
                  </button>
                  <span className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg">
                    {currentPage}
                  </span>
                  <button
                    onClick={() => fetchCustomers(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                      currentPage === totalPages 
                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                        : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    下一页
                  </button>
                  <button
                    onClick={() => fetchCustomers(totalPages)}
                    disabled={currentPage === totalPages}
                    className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                      currentPage === totalPages 
                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                        : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    末页
                  </button>
                </div>
              </div>
            )}
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
      </>
      )}
      
      {/* ============= 欠款查询 Tab ============= */}
      {mainTab === 'debt' && (
        <>
          {/* 欠款汇总统计卡片 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-gradient-to-br from-red-50 to-red-100 rounded-2xl p-5 border border-red-200">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-red-600 font-medium">现金欠款总计</p>
                  <p className="text-2xl font-bold text-red-700 mt-1">
                    ¥{debtSummary.total_cash_debt.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div className="p-3 bg-red-200/50 rounded-xl">
                  <Wallet className="w-6 h-6 text-red-600" />
                </div>
              </div>
            </div>
            <div className={`bg-gradient-to-br rounded-2xl p-5 border ${
              (debtSummary.total_gold_balance || 0) >= 0 
                ? 'from-orange-50 to-orange-100 border-orange-200' 
                : 'from-green-50 to-green-100 border-green-200'
            }`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className={`text-sm font-medium ${
                    (debtSummary.total_gold_balance || 0) >= 0 ? 'text-orange-600' : 'text-green-600'
                  }`}>
                    {(debtSummary.total_gold_balance || 0) >= 0 ? '金料欠款总计' : '金料存料总计'}
                  </p>
                  <p className={`text-2xl font-bold mt-1 ${
                    (debtSummary.total_gold_balance || 0) >= 0 ? 'text-orange-700' : 'text-green-700'
                  }`}>
                    {(debtSummary.total_gold_balance || 0) >= 0 
                      ? `${(debtSummary.total_gold_balance || 0).toFixed(2)} 克`
                      : `${Math.abs(debtSummary.total_gold_balance || 0).toFixed(2)} 克`
                    }
                  </p>
                </div>
                <div className={`p-3 rounded-xl ${
                  (debtSummary.total_gold_balance || 0) >= 0 ? 'bg-orange-200/50' : 'bg-green-200/50'
                }`}>
                  <TrendingDown className={`w-6 h-6 ${
                    (debtSummary.total_gold_balance || 0) >= 0 ? 'text-orange-600' : 'text-green-600'
                  }`} />
                </div>
              </div>
            </div>
            <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-2xl p-5 border border-blue-200">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-blue-600 font-medium">欠款客户数</p>
                  <p className="text-2xl font-bold text-blue-700 mt-1">
                    {debtSummary.customer_count} 人
                  </p>
                </div>
                <div className="p-3 bg-blue-200/50 rounded-xl">
                  <Users className="w-6 h-6 text-blue-600" />
                </div>
              </div>
            </div>
          </div>
          
          {/* 搜索和排序 */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 mb-6">
            <div className="flex items-center space-x-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={debtSearch}
                  onChange={(e) => setDebtSearch(e.target.value)}
                  placeholder="搜索客户名称..."
                  className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-xl focus:outline-none 
                             focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  onKeyPress={(e) => e.key === 'Enter' && fetchDebtSummary()}
                />
              </div>
              <button
                onClick={fetchDebtSummary}
                className="px-6 py-2.5 bg-orange-600 text-white rounded-xl hover:bg-orange-700 transition-all"
              >
                搜索
              </button>
              {debtSearch && (
                <button
                  onClick={() => { setDebtSearch(''); fetchDebtSummary(); }}
                  className="px-4 py-2.5 bg-gray-100 text-gray-600 rounded-xl hover:bg-gray-200 transition-all"
                >
                  清除
                </button>
              )}
            </div>
          </div>
          
          {/* 欠款客户列表 */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
              <h2 className="text-lg font-semibold text-gray-800">
                欠款客户列表 ({debtList.length}人)
              </h2>
            </div>
            
            {debtLoading ? (
              <div className="p-12 text-center text-gray-500">
                <RefreshCw className="w-8 h-8 mx-auto mb-3 animate-spin text-orange-500" />
                <p>加载中...</p>
              </div>
            ) : debtList.length === 0 ? (
              <div className="p-12 text-center text-gray-500">
                <CreditCard className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                <p>暂无欠款客户</p>
                <p className="text-sm mt-2">所有客户账款已结清 🎉</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        <button
                          onClick={() => toggleDebtSort('name')}
                          className="flex items-center space-x-1 hover:text-gray-700"
                        >
                          <span>客户名称</span>
                          {debtSortBy === 'name' && (
                            <ArrowUpDown className="w-3 h-3" />
                          )}
                        </button>
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">业务人员</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">电话</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        <button
                          onClick={() => toggleDebtSort('cash_debt')}
                          className="flex items-center space-x-1 hover:text-gray-700"
                        >
                          <span>现金欠款</span>
                          {debtSortBy === 'cash_debt' && (
                            <ArrowUpDown className="w-3 h-3" />
                          )}
                        </button>
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        <button
                          onClick={() => toggleDebtSort('gold_balance')}
                          className="flex items-center space-x-1 hover:text-gray-700"
                        >
                          <span>欠料</span>
                          {debtSortBy === 'gold_balance' && (
                            <ArrowUpDown className="w-3 h-3" />
                          )}
                        </button>
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">最后交易</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {debtList.map((item) => (
                      <tr key={item.customer_id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3">
                          <span className="font-medium text-gray-900">{item.customer_name}</span>
                          <span className="text-xs text-gray-400 ml-2">{item.customer_no}</span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {item.salesperson || '-'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {item.phone || '-'}
                        </td>
                        <td className="px-4 py-3">
                          {item.cash_debt > 0 ? (
                            <span className="font-semibold text-red-600">¥{item.cash_debt.toFixed(2)}</span>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {(item.gold_balance || 0) > 0.001 ? (
                            <span className="font-semibold text-orange-600">+{item.gold_balance.toFixed(2)}克</span>
                          ) : (item.gold_balance || 0) < -0.001 ? (
                            <span className="font-semibold text-green-600">{item.gold_balance.toFixed(2)}克</span>
                          ) : (
                            <span className="text-gray-400">0</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500">
                          {item.last_transaction_date || '-'}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => fetchDebtHistory(item)}
                            className="flex items-center space-x-1 px-3 py-1.5 bg-orange-100 text-orange-700 
                                       rounded-lg hover:bg-orange-200 transition-colors text-sm"
                          >
                            <Eye className="w-4 h-4" />
                            <span>查看明细</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          
          {/* 提示信息 */}
          <div className="mt-6 p-4 bg-orange-50 rounded-xl border border-orange-100">
            <p className="text-sm text-orange-800">
              💡 <strong>提示：</strong>
              点击"查看明细"可查看客户的完整交易历史和欠款变化记录。点击表头可按该列排序。
            </p>
          </div>
        </>
      )}
      
      {/* ============= 欠款历史弹窗 ============= */}
      {selectedDebtCustomer && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
            {/* 弹窗头部 */}
            <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-orange-50 to-red-50">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <button
                    onClick={closeDebtHistory}
                    className="p-2 hover:bg-white/50 rounded-lg transition-colors"
                  >
                    <ArrowLeft className="w-5 h-5 text-gray-600" />
                  </button>
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">{selectedDebtCustomer.customer_name}</h2>
                    <p className="text-sm text-gray-500">{selectedDebtCustomer.customer_no} · 欠款明细</p>
                  </div>
                </div>
                <button
                  onClick={closeDebtHistory}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>
            </div>
            
            {/* 当前余额概览 */}
            {customerCurrentBalance && (
              <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
                <div className="grid grid-cols-2 gap-6">
                  <div className="text-center">
                    <p className="text-xs text-gray-500 mb-1">💰 现金账户</p>
                    <p className={`text-lg font-bold ${customerCurrentBalance.cash_debt > 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {customerCurrentBalance.cash_debt > 0 ? `欠款 ¥${customerCurrentBalance.cash_debt.toFixed(2)}` : '无欠款 ✓'}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-gray-500 mb-1">💎 金料账户</p>
                    {(() => {
                      const net = customerCurrentBalance.gold_deposit - customerCurrentBalance.gold_debt;
                      return (
                        <p className={`text-lg font-bold ${net > 0 ? 'text-green-600' : net < 0 ? 'text-red-600' : 'text-gray-600'}`}>
                          {net > 0 ? `净存料 +${net.toFixed(2)}克` : net < 0 ? `净欠料 ${net.toFixed(2)}克` : '已结清'}
                        </p>
                      );
                    })()}
                  </div>
                </div>
              </div>
            )}
            
            {/* 交易历史列表 */}
            <div className="flex-1 overflow-y-auto p-6">
              {debtHistoryLoading ? (
                <div className="flex items-center justify-center py-12">
                  <RefreshCw className="w-8 h-8 animate-spin text-orange-500" />
                  <span className="ml-3 text-gray-500">加载中...</span>
                </div>
              ) : debtHistory.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <FileText className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p>暂无交易记录</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {debtHistory.map((tx) => (
                    <div key={tx.id} className="p-4 bg-gray-50 rounded-xl border border-gray-200">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <div className={`p-2 rounded-lg ${
                            tx.type === 'sale' ? 'bg-green-100' :
                            tx.type === 'settlement' ? 'bg-blue-100' :
                            tx.type === 'payment' ? 'bg-purple-100' :
                            tx.type === 'gold_deposit' ? 'bg-yellow-100' :
                            'bg-gray-100'
                          }`}>
                            {tx.type === 'sale' && <ShoppingBag className="w-4 h-4 text-green-600" />}
                            {tx.type === 'settlement' && <FileText className="w-4 h-4 text-blue-600" />}
                            {tx.type === 'payment' && <Wallet className="w-4 h-4 text-purple-600" />}
                            {tx.type === 'gold_deposit' && <TrendingDown className="w-4 h-4 text-yellow-600" />}
                            {tx.type === 'transaction' && <Clock className="w-4 h-4 text-gray-600" />}
                          </div>
                          <div>
                            <div className="flex items-center space-x-2">
                              <span className={`px-2 py-0.5 text-xs rounded-full ${
                                tx.type === 'sale' ? 'bg-green-100 text-green-700' :
                                tx.type === 'settlement' ? 'bg-blue-100 text-blue-700' :
                                tx.type === 'payment' ? 'bg-purple-100 text-purple-700' :
                                tx.type === 'gold_deposit' ? 'bg-yellow-100 text-yellow-700' :
                                'bg-gray-100 text-gray-700'
                              }`}>
                                {tx.type_label}
                              </span>
                              <span className="text-xs text-gray-400">{tx.order_no}</span>
                            </div>
                            <p className="font-medium text-gray-900 mt-1">{tx.description}</p>
                            <p className="text-xs text-gray-500 mt-1">
                              {tx.created_at ? new Date(tx.created_at).toLocaleString() : '-'}
                              {tx.operator && <span className="ml-2">· 操作人：{tx.operator}</span>}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          {tx.cash_amount !== 0 && (
                            <p className={`font-semibold ${tx.cash_amount > 0 ? 'text-red-600' : 'text-green-600'}`}>
                              {tx.cash_amount > 0 ? '+' : ''}¥{tx.cash_amount.toFixed(2)}
                            </p>
                          )}
                          {tx.gold_amount !== 0 && (
                            <p className={`text-sm ${tx.gold_amount > 0 ? 'text-orange-600' : 'text-green-600'}`}>
                              {tx.gold_amount > 0 ? '+' : ''}{tx.gold_amount.toFixed(2)}克
                            </p>
                          )}
                          {tx.gold_debt_after !== undefined && (
                            <p className="text-xs text-gray-400 mt-1">
                              欠料余额：{tx.gold_debt_after.toFixed(2)}克
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 批量导入模态框 */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                  <FileText className="w-6 h-6 text-blue-600" />
                  批量导入客户
                </h3>
                <button
                  onClick={() => {
                    setShowImportModal(false);
                    setImportFile(null);
                    setImportResult(null);
                  }}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                  disabled={importing}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  选择文件（支持 Excel、CSV、TXT）
                </label>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv,.txt"
                  onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                  className="w-full border border-gray-300 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={importing}
                />
                <div className="mt-3 text-xs text-gray-500 space-y-1">
                  <p>• <strong>Excel/CSV 格式：</strong>第一列为姓名，其他列可选（电话、微信、地址、类型、备注）</p>
                  <p>• <strong>TXT 格式：</strong>每行一个姓名</p>
                  <p>• <strong>支持2000+条数据批量导入</strong></p>
                </div>
              </div>

              {importResult && (
                <div className={`mb-6 p-4 rounded-lg border ${
                  importResult.success 
                    ? 'bg-green-50 border-green-200' 
                    : 'bg-red-50 border-red-200'
                }`}>
                  <div className="flex items-start gap-3">
                    {importResult.success ? (
                      <Check className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
                    ) : (
                      <X className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
                    )}
                    <div className="flex-1">
                      <p className={`font-medium ${importResult.success ? 'text-green-800' : 'text-red-800'}`}>
                        {importResult.message}
                      </p>
                      {importResult.results && (
                        <div className="mt-3 text-sm space-y-2">
                          <div className="flex gap-4">
                            <span className="text-gray-700">
                              <strong>总计：</strong>{importResult.results.total} 条
                            </span>
                            <span className="text-green-600">
                              <strong>成功：</strong>{importResult.results.created} 条
                            </span>
                            <span className="text-yellow-600">
                              <strong>跳过：</strong>{importResult.results.skipped} 条
                            </span>
                            {importResult.results.errors?.length > 0 && (
                              <span className="text-red-600">
                                <strong>失败：</strong>{importResult.results.errors.length} 条
                              </span>
                            )}
                          </div>
                          {importResult.results.elapsed_time && (
                            <p className="text-gray-500 text-xs">
                              耗时：{importResult.results.elapsed_time.toFixed(2)} 秒
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={handleBatchImport}
                  disabled={!importFile || importing}
                  className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 
                             disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors 
                             flex items-center justify-center gap-2"
                >
                  {importing ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>导入中...</span>
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4" />
                      <span>开始导入</span>
                    </>
                  )}
                </button>
                <button
                  onClick={() => {
                    setShowImportModal(false);
                    setImportFile(null);
                    setImportResult(null);
                  }}
                  className="px-4 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                  disabled={importing}
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomerPage;

