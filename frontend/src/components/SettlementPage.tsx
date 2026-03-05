import React, { useState, useEffect } from 'react';
import { API_ENDPOINTS } from '../config';
import {
  FileText, Check, Printer, Clock, AlertCircle, ChevronRight, ChevronDown,
  RefreshCw, X, DollarSign, Package, User, Calendar, Download,
  Search, RotateCcw, Filter, ArrowUpRight
} from 'lucide-react';
import toast from 'react-hot-toast';
import { QuickReturnModal } from './QuickReturnModal';
import { fetchWithCacheJson } from '../utils/fetchCache';
import ConfirmationDialog from './ui/ConfirmationDialog';

const ROLE_HEADER = { 'X-User-Role': 'settlement' };
const JSON_ROLE_HEADERS = { 'Content-Type': 'application/json', 'X-User-Role': 'settlement' };

// 类型定义
interface SalesDetail {
  id: number;
  product_code?: string;
  product_name: string;
  weight: number;
  piece_count?: number;
  labor_cost: number;
  piece_labor_cost?: number;
  total_labor_cost: number;
  main_stone_weight?: number;
  main_stone_count?: number;
  sub_stone_weight?: number;
  sub_stone_count?: number;
  main_stone_mark?: string;
  sub_stone_mark?: string;
  pearl_weight?: number;
  bearing_weight?: number;
  sale_labor_cost?: number;
  sale_piece_labor_cost?: number;
}

interface SalesOrder {
  id: number;
  order_no: string;
  order_date: string;
  customer_id?: number;
  customer_name: string;
  salesperson: string;
  store_code: string | null;
  total_labor_cost: number;
  total_weight: number;
  remark: string | null;
  status: string;
  create_time: string;
  details: SalesDetail[];
}

interface SettlementOrder {
  id: number;
  settlement_no: string;
  sales_order_id: number;
  payment_method: string;
  gold_price: number | null;
  physical_gold_weight: number | null;
  // 混合支付专用字段
  gold_payment_weight: number | null;  // 结料部分克重
  cash_payment_weight: number | null;  // 结价部分克重
  total_weight: number;
  material_amount: number | null;
  labor_amount: number;
  total_amount: number;
  // 灵活支付状态
  payment_difference: number | null;  // 支付差额（正=多付，负=少付）
  payment_status: string | null;  // full/overpaid/underpaid
  status: string;
  created_by: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  printed_at: string | null;
  remark: string | null;
  created_at: string;
  sales_order: SalesOrder | null;
}

// 状态徽章
const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    draft: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: '未确认' },
    pending: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: '待确认' },
    confirmed: { bg: 'bg-blue-100', text: 'text-blue-700', label: '已确认' },
    printed: { bg: 'bg-green-100', text: 'text-green-700', label: '已打印' },
    refunded: { bg: 'bg-red-100', text: 'text-red-700', label: '已销退' },
    '待结算': { bg: 'bg-orange-100', text: 'text-orange-700', label: '待结算' },
  };
  const { bg, text, label } = config[status] || { bg: 'bg-gray-100', text: 'text-gray-700', label: status };

  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${bg} ${text}`}>
      {label}
    </span>
  );
};

// Tab 组件 - 珠宝风格
const TabButton: React.FC<{
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count?: number;
}> = ({ active, onClick, icon, label, count }) => (
  <button
    onClick={onClick}
    className={`flex items-center space-x-2 px-5 py-3 rounded-xl font-medium transition-all ${active
      ? 'bg-gradient-to-r from-amber-500 to-yellow-500 text-white shadow-lg shadow-amber-200/50'
      : 'bg-white text-gray-600 hover:bg-amber-50 border border-gray-200'
      }`}
  >
    {icon}
    <span>{label}</span>
    {count !== undefined && count > 0 && (
      <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-bold ${active ? 'bg-white/20' : 'bg-red-500 text-white'
        }`}>
        {count}
      </span>
    )}
  </button>
);

// 结算单确认后的回调数据
interface SettlementConfirmedData {
  settlement_id: number;
  settlement_no: string;
  customer_name: string;
  salesperson: string;
  payment_method: string;
  gold_price?: number | null;
  total_weight: number;
  labor_amount: number;
  material_amount: number;
  total_amount: number;
  details: Array<{
    product_name: string;
    weight: number;
    labor_cost: number;
    total_labor_cost: number;
  }>;
}

interface SettlementPageProps {
  onSettlementConfirmed?: (data: SettlementConfirmedData) => void;
}

export const SettlementPage: React.FC<SettlementPageProps> = ({ onSettlementConfirmed }) => {
  // to_settle = 待开结算单（显示销售单）
  // settlements = 结算单一览（显示全部结算单）
  const [activeTab, setActiveTab] = useState<'to_settle' | 'settlements' | 'deposit-settlements' | 'customer-payments'>('to_settle');
  const [pendingSales, setPendingSales] = useState<SalesOrder[]>([]);
  const [settlements, setSettlements] = useState<SettlementOrder[]>([]);
  const [loading, setLoading] = useState(false);

  // 分页
  const [currentPage, setCurrentPage] = useState(1);
  const [totalSettlements, setTotalSettlements] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [serverPendingCount, setServerPendingCount] = useState(0);
  const [serverCompletedCount, setServerCompletedCount] = useState(0);
  const pageSize = 20;

  // 创建结算单表单
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedSalesOrder, setSelectedSalesOrder] = useState<SalesOrder | null>(null);
  const [createForm, setCreateForm] = useState({
    payment_method: 'cash_price',
    gold_price: '',
    physical_gold_weight: '',
    // 混合支付专用字段
    gold_payment_weight: '',  // 结料部分克重
    cash_payment_weight: '',  // 结价部分克重
    remark: ''
  });

  // 展开明细
  const [expandedPendingId, setExpandedPendingId] = useState<number | null>(null);
  const [expandedSettlementId, setExpandedSettlementId] = useState<number | null>(null);

  // 确认结算单
  const [confirmingSettlement, setConfirmingSettlement] = useState<SettlementOrder | null>(null);
  const [confirmingSettlementLoading, setConfirmingSettlementLoading] = useState(false);

  // 编辑结算单
  const [editingSettlement, setEditingSettlement] = useState<SettlementOrder | null>(null);
  const [editForm, setEditForm] = useState({
    payment_method: 'cash_price',
    gold_price: '',
    physical_gold_weight: '',
    gold_payment_weight: '',
    cash_payment_weight: '',
    remark: ''
  });

  // 少付确认对话框
  const [showUnderpayConfirm, setShowUnderpayConfirm] = useState(false);
  const [underpayData, setUnderpayData] = useState<{
    totalInput: number;
    totalWeight: number;
    difference: number;
  } | null>(null);

  // 收料单弹窗
  const [showReceiptForm, setShowReceiptForm] = useState(false);
  const [selectedSettlementForReceipt, setSelectedSettlementForReceipt] = useState<SettlementOrder | null>(null);
  const [receiptForm, setReceiptForm] = useState({
    gold_weight: '',
    gold_fineness: '足金999',
    remark: ''
  });
  const [confirmDialog, setConfirmDialog] = useState<{isOpen: boolean, title: string, message: string, onConfirm: () => void, isDestructive?: boolean}>({isOpen: false, title: '', message: '', onConfirm: () => {}});

  // 快捷收料弹窗
  const [showQuickReceiptForm, setShowQuickReceiptForm] = useState(false);
  const [customers, setCustomers] = useState<Array<{ id: number; name: string; phone?: string }>>([]);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [quickReceiptForm, setQuickReceiptForm] = useState({
    customer_id: '',
    gold_weight: '',
    gold_fineness: '足金999',
    remark: ''
  });
  const [customerSearch, setCustomerSearch] = useState('');

  // 搜索筛选
  const [showSearchPanel, setShowSearchPanel] = useState(false);
  const [searchFilters, setSearchFilters] = useState({
    settlement_no: '',
    sales_order_no: '',
    customer_name: '',
    start_date: '',
    end_date: ''
  });

  // 销退弹窗
  const [showRefundConfirm, setShowRefundConfirm] = useState(false);
  const [refundingSettlement, setRefundingSettlement] = useState<SettlementOrder | null>(null);
  const [refundReason, setRefundReason] = useState('客户退货');
  const [refundDestination, setRefundDestination] = useState<'showroom' | 'warehouse'>('showroom');
  const [confirmingRefund, setConfirmingRefund] = useState(false);

  // 退货表单弹窗（用于销退到商品部的双重确认）
  const [showReturnFormForRefund, setShowReturnFormForRefund] = useState(false);

  // 快捷提料弹窗
  const [showQuickWithdrawalForm, setShowQuickWithdrawalForm] = useState(false);
  const [quickWithdrawalForm, setQuickWithdrawalForm] = useState({
    customer_id: '',
    gold_weight: '',
    remark: ''
  });
  const [selectedCustomerDeposit, setSelectedCustomerDeposit] = useState<{
    current_balance: number;
    customer_name: string;
  } | null>(null);
  const [depositLoading, setDepositLoading] = useState(false);
  const [withdrawalCustomerSearch, setWithdrawalCustomerSearch] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(true);

  // 客户收款登记
  const [customerPayments, setCustomerPayments] = useState<any[]>([]);
  const [customerPaymentsLoading, setCustomerPaymentsLoading] = useState(false);
  const [showCustomerPaymentModal, setShowCustomerPaymentModal] = useState(false);
  const [customerPaymentForm, setCustomerPaymentForm] = useState({ customer_id: '', amount: '', payment_method: 'bank_transfer', remark: '' });
  const [editingPaymentId, setEditingPaymentId] = useState<number | null>(null);

  // 存料结价弹窗
  const [showDepositSettleForm, setShowDepositSettleForm] = useState(false);
  const [depositSettleForm, setDepositSettleForm] = useState({
    customer_id: '',
    gold_weight: '',
    gold_price: '',
    remark: ''
  });
  const [depositSettleCustomerSearch, setDepositSettleCustomerSearch] = useState('');
  const [showDepositSettleDropdown, setShowDepositSettleDropdown] = useState(true);
  const [depositSettleDeposit, setDepositSettleDeposit] = useState<{
    current_balance: number;
    customer_name: string;
  } | null>(null);
  const [depositSettleDepositLoading, setDepositSettleDepositLoading] = useState(false);
  const [depositSettlements, setDepositSettlements] = useState<any[]>([]);
  const [depositSettlementsLoading, setDepositSettlementsLoading] = useState(false);

  // 加载数据
  useEffect(() => {
    loadPendingSales();
    loadSettlements();
    loadCustomers();
  }, []);

  // 切换到收款登记/存料结价时加载数据
  useEffect(() => {
    if (activeTab === 'customer-payments') {
      loadCustomerPayments();
    }
    if (activeTab === 'deposit-settlements') {
      loadDepositSettlements();
    }
  }, [activeTab]);

  // 加载客户列表（带缓存检查，避免重复加载）
  const loadCustomers = async (force = false) => {
    // 如果已有客户数据且非强制刷新，跳过加载
    if (customers.length > 0 && !force) {
      return;
    }
    setCustomersLoading(true);
    try {
      const processData = (result: any) => {
        // API 返回格式: { success: true, data: { customers: [...] } }
        if (result.success && result.data?.customers) {
          setCustomers(result.data.customers);
        } else if (Array.isArray(result)) {
          setCustomers(result);
        }
      };

      const data = await fetchWithCacheJson(`${API_ENDPOINTS.API_BASE_URL}/api/customers?page_size=500`, {}, (cachedData) => {
        processData(cachedData);
        setCustomersLoading(false);
      });
      processData(data);
    } catch (error) {
      console.error('加载客户列表失败:', error);
    } finally {
      setCustomersLoading(false);
    }
  };

  // ============= 存料结价功能 =============

  // 加载存料结价单列表
  const loadDepositSettlements = async () => {
    setDepositSettlementsLoading(true);
    try {
      const processData = (data: any) => {
        setDepositSettlements(Array.isArray(data) ? data : []);
      };

      const data = await fetchWithCacheJson(`${API_ENDPOINTS.API_BASE_URL}/api/settlement/deposit-settlements?user_role=settlement&limit=50`, {}, (cachedData) => {
        processData(cachedData);
        setDepositSettlementsLoading(false);
      });
      processData(data);
    } catch (error) {
      console.error('加载存料结价单失败:', error);
    } finally {
      setDepositSettlementsLoading(false);
    }
  };

  // 筛选存料结价客户
  const filteredDepositSettleCustomers = (Array.isArray(customers) ? customers : []).filter(c =>
    c && c.name && (c.name.toLowerCase().includes(depositSettleCustomerSearch.toLowerCase()) ||
      (c.phone && c.phone.includes(depositSettleCustomerSearch)))
  );

  // 查询客户存料余额（存料结价用 - 后端统一使用 gold_balance 函数计算）
  const fetchDepositSettleBalance = async (customerId: string) => {
    if (!customerId) {
      setDepositSettleDeposit(null);
      return;
    }
    setDepositSettleDepositLoading(true);
    try {
      const response = await fetch(
        `${API_ENDPOINTS.API_BASE_URL}/api/gold-material/customers/${customerId}/deposit?user_role=settlement`
      );
      if (response.ok) {
        const result = await response.json();
        const deposit = result?.data?.deposit || {};
        const customerName = result?.data?.customer_name || '';
        setDepositSettleDeposit({
          current_balance: deposit.current_balance ?? deposit.net_gold ?? 0,
          customer_name: customerName
        });
      } else {
        setDepositSettleDeposit({ current_balance: 0, customer_name: '' });
      }
    } catch (error) {
      console.error('查询客户存料余额失败:', error);
      setDepositSettleDeposit({ current_balance: 0, customer_name: '' });
    } finally {
      setDepositSettleDepositLoading(false);
    }
  };

  // 打开存料结价弹窗
  const openDepositSettleForm = () => {
    setDepositSettleForm({ customer_id: '', gold_weight: '', gold_price: '', remark: '' });
    setDepositSettleCustomerSearch('');
    setDepositSettleDeposit(null);
    setShowDepositSettleDropdown(true);
    setShowDepositSettleForm(true);
  };

  // 创建存料结价单
  const handleCreateDepositSettle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!depositSettleForm.customer_id) {
      toast.error('请选择客户');
      return;
    }
    const weight = parseFloat(depositSettleForm.gold_weight);
    const price = parseFloat(depositSettleForm.gold_price);
    if (!weight || weight <= 0) {
      toast.error('请输入有效的结价克重');
      return;
    }
    if (!price || price <= 0) {
      toast.error('请输入有效的金价');
      return;
    }
    const balance = depositSettleDeposit?.current_balance || 0;
    if (weight > balance) {
      toast.error(`结价克重(${weight.toFixed(3)}g)超过存料余额(${balance.toFixed(3)}g)`);
      return;
    }
    try {
      const response = await fetch(
        `${API_ENDPOINTS.API_BASE_URL}/api/settlement/deposit-settlements?user_role=settlement`,
        {
          method: 'POST',
          headers: JSON_ROLE_HEADERS,
          body: JSON.stringify({
            customer_id: parseInt(depositSettleForm.customer_id),
            gold_weight: weight,
            gold_price: price,
            remark: depositSettleForm.remark || ''
          })
        }
      );
      if (response.ok) {
        const result = await response.json();
        toast.success(result.message || '存料结价单创建成功');
        setShowDepositSettleForm(false);
        loadDepositSettlements();
      } else {
        const error = await response.json();
        toast.error(error.detail || '创建失败');
      }
    } catch (error) {
      toast.error('创建存料结价单失败');
    }
  };

  // 确认存料结价单
  const handleConfirmDepositSettle = (id: number, settlementNo: string) => {
    setConfirmDialog({
      isOpen: true,
      title: '确认存料结价',
      message: `确定要确认存料结价单 ${settlementNo} 吗？\n确认后将扣减客户存料并抵扣欠款，此操作不可撤销。`,
      isDestructive: false,
      onConfirm: async () => {
        setConfirmDialog(prev => ({...prev, isOpen: false}));
        try {
          const response = await fetch(
            `${API_ENDPOINTS.API_BASE_URL}/api/settlement/deposit-settlements/${id}/confirm?user_role=settlement`,
            { method: 'POST' }
          );
          if (response.ok) {
            const result = await response.json();
            toast.success(result.message || '存料结价单已确认');
            loadDepositSettlements();
          } else {
            const error = await response.json();
            toast.error(error.detail || '确认失败');
          }
        } catch (error) {
          toast.error('确认失败');
        }
      }
    });
  };

  // 取消存料结价单
  const handleCancelDepositSettle = (id: number, settlementNo: string) => {
    setConfirmDialog({
      isOpen: true,
      title: '取消存料结价',
      message: `确定要取消存料结价单 ${settlementNo} 吗？`,
      isDestructive: true,
      onConfirm: async () => {
        setConfirmDialog(prev => ({...prev, isOpen: false}));
        try {
          const response = await fetch(
            `${API_ENDPOINTS.API_BASE_URL}/api/settlement/deposit-settlements/${id}/cancel?user_role=settlement`,
            { method: 'POST' }
          );
          if (response.ok) {
            toast.success('存料结价单已取消');
            loadDepositSettlements();
          } else {
            const error = await response.json();
            toast.error(error.detail || '取消失败');
          }
        } catch (error) {
          toast.error('取消失败');
        }
      }
    });
  };

  // 打开快捷收料弹窗
  const openQuickReceiptForm = () => {
    // 客户列表已在页面加载时预加载，无需重复加载
    setQuickReceiptForm({
      customer_id: '',
      gold_weight: '',
      gold_fineness: '足金999',
      remark: ''
    });
    setCustomerSearch('');
    setShowQuickReceiptForm(true);
  };

  // 创建快捷收料单
  const handleCreateQuickReceipt = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!quickReceiptForm.customer_id) {
      toast.error('请选择客户');
      return;
    }
    if (!quickReceiptForm.gold_weight || parseFloat(quickReceiptForm.gold_weight) <= 0) {
      toast.error('请输入有效的收料克重');
      return;
    }

    try {
      const params = new URLSearchParams({
        customer_id: quickReceiptForm.customer_id,
        gold_weight: quickReceiptForm.gold_weight,
        gold_fineness: quickReceiptForm.gold_fineness,
        remark: quickReceiptForm.remark || '快捷收料',
        created_by: '结算专员'
      });

      const response = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/gold-material/gold-receipts?${params}&user_role=settlement`, {
        method: 'POST',
        headers: JSON_ROLE_HEADERS
      });

      if (response.ok) {
        const result = await response.json();
        toast.success(`收料单创建成功：${result.data.receipt_no}，请到金料管理确认`);
        setShowQuickReceiptForm(false);
      } else {
        const error = await response.json();
        toast.error(error.detail || '创建收料单失败');
      }
    } catch (error) {
      toast.error('创建收料单失败');
    }
  };

  // 筛选客户（添加数组安全检查）
  const filteredCustomers = (Array.isArray(customers) ? customers : []).filter(c =>
    c && c.name && (c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
      (c.phone && c.phone.includes(customerSearch)))
  );

  // 筛选提料客户（添加数组安全检查）
  const filteredWithdrawalCustomers = (Array.isArray(customers) ? customers : []).filter(c =>
    c && c.name && (c.name.toLowerCase().includes(withdrawalCustomerSearch.toLowerCase()) ||
      (c.phone && c.phone.includes(withdrawalCustomerSearch)))
  );

  // 打开快捷提料弹窗
  const openQuickWithdrawalForm = () => {
    // 客户列表已在页面加载时预加载，无需重复加载
    setQuickWithdrawalForm({
      customer_id: '',
      gold_weight: '',
      remark: ''
    });
    setWithdrawalCustomerSearch('');
    setSelectedCustomerDeposit(null);
    setShowCustomerDropdown(true);  // 重置下拉框显示状态
    setShowQuickWithdrawalForm(true);
  };

  // 查询客户存料余额
  const fetchCustomerDeposit = async (customerId: string) => {
    if (!customerId) {
      setSelectedCustomerDeposit(null);
      return;
    }
    setDepositLoading(true);
    try {
      const response = await fetch(
        `${API_ENDPOINTS.API_BASE_URL}/api/gold-material/customers/${customerId}/deposit?user_role=settlement`,
        { headers: ROLE_HEADER }
      );
      if (response.ok) {
        const result = await response.json();

        // 防御性读取，兼容多种数据格式
        const deposit = result?.data?.deposit || result?.deposit || {};
        const customerName = result?.data?.customer_name || result?.customer_name || '';

        setSelectedCustomerDeposit({
          current_balance: deposit.current_balance ?? deposit.net_gold ?? 0,
          customer_name: customerName
        });
      } else {
        setSelectedCustomerDeposit({ current_balance: 0, customer_name: '' });
      }
    } catch (error) {
      console.error('查询客户存料余额失败:', error);
      setSelectedCustomerDeposit({ current_balance: 0, customer_name: '' });
    } finally {
      setDepositLoading(false);
    }
  };

  // 创建快捷提料单
  const handleCreateQuickWithdrawal = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!quickWithdrawalForm.customer_id) {
      toast.error('请选择客户');
      return;
    }

    const weight = parseFloat(quickWithdrawalForm.gold_weight);
    if (!weight || weight <= 0) {
      toast.error('请输入有效的提料克重');
      return;
    }

    // 检查客户是否有存料可提
    const availableBalance = Math.max(0, selectedCustomerDeposit?.current_balance || 0);
    if (availableBalance <= 0) {
      const owedAmount = Math.abs(selectedCustomerDeposit?.current_balance || 0);
      if ((selectedCustomerDeposit?.current_balance || 0) < 0) {
        toast.error(`该客户欠料 ${owedAmount.toFixed(3)} 克，无法提料`);
      } else {
        toast.error('该客户无存料余额，无法提料');
      }
      return;
    }

    if (weight > availableBalance) {
      toast.error(`提料克重不能超过客户存料余额（${availableBalance.toFixed(3)}克）`);
      return;
    }

    try {
      const params = new URLSearchParams({
        user_role: 'settlement',
        created_by: '结算专员'
      });

      const response = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/gold-material/withdrawals?${params}&user_role=settlement`, {
        method: 'POST',
        headers: JSON_ROLE_HEADERS,
        body: JSON.stringify({
          customer_id: parseInt(quickWithdrawalForm.customer_id),
          gold_weight: weight,
          withdrawal_type: 'self',
          remark: quickWithdrawalForm.remark || '快捷提料'
        })
      });

      if (response.ok) {
        const result = await response.json();
        toast.success(`提料单创建成功：${result.withdrawal_no}（待料部确认）`);
        setShowQuickWithdrawalForm(false);

        // 打开打印页面
        if (result.id) {
          window.open(`${API_ENDPOINTS.API_BASE_URL}/api/gold-material/withdrawals/${result.id}/download?format=html`, '_blank');
        }
      } else {
        const error = await response.json();
        toast.error(error.detail || '创建提料单失败');
      }
    } catch (error) {
      toast.error('创建提料单失败');
    }
  };

  const loadPendingSales = async () => {
    try {
      const processData = (data: any) => {
        setPendingSales(data);
      };

      const data = await fetchWithCacheJson(API_ENDPOINTS.PENDING_SALES, {}, processData);
      processData(data);
    } catch (error) {
      console.error('加载待结算销售单失败:', error);
    }
  };

  const loadSettlements = async (page?: number) => {
    setLoading(true);
    const loadPage = page ?? currentPage;
    try {
      const params = new URLSearchParams();
      if (searchFilters.settlement_no) params.append('settlement_no', searchFilters.settlement_no);
      if (searchFilters.sales_order_no) params.append('sales_order_no', searchFilters.sales_order_no);
      if (searchFilters.customer_name) params.append('customer_name', searchFilters.customer_name);
      if (searchFilters.start_date) params.append('start_date', searchFilters.start_date);
      if (searchFilters.end_date) params.append('end_date', searchFilters.end_date);
      params.append('page', loadPage.toString());
      params.append('page_size', pageSize.toString());
      params.append('user_role', 'settlement');

      const url = `${API_ENDPOINTS.SETTLEMENT_ORDERS}?${params.toString()}`;

      const processData = (data: any) => {
        if (data.items) {
          setSettlements(Array.isArray(data.items) ? data.items : []);
          setTotalSettlements(data.total || 0);
          setTotalPages(data.total_pages || 0);
          setCurrentPage(data.page || 1);
          setServerPendingCount(data.pending_count ?? 0);
          setServerCompletedCount(data.completed_count ?? 0);
        } else {
          setSettlements(Array.isArray(data) ? data : []);
        }
      };

      const data = await fetchWithCacheJson(url, {}, (cachedData) => {
        processData(cachedData);
        setLoading(false);
      });
      processData(data);
    } catch (error) {
      console.error('加载结算单失败:', error);
      setSettlements([]);
    } finally {
      setLoading(false);
    }
  };

  // ==================== 客户收款登记 ====================
  const loadCustomerPayments = async () => {
    setCustomerPaymentsLoading(true);
    try {
      const response = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/finance/customer-payment-registrations?user_role=settlement`, { headers: ROLE_HEADER });
      if (response.ok) {
        const result = await response.json();
        setCustomerPayments(result.data?.payments || []);
      }
    } catch (error) {
      console.error('加载客户收款列表失败:', error);
    } finally {
      setCustomerPaymentsLoading(false);
    }
  };

  const createCustomerPayment = async () => {
    const customerId = parseInt(customerPaymentForm.customer_id);
    const amount = parseFloat(customerPaymentForm.amount);
    if (!customerId || !amount || amount <= 0) {
      toast.error('请选择客户并输入有效金额');
      return;
    }
    try {
      const params = new URLSearchParams();
      params.append('customer_id', customerId.toString());
      params.append('amount', amount.toString());
      params.append('payment_method', customerPaymentForm.payment_method);
      if (customerPaymentForm.remark) params.append('remark', customerPaymentForm.remark);
      params.append('created_by', '结算');

      const response = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/finance/customer-payment-registration?${params}&user_role=settlement`, { method: 'POST', headers: ROLE_HEADER });
      const result = await response.json();
      if (response.ok && result.success) {
        toast.success(result.message || '收款登记创建成功');
        setShowCustomerPaymentModal(false);
        setCustomerPaymentForm({ customer_id: '', amount: '', payment_method: 'bank_transfer', remark: '' });
        loadCustomerPayments();
      } else {
        toast.error(result.detail || '创建失败');
      }
    } catch (error) {
      toast.error('创建失败');
    }
  };

  // 编辑客户收款
  const updateCustomerPayment = async () => {
    if (!editingPaymentId) return;
    const customerId = parseInt(customerPaymentForm.customer_id);
    const amount = parseFloat(customerPaymentForm.amount);
    if (!customerId || !amount || amount <= 0) {
      toast.error('请选择客户并输入有效金额');
      return;
    }
    try {
      const params = new URLSearchParams();
      params.append('customer_id', customerId.toString());
      params.append('amount', amount.toString());
      params.append('payment_method', customerPaymentForm.payment_method);
      params.append('remark', customerPaymentForm.remark || '');

      const response = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/finance/customer-payment-registrations/${editingPaymentId}?${params}&user_role=settlement`, { method: 'PUT', headers: ROLE_HEADER });
      const result = await response.json();
      if (response.ok) {
        toast.success(result.message || '更新成功');
        setShowCustomerPaymentModal(false);
        setEditingPaymentId(null);
        setCustomerPaymentForm({ customer_id: '', amount: '', payment_method: 'bank_transfer', remark: '' });
        loadCustomerPayments();
      } else {
        toast.error(result.detail || '更新失败');
      }
    } catch (error) {
      toast.error('更新失败');
    }
  };

  // 确认/删除/反确认 客户收款
  const handleCustomerPaymentAction = async (paymentId: number, action: 'confirm' | 'delete' | 'unconfirm', reason?: string) => {
    try {
      if (action === 'delete') {
        setConfirmDialog({
          isOpen: true,
          title: '删除收款记录',
          message: '确定要删除这条收款记录吗？',
          isDestructive: true,
          onConfirm: async () => {
            setConfirmDialog(prev => ({...prev, isOpen: false}));
            const params = new URLSearchParams();
            params.append('deleted_by', '结算');
            const response = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/finance/customer-payment-registrations/${paymentId}?${params}&user_role=settlement`, { method: 'DELETE', headers: ROLE_HEADER });
            const result = await response.json();
            if (response.ok) {
              toast.success(result.message || '删除成功');
              loadCustomerPayments();
            } else {
              toast.error(result.detail || '删除失败');
            }
          }
        });
        return;
      }

      const params = new URLSearchParams();
      if (action === 'confirm') params.append('confirmed_by', '结算');
      if (action === 'unconfirm') {
        params.append('operated_by', '结算');
        params.append('reason', reason || '操作员反确认');
      }

      const response = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/finance/customer-payment-registrations/${paymentId}/${action}?${params}&user_role=settlement`, { method: 'POST', headers: ROLE_HEADER });
      const result = await response.json();
      if (response.ok) {
        toast.success(result.message || '操作成功');
        loadCustomerPayments();
      } else {
        toast.error(result.detail || '操作失败');
      }
    } catch (error) {
      toast.error('操作失败');
    }
  };

  // 搜索处理
  const handleSearch = () => {
    setCurrentPage(1);
    loadSettlements(1);
  };

  // 重置搜索
  const handleResetSearch = () => {
    setSearchFilters({
      settlement_no: '',
      sales_order_no: '',
      customer_name: '',
      start_date: '',
      end_date: ''
    });
    setCurrentPage(1);
    setTimeout(() => loadSettlements(1), 0);
  };

  // 销退处理
  const handleRefund = async () => {
    if (confirmingRefund) return;
    if (!refundingSettlement) return;

    // 如果是退到商品部，先弹出退货表单进行双重确认
    if (refundDestination === 'warehouse') {
      setShowRefundConfirm(false);
      setShowReturnFormForRefund(true);
      return;
    }

    // 退到柜台则直接执行销退
    await executeRefund();
  };

  // 执行销退操作（内部函数，被 handleRefund 和退货表单回调调用）
  const executeRefund = async () => {
    if (confirmingRefund) return;
    if (!refundingSettlement) return;

    setConfirmingRefund(true);
    try {
      // 第一步：如果结算单已确认/已打印，先撤销结算（回滚账务）
      if (refundingSettlement.status === 'confirmed' || refundingSettlement.status === 'printed') {
        const revertResponse = await fetch(
          `${API_ENDPOINTS.API_BASE_URL}/api/settlement/orders/${refundingSettlement.id}/revert?user_role=settlement`,
          { method: 'POST' }
        );
        if (!revertResponse.ok) {
          const error = await revertResponse.json();
          throw new Error(error.detail || '撤销结算失败');
        }
      }

      // 第二步：执行销退（商品退回库存）
      const params = new URLSearchParams({
        return_reason: refundReason,
        user_role: 'settlement',
        return_to: refundDestination
      });

      const response = await fetch(
          `${API_ENDPOINTS.API_BASE_URL}/api/settlement/orders/${refundingSettlement.id}/refund?${params}&user_role=settlement`,
        { method: 'POST', headers: ROLE_HEADER }
      );

      if (response.ok) {
        const result = await response.json();
        toast.success(result.message || '销退成功');
        setShowRefundConfirm(false);
        setRefundingSettlement(null);
        loadSettlements();
      } else {
        const error = await response.json();
        toast.error(error.detail || '销退失败');
      }
    } catch (error: any) {
      toast.error(error.message || '销退失败');
    } finally {
      setConfirmingRefund(false);
    }
  };

  // 退货表单成功回调（用于销退到商品部的双重确认）
  const handleReturnFormSuccess = async () => {
    // 退货表单已创建退货单，现在执行销退流程
    setShowReturnFormForRefund(false);
    await executeRefund();
  };

  // 创建结算单（支持灵活支付）
  const handleCreateSettlement = async (e: React.FormEvent, confirmedUnderpay: boolean = false) => {
    e.preventDefault();
    if (!selectedSalesOrder) return;

    const data: any = {
      sales_order_id: selectedSalesOrder.id,
      payment_method: createForm.payment_method,
      remark: createForm.remark || null,
      confirmed_underpay: confirmedUnderpay
    };

    if (createForm.payment_method === 'cash_price') {
      if (!createForm.gold_price) {
        toast.error('请输入当日金价');
        return;
      }
      data.gold_price = parseFloat(createForm.gold_price);
    } else if (createForm.payment_method === 'physical_gold') {
      if (!createForm.physical_gold_weight) {
        toast.error('请输入客户提供的黄金重量');
        return;
      }
      data.physical_gold_weight = parseFloat(createForm.physical_gold_weight);
    } else if (createForm.payment_method === 'mixed') {
      if (!createForm.gold_price) {
        toast.error('混合支付需要填写当日金价');
        return;
      }
      if (!createForm.gold_payment_weight && !createForm.cash_payment_weight) {
        toast.error('请填写结料克重或结价克重');
        return;
      }
      const goldWeight = parseFloat(createForm.gold_payment_weight || '0');
      const cashWeight = parseFloat(createForm.cash_payment_weight || '0');
      const totalInput = goldWeight + cashWeight;
      const difference = totalInput - selectedSalesOrder.total_weight;

      if (difference < -0.01 && !confirmedUnderpay) {
        setUnderpayData({
          totalInput,
          totalWeight: selectedSalesOrder.total_weight,
          difference: Math.abs(difference)
        });
        setShowUnderpayConfirm(true);
        return;
      }

      data.gold_price = parseFloat(createForm.gold_price);
      data.gold_payment_weight = goldWeight;
      data.cash_payment_weight = cashWeight;
    }

    try {
      const response = await fetch(`${API_ENDPOINTS.SETTLEMENT_ORDERS}?user_role=settlement`, {
        method: 'POST',
        headers: JSON_ROLE_HEADERS,
        body: JSON.stringify(data)
      });

      if (response.ok) {
        const paymentStatus = data.gold_payment_weight + data.cash_payment_weight < selectedSalesOrder.total_weight
          ? '（客户欠款已记录）'
          : data.gold_payment_weight + data.cash_payment_weight > selectedSalesOrder.total_weight
            ? '（多付部分已记入存款）'
            : '';
        toast.success(`结算单创建成功${paymentStatus}`);
        setShowCreateForm(false);
        setSelectedSalesOrder(null);
        setCreateForm({ payment_method: 'cash_price', gold_price: '', physical_gold_weight: '', gold_payment_weight: '', cash_payment_weight: '', remark: '' });
        setShowUnderpayConfirm(false);
        setUnderpayData(null);
        loadPendingSales();
        loadSettlements();
      } else {
        const error = await response.json();
        toast.error(error.detail || '创建失败');
      }
    } catch (error) {
      toast.error('创建失败');
    }
  };

  // 确认少付后继续创建
  const handleConfirmUnderpay = (e: React.FormEvent) => {
    setShowUnderpayConfirm(false);
    handleCreateSettlement(e, true);
  };

  // 确认结算单
  const handleConfirmSettlement = async () => {
    if (confirmingSettlementLoading) return;
    if (!confirmingSettlement) return;

    setConfirmingSettlementLoading(true);
    try {
      const response = await fetch(`${API_ENDPOINTS.SETTLEMENT_CONFIRM(confirmingSettlement.id)}?user_role=settlement`, {
        method: 'POST',
        headers: JSON_ROLE_HEADERS,
        body: JSON.stringify({ confirmed_by: '结算专员' })
      });

      if (response.ok) {
        const result = await response.json();
        toast.success('结算单已确认');

        // 调用回调，将结算单信息传递给父组件（用于在聊天框显示）
        if (onSettlementConfirmed && confirmingSettlement) {
          onSettlementConfirmed({
            settlement_id: confirmingSettlement.id,
            settlement_no: confirmingSettlement.settlement_no,
            customer_name: confirmingSettlement.sales_order?.customer_name || '未知',
            salesperson: confirmingSettlement.sales_order?.salesperson || '未知',
            payment_method: confirmingSettlement.payment_method,
            gold_price: confirmingSettlement.gold_price,
            total_weight: confirmingSettlement.total_weight,
            labor_amount: confirmingSettlement.labor_amount,
            material_amount: confirmingSettlement.material_amount || 0,
            total_amount: confirmingSettlement.total_amount,
            details: confirmingSettlement.sales_order?.details?.map(d => ({
              product_name: d.product_name,
              weight: d.weight,
              labor_cost: d.labor_cost,
              total_labor_cost: d.total_labor_cost
            })) || []
          });
        }

        setConfirmingSettlement(null);
        loadSettlements();
      } else {
        const error = await response.json();
        toast.error(error.detail || '确认失败');
      }
    } catch (error) {
      toast.error('确认失败');
    } finally {
      setConfirmingSettlementLoading(false);
    }
  };

  // 打开编辑结算单弹窗
  const handleOpenEdit = (settlement: SettlementOrder) => {
    setEditingSettlement(settlement);
    setEditForm({
      payment_method: settlement.payment_method,
      gold_price: settlement.gold_price?.toString() || '',
      physical_gold_weight: settlement.physical_gold_weight?.toString() || '',
      gold_payment_weight: settlement.gold_payment_weight?.toString() || '',
      cash_payment_weight: settlement.cash_payment_weight?.toString() || '',
      remark: settlement.remark || ''
    });
  };

  // 保存编辑结算单
  const handleSaveEdit = async () => {
    if (!editingSettlement) return;

    try {
      const payload: any = {
        payment_method: editForm.payment_method,
        remark: editForm.remark || null
      };

      if (editForm.gold_price) {
        payload.gold_price = parseFloat(editForm.gold_price);
      }

      if (editForm.payment_method === 'physical_gold' && editForm.physical_gold_weight) {
        payload.physical_gold_weight = parseFloat(editForm.physical_gold_weight);
      }

      if (editForm.payment_method === 'mixed') {
        if (editForm.gold_payment_weight) {
          payload.gold_payment_weight = parseFloat(editForm.gold_payment_weight);
        }
        if (editForm.cash_payment_weight) {
          payload.cash_payment_weight = parseFloat(editForm.cash_payment_weight);
        }
      }

      const response = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/settlement/orders/${editingSettlement.id}?user_role=settlement`, {
        method: 'PUT',
        headers: JSON_ROLE_HEADERS,
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        toast.success('结算单已更新');
        setEditingSettlement(null);
        loadSettlements();
      } else {
        const error = await response.json();
        toast.error(error.detail || '更新失败');
      }
    } catch (error) {
      toast.error('更新失败');
    }
  };

  // 标记已打印
  const handlePrint = async (settlement: SettlementOrder) => {
    try {
      const response = await fetch(`${API_ENDPOINTS.SETTLEMENT_PRINT(settlement.id)}?user_role=settlement`, {
        method: 'POST',
        headers: ROLE_HEADER
      });

      if (response.ok) {
        toast.success('已标记为打印');
        loadSettlements();
        // 实际打印功能
        window.print();
      } else {
        const error = await response.json();
        toast.error(error.detail || '操作失败');
      }
    } catch (error) {
      toast.error('操作失败');
    }
  };

  // 下载结算单 PDF
  const handleDownload = async (settlement: SettlementOrder) => {
    try {
      const url = `${API_ENDPOINTS.API_BASE_URL}/api/settlement/orders/${settlement.id}/download?format=pdf&user_role=settlement`;
      const response = await fetch(url);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || '下载失败');
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `结算单_${settlement.settlement_no}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(downloadUrl);
      toast.success('下载成功');
    } catch (error) {
      toast.error('下载失败，请稍后重试');
    }
  };

  // 打开开具收料单弹窗
  const openReceiptForm = (settlement: SettlementOrder) => {
    setSelectedSettlementForReceipt(settlement);
    // 预填克重（结料部分或全部克重）
    const goldWeight = settlement.payment_method === 'physical_gold'
      ? settlement.total_weight
      : settlement.gold_payment_weight || 0;
    setReceiptForm({
      gold_weight: goldWeight.toString(),
      gold_fineness: '足金999',
      remark: ''
    });
    setShowReceiptForm(true);
  };

  // 创建收料单
  const handleCreateReceipt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSettlementForReceipt) return;

    if (!receiptForm.gold_weight || parseFloat(receiptForm.gold_weight) <= 0) {
      toast.error('请输入有效的收料克重');
      return;
    }

    try {
      const params = new URLSearchParams({
        gold_weight: receiptForm.gold_weight,
        gold_fineness: receiptForm.gold_fineness,
        settlement_id: selectedSettlementForReceipt.id.toString(),
        remark: receiptForm.remark,
        created_by: '结算专员'
      });

      const response = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/gold-material/gold-receipts?${params}&user_role=settlement`, {
        method: 'POST',
        headers: JSON_ROLE_HEADERS
      });

      if (response.ok) {
        const result = await response.json();
        toast.success(`收料单创建成功：${result.data.receipt_no}，请到金料管理确认`);
        setShowReceiptForm(false);
        setSelectedSettlementForReceipt(null);
      } else {
        const error = await response.json();
        toast.error(error.detail || '创建收料单失败');
      }
    } catch (error) {
      toast.error('创建收料单失败');
    }
  };

  // 判断结算单是否需要收料（支付方式包含金料）
  const needsGoldReceipt = (settlement: SettlementOrder) => {
    return settlement.payment_method === 'physical_gold' || settlement.payment_method === 'mixed';
  };

  // 过滤结算单（添加数组安全检查）- 结算单一览显示全部
  const allSettlements = Array.isArray(settlements) ? settlements : [];
  const filteredSettlements = allSettlements.filter(s => {
    if (activeTab !== 'settlements') return false;
    // 搜索过滤
    if (searchFilters.settlement_no && !s.settlement_no.toLowerCase().includes(searchFilters.settlement_no.toLowerCase())) return false;
    if (searchFilters.sales_order_no && !(s.sales_order?.order_no || '').toLowerCase().includes(searchFilters.sales_order_no.toLowerCase())) return false;
    if (searchFilters.customer_name && !(s.sales_order?.customer_name || '').toLowerCase().includes(searchFilters.customer_name.toLowerCase())) return false;
    if (searchFilters.start_date && new Date(s.created_at) < new Date(searchFilters.start_date)) return false;
    if (searchFilters.end_date && new Date(s.created_at) > new Date(searchFilters.end_date + 'T23:59:59')) return false;
    return true;
  });

  const pendingCount = serverPendingCount || (Array.isArray(settlements) ? settlements : []).filter(s => s.status === 'pending' || s.status === 'draft').length;
  const completedCount = serverCompletedCount || (Array.isArray(settlements) ? settlements : []).filter(s => s.status === 'confirmed' || s.status === 'printed').length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-amber-50/30 to-gray-50 p-6">
      {/* 少付确认对话框 - z-index 要高于其他弹窗 */}
      {showUnderpayConfirm && underpayData && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100]">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl">
            <div className="flex items-center space-x-3 mb-4">
              <div className="p-3 bg-orange-100 rounded-full">
                <AlertCircle className="w-6 h-6 text-orange-600" />
              </div>
              <h3 className="text-lg font-bold text-gray-900">支付金额不足</h3>
            </div>

            <div className="space-y-3 mb-6">
              <div className="flex justify-between py-2 border-b">
                <span className="text-gray-600">本次支付</span>
                <span className="font-medium">{underpayData.totalInput.toFixed(3)} 克</span>
              </div>
              <div className="flex justify-between py-2 border-b">
                <span className="text-gray-600">应付金额</span>
                <span className="font-medium">{underpayData.totalWeight.toFixed(3)} 克</span>
              </div>
              <div className="flex justify-between py-2 bg-red-50 px-3 rounded-lg">
                <span className="text-red-700 font-medium">差额欠款</span>
                <span className="text-red-700 font-bold">{underpayData.difference.toFixed(3)} 克</span>
              </div>
            </div>

            <p className="text-sm text-gray-500 mb-6">
              是否确认以当前金额创建结算单？欠款将记录在客户账户中。
            </p>

            <div className="flex space-x-3">
              <button
                onClick={() => { setShowUnderpayConfirm(false); setUnderpayData(null); }}
                className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors"
              >
                取消
              </button>
              <button
                onClick={(e) => handleConfirmUnderpay(e)}
                className="flex-1 px-4 py-2.5 bg-orange-600 text-white rounded-xl hover:bg-orange-700 transition-colors"
              >
                确认继续
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto">
        {/* 标题栏 - 珠宝风格 */}
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-gradient-to-br from-cyan-500 to-teal-500 rounded-xl shadow-lg shadow-cyan-200/50">
              <FileText className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">结算管理</h1>
              <p className="text-gray-500 text-sm">确认销售单支付方式并复核打印</p>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <button
              onClick={openQuickReceiptForm}
              className="flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-yellow-500 to-amber-500 text-white 
                rounded-xl shadow-lg shadow-yellow-200/50 hover:from-yellow-600 hover:to-amber-600 
                transition-all font-medium"
            >
              <Package className="w-4 h-4" />
              <span>快捷收料</span>
            </button>
            <button
              onClick={openQuickWithdrawalForm}
              className="flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-500 text-white 
                rounded-xl shadow-lg shadow-blue-200/50 hover:from-blue-600 hover:to-indigo-600 
                transition-all font-medium"
            >
              <ArrowUpRight className="w-4 h-4" />
              <span>快捷提料</span>
            </button>
            <button
              onClick={openDepositSettleForm}
              className="flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-purple-500 to-violet-500 text-white 
                rounded-xl shadow-lg shadow-purple-200/50 hover:from-purple-600 hover:to-violet-600 
                transition-all font-medium"
            >
              <DollarSign className="w-4 h-4" />
              <span>存料结价</span>
            </button>
            <button
              onClick={() => { loadPendingSales(); loadSettlements(); loadDepositSettlements(); }}
              className="flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-gray-500 to-gray-600 text-white 
                rounded-xl shadow-lg shadow-gray-200/50 hover:from-gray-600 hover:to-gray-700 
                transition-all font-medium"
            >
              <RefreshCw className="w-4 h-4" />
              <span>刷新</span>
            </button>
          </div>
        </div>

        {/* 统计栏 */}
        <div className="bg-white rounded-xl shadow-sm mb-4">
          <div className="px-4 py-3 flex flex-wrap gap-4 text-sm border-b">
            <span className="text-gray-600">共 <strong className="text-gray-900">{pendingSales.length + (totalSettlements || allSettlements.length)}</strong> 单</span>
            <span className="text-orange-600">待开结算 <strong>{pendingSales.length}</strong></span>
            <span className="text-yellow-600">待确认 <strong>{pendingCount}</strong></span>
            <span className="text-green-600">已完成 <strong>{completedCount}</strong></span>
          </div>

          {/* Tab 切换 */}
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex space-x-3">
              <TabButton
                active={activeTab === 'to_settle'}
                onClick={() => setActiveTab('to_settle')}
                icon={<FileText className="w-4 h-4" />}
                label="待开结算单"
                count={pendingSales.length}
              />
              <TabButton
                active={activeTab === 'settlements'}
                onClick={() => setActiveTab('settlements')}
                icon={<Check className="w-4 h-4" />}
                label="结算单一览"
                count={totalSettlements || allSettlements.length}
              />
              <TabButton
                active={activeTab === 'deposit-settlements'}
                onClick={() => setActiveTab('deposit-settlements')}
                icon={<DollarSign className="w-4 h-4" />}
                label="存料结价"
                count={depositSettlements.filter(d => d.status === 'draft').length}
              />
              <TabButton
                active={activeTab === 'customer-payments'}
                onClick={() => setActiveTab('customer-payments')}
                icon={<DollarSign className="w-4 h-4" />}
                label="客户收款登记"
                count={customerPayments.filter(p => p.status === 'pending').length}
              />
            </div>
          </div>

          {/* 高级查询 - 结算单一览 Tab */}
          {activeTab === 'settlements' && (
            <>
              <div className="border-t">
                <button
                  onClick={() => setShowSearchPanel(!showSearchPanel)}
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50"
                >
                  <span className="flex items-center gap-2 text-sm font-medium text-gray-700">
                    <Filter className="w-4 h-4" />
                    高级查询
                  </span>
                  {showSearchPanel ? <X className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </button>
              </div>
              {showSearchPanel && (
                <div className="px-4 pb-4 border-t pt-4">
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">结算单号</label>
                      <input
                        type="text"
                        value={searchFilters.settlement_no}
                        onChange={(e) => setSearchFilters({ ...searchFilters, settlement_no: e.target.value })}
                        placeholder="JS..."
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">销售单号</label>
                      <input
                        type="text"
                        value={searchFilters.sales_order_no}
                        onChange={(e) => setSearchFilters({ ...searchFilters, sales_order_no: e.target.value })}
                        placeholder="XS..."
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">客户名称</label>
                      <input
                        type="text"
                        value={searchFilters.customer_name}
                        onChange={(e) => setSearchFilters({ ...searchFilters, customer_name: e.target.value })}
                        placeholder="客户姓名"
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">开始日期</label>
                      <input
                        type="date"
                        value={searchFilters.start_date}
                        onChange={(e) => setSearchFilters({ ...searchFilters, start_date: e.target.value })}
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">结束日期</label>
                      <input
                        type="date"
                        value={searchFilters.end_date}
                        onChange={(e) => setSearchFilters({ ...searchFilters, end_date: e.target.value })}
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none"
                      />
                    </div>
                  </div>
                  <div className="col-span-full flex gap-2 mt-3">
                    <button
                      onClick={() => {/* filteredSettlements already reactive */ }}
                      className="px-4 py-2 bg-amber-500 text-white rounded-lg text-sm hover:bg-amber-600 flex items-center gap-1"
                    >
                      <Search className="w-4 h-4" />
                      搜索
                    </button>
                    <button
                      onClick={handleResetSearch}
                      className="px-4 py-2 border text-gray-600 rounded-lg text-sm hover:bg-gray-50"
                    >
                      重置
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* 内容区域 - 根据Tab显示不同内容 */}
        {activeTab === 'to_settle' && (
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            {pendingSales.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <Package className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                <p className="text-lg">暂无待结算销售单</p>
                <p className="text-sm text-gray-400 mt-2">当销售单完成后会显示在这里等待开具结算单</p>
              </div>
            ) : (
              <div className="divide-y">
                {pendingSales.map(order => (
                  <div key={order.id}>
                    <div
                      className="hover:bg-gray-50 cursor-pointer transition-colors"
                      onClick={() => setExpandedPendingId(expandedPendingId === order.id ? null : order.id)}
                    >
                      <div className="px-4 py-3 flex items-center gap-4">
                        <div className="flex-shrink-0 text-gray-400 transition-transform" style={{ transform: expandedPendingId === order.id ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                          <ChevronDown className="w-4 h-4" />
                        </div>
                        <div className="min-w-[180px]">
                          <div className="font-medium text-orange-600">{order.order_no}</div>
                          <div className="text-xs text-gray-400">
                            {order.order_date ? new Date(order.order_date).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}
                          </div>
                        </div>
                        <div className="min-w-[100px]">
                          <div className="text-sm font-medium text-gray-800">{order.customer_name || '-'}</div>
                          <div className="text-xs text-gray-400">客户</div>
                        </div>
                        <div className="min-w-[60px] text-center">
                          <div className="text-sm font-medium">{order.details?.length || 0}</div>
                          <div className="text-xs text-gray-400">商品数</div>
                        </div>
                        <div className="min-w-[80px] text-center">
                          <div className="text-sm font-medium">{order.total_weight?.toFixed(3) || '0.000'}</div>
                          <div className="text-xs text-gray-400">克重</div>
                        </div>
                        <div className="min-w-[100px] text-center">
                          <div className="text-sm font-medium text-orange-600">¥{order.total_labor_cost?.toFixed(2) || '0.00'}</div>
                          <div className="text-xs text-gray-400">总工费</div>
                        </div>
                        <div className="min-w-[80px]">
                          <StatusBadge status={order.status} />
                        </div>
                        <div className="flex-1 flex justify-end" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => {
                              setSelectedSalesOrder(order);
                              setCreateForm(prev => ({ ...prev, remark: order.remark || '' }));
                              setShowCreateForm(true);
                            }}
                            className="px-3 py-1.5 text-xs font-medium bg-amber-50 text-amber-700 rounded-md hover:bg-amber-100 transition-colors border border-amber-200"
                          >
                            开结算单
                          </button>
                        </div>
                      </div>
                    </div>
                    {expandedPendingId === order.id && order.details && order.details.length > 0 && (() => {
                      const hasFCode = order.details.some((d: SalesDetail) => d.product_code?.startsWith('F'));
                      return (
                      <div className="px-4 pb-3 pt-0">
                        <div className="ml-8 bg-amber-50/50 rounded-lg border border-amber-100 overflow-x-auto">
                          <table className="w-full text-sm min-w-max">
                            <thead>
                              <tr className="text-xs text-gray-500 border-b border-amber-100">
                                <th className="text-left px-3 py-2 font-medium">商品编码</th>
                                <th className="text-left px-3 py-2 font-medium">商品名称</th>
                                <th className="text-right px-3 py-2 font-medium">件数</th>
                                <th className="text-right px-3 py-2 font-medium">克重</th>
                                <th className="text-right px-3 py-2 font-medium">克工费</th>
                                <th className="text-right px-3 py-2 font-medium">件工费</th>
                                <th className="text-right px-3 py-2 font-medium">总工费</th>
                                {hasFCode && (
                                  <>
                                    <th className="text-right px-3 py-2 font-medium">主石重</th>
                                    <th className="text-right px-3 py-2 font-medium">主石粒数</th>
                                    <th className="text-right px-3 py-2 font-medium">副石重</th>
                                    <th className="text-right px-3 py-2 font-medium">副石粒数</th>
                                    <th className="text-center px-3 py-2 font-medium">主石字印</th>
                                    <th className="text-center px-3 py-2 font-medium">副石字印</th>
                                    <th className="text-right px-3 py-2 font-medium">珍珠重</th>
                                    <th className="text-right px-3 py-2 font-medium">轴承重</th>
                                    <th className="text-right px-3 py-2 font-medium">销售克工费</th>
                                    <th className="text-right px-3 py-2 font-medium">销售件工费</th>
                                  </>
                                )}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-amber-100/50">
                              {order.details.map((d: SalesDetail) => (
                                <tr key={d.id} className="text-gray-700">
                                  <td className="px-3 py-1.5 text-gray-500">{d.product_code || '-'}</td>
                                  <td className="px-3 py-1.5">{d.product_name}</td>
                                  <td className="px-3 py-1.5 text-right">{d.piece_count ?? 1}</td>
                                  <td className="px-3 py-1.5 text-right">{Number(d.weight).toFixed(3)}g</td>
                                  <td className="px-3 py-1.5 text-right">¥{Number(d.labor_cost).toFixed(2)}/g</td>
                                  <td className="px-3 py-1.5 text-right">{d.piece_labor_cost ? `¥${Number(d.piece_labor_cost).toFixed(2)}` : '-'}</td>
                                  <td className="px-3 py-1.5 text-right text-orange-600 font-medium">¥{(d.total_labor_cost ?? (d.weight * d.labor_cost)).toFixed(2)}</td>
                                  {hasFCode && (
                                    <>
                                      <td className="px-3 py-1.5 text-right">{d.main_stone_weight ?? '-'}</td>
                                      <td className="px-3 py-1.5 text-right">{d.main_stone_count ?? '-'}</td>
                                      <td className="px-3 py-1.5 text-right">{d.sub_stone_weight ?? '-'}</td>
                                      <td className="px-3 py-1.5 text-right">{d.sub_stone_count ?? '-'}</td>
                                      <td className="px-3 py-1.5 text-center">{d.main_stone_mark || '-'}</td>
                                      <td className="px-3 py-1.5 text-center">{d.sub_stone_mark || '-'}</td>
                                      <td className="px-3 py-1.5 text-right">{d.pearl_weight ?? '-'}</td>
                                      <td className="px-3 py-1.5 text-right">{d.bearing_weight ?? '-'}</td>
                                      <td className="px-3 py-1.5 text-right">{d.sale_labor_cost ?? '-'}</td>
                                      <td className="px-3 py-1.5 text-right">{d.sale_piece_labor_cost ?? '-'}</td>
                                    </>
                                  )}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                      );
                    })()}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'settlements' && (
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500"></div>
                <span className="ml-2 text-gray-500">加载中...</span>
              </div>
            ) : filteredSettlements.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                <FileText className="w-12 h-12 mb-3 opacity-50" />
                <p>暂无结算单</p>
                <p className="text-sm mt-1">创建结算单后会显示在这里</p>
              </div>
            ) : (
              <div className="divide-y">
                {filteredSettlements.map(settlement => (
                  <div key={settlement.id}>
                    <div
                      className="hover:bg-gray-50 transition-colors cursor-pointer"
                      onClick={() => setExpandedSettlementId(expandedSettlementId === settlement.id ? null : settlement.id)}
                    >
                      <div className="px-4 py-3 flex items-center gap-4">
                        <div className="flex-shrink-0 text-gray-400 transition-transform" style={{ transform: expandedSettlementId === settlement.id ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                          <ChevronDown className="w-4 h-4" />
                        </div>
                        <div className="min-w-[180px]">
                          <div className="font-medium text-amber-600">{settlement.settlement_no}</div>
                          <div className="text-xs text-gray-400">
                            {settlement.created_at ? new Date(settlement.created_at).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}
                          </div>
                        </div>
                        <div className="min-w-[100px]">
                          <div className="text-sm font-medium text-gray-800">{settlement.sales_order?.customer_name || '-'}</div>
                          <div className="text-xs text-gray-400">客户</div>
                        </div>
                        <div className="min-w-[120px]">
                          <div className="text-sm text-gray-700">
                            {settlement.payment_method === 'cash_price'
                              ? `结价 ¥${settlement.gold_price}/g`
                              : settlement.payment_method === 'mixed'
                                ? '混合支付'
                                : `结料 ${settlement.physical_gold_weight}g`
                            }
                          </div>
                          <div className="text-xs text-gray-400">支付方式</div>
                        </div>
                        <div className="min-w-[80px] text-center">
                          <div className="text-sm font-medium">{settlement.total_weight?.toFixed(3) || '0.000'}</div>
                          <div className="text-xs text-gray-400">克重</div>
                        </div>
                        <div className="min-w-[100px] text-center">
                          <div className="text-sm font-medium text-amber-600">¥{settlement.total_amount?.toFixed(2) || '0.00'}</div>
                          <div className="text-xs text-gray-400">总金额</div>
                        </div>
                        <div className="min-w-[80px] flex flex-col items-start gap-1">
                          <StatusBadge status={settlement.status} />
                          {settlement.payment_status === 'overpaid' && (
                            <span className="px-1.5 py-0.5 text-[10px] bg-blue-100 text-blue-700 rounded-full">
                              多付 {Math.abs(settlement.payment_difference || 0).toFixed(3)}g
                            </span>
                          )}
                          {settlement.payment_status === 'underpaid' && (
                            <span className="px-1.5 py-0.5 text-[10px] bg-red-100 text-red-700 rounded-full">
                              欠款 {Math.abs(settlement.payment_difference || 0).toFixed(3)}g
                            </span>
                          )}
                        </div>
                        <div className="flex-1 flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                          {(settlement.status === 'pending' || settlement.status === 'draft') && (
                          <>
                            <button
                              onClick={() => setConfirmingSettlement(settlement)}
                              className="px-2.5 py-1 text-xs font-medium bg-green-50 text-green-700 rounded-md hover:bg-green-100 transition-colors border border-green-200"
                            >
                              确认
                            </button>
                            <button
                              onClick={() => handleOpenEdit(settlement)}
                              className="px-2.5 py-1 text-xs font-medium bg-gray-50 text-gray-700 rounded-md hover:bg-gray-100 transition-colors border border-gray-200"
                            >
                              编辑
                            </button>
                            <button
                              onClick={() => {
                                setConfirmDialog({
                                  isOpen: true,
                                  title: '撤销结算单',
                                  message: `确定要撤销结算单 ${settlement.settlement_no} 吗？\n销售单将回到"待开结算单"状态。`,
                                  isDestructive: true,
                                  onConfirm: async () => {
                                    setConfirmDialog(prev => ({...prev, isOpen: false}));
                                    try {
                                      const response = await fetch(
                                        `${API_ENDPOINTS.API_BASE_URL}/api/settlement/orders/${settlement.id}/cancel?user_role=settlement`,
                                        { method: 'POST' }
                                      );
                                      if (response.ok) {
                                        toast.success('结算单已撤销');
                                        loadSettlements();
                                        loadPendingSales();
                                      } else {
                                        const error = await response.json();
                                        toast.error(error.detail || '撤单失败');
                                      }
                                    } catch (error) {
                                      toast.error('撤单失败');
                                    }
                                  }
                                });
                              }}
                              className="px-2.5 py-1 text-xs font-medium bg-red-50 text-red-700 rounded-md hover:bg-red-100 transition-colors border border-red-200"
                            >
                              撤单
                            </button>
                          </>
                        )}
                        {settlement.status === 'confirmed' && (
                          <>
                            <button
                              onClick={() => handlePrint(settlement)}
                              className="px-2.5 py-1 text-xs font-medium bg-green-50 text-green-700 rounded-md hover:bg-green-100 transition-colors border border-green-200"
                            >
                              打印
                            </button>
                            <button
                              onClick={() => handleDownload(settlement)}
                              className="px-2.5 py-1 text-xs font-medium bg-blue-50 text-blue-700 rounded-md hover:bg-blue-100 transition-colors border border-blue-200"
                            >
                              下载
                            </button>
                            {needsGoldReceipt(settlement) && (
                              <button
                                onClick={() => openReceiptForm(settlement)}
                                className="px-2.5 py-1 text-xs font-medium bg-amber-50 text-amber-700 rounded-md hover:bg-amber-100 transition-colors border border-amber-200"
                              >
                                收料单
                              </button>
                            )}
                            <button
                              onClick={() => {
                                setConfirmDialog({
                                  isOpen: true,
                                  title: '撤销结算单',
                                  message: '确定要撤销此结算单吗？撤销后可以重新选择支付方式进行结算。',
                                  isDestructive: true,
                                  onConfirm: async () => {
                                    setConfirmDialog(prev => ({...prev, isOpen: false}));
                                    try {
                                      const response = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/settlement/orders/${settlement.id}/revert?user_role=settlement`, {
                                        method: 'POST'
                                      })
                                      if (response.ok) {
                                        const result = await response.json()
                                        toast.success(result.message || '结算单已撤销')
                                        loadSettlements()
                                      } else {
                                        const error = await response.json()
                                        toast.error('撤销失败：' + (error.detail || '未知错误'))
                                      }
                                    } catch (error) {
                                      toast.error('撤销失败')
                                    }
                                  }
                                });
                              }}
                              className="px-2.5 py-1 text-xs font-medium bg-orange-50 text-orange-700 rounded-md hover:bg-orange-100 transition-colors border border-orange-200"
                            >
                              反确认
                            </button>
                          </>
                        )}
                        {settlement.status === 'printed' && (
                          <>
                            <button
                              onClick={() => window.open(`${API_ENDPOINTS.API_BASE_URL}/api/settlement/orders/${settlement.id}/download?format=html`, '_blank')}
                              className="px-2.5 py-1 text-xs font-medium bg-green-50 text-green-700 rounded-md hover:bg-green-100 transition-colors border border-green-200"
                            >
                              打印
                            </button>
                            <button
                              onClick={() => handleDownload(settlement)}
                              className="px-2.5 py-1 text-xs font-medium bg-blue-50 text-blue-700 rounded-md hover:bg-blue-100 transition-colors border border-blue-200"
                            >
                              下载
                            </button>
                            {needsGoldReceipt(settlement) && (
                              <button
                                onClick={() => openReceiptForm(settlement)}
                                className="px-2.5 py-1 text-xs font-medium bg-amber-50 text-amber-700 rounded-md hover:bg-amber-100 transition-colors border border-amber-200"
                              >
                                收料单
                              </button>
                            )}
                            <button
                              onClick={() => {
                                setConfirmDialog({
                                  isOpen: true,
                                  title: '撤销结算单',
                                  message: '确定要撤销此结算单吗？撤销后可以重新选择支付方式进行结算。',
                                  isDestructive: true,
                                  onConfirm: async () => {
                                    setConfirmDialog(prev => ({...prev, isOpen: false}));
                                    try {
                                      const response = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/settlement/orders/${settlement.id}/revert?user_role=settlement`, {
                                        method: 'POST'
                                      })
                                      if (response.ok) {
                                        const result = await response.json()
                                        toast.success(result.message || '结算单已撤销')
                                        loadSettlements()
                                      } else {
                                        const error = await response.json()
                                        toast.error('撤销失败：' + (error.detail || '未知错误'))
                                      }
                                    } catch (error) {
                                      toast.error('撤销失败')
                                    }
                                  }
                                });
                              }}
                              className="px-2.5 py-1 text-xs font-medium bg-orange-50 text-orange-700 rounded-md hover:bg-orange-100 transition-colors border border-orange-200"
                            >
                              反确认
                            </button>
                          </>
                        )}
                        {settlement.status === 'refunded' && (
                          <span className="text-xs text-red-500">已销退</span>
                        )}
                        </div>
                      </div>
                    </div>
                    {expandedSettlementId === settlement.id && settlement.sales_order?.details && settlement.sales_order.details.length > 0 && (() => {
                      const hasFCode = settlement.sales_order.details.some((d: SalesDetail) => d.product_code?.startsWith('F'));
                      return (
                      <div className="px-4 pb-3 pt-0">
                        <div className="ml-8 space-y-2">
                          <div className="flex items-center gap-4 text-xs bg-gray-50 rounded-lg px-3 py-2 border border-gray-200">
                            <span className="text-gray-500">支付方式:</span>
                            <span className="font-medium text-gray-800">
                              {settlement.payment_method === 'cash_price' ? '结价' : settlement.payment_method === 'physical_gold' ? '结料' : '混合支付'}
                            </span>
                            {settlement.gold_price && (
                              <><span className="text-gray-400">|</span><span className="text-gray-500">金价: <span className="font-medium text-gray-800">¥{Number(settlement.gold_price).toFixed(2)}/g</span></span></>
                            )}
                            {settlement.payment_method === 'physical_gold' && settlement.physical_gold_weight && (
                              <><span className="text-gray-400">|</span><span className="text-gray-500">结料克重: <span className="font-medium text-gray-800">{Number(settlement.physical_gold_weight).toFixed(3)}g</span></span></>
                            )}
                            {settlement.payment_method === 'mixed' && (
                              <>
                                {settlement.gold_payment_weight && <><span className="text-gray-400">|</span><span className="text-gray-500">结料部分: <span className="font-medium text-gray-800">{Number(settlement.gold_payment_weight).toFixed(3)}g</span></span></>}
                                {settlement.cash_payment_weight && <><span className="text-gray-400">|</span><span className="text-gray-500">结价部分: <span className="font-medium text-gray-800">{Number(settlement.cash_payment_weight).toFixed(3)}g</span></span></>}
                              </>
                            )}
                            <span className="text-gray-400">|</span>
                            <span className="text-gray-500">总金额: <span className="font-medium text-orange-600">¥{Number(settlement.total_amount || 0).toFixed(2)}</span></span>
                          </div>
                          <div className="bg-amber-50/50 rounded-lg border border-amber-100 overflow-x-auto">
                            <table className="w-full text-sm min-w-max">
                              <thead>
                                <tr className="text-xs text-gray-500 border-b border-amber-100">
                                  <th className="text-left px-3 py-2 font-medium">商品编码</th>
                                  <th className="text-left px-3 py-2 font-medium">商品名称</th>
                                  <th className="text-right px-3 py-2 font-medium">件数</th>
                                  <th className="text-right px-3 py-2 font-medium">克重</th>
                                  <th className="text-right px-3 py-2 font-medium">克工费</th>
                                  <th className="text-right px-3 py-2 font-medium">件工费</th>
                                  <th className="text-right px-3 py-2 font-medium">总工费</th>
                                  {hasFCode && (
                                    <>
                                      <th className="text-right px-3 py-2 font-medium">主石重</th>
                                      <th className="text-right px-3 py-2 font-medium">主石粒数</th>
                                      <th className="text-right px-3 py-2 font-medium">副石重</th>
                                      <th className="text-right px-3 py-2 font-medium">副石粒数</th>
                                      <th className="text-center px-3 py-2 font-medium">主石字印</th>
                                      <th className="text-center px-3 py-2 font-medium">副石字印</th>
                                      <th className="text-right px-3 py-2 font-medium">珍珠重</th>
                                      <th className="text-right px-3 py-2 font-medium">轴承重</th>
                                      <th className="text-right px-3 py-2 font-medium">销售克工费</th>
                                      <th className="text-right px-3 py-2 font-medium">销售件工费</th>
                                    </>
                                  )}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-amber-100/50">
                                {settlement.sales_order.details.map((d: SalesDetail) => (
                                  <tr key={d.id} className="text-gray-700">
                                    <td className="px-3 py-1.5 text-gray-500">{d.product_code || '-'}</td>
                                    <td className="px-3 py-1.5">{d.product_name}</td>
                                    <td className="px-3 py-1.5 text-right">{d.piece_count ?? 1}</td>
                                    <td className="px-3 py-1.5 text-right">{Number(d.weight).toFixed(3)}g</td>
                                    <td className="px-3 py-1.5 text-right">¥{Number(d.labor_cost).toFixed(2)}/g</td>
                                    <td className="px-3 py-1.5 text-right">{d.piece_labor_cost ? `¥${Number(d.piece_labor_cost).toFixed(2)}` : '-'}</td>
                                    <td className="px-3 py-1.5 text-right text-orange-600 font-medium">¥{(d.total_labor_cost ?? (d.weight * d.labor_cost)).toFixed(2)}</td>
                                    {hasFCode && (
                                      <>
                                        <td className="px-3 py-1.5 text-right">{d.main_stone_weight ?? '-'}</td>
                                        <td className="px-3 py-1.5 text-right">{d.main_stone_count ?? '-'}</td>
                                        <td className="px-3 py-1.5 text-right">{d.sub_stone_weight ?? '-'}</td>
                                        <td className="px-3 py-1.5 text-right">{d.sub_stone_count ?? '-'}</td>
                                        <td className="px-3 py-1.5 text-center">{d.main_stone_mark || '-'}</td>
                                        <td className="px-3 py-1.5 text-center">{d.sub_stone_mark || '-'}</td>
                                        <td className="px-3 py-1.5 text-right">{d.pearl_weight ?? '-'}</td>
                                        <td className="px-3 py-1.5 text-right">{d.bearing_weight ?? '-'}</td>
                                        <td className="px-3 py-1.5 text-right">{d.sale_labor_cost ?? '-'}</td>
                                        <td className="px-3 py-1.5 text-right">{d.sale_piece_labor_cost ?? '-'}</td>
                                      </>
                                    )}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                      );
                    })()}
                  </div>
                ))}
              </div>
            )}

            {/* 分页控件 */}
            {totalPages > 1 && (
              <div className="px-4 py-3 flex items-center justify-between border-t bg-gray-50/50">
                <span className="text-sm text-gray-500">
                  共 {totalSettlements} 条，第 {currentPage}/{totalPages} 页
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => { setCurrentPage(1); loadSettlements(1); }}
                    disabled={currentPage <= 1}
                    className="px-2.5 py-1.5 text-xs rounded-md border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    首页
                  </button>
                  <button
                    onClick={() => { const p = currentPage - 1; setCurrentPage(p); loadSettlements(p); }}
                    disabled={currentPage <= 1}
                    className="px-2.5 py-1.5 text-xs rounded-md border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    上一页
                  </button>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum: number;
                    if (totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (currentPage <= 3) {
                      pageNum = i + 1;
                    } else if (currentPage >= totalPages - 2) {
                      pageNum = totalPages - 4 + i;
                    } else {
                      pageNum = currentPage - 2 + i;
                    }
                    return (
                      <button
                        key={pageNum}
                        onClick={() => { setCurrentPage(pageNum); loadSettlements(pageNum); }}
                        className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${pageNum === currentPage
                          ? 'bg-amber-500 text-white border-amber-500'
                          : 'border-gray-200 bg-white hover:bg-gray-50'
                          }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                  <button
                    onClick={() => { const p = currentPage + 1; setCurrentPage(p); loadSettlements(p); }}
                    disabled={currentPage >= totalPages}
                    className="px-2.5 py-1.5 text-xs rounded-md border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    下一页
                  </button>
                  <button
                    onClick={() => { setCurrentPage(totalPages); loadSettlements(totalPages); }}
                    disabled={currentPage >= totalPages}
                    className="px-2.5 py-1.5 text-xs rounded-md border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    末页
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ==================== 存料结价一览 ==================== */}
        {activeTab === 'deposit-settlements' && (
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            {depositSettlementsLoading ? (
              <div className="flex items-center justify-center py-20">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500"></div>
                <span className="ml-2 text-gray-500">加载中...</span>
              </div>
            ) : depositSettlements.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                <DollarSign className="w-12 h-12 mb-3 opacity-50" />
                <p>暂无存料结价单</p>
                <p className="text-sm mt-1">点击「存料结价」按钮创建</p>
              </div>
            ) : (
              <div className="divide-y">
                {depositSettlements.map(ds => (
                  <div key={ds.id} className="hover:bg-gray-50 transition-colors">
                    <div className="px-4 py-3 flex items-center gap-4">
                      {/* 单号和时间 */}
                      <div className="min-w-[160px]">
                        <div className="font-medium text-purple-600">{ds.settlement_no}</div>
                        <div className="text-xs text-gray-400">
                          {ds.created_at ? new Date(ds.created_at).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}
                        </div>
                      </div>
                      {/* 客户 */}
                      <div className="min-w-[100px]">
                        <div className="text-sm font-medium text-gray-800">{ds.customer_name}</div>
                        <div className="text-xs text-gray-400">客户</div>
                      </div>
                      {/* 结价克重 */}
                      <div className="min-w-[80px] text-center">
                        <div className="text-sm font-medium">{ds.gold_weight?.toFixed(3) || '0.000'}g</div>
                        <div className="text-xs text-gray-400">结价克重</div>
                      </div>
                      {/* 金价 */}
                      <div className="min-w-[80px] text-center">
                        <div className="text-sm font-medium">¥{ds.gold_price?.toFixed(0) || '0'}/g</div>
                        <div className="text-xs text-gray-400">金价</div>
                      </div>
                      {/* 抵扣金额 */}
                      <div className="min-w-[100px] text-center">
                        <div className="text-sm font-medium text-purple-600">¥{ds.total_amount?.toFixed(2) || '0.00'}</div>
                        <div className="text-xs text-gray-400">抵扣金额</div>
                      </div>
                      {/* 状态 */}
                      <div className="min-w-[80px]">
                        <span className={`px-2 py-1 text-xs rounded-full font-medium ${ds.status === 'draft' ? 'bg-yellow-100 text-yellow-700' :
                          ds.status === 'confirmed' ? 'bg-green-100 text-green-700' :
                            'bg-gray-100 text-gray-500'
                          }`}>
                          {ds.status === 'draft' ? '待确认' : ds.status === 'confirmed' ? '已确认' : '已取消'}
                        </span>
                      </div>
                      {/* 操作按钮 */}
                      <div className="flex-1 flex justify-end gap-1.5">
                        {ds.status === 'draft' && (
                          <>
                            <button
                              onClick={() => handleConfirmDepositSettle(ds.id, ds.settlement_no)}
                              className="px-2.5 py-1 text-xs font-medium bg-green-50 text-green-700 rounded-md hover:bg-green-100 transition-colors border border-green-200"
                            >
                              确认
                            </button>
                            <button
                              onClick={() => handleCancelDepositSettle(ds.id, ds.settlement_no)}
                              className="px-2.5 py-1 text-xs font-medium bg-red-50 text-red-700 rounded-md hover:bg-red-100 transition-colors border border-red-200"
                            >
                              取消
                            </button>
                          </>
                        )}
                        {ds.status === 'confirmed' && ds.confirmed_at && (
                          <span className="text-xs text-gray-400">
                            {new Date(ds.confirmed_at).toLocaleDateString('zh-CN')} 确认
                          </span>
                        )}
                      </div>
                    </div>
                    {ds.remark && (
                      <div className="px-4 pb-2 text-xs text-gray-500">备注：{ds.remark}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ==================== 客户收款登记 ==================== */}
        {activeTab === 'customer-payments' && (
          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                <DollarSign className="w-5 h-5 mr-2 text-green-500" />
                客户收款登记
              </h2>
              <button
                onClick={() => {
                  setEditingPaymentId(null);
                  setCustomerPaymentForm({ customer_id: '', amount: '', payment_method: 'bank_transfer', remark: '' });
                  setShowCustomerPaymentModal(true);
                }}
                className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 flex items-center gap-2 text-sm"
              >
                <span>➕</span> 创建收款登记
              </button>
            </div>

            {customerPaymentsLoading ? (
              <div className="text-center py-12 text-gray-500">加载中...</div>
            ) : customerPayments.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[600px]">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-gray-600">收款单号</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-600">客户</th>
                      <th className="px-4 py-3 text-right font-medium text-gray-600">金额</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-600">收款方式</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-600">状态</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-600">操作人</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-600">时间</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-600">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {customerPayments.map((p: any) => (
                      <tr key={p.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-mono text-xs">{p.payment_no}</td>
                        <td className="px-4 py-3 font-medium">{p.customer_name}</td>
                        <td className="px-4 py-3 text-right font-semibold text-green-600">¥{p.amount?.toFixed(2)}</td>
                        <td className="px-4 py-3 text-center text-xs">
                          {{ bank_transfer: '银行转账', cash: '现金', wechat: '微信', alipay: '支付宝', card: '刷卡', check: '支票', other: '其他' }[p.payment_method as string] || p.payment_method}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {p.status === 'pending' && <span className="px-2 py-1 text-xs bg-yellow-100 text-yellow-700 rounded-full">待确认</span>}
                          {p.status === 'confirmed' && <span className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded-full">已确认</span>}
                          {p.status === 'cancelled' && <span className="px-2 py-1 text-xs bg-gray-100 text-gray-500 rounded-full">已取消</span>}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-600">
                          <div>{p.operator}</div>
                          {p.confirmed_by && <div className="text-green-600">确认: {p.confirmed_by}</div>}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">
                          {p.create_time ? new Date(p.create_time).toLocaleString('zh-CN') : ''}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex gap-1 justify-center">
                            {p.status === 'pending' && (
                              <>
                                <button
                                  onClick={() => handleCustomerPaymentAction(p.id, 'confirm')}
                                  className="px-2 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600"
                                >
                                  确认
                                </button>
                                <button
                                  onClick={() => {
                                    setEditingPaymentId(p.id);
                                    setCustomerPaymentForm({
                                      customer_id: p.customer_id?.toString() || '',
                                      amount: p.amount?.toString() || '',
                                      payment_method: p.payment_method || 'bank_transfer',
                                      remark: p.remark || ''
                                    });
                                    setShowCustomerPaymentModal(true);
                                  }}
                                  className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
                                >
                                  编辑
                                </button>
                                <button
                                  onClick={() => handleCustomerPaymentAction(p.id, 'delete')}
                                  className="px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600"
                                >
                                  取消
                                </button>
                              </>
                            )}
                            {p.status === 'confirmed' && (
                              <button
                                onClick={() => {
                                  const reason = prompt('请输入反确认原因：');
                                  if (reason) handleCustomerPaymentAction(p.id, 'unconfirm', reason);
                                }}
                                className="px-2 py-1 text-xs bg-amber-500 text-white rounded hover:bg-amber-600"
                              >
                                反确认
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-12 text-gray-400">暂无收款记录</div>
            )}
          </div>
        )}

        {/* 创建/编辑客户收款登记模态框 */}
        {showCustomerPaymentModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => { setShowCustomerPaymentModal(false); setEditingPaymentId(null); }}>
            <div className="bg-white rounded-lg p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold">{editingPaymentId ? '编辑收款登记' : '创建收款登记'}</h3>
                <button onClick={() => { setShowCustomerPaymentModal(false); setEditingPaymentId(null); }} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">客户 *</label>
                  <select
                    value={customerPaymentForm.customer_id}
                    onChange={(e) => setCustomerPaymentForm({ ...customerPaymentForm, customer_id: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value="">请选择客户</option>
                    {customers.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">收款金额 (元) *</label>
                  <input
                    type="number"
                    step="0.01"
                    value={customerPaymentForm.amount}
                    onChange={(e) => setCustomerPaymentForm({ ...customerPaymentForm, amount: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    placeholder="请输入收款金额"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">收款方式</label>
                  <select
                    value={customerPaymentForm.payment_method}
                    onChange={(e) => setCustomerPaymentForm({ ...customerPaymentForm, payment_method: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value="bank_transfer">银行转账</option>
                    <option value="cash">现金</option>
                    <option value="wechat">微信</option>
                    <option value="alipay">支付宝</option>
                    <option value="card">刷卡</option>
                    <option value="check">支票</option>
                    <option value="other">其他</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
                  <textarea
                    value={customerPaymentForm.remark}
                    onChange={(e) => setCustomerPaymentForm({ ...customerPaymentForm, remark: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    rows={2}
                    placeholder="可选备注信息"
                  />
                </div>
                <div className="flex gap-2 justify-end pt-2">
                  <button
                    onClick={() => { setShowCustomerPaymentModal(false); setEditingPaymentId(null); }}
                    className="px-4 py-2 border rounded-lg hover:bg-gray-50"
                  >
                    取消
                  </button>
                  <button
                    onClick={editingPaymentId ? updateCustomerPayment : createCustomerPayment}
                    className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600"
                  >
                    {editingPaymentId ? '保存' : '创建'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 创建结算单弹窗 */}
        {showCreateForm && selectedSalesOrder && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">创建结算单</h3>
                <button onClick={() => setShowCreateForm(false)} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* 销售单信息 */}
              <div className="bg-gray-50 rounded-lg p-4 mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-500">销售单号</span>
                  <span className="font-mono">{selectedSalesOrder.order_no}</span>
                </div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-500">客户</span>
                  <span className="font-medium">{selectedSalesOrder.customer_name}</span>
                </div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-500">总克重</span>
                  <span className="font-medium">{selectedSalesOrder.total_weight.toFixed(3)}g</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">工费总计</span>
                  <span className="font-medium text-green-600">¥{selectedSalesOrder.total_labor_cost.toFixed(2)}</span>
                </div>
              </div>

              {/* 商品明细 */}
              <div className="mb-4">
                <h4 className="text-sm font-medium text-gray-700 mb-2">商品明细</h4>
                <div className="space-y-2">
                  {selectedSalesOrder.details.map(detail => (
                    <div key={detail.id} className="flex items-center justify-between text-sm bg-gray-50 rounded px-3 py-2">
                      <span>{detail.product_name}</span>
                      <span className="text-gray-500">{Number(detail.weight).toFixed(3)}g × ¥{detail.labor_cost}/g</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 表单 */}
              <form onSubmit={handleCreateSettlement} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">原料支付方式</label>
                  <div className="flex space-x-4">
                    <label className="flex items-center">
                      <input
                        type="radio"
                        name="payment_method"
                        value="cash_price"
                        checked={createForm.payment_method === 'cash_price'}
                        onChange={(e) => setCreateForm({ ...createForm, payment_method: e.target.value })}
                        className="mr-2"
                      />
                      <span className="flex items-center">
                        <DollarSign className="w-4 h-4 mr-1 text-green-500" />
                        结价支付
                      </span>
                    </label>
                    <label className="flex items-center">
                      <input
                        type="radio"
                        name="payment_method"
                        value="physical_gold"
                        checked={createForm.payment_method === 'physical_gold'}
                        onChange={(e) => setCreateForm({
                          ...createForm,
                          payment_method: e.target.value,
                          physical_gold_weight: e.target.value === 'physical_gold'
                            ? selectedSalesOrder?.total_weight?.toString() || ''
                            : createForm.physical_gold_weight
                        })}
                        className="mr-2"
                      />
                      <span className="flex items-center">
                        <Package className="w-4 h-4 mr-1 text-yellow-500" />
                        结料
                      </span>
                    </label>
                    <label className="flex items-center">
                      <input
                        type="radio"
                        name="payment_method"
                        value="mixed"
                        checked={createForm.payment_method === 'mixed'}
                        onChange={(e) => setCreateForm({ ...createForm, payment_method: e.target.value })}
                        className="mr-2"
                      />
                      <span className="flex items-center">
                        <DollarSign className="w-4 h-4 mr-1 text-purple-500" />
                        混合支付
                      </span>
                    </label>
                  </div>
                </div>

                {createForm.payment_method === 'cash_price' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">当日金价 (元/克)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={createForm.gold_price}
                      onChange={(e) => setCreateForm({ ...createForm, gold_price: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                      placeholder="例如: 580.00"
                      required
                    />
                    {createForm.gold_price && (
                      <p className="mt-1 text-sm text-gray-500">
                        原料金额: ¥{(parseFloat(createForm.gold_price) * selectedSalesOrder.total_weight).toFixed(2)}
                      </p>
                    )}
                  </div>
                )}

                {createForm.payment_method === 'physical_gold' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">客人应付黄金重量 (克)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={createForm.physical_gold_weight}
                      onChange={(e) => setCreateForm({ ...createForm, physical_gold_weight: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                      placeholder="例如: 50.00"
                      required
                    />
                  </div>
                )}

                {/* 混合支付专用表单 */}
                {createForm.payment_method === 'mixed' && (
                  <div className="space-y-4 bg-purple-50 rounded-lg p-4">
                    <h4 className="text-sm font-medium text-purple-800">混合支付设置</h4>
                    <p className="text-xs text-purple-600">
                      商品总重量：{selectedSalesOrder.total_weight} 克，请分配结料和结价的克重
                    </p>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">当日金价 (元/克)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={createForm.gold_price}
                        onChange={(e) => setCreateForm({ ...createForm, gold_price: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                        placeholder="例如: 580.00"
                        required
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          💰 结料克重 (客户支付金料)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          value={createForm.gold_payment_weight}
                          onChange={(e) => setCreateForm({ ...createForm, gold_payment_weight: e.target.value })}
                          className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500"
                          placeholder="例如: 10.00"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          💵 结价克重 (按金价换算现金)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          value={createForm.cash_payment_weight}
                          onChange={(e) => setCreateForm({ ...createForm, cash_payment_weight: e.target.value })}
                          className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                          placeholder="例如: 10.00"
                          required
                        />
                      </div>
                    </div>

                    {/* 克重校验提示 */}
                    {(createForm.gold_payment_weight || createForm.cash_payment_weight) && (
                      <div className={`text-sm p-2 rounded ${Math.abs((parseFloat(createForm.gold_payment_weight || '0') + parseFloat(createForm.cash_payment_weight || '0')) - selectedSalesOrder.total_weight) <= 0.01
                        ? 'bg-green-100 text-green-700'
                        : 'bg-red-100 text-red-700'
                        }`}>
                        结料 {parseFloat(createForm.gold_payment_weight || '0').toFixed(3)} 克 +
                        结价 {parseFloat(createForm.cash_payment_weight || '0').toFixed(3)} 克 =
                        {(parseFloat(createForm.gold_payment_weight || '0') + parseFloat(createForm.cash_payment_weight || '0')).toFixed(3)} 克
                        {Math.abs((parseFloat(createForm.gold_payment_weight || '0') + parseFloat(createForm.cash_payment_weight || '0')) - selectedSalesOrder.total_weight) <= 0.01
                          ? ' ✓'
                          : ` (应等于 ${selectedSalesOrder.total_weight} 克)`
                        }
                      </div>
                    )}

                    {/* 混合支付金额预览 */}
                    {createForm.gold_price && createForm.cash_payment_weight && (
                      <div className="bg-white rounded-lg p-3 border border-purple-200">
                        <div className="text-sm space-y-1">
                          <div className="flex justify-between">
                            <span className="text-gray-600">结价部分料费</span>
                            <span>¥{(parseFloat(createForm.gold_price) * parseFloat(createForm.cash_payment_weight || '0')).toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-purple-600 font-medium">
                            <span>应收金料</span>
                            <span>{parseFloat(createForm.gold_payment_weight || '0').toFixed(3)} 克</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">备注（可选）</label>
                  <textarea
                    value={createForm.remark}
                    onChange={(e) => setCreateForm({ ...createForm, remark: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    rows={2}
                    placeholder="输入备注信息"
                  />
                </div>

                {/* 金额预览 */}
                <div className="bg-cyan-50 rounded-lg p-4">
                  <h4 className="text-sm font-medium text-cyan-800 mb-2">应收金额预览</h4>
                  <div className="space-y-1 text-sm">
                    {createForm.payment_method === 'cash_price' && createForm.gold_price && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">原料费用</span>
                        <span>¥{(parseFloat(createForm.gold_price) * selectedSalesOrder.total_weight).toFixed(2)}</span>
                      </div>
                    )}
                    {createForm.payment_method === 'mixed' && createForm.gold_price && createForm.cash_payment_weight && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">结价部分料费</span>
                        <span>¥{(parseFloat(createForm.gold_price) * parseFloat(createForm.cash_payment_weight || '0')).toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-gray-600">工费</span>
                      <span>¥{selectedSalesOrder.total_labor_cost.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between font-bold text-lg border-t border-cyan-200 pt-2 mt-2">
                      <span>应收现金</span>
                      <span className="text-cyan-600">
                        ¥{(
                          (createForm.payment_method === 'cash_price' && createForm.gold_price
                            ? parseFloat(createForm.gold_price) * selectedSalesOrder.total_weight
                            : createForm.payment_method === 'mixed' && createForm.gold_price && createForm.cash_payment_weight
                              ? parseFloat(createForm.gold_price) * parseFloat(createForm.cash_payment_weight || '0')
                              : 0) + selectedSalesOrder.total_labor_cost
                        ).toFixed(2)}
                      </span>
                    </div>
                    {(createForm.payment_method === 'physical_gold' || createForm.payment_method === 'mixed') && (
                      <div className="flex justify-between font-bold text-lg text-yellow-600">
                        <span>应收金料</span>
                        <span>
                          {createForm.payment_method === 'physical_gold'
                            ? `${selectedSalesOrder.total_weight.toFixed(3)} 克`
                            : `${parseFloat(createForm.gold_payment_weight || '0').toFixed(3)} 克`
                          }
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowCreateForm(false)}
                    className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 transition-colors"
                  >
                    创建结算单
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* 确认结算单弹窗 */}
        {confirmingSettlement && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4">
              <h3 className="text-lg font-semibold mb-4">确认结算单</h3>

              <div className="bg-gray-50 rounded-lg p-4 mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-500">结算单号</span>
                  <span className="font-mono">{confirmingSettlement.settlement_no}</span>
                </div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-500">支付方式</span>
                  <span>
                    {confirmingSettlement.payment_method === 'cash_price'
                      ? `结价 (¥${confirmingSettlement.gold_price}/g)`
                      : confirmingSettlement.payment_method === 'mixed'
                        ? `混合支付 (结料${confirmingSettlement.gold_payment_weight || 0}g + 结价${confirmingSettlement.cash_payment_weight || 0}g)`
                        : `结料 (${confirmingSettlement.physical_gold_weight}g)`
                    }
                  </span>
                </div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-500">原料费用</span>
                  <span>¥{(confirmingSettlement.material_amount || 0).toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-500">工费</span>
                  <span>¥{confirmingSettlement.labor_amount.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between font-bold text-lg border-t pt-2 mt-2">
                  <span>应收总计</span>
                  <span className="text-cyan-600">¥{confirmingSettlement.total_amount.toFixed(2)}</span>
                </div>
              </div>

              <div className="flex items-center text-yellow-600 bg-yellow-50 rounded-lg p-3 mb-4">
                <AlertCircle className="w-5 h-5 mr-2" />
                <span className="text-sm">确认后销售单状态将更新为"已结算"</span>
              </div>

              <div className="flex space-x-3">
                <button
                  onClick={() => setConfirmingSettlement(null)}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleConfirmSettlement}
                  disabled={confirmingSettlementLoading}
                  className="flex-1 px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {confirmingSettlementLoading ? '确认中...' : '确认结算'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 编辑结算单弹窗 */}
        {editingSettlement && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">编辑结算单</h3>
                <button onClick={() => setEditingSettlement(null)} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="bg-gray-50 rounded-lg p-3 mb-4 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">结算单号</span>
                  <span className="font-mono">{editingSettlement.settlement_no}</span>
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-gray-500">销售单</span>
                  <span>{editingSettlement.sales_order?.order_no || '-'}</span>
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-gray-500">商品总克重</span>
                  <span className="font-medium">{editingSettlement.total_weight?.toFixed(3)}g</span>
                </div>
              </div>

              <div className="space-y-4">
                {/* 支付方式 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">支付方式</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { value: 'cash_price', label: '结价' },
                      { value: 'physical_gold', label: '结料' },
                      { value: 'mixed', label: '混合' }
                    ].map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => setEditForm(prev => ({ ...prev, payment_method: opt.value }))}
                        className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${editForm.payment_method === opt.value
                          ? 'bg-cyan-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 金价 - 仅结价或混合时显示 */}
                {editForm.payment_method !== 'physical_gold' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">金价 (元/克)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={editForm.gold_price}
                      onChange={(e) => setEditForm(prev => ({ ...prev, gold_price: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500"
                      placeholder="请输入当日金价"
                    />
                  </div>
                )}

                {/* 结料克重 - 仅结料时显示 */}
                {editForm.payment_method === 'physical_gold' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">结料克重 (克)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={editForm.physical_gold_weight}
                      onChange={(e) => setEditForm(prev => ({ ...prev, physical_gold_weight: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500"
                      placeholder={`建议与商品克重一致 (${editingSettlement.total_weight?.toFixed(3)}g)`}
                    />
                  </div>
                )}

                {/* 混合支付 - 克重分配 */}
                {editForm.payment_method === 'mixed' && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">结料部分 (克)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={editForm.gold_payment_weight}
                        onChange={(e) => setEditForm(prev => ({ ...prev, gold_payment_weight: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500"
                        placeholder="用金料支付的克重"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">结价部分 (克)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={editForm.cash_payment_weight}
                        onChange={(e) => setEditForm(prev => ({ ...prev, cash_payment_weight: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500"
                        placeholder="用现金支付的克重"
                      />
                    </div>
                    <div className="text-xs text-gray-500">
                      合计: {(parseFloat(editForm.gold_payment_weight || '0') + parseFloat(editForm.cash_payment_weight || '0')).toFixed(3)}g
                      {' '}(商品: {editingSettlement.total_weight?.toFixed(3)}g)
                    </div>
                  </div>
                )}

                {/* 备注 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
                  <input
                    type="text"
                    value={editForm.remark}
                    onChange={(e) => setEditForm(prev => ({ ...prev, remark: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500"
                    placeholder="可选"
                  />
                </div>
              </div>

              <div className="flex space-x-3 mt-6">
                <button
                  onClick={() => setEditingSettlement(null)}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleSaveEdit}
                  className="flex-1 px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 transition-colors"
                >
                  保存修改
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 开具收料单弹窗 */}
        {showReceiptForm && selectedSettlementForReceipt && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold flex items-center">
                  <Package className="w-5 h-5 mr-2 text-yellow-500" />
                  开具收料单
                </h3>
                <button onClick={() => setShowReceiptForm(false)} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* 结算单信息 */}
              <div className="bg-gray-50 rounded-lg p-4 mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-500">关联结算单</span>
                  <span className="font-mono text-sm">{selectedSettlementForReceipt.settlement_no}</span>
                </div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-500">客户</span>
                  <span className="font-medium">{selectedSettlementForReceipt.sales_order?.customer_name || '-'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">应收金料</span>
                  <span className="font-bold text-yellow-600">
                    {selectedSettlementForReceipt.payment_method === 'physical_gold'
                      ? `${selectedSettlementForReceipt.total_weight.toFixed(3)} 克`
                      : `${(selectedSettlementForReceipt.gold_payment_weight || 0).toFixed(3)} 克`
                    }
                  </span>
                </div>
              </div>

              {/* 表单 */}
              <form onSubmit={handleCreateReceipt} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">实收克重 (克)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={receiptForm.gold_weight}
                    onChange={(e) => setReceiptForm({ ...receiptForm, gold_weight: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500"
                    placeholder="输入实际收取的克重"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">成色</label>
                  <select
                    value={receiptForm.gold_fineness}
                    onChange={(e) => setReceiptForm({ ...receiptForm, gold_fineness: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500"
                  >
                    <option value="足金999">足金999</option>
                    <option value="足金9999">足金9999</option>
                    <option value="Au999">Au999</option>
                    <option value="Au9999">Au9999</option>
                    <option value="18K">18K</option>
                    <option value="22K">22K</option>
                    <option value="其他">其他</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">备注（可选）</label>
                  <textarea
                    value={receiptForm.remark}
                    onChange={(e) => setReceiptForm({ ...receiptForm, remark: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500"
                    rows={2}
                    placeholder="输入备注信息"
                  />
                </div>

                <div className="flex space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowReceiptForm(false)}
                    className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 transition-colors flex items-center justify-center"
                  >
                    创建收料单
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* 快捷收料弹窗 */}
        {showQuickReceiptForm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 max-w-lg w-full mx-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold flex items-center">
                  <Package className="w-5 h-5 mr-2 text-yellow-500" />
                  快捷收料
                </h3>
                <button onClick={() => setShowQuickReceiptForm(false)} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleCreateQuickReceipt} className="space-y-4">
                {/* 客户搜索和选择 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">选择客户</label>
                  <input
                    type="text"
                    placeholder="搜索客户姓名或电话..."
                    value={customerSearch}
                    onChange={(e) => {
                      setCustomerSearch(e.target.value)
                      if (quickReceiptForm.customer_id) setQuickReceiptForm(prev => ({ ...prev, customer_id: '' }))
                    }}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500 mb-2"
                  />
                  {!quickReceiptForm.customer_id && (
                    <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg">
                      {customersLoading ? (
                        <div className="p-3 text-center text-gray-500 text-sm">加载中...</div>
                      ) : filteredCustomers.length === 0 ? (
                        <div className="p-3 text-center text-gray-500 text-sm">暂无匹配客户</div>
                      ) : (
                        filteredCustomers.slice(0, 10).map(customer => (
                          <div
                            key={customer.id}
                            onClick={() => setQuickReceiptForm({ ...quickReceiptForm, customer_id: customer.id.toString() })}
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
                      已选择：{customers.find(c => c.id.toString() === quickReceiptForm.customer_id)?.name}
                      <button type="button" onClick={() => { setQuickReceiptForm(prev => ({ ...prev, customer_id: '' })); setCustomerSearch('') }} className="text-amber-600 hover:underline">重选</button>
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
                    <option value="18K">18K</option>
                    <option value="22K">22K</option>
                    <option value="其他">其他</option>
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
                  <button
                    type="button"
                    onClick={() => setShowQuickReceiptForm(false)}
                    className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 transition-colors flex items-center justify-center"
                  >
                    创建收料单
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* 快捷提料弹窗 */}
        {showQuickWithdrawalForm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 max-w-lg w-full mx-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold flex items-center">
                  <ArrowUpRight className="w-5 h-5 mr-2 text-blue-500" />
                  快捷提料
                </h3>
                <button onClick={() => setShowQuickWithdrawalForm(false)} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleCreateQuickWithdrawal} className="space-y-4">
                {/* 客户搜索和选择 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">选择客户</label>
                  <input
                    type="text"
                    placeholder="搜索客户姓名或电话..."
                    value={withdrawalCustomerSearch}
                    onChange={(e) => {
                      setWithdrawalCustomerSearch(e.target.value);
                      setShowCustomerDropdown(true);  // 输入时显示下拉框
                    }}
                    onFocus={() => setShowCustomerDropdown(true)}  // 聚焦时显示下拉框
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2"
                  />
                  {/* 下拉框：选择客户后隐藏 */}
                  {showCustomerDropdown && (
                    <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg">
                      {customersLoading ? (
                        <div className="p-3 text-center text-gray-500 text-sm">加载中...</div>
                      ) : filteredWithdrawalCustomers.length === 0 ? (
                        <div className="p-3 text-center text-gray-500 text-sm">暂无匹配客户</div>
                      ) : (
                        filteredWithdrawalCustomers.slice(0, 10).map(customer => (
                          <div
                            key={customer.id}
                            onClick={() => {
                              setQuickWithdrawalForm({ ...quickWithdrawalForm, customer_id: customer.id.toString() });
                              fetchCustomerDeposit(customer.id.toString());
                              setShowCustomerDropdown(false);  // 选择后隐藏下拉框
                            }}
                            className={`p-3 cursor-pointer hover:bg-blue-50 border-b last:border-b-0 flex justify-between items-center ${quickWithdrawalForm.customer_id === customer.id.toString() ? 'bg-blue-100' : ''
                              }`}
                          >
                            <span className="font-medium">{customer.name}</span>
                            <span className="text-sm text-gray-500">{customer.phone || '-'}</span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                  {quickWithdrawalForm.customer_id && (
                    <div className="mt-2 text-sm text-green-600">
                      已选择：{customers.find(c => c.id.toString() === quickWithdrawalForm.customer_id)?.name}
                    </div>
                  )}
                </div>

                {/* 金料账户状态显示（统一使用与AI分析一致的计算方式） */}
                {quickWithdrawalForm.customer_id && (
                  <div className={`p-4 rounded-lg ${depositLoading ? 'bg-gray-100' :
                    (selectedCustomerDeposit?.current_balance || 0) > 0 ? 'bg-green-50 border border-green-200' :
                      (selectedCustomerDeposit?.current_balance || 0) < 0 ? 'bg-red-50 border border-red-200' :
                        'bg-gray-50 border border-gray-200'
                    }`}>
                    {depositLoading ? (
                      <div className="flex items-center justify-center">
                        <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                        <span className="text-gray-500">查询中...</span>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-700">
                          {(selectedCustomerDeposit?.current_balance || 0) > 0 ? '当前存料余额' :
                            (selectedCustomerDeposit?.current_balance || 0) < 0 ? '当前欠料' :
                              '金料账户'}
                        </span>
                        <span className={`text-xl font-bold ${(selectedCustomerDeposit?.current_balance || 0) > 0 ? 'text-green-600' :
                          (selectedCustomerDeposit?.current_balance || 0) < 0 ? 'text-red-600' :
                            'text-gray-600'
                          }`}>
                          {(selectedCustomerDeposit?.current_balance || 0) > 0
                            ? `${selectedCustomerDeposit?.current_balance?.toFixed(3)} 克`
                            : (selectedCustomerDeposit?.current_balance || 0) < 0
                              ? `${Math.abs(selectedCustomerDeposit?.current_balance || 0).toFixed(3)} 克`
                              : '已结清'}
                        </span>
                      </div>
                    )}
                    {/* 存料时显示可提料 */}
                    {!depositLoading && (selectedCustomerDeposit?.current_balance || 0) > 0 && (
                      <div className="mt-2 text-xs text-green-600">
                        ✓ 客户有存料，可以提料
                      </div>
                    )}
                    {/* 欠料时显示警告 */}
                    {!depositLoading && (selectedCustomerDeposit?.current_balance || 0) < 0 && (
                      <div className="mt-2 text-xs text-red-600">
                        ⚠️ 该客户欠料 {Math.abs(selectedCustomerDeposit?.current_balance || 0).toFixed(3)} 克，无法提料
                      </div>
                    )}
                    {/* 已结清时显示提示 */}
                    {!depositLoading && (selectedCustomerDeposit?.current_balance || 0) === 0 && (
                      <div className="mt-2 text-xs text-gray-600">
                        该客户金料账户已结清，暂无存料可提
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">提料克重 (克)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={quickWithdrawalForm.gold_weight}
                    onChange={(e) => setQuickWithdrawalForm({ ...quickWithdrawalForm, gold_weight: e.target.value })}
                    className={`w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${(selectedCustomerDeposit?.current_balance || 0) <= 0 ? 'bg-gray-100 cursor-not-allowed' : ''
                      }`}
                    placeholder="输入提料克重"
                    max={Math.max(0, selectedCustomerDeposit?.current_balance || 0)}
                    disabled={(selectedCustomerDeposit?.current_balance || 0) <= 0}
                    required
                  />
                  {quickWithdrawalForm.gold_weight && parseFloat(quickWithdrawalForm.gold_weight) > Math.max(0, selectedCustomerDeposit?.current_balance || 0) && (
                    <div className="mt-1 text-xs text-red-600">
                      ⚠️ 提料克重不能超过存料余额
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">备注（可选）</label>
                  <textarea
                    value={quickWithdrawalForm.remark}
                    onChange={(e) => setQuickWithdrawalForm({ ...quickWithdrawalForm, remark: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    rows={2}
                    placeholder="客户提料 / 其他说明"
                  />
                </div>

                <div className="flex space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowQuickWithdrawalForm(false)}
                    className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={!quickWithdrawalForm.customer_id ||
                      !quickWithdrawalForm.gold_weight ||
                      parseFloat(quickWithdrawalForm.gold_weight) <= 0 ||
                      parseFloat(quickWithdrawalForm.gold_weight) > (selectedCustomerDeposit?.current_balance || 0)}
                    className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors flex items-center justify-center space-x-2 disabled:bg-gray-300 disabled:cursor-not-allowed"
                  >
                    <Printer className="w-4 h-4" />
                    <span>创建并打印</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* 存料结价弹窗 */}
        {showDepositSettleForm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 max-w-lg w-full mx-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold flex items-center">
                  <DollarSign className="w-5 h-5 mr-2 text-purple-500" />
                  存料结价
                </h3>
                <button onClick={() => setShowDepositSettleForm(false)} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleCreateDepositSettle} className="space-y-4">
                {/* 客户搜索和选择 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">选择客户</label>
                  <input
                    type="text"
                    placeholder="搜索客户姓名或电话..."
                    value={depositSettleCustomerSearch}
                    onChange={(e) => {
                      setDepositSettleCustomerSearch(e.target.value);
                      setShowDepositSettleDropdown(true);
                    }}
                    onFocus={() => setShowDepositSettleDropdown(true)}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 mb-2"
                  />
                  {showDepositSettleDropdown && (
                    <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg">
                      {customersLoading ? (
                        <div className="p-3 text-center text-gray-500 text-sm">加载中...</div>
                      ) : filteredDepositSettleCustomers.length === 0 ? (
                        <div className="p-3 text-center text-gray-500 text-sm">暂无匹配客户</div>
                      ) : (
                        filteredDepositSettleCustomers.slice(0, 10).map(customer => (
                          <div
                            key={customer.id}
                            onClick={() => {
                              setDepositSettleForm({ ...depositSettleForm, customer_id: customer.id.toString() });
                              fetchDepositSettleBalance(customer.id.toString());
                              setShowDepositSettleDropdown(false);
                              setDepositSettleCustomerSearch(customer.name);
                            }}
                            className={`p-3 cursor-pointer hover:bg-purple-50 border-b last:border-b-0 flex justify-between items-center ${depositSettleForm.customer_id === customer.id.toString() ? 'bg-purple-100' : ''
                              }`}
                          >
                            <span className="font-medium">{customer.name}</span>
                            <span className="text-sm text-gray-500">{customer.phone || '-'}</span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                  {depositSettleForm.customer_id && (
                    <div className="mt-2 text-sm text-green-600">
                      已选择：{customers.find(c => c.id.toString() === depositSettleForm.customer_id)?.name}
                    </div>
                  )}
                </div>

                {/* 存料余额显示 */}
                {depositSettleForm.customer_id && (
                  <div className={`p-4 rounded-lg ${depositSettleDepositLoading ? 'bg-gray-100' :
                    (depositSettleDeposit?.current_balance || 0) > 0 ? 'bg-green-50 border border-green-200' :
                      'bg-gray-50 border border-gray-200'
                    }`}>
                    {depositSettleDepositLoading ? (
                      <div className="flex items-center justify-center">
                        <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                        <span className="text-gray-500">查询中...</span>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-700">当前存料余额</span>
                        <span className={`text-xl font-bold ${(depositSettleDeposit?.current_balance || 0) > 0 ? 'text-green-600' : 'text-gray-600'
                          }`}>
                          {(depositSettleDeposit?.current_balance || 0) > 0
                            ? `${depositSettleDeposit?.current_balance?.toFixed(3)} 克`
                            : '无存料'}
                        </span>
                      </div>
                    )}
                    {!depositSettleDepositLoading && (depositSettleDeposit?.current_balance || 0) <= 0 && (
                      <div className="mt-2 text-xs text-red-600">
                        该客户无存料余额，无法进行存料结价
                      </div>
                    )}
                  </div>
                )}

                {/* 金价输入 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">金价 (元/克)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={depositSettleForm.gold_price}
                    onChange={(e) => setDepositSettleForm({ ...depositSettleForm, gold_price: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                    placeholder="输入当日金价"
                    disabled={(depositSettleDeposit?.current_balance || 0) <= 0}
                    required
                  />
                </div>

                {/* 结价克重输入 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">结价克重 (克)</label>
                  <input
                    type="number"
                    step="0.001"
                    value={depositSettleForm.gold_weight}
                    onChange={(e) => setDepositSettleForm({ ...depositSettleForm, gold_weight: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                    placeholder="输入结价克重"
                    max={Math.max(0, depositSettleDeposit?.current_balance || 0)}
                    disabled={(depositSettleDeposit?.current_balance || 0) <= 0}
                    required
                  />
                  {depositSettleForm.gold_weight && parseFloat(depositSettleForm.gold_weight) > (depositSettleDeposit?.current_balance || 0) && (
                    <div className="mt-1 text-xs text-red-600">
                      结价克重不能超过存料余额
                    </div>
                  )}
                </div>

                {/* 自动计算抵扣金额 */}
                {depositSettleForm.gold_weight && depositSettleForm.gold_price && (
                  <div className="p-4 bg-purple-50 border border-purple-200 rounded-lg">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-purple-700">抵扣金额</span>
                      <span className="text-xl font-bold text-purple-600">
                        ¥{(parseFloat(depositSettleForm.gold_weight) * parseFloat(depositSettleForm.gold_price)).toFixed(2)}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-purple-500">
                      {parseFloat(depositSettleForm.gold_weight).toFixed(3)}g × ¥{parseFloat(depositSettleForm.gold_price).toFixed(0)}/g
                    </div>
                  </div>
                )}

                {/* 备注 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">备注（可选）</label>
                  <textarea
                    value={depositSettleForm.remark}
                    onChange={(e) => setDepositSettleForm({ ...depositSettleForm, remark: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                    rows={2}
                    placeholder="存料结价说明"
                  />
                </div>

                <div className="flex space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowDepositSettleForm(false)}
                    className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={
                      !depositSettleForm.customer_id ||
                      !depositSettleForm.gold_weight ||
                      !depositSettleForm.gold_price ||
                      parseFloat(depositSettleForm.gold_weight) <= 0 ||
                      parseFloat(depositSettleForm.gold_price) <= 0 ||
                      parseFloat(depositSettleForm.gold_weight) > (depositSettleDeposit?.current_balance || 0)
                    }
                    className="flex-1 px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors flex items-center justify-center space-x-2 disabled:bg-gray-300 disabled:cursor-not-allowed"
                  >
                    <DollarSign className="w-4 h-4" />
                    <span>创建存料结价单</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* 销退确认弹窗 */}
        {showRefundConfirm && refundingSettlement && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 max-w-lg w-full mx-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold flex items-center">
                  <RotateCcw className="w-5 h-5 mr-2 text-red-500" />
                  销退确认
                </h3>
                <button onClick={() => setShowRefundConfirm(false)} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* 结算单信息 */}
              <div className="bg-red-50 rounded-lg p-4 mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-500">结算单号</span>
                  <span className="font-mono text-sm">{refundingSettlement.settlement_no}</span>
                </div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-500">销售单号</span>
                  <span className="font-mono text-sm">{refundingSettlement.sales_order?.order_no || '-'}</span>
                </div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-500">客户</span>
                  <span className="font-medium">{refundingSettlement.sales_order?.customer_name || '-'}</span>
                </div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-500">总克重</span>
                  <span className="font-medium">{refundingSettlement.total_weight?.toFixed(3)}g</span>
                </div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-500">工费</span>
                  <span className="font-medium text-orange-600">¥{refundingSettlement.labor_amount?.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">金额</span>
                  <span className="font-bold text-red-600">¥{refundingSettlement.total_amount?.toFixed(2)}</span>
                </div>
              </div>

              {/* 商品明细 */}
              {refundingSettlement.sales_order?.details && refundingSettlement.sales_order.details.length > 0 && (
                <div className="mb-4">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">商品明细</h4>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {refundingSettlement.sales_order.details.map((d, i) => (
                      <div key={i} className="flex justify-between text-sm bg-gray-50 px-3 py-2 rounded">
                        <span>{d.product_name}</span>
                        <div className="text-right">
                          <span className="text-gray-500">{Number(d.weight).toFixed(3)}g</span>
                          <span className="text-orange-500 ml-2">工费 ¥{d.total_labor_cost?.toFixed(2) || (d.weight * d.labor_cost).toFixed(2)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 退货原因 */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">退货原因</label>
                <select
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  <option value="客户退货">客户退货</option>
                  <option value="质量问题">质量问题</option>
                  <option value="款式不符">款式不符</option>
                  <option value="尺寸不合">尺寸不合</option>
                  <option value="其他">其他</option>
                </select>
              </div>

              {/* 退货目的地 */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">退货目的地</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setRefundDestination('showroom')}
                    className={`p-3 rounded-lg border-2 transition-colors ${refundDestination === 'showroom'
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 hover:border-gray-300'
                      }`}
                  >
                    <div className="font-medium">🏪 退到柜台</div>
                    <div className="text-xs text-gray-500 mt-1">商品返回展厅，可重新销售</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRefundDestination('warehouse')}
                    className={`p-3 rounded-lg border-2 transition-colors ${refundDestination === 'warehouse'
                      ? 'border-orange-500 bg-orange-50 text-orange-700'
                      : 'border-gray-200 hover:border-gray-300'
                      }`}
                  >
                    <div className="font-medium">🏭 退到商品部</div>
                    <div className="text-xs text-gray-500 mt-1">商品返回仓库，需开退货单</div>
                  </button>
                </div>
              </div>

              <div className={`flex items-center rounded-lg p-3 mb-4 ${refundDestination === 'showroom'
                ? 'text-blue-600 bg-blue-50'
                : 'text-orange-600 bg-orange-50'
                }`}>
                <AlertCircle className="w-5 h-5 mr-2" />
                <span className="text-sm">
                  {refundDestination === 'showroom'
                    ? '确认后将创建退货单，商品将退回展厅'
                    : '确认后将创建退货单，商品将退回商品部仓库'}
                </span>
              </div>

              <div className="flex space-x-3">
                <button
                  onClick={() => setShowRefundConfirm(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleRefund}
                  disabled={confirmingRefund}
                  className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>{confirmingRefund ? '处理中...' : '确认销退'}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 退货表单弹窗（销退到商品部的双重确认） */}
        <QuickReturnModal
          isOpen={showReturnFormForRefund}
          onClose={() => {
            setShowReturnFormForRefund(false);
            // 取消时恢复销退弹窗状态
            setShowRefundConfirm(true);
          }}
          onSuccess={handleReturnFormSuccess}
          userRole="counter"
          initialItems={refundingSettlement?.sales_order?.details?.map(d => ({
            product_name: d.product_name,
            return_weight: String(d.weight),
            labor_cost: String(d.labor_cost),
            piece_count: '',
            piece_labor_cost: '',
            remark: ''
          }))}
          initialReason={refundReason}
        />
      </div>
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

export default SettlementPage;



