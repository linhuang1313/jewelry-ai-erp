import React, { useState, useEffect, useCallback, useRef } from 'react';
import { API_ENDPOINTS } from '../config';
import {
  FileText, Check, Clock, AlertCircle, RefreshCw, X, Package, User,
  Search, Filter, RotateCcw, Undo2, History, Printer,
  Plus, Trash2, Eye, ArrowLeft, ChevronDown, ChevronUp
} from 'lucide-react';
import toast from 'react-hot-toast';
import ConfirmationDialog from './ui/ConfirmationDialog';
import AsyncSearchSelect from './ui/AsyncSearchSelect';

// ============= 类型定义 =============

interface LoanDetail {
  id: number;
  loan_id: number;
  product_name: string;
  product_code?: string | null;
  weight: number;
  piece_count?: number | null;
  status: string;
  returned_at: string | null;
  returned_by: string | null;
}

interface LoanOrder {
  id: number;
  loan_no: string;
  customer_id: number;
  customer_name: string;
  total_weight: number;
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
  details: LoanDetail[];
  item_count: number;
  returns?: any[];
}

interface LoanReturnOrder {
  id: number;
  return_no: string;
  loan_id: number;
  loan_no: string;
  customer_id: number;
  customer_name: string;
  total_weight: number;
  operator: string | null;
  created_at: string;
  remark: string | null;
  printed_at: string | null;
  details: LoanReturnDetail[];
  item_count: number;
}

interface LoanReturnDetail {
  id: number;
  return_id: number;
  loan_detail_id: number;
  product_name: string;
  weight: number;
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

interface Product {
  code: string;
  name: string;
  product_name: string;
  total_weight: number;
}

interface Salesperson {
  id: number;
  name: string;
}

interface CreateItem {
  product_name: string;
  product_display: string;
  weight: string;
  piece_count: string;
}

// ============= 辅助组件 =============

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    pending: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: '待确认' },
    borrowed: { bg: 'bg-blue-100', text: 'text-blue-700', label: '已借出' },
    partial_returned: { bg: 'bg-purple-100', text: 'text-purple-700', label: '部分归还' },
    returned: { bg: 'bg-green-100', text: 'text-green-700', label: '已归还' },
    cancelled: { bg: 'bg-red-100', text: 'text-red-700', label: '已撤销' },
  };
  const { bg, text, label } = config[status] || { bg: 'bg-gray-100', text: 'text-gray-700', label: status };
  return <span className={`px-2 py-1 rounded-full text-xs font-medium ${bg} ${text}`}>{label}</span>;
};

const TabButton: React.FC<{
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count?: number;
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
      }`}>{count}</span>
    )}
  </button>
);

// ============= 主组件 =============

const LoanPage: React.FC = () => {
  type TabType = 'orders' | 'returns';
  
  const [activeTab, setActiveTab] = useState<TabType>('orders');
  const [loanOrders, setLoanOrders] = useState<LoanOrder[]>([]);
  const [loanReturns, setLoanReturns] = useState<LoanReturnOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{isOpen: boolean, title: string, message: string, onConfirm: () => void, isDestructive?: boolean}>({isOpen: false, title: '', message: '', onConfirm: () => {}});
  
  // 弹窗
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showLogsModal, setShowLogsModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [showReturnDetailModal, setShowReturnDetailModal] = useState(false);
  
  const [selectedLoan, setSelectedLoan] = useState<LoanOrder | null>(null);
  const [selectedReturnDetail, setSelectedReturnDetail] = useState<LoanReturnOrder | null>(null);
  const [detailData, setDetailData] = useState<any>(null);
  const [logs, setLogs] = useState<LoanOrderLog[]>([]);
  const [cancelReason, setCancelReason] = useState('');
  
  // 还货单选择
  const [returnDetailIds, setReturnDetailIds] = useState<number[]>([]);
  const [returnRemark, setReturnRemark] = useState('');
  
  // 从还货单tab创建还货单的流程状态
  const [showReturnCreateFlow, setShowReturnCreateFlow] = useState(false);
  const [returnFlowStep, setReturnFlowStep] = useState<'search' | 'select'>('search');
  const [returnCustomerSearch, setReturnCustomerSearch] = useState('');
  const [returnFlowLoans, setReturnFlowLoans] = useState<LoanOrder[]>([]);
  const [returnFlowLoading, setReturnFlowLoading] = useState(false);
  
  // 汇总
  const [outstandingWeight, setOutstandingWeight] = useState(0);
  
  // 基础数据
  const [products, setProducts] = useState<Product[]>([]);
  const [salespersons, setSalespersons] = useState<Salesperson[]>([]);
  
  // 创建表单
  const [showSalespersonDropdown, setShowSalespersonDropdown] = useState(false);
  
  const [createForm, setCreateForm] = useState({
    customer_id: 0,
    customer_name: '',
    salesperson: '',
    loan_date: new Date().toISOString().split('T')[0],
    remark: '',
  });
  
  // 多商品行
  const [createItems, setCreateItems] = useState<CreateItem[]>([
    { product_name: '', product_display: '', weight: '', piece_count: '' }
  ]);
  
  // 商品行的搜索状态
  const [activeItemIndex, setActiveItemIndex] = useState<number | null>(null);
  const [itemProductSearch, setItemProductSearch] = useState('');
  const [itemFilteredProducts, setItemFilteredProducts] = useState<Product[]>([]);
  const [dropdownPos, setDropdownPos] = useState<{top: number; left: number; width: number} | null>(null);
  const itemInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  
  // 搜索筛选
  const [searchFilters, setSearchFilters] = useState({ customer_name: '', product_name: '', status: '' });
  
  // 分页状态
  const [orderPage, setOrderPage] = useState(1);
  const [orderTotalPages, setOrderTotalPages] = useState(0);
  const [orderTotal, setOrderTotal] = useState(0);
  const [returnPage, setReturnPage] = useState(1);
  const [returnTotalPages, setReturnTotalPages] = useState(0);
  const [returnTotal, setReturnTotal] = useState(0);
  const pageSize = 20;

  const API_BASE = API_ENDPOINTS.API_BASE_URL;

  // ============= 数据加载 =============
  
  const fetchCustomers = useCallback(async (search: string) => {
    const url = search
      ? `${API_BASE}/api/customers?name=${encodeURIComponent(search)}&page_size=50`
      : `${API_BASE}/api/customers?page_size=50`;
    const response = await fetch(url);
    const data = await response.json();
    const customers = data.data?.customers || data.customers || [];
    return customers.map((c: any) => ({
      value: c.id,
      label: c.name,
      sublabel: c.phone || undefined,
    }));
  }, [API_BASE]);

  const loadProducts = async () => {
    try {
      const [codesRes, inventoryRes] = await Promise.all([
        fetch(`${API_BASE}/api/product-codes?code_type=predefined&include_used=true&limit=500`),
        fetch(`${API_BASE}/api/warehouse/inventory/summary`)
      ]);
      const codes = codesRes.ok ? await codesRes.json() : [];
      const inventory = inventoryRes.ok ? await inventoryRes.json() : [];
      
      const inventoryMap = new Map<string, number>();
      if (Array.isArray(inventory)) {
        inventory.forEach((item: any) => {
          inventoryMap.set(item.product_name, (inventoryMap.get(item.product_name) || 0) + (item.total_weight || 0));
        });
      }
      if (Array.isArray(codes)) {
        setProducts(codes.map((code: any) => ({
          code: code.code,
          name: code.name,
          product_name: code.name,
          total_weight: inventoryMap.get(code.name) || 0
        })));
      }
    } catch (error) {
      console.error('加载产品列表失败:', error);
    }
  };

  const loadSalespersons = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/salespersons`);
      if (response.ok) {
        const result = await response.json();
        if (result.success && result.salespersons) setSalespersons(result.salespersons);
      }
    } catch (error) {
      console.error('加载业务员列表失败:', error);
    }
  };

  const loadLoanOrders = useCallback(async (page = orderPage) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchFilters.status) params.append('status', searchFilters.status);
      if (searchFilters.customer_name) params.append('customer_name', searchFilters.customer_name);
      if (searchFilters.product_name) params.append('product_name', searchFilters.product_name);
      params.append('page', String(page));
      params.append('page_size', String(pageSize));
      
      const response = await fetch(`${API_BASE}/api/loan/orders?${params.toString()}`);
      if (response.ok) {
        const result = await response.json();
        if (result.success && result.data?.orders) {
          setLoanOrders(result.data.orders);
          setOrderTotal(result.data.total || 0);
          setOrderTotalPages(result.data.total_pages || 0);
          setOrderPage(result.data.page || page);
        } else {
          setLoanOrders(Array.isArray(result) ? result : []);
        }
      } else {
        toast.error('加载暂借单失败');
      }
    } catch (error) {
      console.error('加载暂借单失败:', error);
    } finally {
      setLoading(false);
    }
  }, [searchFilters, orderPage, API_BASE]);

  const loadLoanReturns = useCallback(async (page = returnPage) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchFilters.customer_name) params.append('customer_name', searchFilters.customer_name);
      params.append('page', String(page));
      params.append('page_size', String(pageSize));
      
      const response = await fetch(`${API_BASE}/api/loan/returns?${params.toString()}`);
      if (response.ok) {
        const result = await response.json();
        if (result.success && result.data?.returns) {
          setLoanReturns(result.data.returns);
          setReturnTotal(result.data.total || 0);
          setReturnTotalPages(result.data.total_pages || 0);
          setReturnPage(result.data.page || page);
        } else {
          setLoanReturns(Array.isArray(result) ? result : []);
        }
      }
    } catch (error) {
      console.error('加载还货单失败:', error);
    } finally {
      setLoading(false);
    }
  }, [searchFilters, returnPage, API_BASE]);

  const loadSummary = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/loan/summary`);
      if (response.ok) {
        const result = await response.json();
        if (result.success) setOutstandingWeight(result.data.outstanding_weight || 0);
      }
    } catch (error) {
      console.error('加载汇总失败:', error);
    }
  };

  // ============= 搜索过滤 =============
  
  useEffect(() => {
    if (itemProductSearch.trim()) {
      const keyword = itemProductSearch.toLowerCase();
      const filtered = products.filter(p =>
        p.code.toLowerCase().includes(keyword) || p.name.toLowerCase().includes(keyword)
      );
      setItemFilteredProducts(filtered.slice(0, 10));
    } else {
      setItemFilteredProducts(products.slice(0, 10));
    }
  }, [itemProductSearch, products]);

  // ============= 选择处理 =============
  
  const handleSelectItemProduct = (product: Product, index: number) => {
    const newItems = [...createItems];
    newItems[index] = {
      ...newItems[index],
      product_name: product.product_name,
      product_display: `${product.code} ${product.name}`,
    };
    setCreateItems(newItems);
    setActiveItemIndex(null);
    setItemProductSearch('');
  };

  const handleSelectSalesperson = (sp: Salesperson) => {
    setCreateForm({ ...createForm, salesperson: sp.name });
    setShowSalespersonDropdown(false);
  };

  // ============= 多商品行操作 =============
  
  const addItem = () => {
    setCreateItems([...createItems, { product_name: '', product_display: '', weight: '', piece_count: '' }]);
  };
  
  const removeItem = (index: number) => {
    if (createItems.length <= 1) return;
    setCreateItems(createItems.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, field: keyof CreateItem, value: string) => {
    const newItems = [...createItems];
    newItems[index] = { ...newItems[index], [field]: value };
    setCreateItems(newItems);
  };

  // ============= 业务操作 =============
  
  const handleCreate = async () => {
    if (!createForm.customer_id || !createForm.salesperson) {
      toast.error('请选择客户和业务员');
      return;
    }
    
    const validItems = createItems.filter(item => item.product_name && item.weight);
    if (validItems.length === 0) {
      toast.error('请添加至少一个商品');
      return;
    }
    
    try {
      const response = await fetch(`${API_BASE}/api/loan/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: createForm.customer_id,
          items: validItems.map(item => ({
            product_name: item.product_name,
            weight: parseFloat(item.weight),
            piece_count: item.piece_count ? parseInt(item.piece_count) : null,
          })),
          salesperson: createForm.salesperson,
          loan_date: new Date(createForm.loan_date).toISOString(),
          remark: createForm.remark || null,
          created_by: '结算专员',
        }),
      });
      
      if (response.ok) {
        const result = await response.json();
        toast.success(result.message || '暂借单创建成功');
        resetCreateForm();
        loadLoanOrders();
        loadSummary();
      } else {
        const error = await response.json();
        toast.error(error.detail || '创建失败');
      }
    } catch (error) {
      console.error('创建暂借单失败:', error);
      toast.error('网络错误');
    }
  };

  const resetCreateForm = () => {
    setShowCreateModal(false);
    setCreateForm({ customer_id: 0, customer_name: '', salesperson: '', loan_date: new Date().toISOString().split('T')[0], remark: '' });
    setCreateItems([{ product_name: '', product_display: '', weight: '', piece_count: '' }]);
    setShowSalespersonDropdown(false);
  };

  const handleConfirm = (loan: LoanOrder) => {
    const details = loan.details || [];
    const productList = details.map(d => `${d.product_name} ${d.weight.toFixed(3)}克`).join('\n');
    const message = `客户：${loan.customer_name}\n商品（${details.length} 件）：\n${productList}\n\n总克重：${loan.total_weight.toFixed(3)}克\n\n确认后将从库存中扣减。确定？`;
    setConfirmDialog({
      isOpen: true,
      title: '确认借出',
      message,
      isDestructive: false,
      onConfirm: async () => {
        setConfirmDialog(prev => ({...prev, isOpen: false}));
        try {
          const response = await fetch(`${API_BASE}/api/loan/orders/${loan.id}/confirm`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ operator: '结算专员' }),
          });
          if (response.ok) {
            toast.success('确认借出成功');
            loadLoanOrders();
            loadSummary();
          } else {
            const error = await response.json();
            toast.error(error.detail || '操作失败');
          }
        } catch (error) {
          toast.error('网络错误');
        }
      }
    });
  };

  const handleCancel = async () => {
    if (!selectedLoan || !cancelReason.trim()) {
      toast.error('请填写撤销原因');
      return;
    }
    try {
      const response = await fetch(`${API_BASE}/api/loan/orders/${selectedLoan.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operator: '结算专员', reason: cancelReason.trim() }),
      });
      if (response.ok) {
        toast.success('撤销成功');
        setShowCancelModal(false);
        setSelectedLoan(null);
        setCancelReason('');
        loadLoanOrders();
        loadSummary();
      } else {
        const error = await response.json();
        toast.error(error.detail || '撤销失败');
      }
    } catch (error) {
      toast.error('网络错误');
    }
  };

  // 查看暂借单详情
  const handleViewDetail = async (loan: LoanOrder) => {
    try {
      const response = await fetch(`${API_BASE}/api/loan/orders/${loan.id}`);
      if (response.ok) {
        const data = await response.json();
        setDetailData(data);
        setShowDetailModal(true);
      }
    } catch (error) {
      toast.error('加载详情失败');
    }
  };

  // 打开还货单创建弹窗
  const openReturnModal = (loan: LoanOrder) => {
    setSelectedLoan(loan);
    // 默认全选所有未还商品
    const borrowedIds = (loan.details || [])
      .filter(d => d.status === 'borrowed')
      .map(d => d.id);
    setReturnDetailIds(borrowedIds);
    setReturnRemark('');
    setShowReturnModal(true);
  };

  // 创建还货单
  const handleCreateReturn = async () => {
    if (!selectedLoan || returnDetailIds.length === 0) {
      toast.error('请选择要归还的商品');
      return;
    }
    try {
      const response = await fetch(`${API_BASE}/api/loan/returns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          loan_id: selectedLoan.id,
          detail_ids: returnDetailIds,
          operator: '结算专员',
          remark: returnRemark || null,
        }),
      });
      if (response.ok) {
        const result = await response.json();
        toast.success(result.message || '还货单创建成功');
        setShowReturnModal(false);
        setSelectedLoan(null);
        setReturnDetailIds([]);
        setReturnRemark('');
        loadLoanOrders();
        loadSummary();
        if (activeTab === 'returns') loadLoanReturns();
      } else {
        const error = await response.json();
        toast.error(error.detail || '创建还货单失败');
      }
    } catch (error) {
      toast.error('网络错误');
    }
  };

  // 从还货单tab搜索有未还商品的借货单
  const searchLoansForReturn = async (customerName?: string) => {
    setReturnFlowLoading(true);
    try {
      const statusesToSearch = ['borrowed', 'partial_returned'];
      const allOrders: LoanOrder[] = [];
      
      for (const status of statusesToSearch) {
        const params = new URLSearchParams();
        params.append('status', status);
        if (customerName) params.append('customer_name', customerName);
        params.append('page_size', '100');
        
        const response = await fetch(`${API_BASE}/api/loan/orders?${params.toString()}`);
        if (response.ok) {
          const result = await response.json();
          const orders: LoanOrder[] = result.success && result.data?.orders ? result.data.orders : (Array.isArray(result) ? result : []);
          allOrders.push(...orders);
        }
      }
      
      const seenIds = new Set<number>();
      const unique = allOrders.filter(o => {
        if (seenIds.has(o.id)) return false;
        seenIds.add(o.id);
        return (o.details || []).some(d => d.status === 'borrowed');
      });
      setReturnFlowLoans(unique);
    } catch (error) {
      toast.error('网络错误');
    } finally {
      setReturnFlowLoading(false);
    }
  };

  const handleViewReturnDetail = async (ret: LoanReturnOrder) => {
    try {
      const response = await fetch(`${API_BASE}/api/loan/returns/${ret.id}`);
      if (response.ok) {
        const data = await response.json();
        setSelectedReturnDetail(data);
        setShowReturnDetailModal(true);
      } else {
        toast.error('加载还货单详情失败');
      }
    } catch (error) {
      toast.error('网络错误');
    }
  };

  const openReturnCreateFlow = () => {
    setReturnCustomerSearch('');
    setReturnFlowLoans([]);
    setReturnFlowStep('search');
    setShowReturnCreateFlow(true);
    searchLoansForReturn();
  };

  const selectLoanForReturn = (loan: LoanOrder) => {
    setShowReturnCreateFlow(false);
    openReturnModal(loan);
  };

  // 操作日志
  const handleViewLogs = async (loan: LoanOrder) => {
    setSelectedLoan(loan);
    try {
      const response = await fetch(`${API_BASE}/api/loan/orders/${loan.id}/logs`);
      if (response.ok) {
        const data = await response.json();
        setLogs(data);
        setShowLogsModal(true);
      }
    } catch (error) {
      toast.error('加载日志失败');
    }
  };

  const handlePrint = (loan: LoanOrder) => {
    window.open(`${API_BASE}/api/loan/orders/${loan.id}/download?format=html`, '_blank');
  };

  // ============= Effects =============
  
  useEffect(() => {
    if (activeTab === 'returns') {
      loadLoanReturns();
    } else if (activeTab === 'orders') {
      loadLoanOrders();
    }
  }, [activeTab]);

  useEffect(() => {
    loadProducts();
    loadSalespersons();
    loadSummary();
  }, []);

  // ============= 辅助 =============
  

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('zh-CN');
  };
  const formatDateTime = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString('zh-CN');
  };

  const getActionLabel = (action: string) => {
    const labels: Record<string, string> = {
      create: '创建', confirm: '确认借出', return: '归还', partial_return: '部分归还', cancel: '撤销',
    };
    return labels[action] || action;
  };

  // 产品列显示
  const getProductDisplay = (loan: LoanOrder) => {
    const details = loan.details || [];
    if (details.length === 0) return '-';
    if (details.length === 1) return details[0].product_name;
    return `${details[0].product_name} 等${details.length}件`;
  };

  const getProductCodeDisplay = (loan: LoanOrder) => {
    const details = loan.details || [];
    const codes = details.map(d => d.product_code).filter(Boolean);
    if (codes.length === 0) return '-';
    if (codes.length === 1) return codes[0];
    return `${codes[0]} 等${codes.length}个`;
  };

  // 计算汇总
  const calcCreateSummary = () => {
    let totalWeight = 0;
    let totalPieces = 0;
    createItems.forEach(item => {
      totalWeight += parseFloat(item.weight) || 0;
      totalPieces += parseInt(item.piece_count) || 0;
    });
    return { totalWeight: totalWeight.toFixed(3), totalPieces, count: createItems.filter(i => i.product_name && i.weight).length };
  };

  // ============= 渲染 =============

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
        {activeTab === 'returns' ? (
          <button
            onClick={openReturnCreateFlow}
            className="px-6 py-3 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-xl font-medium shadow-lg shadow-emerald-200/50 hover:shadow-xl transition-all flex items-center space-x-2"
          >
            <RotateCcw className="w-5 h-5" />
            <span>创建还货单</span>
          </button>
        ) : (
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-6 py-3 bg-gradient-to-r from-amber-500 to-yellow-500 text-white rounded-xl font-medium shadow-lg shadow-amber-200/50 hover:shadow-xl transition-all flex items-center space-x-2"
          >
            <FileText className="w-5 h-5" />
            <span>创建暂借单</span>
          </button>
        )}
      </div>

      {/* Tab 切换 + 汇总 */}
      <div className="flex items-center justify-between flex-wrap gap-y-2">
        <div className="flex space-x-3">
          <TabButton active={activeTab === 'orders'} onClick={() => setActiveTab('orders')} icon={<FileText className="w-4 h-4" />} label="借货单" />
          <TabButton active={activeTab === 'returns'} onClick={() => setActiveTab('returns')} icon={<RotateCcw className="w-4 h-4" />} label="还货单" />
        </div>
        {activeTab === 'orders' && (
          <div className="bg-white rounded-xl px-4 py-2 shadow-sm border border-gray-100 flex items-center space-x-2">
            <Package className="w-4 h-4 text-orange-500" />
            <span className="text-sm text-gray-500">未归还总克重</span>
            <span className="text-lg font-bold text-orange-600">{outstandingWeight.toFixed(3)}</span>
            <span className="text-sm text-gray-500">克</span>
          </div>
        )}
      </div>

      {/* 搜索筛选 */}
      {(
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <div className="flex items-center space-x-4 flex-wrap gap-y-2">
            <div className="flex items-center space-x-2">
              <User className="w-4 h-4 text-gray-400" />
              <input type="text" placeholder="客户姓名" value={searchFilters.customer_name}
                onChange={(e) => setSearchFilters({ ...searchFilters, customer_name: e.target.value })}
                className="px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-200 focus:border-amber-400" />
            </div>
            {activeTab === 'orders' && (
              <>
                <div className="flex items-center space-x-2">
                  <Package className="w-4 h-4 text-gray-400" />
                  <input type="text" placeholder="产品名称" value={searchFilters.product_name}
                    onChange={(e) => setSearchFilters({ ...searchFilters, product_name: e.target.value })}
                    className="px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-200 focus:border-amber-400" />
                </div>
                <select
                  value={searchFilters.status}
                  onChange={(e) => setSearchFilters({ ...searchFilters, status: e.target.value })}
                  className="px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-200 focus:border-amber-400 bg-white text-sm"
                >
                  <option value="">全部状态</option>
                  <option value="pending">待确认</option>
                  <option value="borrowed">已借出</option>
                  <option value="partial_returned">部分归还</option>
                  <option value="returned">已归还</option>
                  <option value="cancelled">已撤销</option>
                </select>
              </>
            )}
            <button onClick={() => { if (activeTab === 'returns') { setReturnPage(1); loadLoanReturns(1); } else { setOrderPage(1); loadLoanOrders(1); } }}
              className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors flex items-center space-x-1">
              <Filter className="w-4 h-4" /><span>搜索</span>
            </button>
            <button onClick={() => { setSearchFilters({ customer_name: '', product_name: '', status: '' }); setOrderPage(1); setReturnPage(1); }}
              className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors flex items-center space-x-1">
              <RefreshCw className="w-4 h-4" /><span>重置</span>
            </button>
          </div>
        </div>
      )}

      {/* ========== 还货单列表 ========== */}
      {activeTab === 'returns' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-gray-500"><RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2" /><span>加载中...</span></div>
          ) : loanReturns.length === 0 ? (
            <div className="p-8 text-center text-gray-500"><RotateCcw className="w-12 h-12 mx-auto mb-2 text-gray-300" /><span>暂无还货单</span></div>
          ) : (
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">还货单号</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">原暂借单号</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">客户</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">归还明细</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">总克重</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">操作人</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">日期</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loanReturns.map((ret) => (
                  <tr key={ret.id} className="hover:bg-gray-50 transition-colors cursor-pointer" onClick={() => handleViewReturnDetail(ret)}>
                    <td className="px-4 py-3"><span className="font-mono text-sm text-green-600">{ret.return_no}</span></td>
                    <td className="px-4 py-3"><span className="font-mono text-sm text-amber-600">{ret.loan_no}</span></td>
                    <td className="px-4 py-3 font-medium">{ret.customer_name}</td>
                    <td className="px-4 py-3 text-center">{ret.item_count || (ret.details || []).length} 件</td>
                    <td className="px-4 py-3 text-right font-medium">{ret.total_weight.toFixed(3)}克</td>
                    <td className="px-4 py-3 text-sm">{ret.operator || '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{formatDate(ret.created_at)}</td>
                    <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center space-x-1">
                        <button
                          onClick={() => handleViewReturnDetail(ret)}
                          className="p-1.5 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200"
                          title="查看明细"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => window.open(`${API_BASE}/api/loan/returns/${ret.id}/download?format=html`, '_blank')}
                          className="p-1.5 bg-amber-100 text-amber-600 rounded-lg hover:bg-amber-200"
                          title="打印还货单"
                        >
                          <Printer className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {returnTotalPages > 1 && (
            <div className="px-4 py-3 flex items-center justify-between border-t bg-gray-50/50">
              <span className="text-sm text-gray-500">共 {returnTotal} 条，第 {returnPage}/{returnTotalPages} 页</span>
              <div className="flex items-center gap-1">
                <button onClick={() => { setReturnPage(1); loadLoanReturns(1); }} disabled={returnPage <= 1} className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">首页</button>
                <button onClick={() => { const p = returnPage - 1; setReturnPage(p); loadLoanReturns(p); }} disabled={returnPage <= 1} className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">上一页</button>
                {Array.from({ length: Math.min(5, returnTotalPages) }, (_, i) => {
                  let pn: number;
                  if (returnTotalPages <= 5) pn = i + 1;
                  else if (returnPage <= 3) pn = i + 1;
                  else if (returnPage >= returnTotalPages - 2) pn = returnTotalPages - 4 + i;
                  else pn = returnPage - 2 + i;
                  return (
                    <button key={pn} onClick={() => { setReturnPage(pn); loadLoanReturns(pn); }}
                      className={`px-2.5 py-1 text-xs rounded border ${pn === returnPage ? 'bg-amber-500 text-white border-amber-500' : 'bg-white hover:bg-gray-50'}`}
                    >{pn}</button>
                  );
                })}
                <button onClick={() => { const p = returnPage + 1; setReturnPage(p); loadLoanReturns(p); }} disabled={returnPage >= returnTotalPages} className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">下一页</button>
                <button onClick={() => { setReturnPage(returnTotalPages); loadLoanReturns(returnTotalPages); }} disabled={returnPage >= returnTotalPages} className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">末页</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========== 暂借单列表 ========== */}
      {activeTab === 'orders' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-gray-500"><RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2" /><span>加载中...</span></div>
          ) : loanOrders.length === 0 ? (
            <div className="p-8 text-center text-gray-500"><Package className="w-12 h-12 mx-auto mb-2 text-gray-300" /><span>暂无暂借单</span></div>
          ) : (
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">单号</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">客户</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">商品</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">商品编码</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">件数</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">总克重</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">业务员</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">日期</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">状态</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loanOrders.map((loan) => (
                  <tr key={loan.id} className="hover:bg-gray-50 transition-colors cursor-pointer" onClick={() => handleViewDetail(loan)}>
                    <td className="px-4 py-3"><span className="font-mono text-sm text-amber-600">{loan.loan_no}</span></td>
                    <td className="px-4 py-3 font-medium">{loan.customer_name}</td>
                    <td className="px-4 py-3 text-sm">{getProductDisplay(loan)}</td>
                    <td className="px-4 py-3 text-sm font-mono text-gray-500">{getProductCodeDisplay(loan)}</td>
                    <td className="px-4 py-3 text-center text-sm">{(() => { const total = (loan.details || []).reduce((s, d) => s + (d.piece_count || 0), 0); return total > 0 ? total : '-'; })()}</td>
                    <td className="px-4 py-3 text-right font-medium">{(loan.total_weight || 0).toFixed(3)}克</td>
                    <td className="px-4 py-3 text-sm">{loan.salesperson}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{formatDate(loan.loan_date)}</td>
                    <td className="px-4 py-3 text-center"><StatusBadge status={loan.status} /></td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center space-x-1">
                        {loan.status === 'pending' && (
                          <button onClick={() => handleConfirm(loan)} className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-600 rounded hover:bg-blue-200">
                            确认
                          </button>
                        )}
                        {(loan.status === 'borrowed' || loan.status === 'partial_returned') && (
                          <button onClick={() => openReturnModal(loan)} className="px-2 py-1 text-xs font-medium bg-green-100 text-green-600 rounded hover:bg-green-200">
                            还货
                          </button>
                        )}
                        {(loan.status === 'pending' || loan.status === 'borrowed') && (
                          <button onClick={() => { setSelectedLoan(loan); setShowCancelModal(true); }} className="px-2 py-1 text-xs font-medium bg-red-100 text-red-600 rounded hover:bg-red-200">
                            撤销
                          </button>
                        )}
                        <button onClick={() => handlePrint(loan)} className="px-2 py-1 text-xs font-medium bg-amber-100 text-amber-600 rounded hover:bg-amber-200">
                          打印
                        </button>
                        <button onClick={() => handleViewLogs(loan)} className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-600 rounded hover:bg-gray-200">
                          日志
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {orderTotalPages > 1 && (
            <div className="px-4 py-3 flex items-center justify-between border-t bg-gray-50/50">
              <span className="text-sm text-gray-500">共 {orderTotal} 条，第 {orderPage}/{orderTotalPages} 页</span>
              <div className="flex items-center gap-1">
                <button onClick={() => { setOrderPage(1); loadLoanOrders(1); }} disabled={orderPage <= 1} className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">首页</button>
                <button onClick={() => { const p = orderPage - 1; setOrderPage(p); loadLoanOrders(p); }} disabled={orderPage <= 1} className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">上一页</button>
                {Array.from({ length: Math.min(5, orderTotalPages) }, (_, i) => {
                  let pn: number;
                  if (orderTotalPages <= 5) pn = i + 1;
                  else if (orderPage <= 3) pn = i + 1;
                  else if (orderPage >= orderTotalPages - 2) pn = orderTotalPages - 4 + i;
                  else pn = orderPage - 2 + i;
                  return (
                    <button key={pn} onClick={() => { setOrderPage(pn); loadLoanOrders(pn); }}
                      className={`px-2.5 py-1 text-xs rounded border ${pn === orderPage ? 'bg-amber-500 text-white border-amber-500' : 'bg-white hover:bg-gray-50'}`}
                    >{pn}</button>
                  );
                })}
                <button onClick={() => { const p = orderPage + 1; setOrderPage(p); loadLoanOrders(p); }} disabled={orderPage >= orderTotalPages} className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">下一页</button>
                <button onClick={() => { setOrderPage(orderTotalPages); loadLoanOrders(orderTotalPages); }} disabled={orderPage >= orderTotalPages} className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">末页</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========== 创建暂借单弹窗（多商品） ========== */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-4xl shadow-xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center space-x-2">
              <FileText className="w-6 h-6 text-amber-500" />
              <span>创建暂借单</span>
            </h3>
            
            <div className="space-y-4">
              {/* 客户选择 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">客户 *</label>
                <AsyncSearchSelect
                  value={createForm.customer_id || null}
                  onChange={(val, opt) => {
                    setCreateForm({
                      ...createForm,
                      customer_id: val ? Number(val) : 0,
                      customer_name: opt?.label || '',
                    });
                  }}
                  fetchOptions={fetchCustomers}
                  placeholder="搜索并选择客户"
                />
              </div>

              {/* 业务员和日期 */}
              <div className="grid grid-cols-2 gap-4">
                <div className="relative">
                  <label className="block text-sm font-medium text-gray-700 mb-1">业务员 *</label>
                  <div onClick={() => setShowSalespersonDropdown(!showSalespersonDropdown)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg cursor-pointer bg-white flex justify-between items-center hover:border-amber-400">
                    <span className={createForm.salesperson ? 'text-gray-800' : 'text-gray-400'}>{createForm.salesperson || '选择业务员'}</span>
                    <span className="text-gray-400">▼</span>
                  </div>
                  {showSalespersonDropdown && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {salespersons.map((sp) => (
                        <div key={sp.id} onClick={() => handleSelectSalesperson(sp)} className="px-3 py-2 hover:bg-amber-50 cursor-pointer">{sp.name}</div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">暂借日期 *</label>
                  <input type="date" value={createForm.loan_date} onChange={(e) => setCreateForm({ ...createForm, loan_date: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-200" />
                </div>
              </div>

              {/* 商品明细 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-700">商品明细 *</label>
                  <button onClick={addItem} className="text-sm text-amber-600 hover:text-amber-700 flex items-center space-x-1">
                    <Plus className="w-4 h-4" /><span>添加商品</span>
                  </button>
                </div>
                <div className="border border-gray-200 rounded-lg overflow-visible">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-600" style={{width:'50%'}}>产品品类</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-600" style={{width:'20%'}}>克重</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-600" style={{width:'20%'}}>件数</th>
                        <th className="px-3 py-2 w-10"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {createItems.map((item, index) => (
                        <tr key={index}>
                          <td className="px-3 py-2">
                            <div className="relative">
                              <input
                                ref={(el) => { itemInputRefs.current[index] = el; }}
                                type="text" value={item.product_display || item.product_name}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  const newItems = [...createItems];
                                  newItems[index] = { ...newItems[index], product_display: val, product_name: '' };
                                  setCreateItems(newItems);
                                  setActiveItemIndex(index);
                                  setItemProductSearch(val);
                                  const rect = e.target.getBoundingClientRect();
                                  setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
                                }}
                                onFocus={(e) => {
                                  setActiveItemIndex(index);
                                  setItemProductSearch(item.product_display || '');
                                  const rect = e.target.getBoundingClientRect();
                                  setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
                                }}
                                placeholder="输入或搜索产品" className="w-full px-2 py-1 border border-gray-200 rounded text-sm focus:ring-1 focus:ring-amber-200 pr-7" />
                              {(item.product_display || item.product_name) && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const newItems = [...createItems];
                                    newItems[index] = { ...newItems[index], product_name: '', product_display: '' };
                                    setCreateItems(newItems);
                                    setActiveItemIndex(index);
                                    setItemProductSearch('');
                                    itemInputRefs.current[index]?.focus();
                                  }}
                                  className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <input type="number" step="0.01" min="0" value={item.weight} onChange={(e) => updateItem(index, 'weight', e.target.value)}
                              placeholder="0.00" className="w-full px-2 py-1 border border-gray-200 rounded text-sm focus:ring-1 focus:ring-amber-200" />
                          </td>
                          <td className="px-3 py-2">
                            <input type="number" step="1" min="0" value={item.piece_count} onChange={(e) => updateItem(index, 'piece_count', e.target.value)}
                              placeholder="选填" className="w-full px-2 py-1 border border-gray-200 rounded text-sm focus:ring-1 focus:ring-amber-200" />
                          </td>
                          <td className="px-3 py-2 text-center">
                            {createItems.length > 1 && (
                              <button onClick={() => removeItem(index)} className="text-red-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-amber-50">
                      <tr>
                        <td className="px-3 py-2 text-sm font-medium text-gray-700">合计（{calcCreateSummary().count} 个明细）</td>
                        <td className="px-3 py-2 text-sm font-bold text-gray-800">{calcCreateSummary().totalWeight}克</td>
                        <td className="px-3 py-2 text-sm font-bold text-gray-800">{calcCreateSummary().totalPieces > 0 ? calcCreateSummary().totalPieces : ''}</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* 备注 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
                <textarea value={createForm.remark} onChange={(e) => setCreateForm({ ...createForm, remark: e.target.value })}
                  placeholder="其他备注信息（可选）" rows={2}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-200" />
              </div>
            </div>
            
            <div className="flex justify-end space-x-3 mt-6">
              <button onClick={resetCreateForm} className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200">取消</button>
              <button onClick={handleCreate} className="px-6 py-2 bg-gradient-to-r from-amber-500 to-yellow-500 text-white rounded-lg hover:shadow-lg transition-all">创建</button>
            </div>
          </div>
        </div>
      )}

      {/* 产品搜索下拉框（fixed 定位，避免被 overflow 裁剪） */}
      {showCreateModal && activeItemIndex !== null && itemFilteredProducts.length > 0 && dropdownPos && (
        <div
          className="fixed bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto"
          style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width, zIndex: 9999 }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {itemFilteredProducts.map((p, pi) => (
            <div key={pi} onClick={() => handleSelectItemProduct(p, activeItemIndex)} className="px-3 py-2 hover:bg-amber-50 cursor-pointer flex justify-between text-sm">
              <span>{p.code} {p.name}</span>
              <span className="text-gray-400">库存: {p.total_weight.toFixed(3)}g</span>
            </div>
          ))}
        </div>
      )}

      {/* ========== 暂借单详情弹窗 ========== */}
      {showDetailModal && detailData && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-2xl shadow-xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-gray-800 flex items-center space-x-2">
                <FileText className="w-6 h-6 text-amber-500" />
                <span>暂借单详情</span>
                <span className="text-sm font-normal text-gray-500">{detailData.loan_no}</span>
              </h3>
              <button onClick={() => { setShowDetailModal(false); setDetailData(null); }} className="p-2 hover:bg-gray-100 rounded-lg">
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            
            {/* 基本信息 */}
            <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
              <div><span className="text-gray-500">客户：</span><span className="font-medium">{detailData.customer_name}</span></div>
              <div><span className="text-gray-500">业务员：</span><span className="font-medium">{detailData.salesperson}</span></div>
              <div><span className="text-gray-500">日期：</span><span>{formatDate(detailData.loan_date)}</span></div>
              <div><span className="text-gray-500">状态：</span><StatusBadge status={detailData.status} /></div>
              <div><span className="text-gray-500">经办人：</span><span>{detailData.created_by || '-'}</span></div>
              {detailData.remark && <div className="col-span-2"><span className="text-gray-500">备注：</span><span>{detailData.remark}</span></div>}
            </div>

            {/* 商品明细 */}
            <div className="border border-gray-200 rounded-lg overflow-x-auto mb-4">
              <table className="w-full min-w-[650px]">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-600">商品编码</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-600">产品品类</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-600">克重</th>
                    <th className="px-4 py-2 text-center text-xs font-medium text-gray-600">件数</th>
                    <th className="px-4 py-2 text-center text-xs font-medium text-gray-600">状态</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(detailData.details || []).map((d: any) => (
                    <tr key={d.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 text-sm font-mono text-gray-500">{d.product_code || '-'}</td>
                      <td className="px-4 py-2 text-sm">{d.product_name}</td>
                      <td className="px-4 py-2 text-right text-sm">{d.weight.toFixed(3)}克</td>
                      <td className="px-4 py-2 text-center text-sm">{d.piece_count || '-'}</td>
                      <td className="px-4 py-2 text-center"><StatusBadge status={d.status} /></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50">
                  <tr>
                    <td className="px-4 py-2 text-sm font-medium">合计</td>
                    <td className="px-4 py-2"></td>
                    <td className="px-4 py-2 text-right text-sm font-bold">{(detailData.total_weight || 0).toFixed(3)}克</td>
                    <td className="px-4 py-2 text-center text-sm font-bold">
                      {(() => { const total = (detailData.details || []).reduce((s: number, d: any) => s + (d.piece_count || 0), 0); return total > 0 ? total : ''; })()}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* 还货记录 */}
            {detailData.returns && detailData.returns.length > 0 && (
              <div className="mb-4">
                <h4 className="text-sm font-medium text-gray-700 mb-2">还货记录</h4>
                <div className="space-y-2">
                  {detailData.returns.map((ret: any) => (
                    <div key={ret.id} className="bg-green-50 border border-green-200 rounded-lg p-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-mono text-green-600">{ret.return_no}</span>
                        <span className="text-gray-500">{formatDateTime(ret.created_at)}</span>
                      </div>
                      <div className="text-sm text-gray-600 mt-1">
                        操作人：{ret.operator} | 克重：{ret.total_weight.toFixed(3)}克
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        归还商品：{(ret.details || []).map((d: any) => d.product_name).join('、')}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 操作按钮 */}
            <div className="flex justify-end space-x-2">
              {(detailData.status === 'borrowed' || detailData.status === 'partial_returned') && (
                <button onClick={() => { setShowDetailModal(false); openReturnModal(detailData); }}
                  className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 flex items-center space-x-1">
                  <RotateCcw className="w-4 h-4" /><span>创建还货单</span>
                </button>
              )}
              <button onClick={() => handlePrint(detailData)} className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 flex items-center space-x-1">
                <Printer className="w-4 h-4" /><span>打印</span>
              </button>
              <button onClick={() => { setShowDetailModal(false); setDetailData(null); }} className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200">关闭</button>
            </div>
          </div>
        </div>
      )}

      {/* ========== 还货单创建弹窗 ========== */}
      {/* ========== 还货单明细弹窗 ========== */}
      {showReturnDetailModal && selectedReturnDetail && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl max-h-[80vh] overflow-hidden flex flex-col">
            <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center space-x-2">
              <RotateCcw className="w-6 h-6 text-green-500" />
              <span>还货单明细</span>
            </h3>
            
            <div className="bg-gray-50 rounded-lg p-3 mb-4 text-sm space-y-1">
              <div className="flex justify-between">
                <span><span className="text-gray-500">还货单号：</span><span className="font-mono text-green-600">{selectedReturnDetail.return_no}</span></span>
                <span className="text-gray-400">{formatDateTime(selectedReturnDetail.created_at)}</span>
              </div>
              <div><span className="text-gray-500">原暂借单：</span><span className="font-mono text-amber-600">{selectedReturnDetail.loan_no}</span></div>
              <div><span className="text-gray-500">客户：</span><span className="font-medium">{selectedReturnDetail.customer_name}</span></div>
              {selectedReturnDetail.operator && (
                <div><span className="text-gray-500">操作人：</span>{selectedReturnDetail.operator}</div>
              )}
              {selectedReturnDetail.remark && (
                <div><span className="text-gray-500">备注：</span>{selectedReturnDetail.remark}</div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto">
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-600">产品品类</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-600">克重</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(selectedReturnDetail.details || []).map((d: any) => (
                      <tr key={d.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-sm">{d.product_name}</td>
                        <td className="px-4 py-2 text-right text-sm">{d.weight.toFixed(3)}克</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50">
                    <tr>
                      <td className="px-4 py-2 text-sm font-medium">合计（{(selectedReturnDetail.details || []).length} 件）</td>
                      <td className="px-4 py-2 text-right text-sm font-bold">{(selectedReturnDetail.total_weight || 0).toFixed(3)}克</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            <div className="flex justify-end space-x-3 mt-4">
              <button
                onClick={() => window.open(`${API_BASE}/api/loan/returns/${selectedReturnDetail.id}/download?format=html`, '_blank')}
                className="px-4 py-2 bg-amber-100 text-amber-600 rounded-lg hover:bg-amber-200 flex items-center space-x-1"
              >
                <Printer className="w-4 h-4" />
                <span>打印</span>
              </button>
              <button onClick={() => { setShowReturnDetailModal(false); setSelectedReturnDetail(null); }} className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200">关闭</button>
            </div>
          </div>
        </div>
      )}

      {/* ========== 还货单创建流程弹窗：选择借货单 ========== */}
      {showReturnCreateFlow && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-2xl shadow-xl max-h-[80vh] overflow-hidden flex flex-col">
            <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center space-x-2">
              <RotateCcw className="w-6 h-6 text-emerald-500" />
              <span>创建还货单 - 选择借货单</span>
            </h3>
            
            <div className="flex items-center space-x-2 mb-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={returnCustomerSearch}
                  onChange={(e) => setReturnCustomerSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') searchLoansForReturn(returnCustomerSearch || undefined); }}
                  placeholder="输入客户名称搜索..."
                  className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400"
                />
              </div>
              <button
                onClick={() => searchLoansForReturn(returnCustomerSearch || undefined)}
                className="px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 flex items-center space-x-1"
              >
                <Search className="w-4 h-4" />
                <span>搜索</span>
              </button>
            </div>

            <p className="text-sm text-gray-500 mb-3">
              以下借货单有未归还商品，请选择要还货的借货单：
            </p>

            <div className="flex-1 overflow-y-auto border border-gray-200 rounded-lg">
              {returnFlowLoading ? (
                <div className="flex items-center justify-center py-12 text-gray-400">
                  <RefreshCw className="w-5 h-5 animate-spin mr-2" />
                  <span>加载中...</span>
                </div>
              ) : returnFlowLoans.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                  <Package className="w-10 h-10 mb-2 opacity-50" />
                  <span>没有找到有未还商品的借货单</span>
                </div>
              ) : (
                returnFlowLoans.map((loan) => {
                  const borrowedItems = (loan.details || []).filter(d => d.status === 'borrowed');
                  return (
                    <div
                      key={loan.id}
                      className="p-4 border-b border-gray-100 last:border-b-0 hover:bg-emerald-50 cursor-pointer transition-colors"
                      onClick={() => selectLoanForReturn(loan)}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center space-x-3">
                          <span className="font-mono text-sm text-amber-600 font-medium">{loan.loan_no}</span>
                          <span className="font-medium text-gray-800">{loan.customer_name}</span>
                        </div>
                        <span className="text-xs text-gray-400">{loan.loan_date}</span>
                      </div>
                      <div className="flex items-center space-x-4 text-sm text-gray-500">
                        <span>未还 <span className="text-emerald-600 font-medium">{borrowedItems.length}</span> 件</span>
                        <span>共 {borrowedItems.reduce((s, d) => s + d.weight, 0).toFixed(3)}克</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {borrowedItems.slice(0, 5).map((d) => (
                          <span key={d.id} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                            {d.product_name} ({d.weight.toFixed(2)}g)
                          </span>
                        ))}
                        {borrowedItems.length > 5 && (
                          <span className="text-xs text-gray-400">+{borrowedItems.length - 5}件</span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="flex justify-end mt-4">
              <button
                onClick={() => setShowReturnCreateFlow(false)}
                className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {showReturnModal && selectedLoan && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl">
            <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center space-x-2">
              <RotateCcw className="w-6 h-6 text-green-500" />
              <span>创建还货单</span>
            </h3>
            
            <div className="bg-gray-50 rounded-lg p-3 mb-4 text-sm">
              <div><span className="text-gray-500">暂借单：</span><span className="font-mono text-amber-600">{selectedLoan.loan_no}</span></div>
              <div><span className="text-gray-500">客户：</span><span className="font-medium">{selectedLoan.customer_name}</span></div>
            </div>

            <p className="text-sm text-gray-600 mb-3">请勾选本次归还的商品（默认全选）：</p>

            <div className="border border-gray-200 rounded-lg overflow-hidden mb-4">
              {(selectedLoan.details || []).filter(d => d.status === 'borrowed').map((d) => (
                <label key={d.id} className="flex items-center px-4 py-3 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0">
                  <input type="checkbox" checked={returnDetailIds.includes(d.id)}
                    onChange={(e) => {
                      if (e.target.checked) setReturnDetailIds([...returnDetailIds, d.id]);
                      else setReturnDetailIds(returnDetailIds.filter(id => id !== d.id));
                    }}
                    className="w-4 h-4 text-green-500 rounded border-gray-300 focus:ring-green-500 mr-3" />
                  <div className="flex-1">
                    <span className="text-sm font-medium">{d.product_name}</span>
                  </div>
                  <span className="text-sm text-gray-600">{d.weight.toFixed(3)}克</span>
                </label>
              ))}
            </div>

            <div className="bg-green-50 rounded-lg p-3 mb-4 text-sm">
              本次归还：{returnDetailIds.length} 件，
              共 {(selectedLoan.details || []).filter(d => returnDetailIds.includes(d.id)).reduce((s, d) => s + d.weight, 0).toFixed(3)}克
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
              <input type="text" value={returnRemark} onChange={(e) => setReturnRemark(e.target.value)}
                placeholder="可选" className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-green-200" />
            </div>
            
            <div className="flex justify-end space-x-3">
              <button onClick={() => { setShowReturnModal(false); setSelectedLoan(null); }} className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200">取消</button>
              <button onClick={handleCreateReturn} disabled={returnDetailIds.length === 0}
                className="px-6 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50">确认归还</button>
            </div>
          </div>
        </div>
      )}

      {/* ========== 撤销确认弹窗 ========== */}
      {showCancelModal && selectedLoan && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
            <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center space-x-2">
              <AlertCircle className="w-6 h-6 text-red-500" /><span>撤销暂借单</span>
            </h3>
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
              <p className="text-sm text-red-700 font-medium mb-2">撤销 = 作废这笔暂借单</p>
              <ul className="text-sm text-red-600 space-y-1">
                <li>适用于：录入错误、客户取消借货等异常情况</li>
                {(selectedLoan.status === 'borrowed' || selectedLoan.status === 'partial_returned') && (
                  <li>未归还商品的库存将被恢复</li>
                )}
              </ul>
            </div>
            <p className="text-gray-600 mb-4">确定要撤销 <span className="font-mono font-medium text-amber-600">{selectedLoan.loan_no}</span> 吗？</p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">撤销原因 *</label>
              <textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="请填写撤销原因" rows={3}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-red-200" />
            </div>
            <div className="flex justify-end space-x-3">
              <button onClick={() => { setShowCancelModal(false); setSelectedLoan(null); setCancelReason(''); }} className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200">取消</button>
              <button onClick={handleCancel} className="px-6 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600">确认撤销</button>
            </div>
          </div>
        </div>
      )}

      {/* ========== 操作日志弹窗 ========== */}
      {showLogsModal && selectedLoan && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl max-h-[80vh] overflow-hidden flex flex-col">
            <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center space-x-2">
              <History className="w-6 h-6 text-amber-500" /><span>操作日志</span>
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
                        操作人：{log.operator}
                        {log.old_status && <span className="ml-3">状态：<StatusBadge status={log.old_status} /> → <StatusBadge status={log.new_status} /></span>}
                      </div>
                      {log.remark && <div className="text-sm text-gray-500 mt-1 italic">{log.remark}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex justify-end mt-4 pt-4 border-t border-gray-100">
              <button onClick={() => { setShowLogsModal(false); setSelectedLoan(null); setLogs([]); }} className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200">关闭</button>
            </div>
          </div>
        </div>
      )}

      {/* 点击外部关闭下拉 */}
      {(showSalespersonDropdown || activeItemIndex !== null) && (
        <div className="fixed inset-0 z-40" onClick={() => { setShowSalespersonDropdown(false); setActiveItemIndex(null); }} />
      )}
      <ConfirmationDialog
        isOpen={confirmDialog.isOpen}
        onClose={() => setConfirmDialog(prev => ({...prev, isOpen: false}))}
        onConfirm={confirmDialog.onConfirm}
        title={confirmDialog.title}
        message={confirmDialog.message}
        isDestructive={confirmDialog.isDestructive}
      />
    </div>
  );
};

export default LoanPage;
