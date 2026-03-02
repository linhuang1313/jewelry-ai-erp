import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { Line, Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { API_ENDPOINTS } from '../config';
import { hasPermission } from '../config/permissions';
import { apiGet, apiPost, buildQueryString, openDownloadUrl } from '../utils/api';

// 注册 Chart.js 组件
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend
);

// ==================== 类型定义 ====================

interface GoldTransaction {
  id: number;
  transaction_no: string;
  transaction_type: 'income' | 'expense';
  settlement_order_id: number | null;
  settlement_no: string | null;
  customer_id: number | null;
  customer_name: string | null;
  inbound_order_id: number | null;
  inbound_order_no: string | null;
  supplier_id: number | null;
  supplier_name: string | null;
  gold_weight: number;
  status: string;
  created_by: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  created_at: string;
  receipt_printed_at: string | null;
  payment_printed_at: string | null;
  remark: string | null;
}

interface GoldBalance {
  total_income: number;
  total_expense: number;
  current_balance: number;
}

interface LedgerDay {
  date: string;
  income: number;
  expense: number;
  net: number;
  transactions: Array<{
    id: number;
    transaction_no: string;
    transaction_type: string;
    gold_weight: number;
    customer_name: string | null;
    supplier_name: string | null;
    confirmed_at: string | null;
  }>;
}

interface Supplier {
  id: number;
  name: string;
}


interface GoldPurchasePayment {
  id: number;
  purchase_order_id: number;
  payment_no: string;
  payment_amount: number;
  payment_method: string;
  payment_date: string | null;
  created_by: string | null;
  create_time: string | null;
  remark: string | null;
}

interface GoldPurchaseOrder {
  id: number;
  order_no: string;
  supplier_id: number | null;
  supplier_name: string;
  gold_weight: number;
  gold_fineness: string;
  conversion_rate: number;
  settled_weight: number | null;
  gold_price: number | null;
  total_amount: number | null;
  paid_amount: number;
  unpaid_amount: number | null;
  status: string;
  receive_date: string | null;
  price_date: string | null;
  created_by: string | null;
  priced_by: string | null;
  create_time: string | null;
  remark: string | null;
  payments: GoldPurchasePayment[];
}

interface GoldPurchaseSummary {
  total_weight: number;
  total_amount: number;
  total_paid: number;
  total_unpaid: number;
  pending_count: number;
  priced_count: number;
  partial_paid_count: number;
  paid_count: number;
}

interface GoldMaterialPageProps {
  userRole: string;
}

interface CustomerWithdrawal {
  id: number;
  withdrawal_no: string;
  customer_id: number;
  customer_name: string;
  gold_weight: number;
  withdrawal_type: 'self' | 'deliver';
  destination_company: string | null;
  destination_address: string | null;
  authorized_person: string | null;
  authorized_phone: string | null;
  status: string;
  created_by: string | null;
  created_at: string;
  completed_by: string | null;
  completed_at: string | null;
  printed_at: string | null;
  remark: string | null;
}

interface CustomerTransfer {
  id: number;
  transfer_no: string;
  from_customer_id: number;
  from_customer_name: string;
  to_customer_id: number;
  to_customer_name: string;
  gold_weight: number;
  status: string;
  created_by: string | null;
  created_at: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
  printed_at: string | null;
  remark: string | null;
}

interface Customer {
  id: number;
  name: string;
  current_deposit?: number;
}

// ==================== 常量定义 ====================

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  pending: { label: '待确认', color: '#f59e0b' },
  confirmed: { label: '已确认', color: '#10b981' },
  completed: { label: '已完成', color: '#10b981' },
  cancelled: { label: '已取消', color: '#6b7280' },
};

// 取料单专用状态映射
const WITHDRAWAL_STATUS_MAP: Record<string, { label: string; color: string }> = {
  pending: { label: '待确认', color: '#f59e0b' },
  completed: { label: '已确认', color: '#10b981' },
  cancelled: { label: '已取消', color: '#6b7280' },
};

const INITIAL_PAYMENT_FORM = {
  supplier_id: '',
  gold_weight: '',
  remark: ''
};

// ==================== 组件 ====================

export default function GoldMaterialPage({ userRole }: GoldMaterialPageProps) {
  const defaultTab = (userRole === 'settlement') ? 'receipts'
    : (userRole === 'finance') ? 'supplier-cash-payments'
    : 'ledger';
  const [activeTab, setActiveTab] = useState<'ledger' | 'receipts' | 'payments' | 'balance' | 'withdrawals' | 'transfers' | 'supplier-debt' | 'supplier-cash-payments' | 'customer-gold-transfers' | 'gold-purchase'>(defaultTab as any);
  
  // 台账数据
  const [ledger, setLedger] = useState<LedgerDay[]>([]);
  
  // 待接收收料单（新系统）
  const [pendingGoldReceipts, setPendingGoldReceipts] = useState<any[]>([]);
  const [loadingGoldReceipts, setLoadingGoldReceipts] = useState(false);

  // 金料台账（统一视图）
  const [ledgerStartDate, setLedgerStartDate] = useState('');
  const [ledgerEndDate, setLedgerEndDate] = useState('');
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerSummary, setLedgerSummary] = useState<any>(null);
  const [ledgerBreakdown, setLedgerBreakdown] = useState<any>(null);
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  
  // 付料单数据
  const [payments, setPayments] = useState<GoldTransaction[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentFormData, setPaymentFormData] = useState(INITIAL_PAYMENT_FORM);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  
  // 金料库存
  const [balance, setBalance] = useState<GoldBalance | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  
  // 期初金料
  const [initialBalance, setInitialBalance] = useState<{
    has_initial: boolean;
    initial: { transaction_no: string; gold_weight: number; remark: string; created_at: string } | null;
  } | null>(null);
  const [showInitialModal, setShowInitialModal] = useState(false);
  const [initialFormData, setInitialFormData] = useState({ gold_weight: '', remark: '期初金料库存' });
  const [initialSubmitting, setInitialSubmitting] = useState(false);
  
  // 取料单数据
  const [withdrawals, setWithdrawals] = useState<CustomerWithdrawal[]>([]);
  const [withdrawalsLoading, setWithdrawalsLoading] = useState(false);
  const [showWithdrawalModal, setShowWithdrawalModal] = useState(false);
  const [withdrawalFormData, setWithdrawalFormData] = useState({
    customer_id: '',
    gold_weight: '',
    withdrawal_type: 'self',
    destination_company: '',
    destination_address: '',
    authorized_person: '',
    authorized_phone: '',
    remark: ''
  });
  
  // 转料单数据
  const [transfers, setTransfers] = useState<CustomerTransfer[]>([]);
  const [transfersLoading, setTransfersLoading] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferFormData, setTransferFormData] = useState({
    from_customer_id: '',
    to_customer_id: '',
    gold_weight: '',
    remark: ''
  });
  
  // 客户列表（用于取料单和转料单）
  const [customers, setCustomers] = useState<Customer[]>([]);
  
  // 供应商欠料统计
  const [supplierDebt, setSupplierDebt] = useState<{
    summary: { total_inbound_weight: number; total_paid_weight: number; total_debt_weight: number; total_labor_debt: number; supplier_count: number };
    suppliers: Array<{ supplier_id: number; supplier_name: string; supplier_no: string; inbound_weight: number; paid_weight: number; debt_weight: number; labor_debt: number }>;
  } | null>(null);
  const [supplierDebtLoading, setSupplierDebtLoading] = useState(false);
  
  // 每日明细数据
  const [dailyTransactions, setDailyTransactions] = useState<any>(null);
  const [dailyTransactionsLoading, setDailyTransactionsLoading] = useState(false);
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30); // 默认最近30天
    return {
      start: start.toISOString().split('T')[0],
      end: end.toISOString().split('T')[0]
    };
  });
  const [showDailyDetail, setShowDailyDetail] = useState(false);
  
  // 供应商详情
  const [selectedSupplier, setSelectedSupplier] = useState<number | null>(null);
  const [supplierDetail, setSupplierDetail] = useState<any>(null);
  const [supplierDetailLoading, setSupplierDetailLoading] = useState(false);
  const [showSupplierDetailModal, setShowSupplierDetailModal] = useState(false);
  const [supplierDebtSearch, setSupplierDebtSearch] = useState('');

  // 供应商工费付款
  const [supplierCashPayments, setSupplierCashPayments] = useState<any[]>([]);
  const [supplierCashPaymentsLoading, setSupplierCashPaymentsLoading] = useState(false);
  const [showCashPaymentModal, setShowCashPaymentModal] = useState(false);
  const [cashPaymentForm, setCashPaymentForm] = useState({ supplier_id: '', amount: '', payment_method: 'bank_transfer', remark: '' });
  const [cashPaymentPreselectedSupplier, setCashPaymentPreselectedSupplier] = useState<{ id: number; name: string } | null>(null);
  const [editingCashPaymentId, setEditingCashPaymentId] = useState<number | null>(null);

  // 创建/编辑收料单弹窗（结算用）
  const [showReceiptCreateModal, setShowReceiptCreateModal] = useState(false);
  const [receiptForm, setReceiptForm] = useState({ customer_id: '', gold_weight: '', gold_fineness: '足金999', remark: '' });
  const [receiptCustomerSearch, setReceiptCustomerSearch] = useState('');
  const [editingReceiptId, setEditingReceiptId] = useState<number | null>(null);

  // 客料回仓单
  const [customerGoldTransfers, setCustomerGoldTransfers] = useState<any[]>([]);
  const [customerGoldTransfersLoading, setCustomerGoldTransfersLoading] = useState(false);
  const [showGoldTransferModal, setShowGoldTransferModal] = useState(false);
  const [goldTransferForm, setGoldTransferForm] = useState({ gold_weight: '', gold_fineness: '足金999', remark: '' });
  const [editingGoldTransferId, setEditingGoldTransferId] = useState<number | null>(null);

  // 金料采购
  const [purchaseOrders, setPurchaseOrders] = useState<GoldPurchaseOrder[]>([]);
  const [purchaseOrdersLoading, setPurchaseOrdersLoading] = useState(false);
  const [purchaseSummary, setPurchaseSummary] = useState<GoldPurchaseSummary | null>(null);
  const [showPurchaseForm, setShowPurchaseForm] = useState(false);
  const [purchaseForm, setPurchaseForm] = useState({ supplier_name: '', gold_weight: '', gold_fineness: '足金999', conversion_rate: '1.0', remark: '' });
  const [pricingOrderId, setPricingOrderId] = useState<number | null>(null);
  const [pricingGoldPrice, setPricingGoldPrice] = useState('');
  const [payingOrderId, setPayingOrderId] = useState<number | null>(null);
  const [paymentForm, setPaymentForm] = useState({ payment_amount: '', payment_method: 'transfer', remark: '' });

  // ==================== API 调用函数 ====================

  // 加载台账数据
  // 加载收料单（新系统）- 根据角色加载不同状态
  const loadPendingGoldReceipts = useCallback(async (statusFilter?: string) => {
    setLoadingGoldReceipts(true);
    try {
      // 料部只看待接收的，结算专员和管理层看全部
      const status = statusFilter || (userRole === 'material' ? 'pending' : '');
      const url = status 
        ? `${API_ENDPOINTS.API_BASE_URL}/api/gold-material/gold-receipts?status=${status}`
        : `${API_ENDPOINTS.API_BASE_URL}/api/gold-material/gold-receipts`;
      const response = await fetch(url);
      if (response.ok) {
        const result = await response.json();
        // 后端返回 {data: {items: [...], total: N}} 或 {data: [...]}
        const data = result.data;
        setPendingGoldReceipts(Array.isArray(data) ? data : (data?.items || []));
      }
    } catch (error) {
      console.error('加载收料单失败:', error);
    } finally {
      setLoadingGoldReceipts(false);
    }
  }, [userRole]);

  // 确认接收金料
  const handleReceiveGold = async (receiptId: number) => {
    try {
      const response = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/gold-material/gold-receipts/${receiptId}/receive?received_by=结算专员&user_role=${userRole}`, {
        method: 'POST'
      });
      
      if (response.ok) {
        toast.success('收料单确认成功');
        loadPendingGoldReceipts();
      } else {
        const error = await response.json();
        toast.error(error.detail || '确认失败');
      }
    } catch (error) {
      toast.error('确认失败');
    }
  };

  // 打印收料单
  const handlePrintReceipt = (receiptId: number) => {
    window.open(`${API_ENDPOINTS.API_BASE_URL}/api/gold-material/gold-receipts/${receiptId}/print`, '_blank');
  };

  const loadLedger = useCallback(async () => {
    setLedgerLoading(true);
    const params = buildQueryString({
      start_date: ledgerStartDate,
      end_date: ledgerEndDate,
      user_role: userRole
    });
    
    const data = await apiGet<any>(
      `/api/gold-material/ledger?${params}`,
      { showErrorToast: true }
    );
    
    if (data) {
      const d = data.data || data;
      setLedger(d.ledger || []);
      setLedgerSummary(d.summary || null);
      setLedgerBreakdown(d.breakdown || null);
    }
    setLedgerLoading(false);
  }, [ledgerStartDate, ledgerEndDate, userRole]);

  // 加载付料单列表
  const loadPayments = useCallback(async () => {
    setPaymentsLoading(true);
    const params = buildQueryString({ user_role: userRole });
    
    const data = await apiGet<{ payments: GoldTransaction[] }>(
      `/api/gold-material/payments?${params}`,
      { showErrorToast: true }
    );
    
    if (data) {
      setPayments(data.payments || []);
    }
    setPaymentsLoading(false);
  }, [userRole]);

  // 加载金料库存
  const loadBalance = useCallback(async () => {
    setBalanceLoading(true);
    const params = buildQueryString({ user_role: userRole });
    
    const data = await apiGet<GoldBalance>(
      `/api/gold-material/balance?${params}`,
      { showErrorToast: true }
    );
    
    if (data) {
      setBalance(data);
    }
    setBalanceLoading(false);
  }, [userRole]);
  
  // 加载期初金料
  const loadInitialBalance = useCallback(async () => {
    const params = buildQueryString({ user_role: userRole });
    
    const data = await apiGet<{
      has_initial: boolean;
      initial: { transaction_no: string; gold_weight: number; remark: string; created_at: string } | null;
    }>(
      `/api/gold-material/initial-balance?${params}`,
      { showErrorToast: false }
    );
    
    if (data) {
      setInitialBalance(data);
    }
  }, [userRole]);
  
  // 设置期初金料
  const submitInitialBalance = async () => {
    if (!initialFormData.gold_weight || parseFloat(initialFormData.gold_weight) <= 0) {
      toast.error('请输入有效的期初金料克重');
      return;
    }
    
    setInitialSubmitting(true);
    const params = buildQueryString({
      gold_weight: initialFormData.gold_weight,
      remark: initialFormData.remark || '期初金料库存',
      user_role: userRole
    });
    
    const data = await apiPost<{ success: boolean; message: string }>(
      `/api/gold-material/initial-balance?${params}`,
      {},
      { showSuccessToast: true, successMessage: '期初金料设置成功' }
    );
    
    if (data?.success) {
      setShowInitialModal(false);
      setInitialFormData({ gold_weight: '', remark: '期初金料库存' });
      loadInitialBalance();
      loadBalance();
    }
    setInitialSubmitting(false);
  };

  // 加载供应商列表
  const loadSuppliers = useCallback(async () => {
    const data = await apiGet<{ suppliers: Supplier[] }>(
      '/api/suppliers?page_size=200',
      { showErrorToast: false }
    );
    
    if (data) {
      setSuppliers(data.suppliers || []);
    }
  }, []);

  // 加载客户列表
  const loadCustomers = useCallback(async () => {
    const data = await apiGet<{ data?: { customers: Customer[] }, customers?: Customer[] }>(
      '/api/customers?page_size=500',
      { showErrorToast: false }
    );
    
    if (data) {
      setCustomers(data.data?.customers || data.customers || []);
    }
  }, []);

  // 加载取料单列表
  const loadWithdrawals = useCallback(async () => {
    setWithdrawalsLoading(true);
    const params = buildQueryString({ user_role: userRole });
    
    const data = await apiGet<{ withdrawals: CustomerWithdrawal[] }>(
      `/api/gold-material/withdrawals?${params}`,
      { showErrorToast: true }
    );
    
    if (data) {
      setWithdrawals((data as any).data?.withdrawals || data.withdrawals || []);
    }
    setWithdrawalsLoading(false);
  }, [userRole]);

  // 加载转料单列表
  const loadTransfers = useCallback(async () => {
    setTransfersLoading(true);
    const params = buildQueryString({ user_role: userRole });
    
    const data = await apiGet<{ transfers: CustomerTransfer[] }>(
      `/api/gold-material/transfers?${params}`,
      { showErrorToast: true }
    );
    
    if (data) {
      setTransfers(data.transfers || []);
    }
    setTransfersLoading(false);
  }, [userRole]);

  // 加载供应商欠料统计
  const loadSupplierDebt = useCallback(async () => {
    setSupplierDebtLoading(true);
    const data = await apiGet<{
      success: boolean;
      summary: { total_inbound_weight: number; total_paid_weight: number; total_debt_weight: number; total_labor_debt: number; supplier_count: number };
      suppliers: Array<{ supplier_id: number; supplier_name: string; supplier_no: string; inbound_weight: number; paid_weight: number; debt_weight: number; labor_debt: number }>;
    }>(
      `/api/suppliers/debt-summary?user_role=${userRole}`,
      { showErrorToast: false }
    );
    
    if (data?.success) {
      setSupplierDebt({ 
        summary: {
          total_inbound_weight: data.summary?.total_inbound_weight ?? 0,
          total_paid_weight: data.summary?.total_paid_weight ?? 0,
          total_debt_weight: data.summary?.total_debt_weight ?? 0,
          total_labor_debt: data.summary?.total_labor_debt ?? 0,
          supplier_count: data.summary?.supplier_count ?? 0,
        },
        suppliers: Array.isArray(data.suppliers) ? data.suppliers : [] 
      });
    }
    setSupplierDebtLoading(false);
  }, [userRole]);

  // 加载供应商工费付款列表
  const loadSupplierCashPayments = useCallback(async () => {
    setSupplierCashPaymentsLoading(true);
    try {
      const response = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/gold-material/supplier-cash-payments`);
      if (response.ok) {
        const result = await response.json();
        setSupplierCashPayments(result.data?.payments || []);
      }
    } catch (error) {
      console.error('加载供应商付款列表失败:', error);
    } finally {
      setSupplierCashPaymentsLoading(false);
    }
  }, []);

  // 创建供应商工费付款登记
  const createCashPayment = async () => {
    const supplierId = cashPaymentPreselectedSupplier?.id || parseInt(cashPaymentForm.supplier_id);
    const amount = parseFloat(cashPaymentForm.amount);
    if (!supplierId || !amount || amount <= 0) {
      toast.error('请选择供应商并输入有效金额');
      return;
    }
    try {
      const params = new URLSearchParams();
      params.append('supplier_id', supplierId.toString());
      params.append('amount', amount.toString());
      params.append('payment_method', cashPaymentForm.payment_method);
      if (cashPaymentForm.remark) params.append('remark', cashPaymentForm.remark);
      params.append('created_by', '料部');
      
      const response = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/gold-material/supplier-cash-payments?${params}`, { method: 'POST' });
      const result = await response.json();
      if (response.ok && result.data) {
        toast.success(result.message || '付款登记创建成功');
        setShowCashPaymentModal(false);
        setCashPaymentForm({ supplier_id: '', amount: '', payment_method: 'bank_transfer', remark: '' });
        setCashPaymentPreselectedSupplier(null);
        loadSupplierCashPayments();
      } else {
        toast.error(result.detail || '创建失败');
      }
    } catch (error) {
      toast.error('创建失败');
    }
  };

  // 编辑供应商工费付款
  const updateCashPayment = async () => {
    if (!editingCashPaymentId) return;
    const supplierId = cashPaymentPreselectedSupplier?.id || parseInt(cashPaymentForm.supplier_id);
    const amount = parseFloat(cashPaymentForm.amount);
    if (!supplierId || !amount || amount <= 0) {
      toast.error('请选择供应商并输入有效金额');
      return;
    }
    try {
      const params = new URLSearchParams();
      params.append('supplier_id', supplierId.toString());
      params.append('amount', amount.toString());
      params.append('payment_method', cashPaymentForm.payment_method);
      params.append('remark', cashPaymentForm.remark || '');
      
      const response = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/gold-material/supplier-cash-payments/${editingCashPaymentId}?${params}`, { method: 'PUT' });
      const result = await response.json();
      if (response.ok) {
        toast.success(result.message || '更新成功');
        setShowCashPaymentModal(false);
        setEditingCashPaymentId(null);
        setCashPaymentForm({ supplier_id: '', amount: '', payment_method: 'bank_transfer', remark: '' });
        setCashPaymentPreselectedSupplier(null);
        loadSupplierCashPayments();
      } else {
        toast.error(result.detail || '更新失败');
      }
    } catch (error) {
      toast.error('更新失败');
    }
  };

  // 确认/删除/反确认 供应商工费付款
  const handleCashPaymentAction = async (paymentId: number, action: 'confirm' | 'delete' | 'unconfirm', reason?: string) => {
    try {
      if (action === 'delete') {
        if (!confirm('确定要删除这条付款记录吗？')) return;
        const params = new URLSearchParams();
        params.append('deleted_by', '料部');
        const response = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/gold-material/supplier-cash-payments/${paymentId}?${params}`, { method: 'DELETE' });
        const result = await response.json();
        if (response.ok) {
          toast.success(result.message || '删除成功');
          loadSupplierCashPayments();
          loadSupplierDebt();
        } else {
          toast.error(result.detail || '删除失败');
        }
        return;
      }
      
      const params = new URLSearchParams();
      if (action === 'confirm') params.append('confirmed_by', '料部');
      if (action === 'unconfirm') {
        params.append('operated_by', '料部');
        params.append('reason', reason || '操作员反确认');
      }
      
      const response = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/gold-material/supplier-cash-payments/${paymentId}/${action}?${params}`, { method: 'POST' });
      const result = await response.json();
      if (response.ok) {
        toast.success(result.message || '操作成功');
        loadSupplierCashPayments();
        loadSupplierDebt();
      } else {
        toast.error(result.detail || '操作失败');
      }
    } catch (error) {
      toast.error('操作失败');
    }
  };

  // 加载每日明细
  const loadDailyTransactions = useCallback(async (supplierId?: number) => {
    setDailyTransactionsLoading(true);
    try {
      const params = new URLSearchParams();
      if (dateRange.start) params.append('start_date', dateRange.start);
      if (dateRange.end) params.append('end_date', dateRange.end);
      if (supplierId) params.append('supplier_id', supplierId.toString());
      params.append('user_role', userRole);
      
      const data = await apiGet<{
        success: boolean;
        data: {
          daily_summary: Array<{
            date: string;
            inbound_records: Array<any>;
            payment_records: Array<any>;
            total_inbound: number;
            total_paid: number;
            net_change: number;
          }>;
          summary: {
            total_inbound: number;
            total_paid: number;
            total_net_change: number;
          };
        };
      }>(`/api/suppliers/daily-transactions?${params.toString()}`, { showErrorToast: false });
      
      if (data?.success) {
        const safeData = data.data || { daily_summary: [], summary: { total_inbound: 0, total_paid: 0, total_net_change: 0 } };
        if (safeData.daily_summary && !Array.isArray(safeData.daily_summary)) {
          (safeData as any).daily_summary = [];
        }
        setDailyTransactions(safeData);
      }
    } catch (error) {
      console.error('加载每日明细失败:', error);
    } finally {
      setDailyTransactionsLoading(false);
    }
  }, [dateRange, userRole]);

  // 加载供应商详情
  const loadSupplierDetail = useCallback(async (supplierId: number) => {
    setSupplierDetailLoading(true);
    try {
      const data = await apiGet<{
        success: boolean;
        data: {
          account: any;
          transactions: Array<any>;
        };
      }>(`/api/gold-material/supplier-gold-accounts/${supplierId}?user_role=${userRole}`, { showErrorToast: false });
      
      if (data?.success) {
        const safeData = data.data || { account: null, transactions: [] };
        if (safeData.transactions && !Array.isArray(safeData.transactions)) {
          (safeData as any).transactions = [];
        }
        setSupplierDetail(safeData);
      }
    } catch (error) {
      console.error('加载供应商详情失败:', error);
      toast.error('加载供应商详情失败');
    } finally {
      setSupplierDetailLoading(false);
    }
  }, [userRole]);

  // 打开供应商详情
  const openSupplierDetail = async (supplierId: number) => {
    setSelectedSupplier(supplierId);
    setShowSupplierDetailModal(true);
    await loadSupplierDetail(supplierId);
  };

  // 创建取料单
  const createWithdrawal = async () => {
    if (!withdrawalFormData.customer_id || !withdrawalFormData.gold_weight) {
      toast.error('请填写客户和取料克重');
      return;
    }
    
    const data = await apiPost(
      `/api/gold-material/withdrawals?user_role=${userRole}&created_by=${userRole === 'settlement' ? '结算' : '管理'}`,
      {
        customer_id: parseInt(withdrawalFormData.customer_id),
        gold_weight: parseFloat(withdrawalFormData.gold_weight),
        withdrawal_type: withdrawalFormData.withdrawal_type,
        destination_company: withdrawalFormData.destination_company || null,
        destination_address: withdrawalFormData.destination_address || null,
        authorized_person: withdrawalFormData.authorized_person || null,
        authorized_phone: withdrawalFormData.authorized_phone || null,
        remark: withdrawalFormData.remark || null
      },
      { showErrorToast: true }
    );
    
    if (data) {
      toast.success('取料单已创建，待确认');
      setShowWithdrawalModal(false);
      setWithdrawalFormData({
        customer_id: '',
        gold_weight: '',
        withdrawal_type: 'self',
        destination_company: '',
        destination_address: '',
        authorized_person: '',
        authorized_phone: '',
        remark: ''
      });
      loadWithdrawals();
    }
  };

  // 创建转料单
  const createTransfer = async () => {
    if (!transferFormData.from_customer_id || !transferFormData.to_customer_id || !transferFormData.gold_weight) {
      toast.error('请填写转出客户、转入客户和转料克重');
      return;
    }
    
    if (transferFormData.from_customer_id === transferFormData.to_customer_id) {
      toast.error('转出客户和转入客户不能相同');
      return;
    }
    
    const data = await apiPost(
      `/api/gold-material/transfers?user_role=${userRole}&created_by=${userRole === 'settlement' ? '结算' : '管理'}`,
      {
        from_customer_id: parseInt(transferFormData.from_customer_id),
        to_customer_id: parseInt(transferFormData.to_customer_id),
        gold_weight: parseFloat(transferFormData.gold_weight),
        remark: transferFormData.remark || null
      },
      { showErrorToast: true }
    );
    
    if (data) {
      toast.success('转料单创建成功');
      setShowTransferModal(false);
      setTransferFormData({
        from_customer_id: '',
        to_customer_id: '',
        gold_weight: '',
        remark: ''
      });
      loadTransfers();
    }
  };

  // 确认取料单（扣减余额）
  const completeWithdrawal = async (withdrawalId: number) => {
    const data = await apiPost(
      `/api/gold-material/withdrawals/${withdrawalId}/complete?user_role=${userRole}`,
      { completed_by: userRole === 'material' ? '料部' : userRole === 'settlement' ? '结算' : '管理' },
      { showErrorToast: true }
    );
    
    if (data) {
      toast.success('取料单已确认');
      loadWithdrawals();
    }
  };

  // 反确认取料单（恢复余额）
  const unconfirmWithdrawal = async (withdrawalId: number) => {
    const reason = window.prompt('请输入反确认原因（可选）：');
    if (reason === null) return; // 用户点了取消
    
    const params = new URLSearchParams({
      user_role: userRole,
      operated_by: userRole === 'material' ? '料部' : userRole === 'settlement' ? '结算' : '管理',
      reason: reason || ''
    });
    
    const data = await apiPost(
      `/api/gold-material/withdrawals/${withdrawalId}/unconfirm?${params.toString()}`,
      {},
      { showErrorToast: true }
    );
    
    if (data) {
      toast.success('取料单已反确认，余额已恢复');
      loadWithdrawals();
    }
  };

  // 确认转料单（料部）
  const confirmTransfer = async (transferId: number) => {
    const data = await apiPost(
      `/api/gold-material/transfers/${transferId}/confirm?user_role=${userRole}`,
      { confirmed_by: userRole === 'material' ? '料部' : '管理' },
      { showErrorToast: true }
    );
    
    if (data) {
      toast.success('转料单已确认');
      loadTransfers();
    }
  };

  // 取消取料单
  const cancelWithdrawal = async (withdrawalId: number) => {
    const data = await apiPost(
      `/api/gold-material/withdrawals/${withdrawalId}/cancel?user_role=${userRole}&cancelled_by=${userRole === 'settlement' ? '结算' : '管理'}`,
      {},
      { showErrorToast: true }
    );
    
    if (data) {
      toast.success('取料单已取消');
      loadWithdrawals();
    }
  };

  // 取消转料单
  const cancelTransfer = async (transferId: number) => {
    const data = await apiPost(
      `/api/gold-material/transfers/${transferId}/cancel?user_role=${userRole}`,
      {},
      { showErrorToast: true }
    );
    
    if (data) {
      toast.success('转料单已取消');
      loadTransfers();
    }
  };

  // 打印取料单
  const printWithdrawal = (withdrawalId: number) => {
    openDownloadUrl(`${API_ENDPOINTS.API_BASE_URL}/api/gold-material/withdrawals/${withdrawalId}/download?format=html`);
  };

  // 打印转料单
  const printTransfer = (transferId: number) => {
    openDownloadUrl(`${API_ENDPOINTS.API_BASE_URL}/api/gold-material/transfers/${transferId}/download?format=html`);
  };

  // 确认付料单（扣减供应商账户）
  const confirmPayment = async (paymentId: number) => {
    const params = new URLSearchParams({
      user_role: userRole,
      confirmed_by: userRole === 'material' ? '料部' : '管理'
    });
    const data = await apiPost(
      `/api/gold-material/payments/${paymentId}/confirm?${params.toString()}`,
      {},
      { showErrorToast: true }
    );
    
    if (data) {
      toast.success('付料单已确认');
      loadPayments();
      loadBalance();
    }
  };

  // 取消付料单
  const cancelPayment = async (paymentId: number) => {
    const params = new URLSearchParams({
      user_role: userRole,
      cancelled_by: userRole === 'material' ? '料部' : '管理'
    });
    const data = await apiPost(
      `/api/gold-material/payments/${paymentId}/cancel?${params.toString()}`,
      {},
      { showErrorToast: true }
    );
    
    if (data) {
      toast.success('付料单已取消');
      loadPayments();
    }
  };

  // 反确认付料单（恢复供应商账户）
  const unconfirmPayment = async (paymentId: number) => {
    const reason = window.prompt('请输入反确认原因（可选）：');
    if (reason === null) return; // 用户点了取消
    
    const params = new URLSearchParams({
      user_role: userRole,
      operated_by: userRole === 'material' ? '料部' : '管理',
      reason: reason || ''
    });
    const data = await apiPost(
      `/api/gold-material/payments/${paymentId}/unconfirm?${params.toString()}`,
      {},
      { showErrorToast: true }
    );
    
    if (data) {
      toast.success('付料单已反确认，供应商账户已恢复');
      loadPayments();
      loadBalance();
    }
  };

  // ==================== 创建收料单（结算用） ====================

  const createGoldReceipt = async () => {
    if (!receiptForm.customer_id) {
      toast.error('请选择客户');
      return;
    }
    if (!receiptForm.gold_weight || parseFloat(receiptForm.gold_weight) <= 0) {
      toast.error('请输入有效的收料克重');
      return;
    }
    try {
      const params = new URLSearchParams({
        customer_id: receiptForm.customer_id,
        gold_weight: receiptForm.gold_weight,
        gold_fineness: receiptForm.gold_fineness,
        remark: receiptForm.remark || '',
        created_by: '结算专员'
      });
      const res = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/gold-material/gold-receipts?${params}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Role': userRole }
      });
      if (res.ok) {
        toast.success('收料单创建成功，请确认后生效');
        setShowReceiptCreateModal(false);
        setReceiptForm({ customer_id: '', gold_weight: '', gold_fineness: '足金999', remark: '' });
        setReceiptCustomerSearch('');
        loadPendingGoldReceipts();
      } else {
        const error = await res.json();
        toast.error(error.detail || '创建收料单失败');
      }
    } catch (e: any) {
      toast.error('创建收料单失败: ' + e.message);
    }
  };

  // ==================== 收料单操作（编辑/删除/反确认） ====================

  const updateGoldReceipt = async () => {
    if (!editingReceiptId) return;
    if (!receiptForm.customer_id) {
      toast.error('请选择客户');
      return;
    }
    if (!receiptForm.gold_weight || parseFloat(receiptForm.gold_weight) <= 0) {
      toast.error('请输入有效的收料克重');
      return;
    }
    try {
      const params = new URLSearchParams({
        gold_weight: receiptForm.gold_weight,
        gold_fineness: receiptForm.gold_fineness,
        customer_id: receiptForm.customer_id,
        remark: receiptForm.remark || ''
      });
      const res = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/gold-material/gold-receipts/${editingReceiptId}?${params}`, {
        method: 'PUT',
        headers: { 'X-User-Role': userRole }
      });
      if (res.ok) {
        toast.success('收料单更新成功');
        setShowReceiptCreateModal(false);
        setEditingReceiptId(null);
        setReceiptForm({ customer_id: '', gold_weight: '', gold_fineness: '足金999', remark: '' });
        setReceiptCustomerSearch('');
        loadPendingGoldReceipts();
      } else {
        const error = await res.json();
        toast.error(error.detail || '更新失败');
      }
    } catch (e: any) {
      toast.error('更新失败: ' + e.message);
    }
  };

  const handleReceiptAction = async (receiptId: number, action: 'delete' | 'unconfirm') => {
    if (action === 'delete') {
      if (!confirm('确定要删除这个收料单吗？')) return;
      try {
        const res = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/gold-material/gold-receipts/${receiptId}`, {
          method: 'DELETE',
          headers: { 'X-User-Role': userRole }
        });
        if (res.ok) {
          toast.success('收料单已删除');
          loadPendingGoldReceipts();
        } else {
          const error = await res.json();
          toast.error(error.detail || '删除失败');
        }
      } catch (e: any) {
        toast.error('删除失败: ' + e.message);
      }
    } else if (action === 'unconfirm') {
      const reason = prompt('请输入反确认原因：');
      if (reason === null) return;
      try {
        const params = new URLSearchParams({ operated_by: '结算专员', reason: reason || '' });
        const res = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/gold-material/gold-receipts/${receiptId}/unconfirm?${params}`, {
          method: 'POST',
          headers: { 'X-User-Role': userRole }
        });
        if (res.ok) {
          toast.success('收料单已反确认');
          loadPendingGoldReceipts();
        } else {
          const error = await res.json();
          toast.error(error.detail || '反确认失败');
        }
      } catch (e: any) {
        toast.error('反确认失败: ' + e.message);
      }
    }
  };

  const startEditReceipt = (receipt: any) => {
    setEditingReceiptId(receipt.id);
    setReceiptForm({
      customer_id: String(receipt.customer_id || ''),
      gold_weight: String(receipt.gold_weight || ''),
      gold_fineness: receipt.gold_fineness || '足金999',
      remark: receipt.remark || ''
    });
    setReceiptCustomerSearch('');
    setShowReceiptCreateModal(true);
  };

  // ==================== 客料回仓单 API ====================

  const loadCustomerGoldTransfers = useCallback(async () => {
    setCustomerGoldTransfersLoading(true);
    try {
      const res = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/gold-material/customer-gold-transfers?limit=200`);
      if (!res.ok) {
        console.warn('客料回仓单API暂不可用:', res.status);
        return;
      }
      const data = await res.json();
      if (data.success && data.data) {
        setCustomerGoldTransfers(data.data.items || []);
      }
    } catch (e: any) {
      console.warn('加载客料回仓单失败:', e.message);
    } finally {
      setCustomerGoldTransfersLoading(false);
    }
  }, []);

  const createCustomerGoldTransfer = async () => {
    if (!goldTransferForm.gold_weight || parseFloat(goldTransferForm.gold_weight) <= 0) {
      toast.error('请输入有效的克重');
      return;
    }
    try {
      const params = new URLSearchParams({
        gold_weight: goldTransferForm.gold_weight,
        gold_fineness: goldTransferForm.gold_fineness,
        remark: goldTransferForm.remark,
        created_by: '结算'
      });
      const res = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/gold-material/customer-gold-transfers?${params}`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message || '创建成功');
        setShowGoldTransferModal(false);
        setGoldTransferForm({ gold_weight: '', gold_fineness: '足金999', remark: '' });
        loadCustomerGoldTransfers();
      } else {
        toast.error(data.message || '创建失败');
      }
    } catch (e: any) {
      toast.error('创建失败: ' + e.message);
    }
  };

  const updateCustomerGoldTransfer = async () => {
    if (!editingGoldTransferId) return;
    if (!goldTransferForm.gold_weight || parseFloat(goldTransferForm.gold_weight) <= 0) {
      toast.error('请输入有效的克重');
      return;
    }
    try {
      const params = new URLSearchParams({
        gold_weight: goldTransferForm.gold_weight,
        gold_fineness: goldTransferForm.gold_fineness,
        remark: goldTransferForm.remark
      });
      const res = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/gold-material/customer-gold-transfers/${editingGoldTransferId}?${params}`, { method: 'PUT' });
      const data = await res.json();
      if (data.success) {
        toast.success('更新成功');
        setShowGoldTransferModal(false);
        setEditingGoldTransferId(null);
        setGoldTransferForm({ gold_weight: '', gold_fineness: '足金999', remark: '' });
        loadCustomerGoldTransfers();
      } else {
        toast.error(data.message || '更新失败');
      }
    } catch (e: any) {
      toast.error('更新失败: ' + e.message);
    }
  };

  const handleGoldTransferAction = async (id: number, action: 'confirm' | 'unconfirm' | 'delete') => {
    try {
      if (action === 'delete') {
        if (!confirm('确定要删除这张回仓单吗？')) return;
        const res = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/gold-material/customer-gold-transfers/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
          toast.success('已删除');
          loadCustomerGoldTransfers();
        } else {
          toast.error(data.message || '删除失败');
        }
      } else if (action === 'confirm') {
        const params = new URLSearchParams({ confirmed_by: '料部' });
        const res = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/gold-material/customer-gold-transfers/${id}/confirm?${params}`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          toast.success(data.message || '已确认');
          loadCustomerGoldTransfers();
        } else {
          toast.error(data.message || '确认失败');
        }
      } else if (action === 'unconfirm') {
        const reason = prompt('请输入反确认原因：');
        if (reason === null) return;
        const params = new URLSearchParams({ operated_by: '料部', reason: reason || '' });
        const res = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/gold-material/customer-gold-transfers/${id}/unconfirm?${params}`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          toast.success(data.message || '已反确认');
          loadCustomerGoldTransfers();
        } else {
          toast.error(data.message || '反确认失败');
        }
      }
    } catch (e: any) {
      toast.error('操作失败: ' + e.message);
    }
  };

  // ==================== 金料采购 API ====================

  const loadPurchaseOrders = useCallback(async () => {
    setPurchaseOrdersLoading(true);
    try {
      const res = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/gold-purchase/orders`);
      if (res.ok) {
        const data = await res.json();
        setPurchaseOrders(data.data || []);
        if (data.summary) setPurchaseSummary(data.summary);
      }
    } catch (e: any) {
      console.warn('加载金料采购单失败:', e.message);
    } finally {
      setPurchaseOrdersLoading(false);
    }
  }, []);

  const loadPurchaseSummary = useCallback(async () => {
    try {
      const res = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/gold-purchase/summary`);
      if (res.ok) {
        const data = await res.json();
        setPurchaseSummary(data.summary || data.data || data);
      }
    } catch (e: any) {
      console.warn('加载采购汇总失败:', e.message);
    }
  }, []);

  const createPurchaseOrder = async () => {
    if (!purchaseForm.supplier_name || !purchaseForm.gold_weight) {
      toast.error('请填写供应商和金重');
      return;
    }
    try {
      const res = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/gold-purchase/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplier_name: purchaseForm.supplier_name,
          gold_weight: parseFloat(purchaseForm.gold_weight),
          gold_fineness: purchaseForm.gold_fineness,
          conversion_rate: parseFloat(purchaseForm.conversion_rate) || 1.0,
          remark: purchaseForm.remark,
          created_by: '料部'
        })
      });
      const data = await res.json();
      if (res.ok) {
        toast.success('采购单创建成功');
        setShowPurchaseForm(false);
        setPurchaseForm({ supplier_name: '', gold_weight: '', gold_fineness: '足金999', conversion_rate: '1.0', remark: '' });
        loadPurchaseOrders();
        loadPurchaseSummary();
      } else {
        toast.error(data.detail || '创建失败');
      }
    } catch (e: any) {
      toast.error('创建失败: ' + e.message);
    }
  };

  const pricePurchaseOrder = async (orderId: number) => {
    if (!pricingGoldPrice || parseFloat(pricingGoldPrice) <= 0) {
      toast.error('请输入有效的金价');
      return;
    }
    try {
      const res = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/gold-purchase/orders/${orderId}/price`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gold_price: parseFloat(pricingGoldPrice), priced_by: '料部' })
      });
      const data = await res.json();
      if (res.ok) {
        toast.success('结价成功');
        setPricingOrderId(null);
        setPricingGoldPrice('');
        loadPurchaseOrders();
        loadPurchaseSummary();
      } else {
        toast.error(data.detail || '结价失败');
      }
    } catch (e: any) {
      toast.error('结价失败: ' + e.message);
    }
  };

  const payPurchaseOrder = async (orderId: number) => {
    if (!paymentForm.payment_amount || parseFloat(paymentForm.payment_amount) <= 0) {
      toast.error('请输入有效的付款金额');
      return;
    }
    try {
      const res = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/gold-purchase/orders/${orderId}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payment_amount: parseFloat(paymentForm.payment_amount),
          payment_method: paymentForm.payment_method,
          remark: paymentForm.remark,
          created_by: '料部'
        })
      });
      const data = await res.json();
      if (res.ok) {
        toast.success('付款成功');
        setPayingOrderId(null);
        setPaymentForm({ payment_amount: '', payment_method: 'transfer', remark: '' });
        loadPurchaseOrders();
        loadPurchaseSummary();
      } else {
        toast.error(data.detail || '付款失败');
      }
    } catch (e: any) {
      toast.error('付款失败: ' + e.message);
    }
  };

  const deletePurchaseOrder = async (orderId: number) => {
    if (!confirm('确定删除此采购单？')) return;
    try {
      const res = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/gold-purchase/orders/${orderId}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('已删除');
        loadPurchaseOrders();
        loadPurchaseSummary();
      } else {
        const data = await res.json();
        toast.error(data.detail || '删除失败');
      }
    } catch (e: any) {
      toast.error('删除失败: ' + e.message);
    }
  };

  const cancelPurchaseOrder = async (orderId: number) => {
    if (!confirm('确定取消此采购单？')) return;
    try {
      const res = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/gold-purchase/orders/${orderId}/cancel`, { method: 'POST' });
      if (res.ok) {
        toast.success('已取消');
        loadPurchaseOrders();
        loadPurchaseSummary();
      } else {
        const data = await res.json();
        toast.error(data.detail || '取消失败');
      }
    } catch (e: any) {
      toast.error('取消失败: ' + e.message);
    }
  };

  const unpricePurchaseOrder = async (orderId: number) => {
    if (!confirm('确定撤销结价？')) return;
    try {
      const res = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/gold-purchase/orders/${orderId}/unprice`, { method: 'POST' });
      if (res.ok) {
        toast.success('已撤销结价');
        loadPurchaseOrders();
        loadPurchaseSummary();
      } else {
        const data = await res.json();
        toast.error(data.detail || '撤销失败');
      }
    } catch (e: any) {
      toast.error('撤销失败: ' + e.message);
    }
  };

  // ==================== 初始化 ====================

  useEffect(() => {
    // 设置默认日期范围（最近30天）
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);
    setLedgerEndDate(endDate.toISOString().split('T')[0]);
    setLedgerStartDate(startDate.toISOString().split('T')[0]);
    
    // 加载客户列表（结算和管理层需要）
    if (userRole === 'settlement' || userRole === 'manager') {
      loadCustomers();
      loadWithdrawals();
      loadTransfers();
      loadCustomerGoldTransfers();
    }
    // 料部只需要加载取料单（用于待发取料）
    if (userRole === 'material') {
      loadCustomers();
      loadWithdrawals();
      loadCustomerGoldTransfers();
    }
    
    // 根据角色加载数据 - 统一使用新系统 /gold-receipts API
    if (userRole === 'material') {
      loadPendingGoldReceipts();  // 料部加载待接收收料单
      loadPayments();
      loadBalance();
      loadSuppliers();
      loadSupplierDebt();
    } else if (userRole === 'settlement') {
      loadPendingGoldReceipts();  // 结算加载收料单列表
    } else if (userRole === 'finance') {
      setActiveTab('supplier-cash-payments');
      loadSupplierCashPayments();
      loadSupplierDebt();
    }
  }, [userRole, loadPendingGoldReceipts, loadPayments, loadBalance, loadSuppliers, loadSupplierDebt, loadCustomers, loadWithdrawals, loadTransfers, loadSupplierCashPayments, loadCustomerGoldTransfers]);

  // 初始化后加载台账（需要等日期设置完成）
  useEffect(() => {
    if (ledgerStartDate && ledgerEndDate && (userRole === 'material' || userRole === 'manager')) {
      loadLedger();
    }
  }, [ledgerStartDate, ledgerEndDate, userRole, loadLedger]);

  // 切换标签页时加载数据 - 所有角色统一使用新系统 /gold-receipts API
  useEffect(() => {
    if (activeTab === 'ledger' && ledgerStartDate && ledgerEndDate) {
      loadLedger();
    } else if (activeTab === 'receipts') {
      // 统一使用新系统 /gold-receipts API
      loadPendingGoldReceipts();
    } else if (activeTab === 'payments') {
      loadPayments();
    } else if (activeTab === 'balance') {
      loadBalance();
      loadInitialBalance();
    } else if (activeTab === 'supplier-debt') {
      loadSupplierDebt();
      loadDailyTransactions();
    } else if (activeTab === 'withdrawals') {
      loadWithdrawals();
      loadCustomers();
    } else if (activeTab === 'transfers' && (userRole === 'settlement' || userRole === 'manager')) {
      loadTransfers();
      loadCustomers();
    } else if (activeTab === 'supplier-cash-payments') {
      loadSupplierCashPayments();
      if (suppliers.length === 0) {
        loadSuppliers();
      }
    } else if (activeTab === 'customer-gold-transfers') {
      loadCustomerGoldTransfers();
    } else if (activeTab === 'gold-purchase') {
      loadPurchaseOrders();
      loadPurchaseSummary();
    }
  }, [activeTab]);

  // ==================== 通用打印/下载函数 ====================

  const printDocument = (type: 'receipt' | 'payment', id: number, format: 'pdf' | 'html') => {
    const endpoint = type === 'receipt' 
      ? `/api/gold-material/receipts/${id}/download?format=${format}`
      : `/api/gold-material/payments/${id}/download?format=${format}`;
    openDownloadUrl(endpoint);
  };

  // ==================== 业务操作函数 ====================

  // 确认收到原料（料部）- 使用新系统 /gold-receipts API
  const confirmReceive = async (receiptId: number) => {
    try {
      const response = await fetch(
        `${API_ENDPOINTS.API_BASE_URL}/api/gold-material/gold-receipts/${receiptId}/receive?received_by=${userRole === 'settlement' ? '结算专员' : userRole === 'material' ? '料部' : '系统'}&user_role=${userRole}`,
        { method: 'POST' }
      );
      
      if (response.ok) {
        toast.success('确认成功');
        loadPendingGoldReceipts();
        loadBalance();
        loadLedger();
      } else {
        const error = await response.json();
        toast.error(error.detail || '确认失败');
      }
    } catch (error) {
      toast.error('确认失败');
    }
  };

  // 创建付料单
  const createPayment = async () => {
    if (!paymentFormData.supplier_id || !paymentFormData.gold_weight) {
      toast.error('请填写必填项');
      return;
    }

    const data = await apiPost(
      `/api/gold-material/payments?user_role=${userRole}&created_by=料部`,
      {
        supplier_id: parseInt(paymentFormData.supplier_id),
        gold_weight: parseFloat(paymentFormData.gold_weight),
        remark: paymentFormData.remark || null,
      },
      { showSuccessToast: true, successMessage: '付料单创建成功' }
    );
    
    if (data?.id) {
      setShowPaymentModal(false);
      setPaymentFormData(INITIAL_PAYMENT_FORM);
      loadPayments();
      loadBalance();
      loadLedger();
      // 自动打印
      printDocument('payment', data.id, 'html');
    }
  };

  // 导出台账
  const exportLedger = (format: 'excel' | 'pdf') => {
    const params = buildQueryString({
      start_date: ledgerStartDate,
      end_date: ledgerEndDate,
      format,
      user_role: userRole
    });
    openDownloadUrl(`/api/gold-material/ledger/export?${params}`);
  };

  // ==================== 渲染组件 ====================

  // 渲染标签页按钮 - 珠宝风格
  const renderTabButton = (tab: typeof activeTab, label: string, badge?: number) => (
    <button
      onClick={() => setActiveTab(tab)}
      className={`px-4 py-2.5 text-sm font-medium rounded-xl transition-all ${
        activeTab === tab
          ? 'bg-white text-amber-700 shadow-sm border border-amber-100'
          : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
      }`}
    >
      {label}
      {badge !== undefined && badge > 0 && (
        <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-red-500 text-white">{badge}</span>
      )}
    </button>
  );

  // 渲染状态标签
  const renderStatusBadge = (status: string) => {
    const statusInfo = STATUS_MAP[status] || { label: status, color: '#6b7280' };
    return (
      <span
        className="px-2 py-1 rounded text-xs font-medium"
        style={{
          backgroundColor: `${statusInfo.color}20`,
          color: statusInfo.color
        }}
      >
        {statusInfo.label}
      </span>
    );
  };

  // 渲染操作按钮组
  const renderActionButtons = (
    id: number,
    type: 'receipt' | 'payment',
    showConfirm: boolean = false,
    onConfirm?: () => void
  ) => (
    <div className="flex gap-2">
      {showConfirm && onConfirm && (
        <button
          onClick={onConfirm}
          className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600"
        >
          确认收到
        </button>
      )}
      <button
        onClick={() => printDocument(type, id, 'html')}
        className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
      >
        打印
      </button>
      <button
        onClick={() => printDocument(type, id, 'pdf')}
        className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600"
      >
        下载
      </button>
    </div>
  );

  // 渲染加载状态
  const renderLoading = () => (
    <div className="text-center py-8">加载中...</div>
  );

  // 渲染空状态
  const renderEmpty = (colSpanOrMessage?: number | string) => {
    const message = typeof colSpanOrMessage === 'string' ? colSpanOrMessage : '暂无数据';
    const colSpan = typeof colSpanOrMessage === 'number' ? colSpanOrMessage : undefined;
    
    if (colSpan) {
      return (
        <tr>
          <td colSpan={colSpan} className="px-6 py-8 text-center text-gray-500">{message}</td>
        </tr>
      );
    }
    return <div className="text-center py-8 text-gray-500">{message}</div>;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-amber-50/30 to-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* 页面标题 - 珠宝风格 */}
        <div className="mb-6 flex items-center gap-4">
          <div className="p-3 bg-gradient-to-br from-yellow-400 to-amber-500 rounded-xl shadow-lg shadow-amber-200/50">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">金料管理</h1>
            <p className="text-gray-500 text-sm">管理金料收料、付料和台账</p>
          </div>
        </div>

        {/* 标签页 - 珠宝风格 */}
        <div className="bg-white rounded-2xl shadow-sm mb-6 overflow-hidden">
          <div className="border-b border-gray-100 bg-gradient-to-r from-gray-50 to-amber-50/30 p-2">
            <nav className="flex flex-wrap gap-1">
              {userRole === 'material' && (
                <>
                  {renderTabButton('ledger', '金料台账')}
                  {renderTabButton('receipts', '收料单（客人给我们）', (Array.isArray(pendingGoldReceipts) ? pendingGoldReceipts : []).filter((r: any) => r && r.status === 'pending').length)}
                  {renderTabButton('customer-gold-transfers', '客料回仓', customerGoldTransfers.filter(t => t.status === 'pending').length)}
                  {renderTabButton('payments', '付料单（付供应商）', (Array.isArray(payments) ? payments : []).filter((p: any) => p && p.status === 'pending').length)}
                  {renderTabButton('withdrawals', '取料单（客人拿走）', (Array.isArray(withdrawals) ? withdrawals : []).filter(w => w && w.status === 'pending').length)}
                  {renderTabButton('supplier-cash-payments', '供应商付款（工费）', supplierCashPayments.filter(p => p.status === 'pending').length)}
                  {renderTabButton('supplier-debt', '供应商款料查询')}
                  {renderTabButton('gold-purchase', '金料采购')}
                  {renderTabButton('balance', '金料库存')}
                </>
              )}
              {userRole === 'settlement' && (
                <>
                  {renderTabButton('receipts', '收料单（客人给我们）')}
                  {renderTabButton('customer-gold-transfers', '客料回仓', customerGoldTransfers.filter(t => t.status === 'pending').length)}
                  {renderTabButton('withdrawals', '取料单（客人拿走）')}
                  {renderTabButton('transfers', '转料单')}
                </>
              )}
              {userRole === 'finance' && (
                <>
                  {renderTabButton('supplier-cash-payments', '供应商付款（工费）', supplierCashPayments.filter(p => p.status === 'pending').length)}
                  {renderTabButton('supplier-debt', '供应商款料查询')}
                </>
              )}
              {userRole === 'manager' && (
                <>
                  {renderTabButton('ledger', '金料台账')}
                  {renderTabButton('receipts', '收料单（客人给我们）')}
                  {renderTabButton('customer-gold-transfers', '客料回仓', customerGoldTransfers.filter(t => t.status === 'pending').length)}
                  {renderTabButton('payments', '付料单（付供应商）')}
                  {renderTabButton('withdrawals', '取料单（客人拿走）')}
                  {renderTabButton('supplier-cash-payments', '供应商付款（工费）', supplierCashPayments.filter(p => p.status === 'pending').length)}
                  {renderTabButton('transfers', '转料单')}
                  {renderTabButton('gold-purchase', '金料采购')}
                  {renderTabButton('balance', '金料库存')}
                </>
              )}
            </nav>
          </div>
        </div>

        {/* 金料台账（统一视图：汇总卡片 + 日期流水表） */}
        {activeTab === 'ledger' && (userRole === 'material' || userRole === 'manager') && (
          <div className="space-y-4">
            {/* 工具栏：快捷周期 + 自定义日期 + 导出 */}
            <div className="bg-white rounded-lg shadow-sm p-4">
              <div className="flex flex-wrap items-center gap-3">
                {/* 快捷周期 */}
                <div className="flex bg-gray-100 rounded-lg p-1">
                  {[
                    { value: 'today', label: '今日' },
                    { value: 'week', label: '本周' },
                    { value: 'month', label: '本月' }
                  ].map(item => (
                    <button
                      key={item.value}
                      onClick={() => {
                        const now = new Date();
                        let s: Date;
                        if (item.value === 'today') {
                          s = now;
                        } else if (item.value === 'week') {
                          s = new Date(now);
                          s.setDate(now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1));
                        } else {
                          s = new Date(now.getFullYear(), now.getMonth(), 1);
                        }
                        const fmt = (d: Date) => d.toISOString().slice(0, 10);
                        setLedgerStartDate(fmt(s));
                        setLedgerEndDate(fmt(now));
                      }}
                      className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                        (() => {
                          const now = new Date();
                          let expectedStart: string;
                          if (item.value === 'today') {
                            expectedStart = now.toISOString().slice(0, 10);
                          } else if (item.value === 'week') {
                            const s = new Date(now);
                            s.setDate(now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1));
                            expectedStart = s.toISOString().slice(0, 10);
                          } else {
                            expectedStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
                          }
                          return ledgerStartDate === expectedStart && ledgerEndDate === now.toISOString().slice(0, 10);
                        })()
                          ? 'bg-white text-amber-700 shadow-sm'
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                <div className="h-6 w-px bg-gray-200" />

                {/* 自定义日期 */}
                <input
                  type="date"
                  value={ledgerStartDate}
                  onChange={(e) => setLedgerStartDate(e.target.value)}
                  className="px-3 py-1.5 border rounded-lg text-sm"
                />
                <span className="text-gray-400 text-sm">至</span>
                <input
                  type="date"
                  value={ledgerEndDate}
                  onChange={(e) => setLedgerEndDate(e.target.value)}
                  className="px-3 py-1.5 border rounded-lg text-sm"
                />
                <button
                  onClick={loadLedger}
                  className="px-4 py-1.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 text-sm font-medium"
                >
                  查询
                </button>

                <div className="ml-auto flex gap-2">
                  <button
                    onClick={() => exportLedger('excel')}
                    className="px-3 py-1.5 bg-green-500 text-white rounded-lg hover:bg-green-600 text-sm"
                  >
                    导出Excel
                  </button>
                  <button
                    onClick={() => exportLedger('pdf')}
                    className="px-3 py-1.5 bg-red-500 text-white rounded-lg hover:bg-red-600 text-sm"
                  >
                    导出PDF
                  </button>
                </div>
              </div>
            </div>

            {ledgerLoading ? renderLoading() : (
              <>
                {/* 汇总卡片 */}
                {ledgerSummary && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {/* 收料 */}
                    <div className="bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200 rounded-xl p-4">
                      <div className="text-sm text-gray-500 mb-1">收料</div>
                      <div className="text-xl font-bold text-green-700">{ledgerSummary.total_income?.toFixed(3)} 克</div>
                      <div className="text-xs text-gray-400 mt-1">{ledgerSummary.income_count || 0} 笔</div>
                      {Array.isArray(ledgerBreakdown?.income_by_customer) && ledgerBreakdown.income_by_customer.length > 0 && (
                        <div className="border-t border-green-200 mt-3 pt-2 space-y-1">
                          {ledgerBreakdown.income_by_customer.slice(0, 5).map((item: any) => (
                            <div key={item.customer_id} className="flex justify-between text-xs">
                              <span className="text-gray-600 truncate mr-2">{item.customer_name}</span>
                              <span className="text-green-600 font-medium whitespace-nowrap">{item.total_weight?.toFixed(3)}克</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* 付料 */}
                    <div className="bg-gradient-to-br from-orange-50 to-amber-50 border border-orange-200 rounded-xl p-4">
                      <div className="text-sm text-gray-500 mb-1">付料</div>
                      <div className="text-xl font-bold text-orange-700">{ledgerSummary.total_expense?.toFixed(3)} 克</div>
                      <div className="text-xs text-gray-400 mt-1">{ledgerSummary.expense_count || 0} 笔</div>
                      {Array.isArray(ledgerBreakdown?.expense_by_supplier) && ledgerBreakdown.expense_by_supplier.length > 0 && (
                        <div className="border-t border-orange-200 mt-3 pt-2 space-y-1">
                          {ledgerBreakdown.expense_by_supplier.slice(0, 5).map((item: any) => (
                            <div key={item.supplier_id || 'unknown'} className="flex justify-between text-xs">
                              <span className="text-gray-600 truncate mr-2">{item.supplier_name}</span>
                              <span className="text-orange-600 font-medium whitespace-nowrap">{item.total_weight?.toFixed(3)}克</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* 提料 */}
                    <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-4">
                      <div className="text-sm text-gray-500 mb-1">客户提料</div>
                      <div className="text-xl font-bold text-blue-700">{ledgerSummary.total_withdrawal?.toFixed(3)} 克</div>
                      <div className="text-xs text-gray-400 mt-1">{ledgerSummary.withdrawal_count || 0} 笔</div>
                      {Array.isArray(ledgerBreakdown?.withdrawal_by_customer) && ledgerBreakdown.withdrawal_by_customer.length > 0 && (
                        <div className="border-t border-blue-200 mt-3 pt-2 space-y-1">
                          {ledgerBreakdown.withdrawal_by_customer.slice(0, 5).map((item: any) => (
                            <div key={item.customer_id} className="flex justify-between text-xs">
                              <span className="text-gray-600 truncate mr-2">{item.customer_name}</span>
                              <span className="text-blue-600 font-medium whitespace-nowrap">{item.total_weight?.toFixed(3)}克</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* 净额 */}
                    <div className="bg-gradient-to-br from-gray-50 to-slate-50 border border-gray-200 rounded-xl p-4">
                      <div className="text-sm text-gray-500 mb-1">净额</div>
                      <div className={`text-xl font-bold ${(ledgerSummary.total_net || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {ledgerSummary.total_net?.toFixed(3)} 克
                      </div>
                      <div className="text-xs text-gray-400 mt-1">{ledgerSummary.days_count || 0} 天有记录</div>
                    </div>
                  </div>
                )}

                {/* 日期流水表 */}
                <div className="bg-white rounded-lg shadow-sm p-6">
                  {!Array.isArray(ledger) || ledger.length === 0 ? (
                    <div className="text-center py-12 text-gray-500">暂无台账数据</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-[700px] w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">日期</th>
                            <th className="px-5 py-3 text-right text-xs font-medium text-green-600 uppercase">收料（克）</th>
                            <th className="px-5 py-3 text-right text-xs font-medium text-orange-600 uppercase">付料（克）</th>
                            <th className="px-5 py-3 text-right text-xs font-medium text-blue-600 uppercase">提料（克）</th>
                            <th className="px-5 py-3 text-right text-xs font-medium text-gray-500 uppercase">净额（克）</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {ledger.map((day: any) => {
                            const isExpanded = expandedDates.has(day.date);
                            const hasTransactions = Array.isArray(day.transactions) && day.transactions.length > 0;
                            return (
                              <React.Fragment key={day.date}>
                                <tr
                                  className={`hover:bg-gray-50 ${hasTransactions ? 'cursor-pointer' : ''}`}
                                  onClick={() => {
                                    if (hasTransactions) {
                                      setExpandedDates(prev => {
                                        const next = new Set(prev);
                                        if (next.has(day.date)) next.delete(day.date);
                                        else next.add(day.date);
                                        return next;
                                      });
                                    }
                                  }}
                                >
                                  <td className="px-5 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                    <div className="flex items-center gap-2">
                                      {hasTransactions && (
                                        <span className={`text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                                      )}
                                      {day.date}
                                    </div>
                                  </td>
                                  <td className="px-5 py-4 whitespace-nowrap text-sm text-right text-green-700 font-medium">
                                    {day.income > 0 ? day.income.toFixed(3) : '-'}
                                  </td>
                                  <td className="px-5 py-4 whitespace-nowrap text-sm text-right text-orange-700 font-medium">
                                    {day.expense > 0 ? day.expense.toFixed(3) : '-'}
                                  </td>
                                  <td className="px-5 py-4 whitespace-nowrap text-sm text-right text-blue-700 font-medium">
                                    {(day.withdrawal || 0) > 0 ? (day.withdrawal || 0).toFixed(3) : '-'}
                                  </td>
                                  <td className={`px-5 py-4 whitespace-nowrap text-sm text-right font-bold ${
                                    day.net >= 0 ? 'text-green-600' : 'text-red-600'
                                  }`}>
                                    {(day.net || 0).toFixed(3)}
                                  </td>
                                </tr>
                                {isExpanded && Array.isArray(day.transactions) && day.transactions.map((tx: any, idx: number) => (
                                  <tr key={`${day.date}-${tx.id || idx}`} className="bg-gray-50">
                                    <td className="px-5 py-2.5 whitespace-nowrap text-sm text-gray-600">
                                      <div className="flex items-center gap-2 pl-8">
                                        <span className="text-gray-300">└─</span>
                                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                          tx.transaction_type === 'income'
                                            ? 'bg-green-100 text-green-700'
                                            : tx.transaction_type === 'withdrawal'
                                            ? 'bg-blue-100 text-blue-700'
                                            : 'bg-orange-100 text-orange-700'
                                        }`}>
                                          {tx.transaction_type === 'income' ? '收料' : tx.transaction_type === 'withdrawal' ? '提料' : '付料'}
                                        </span>
                                        <span className="text-gray-700">{tx.customer_name || tx.supplier_name || '-'}</span>
                                        {tx.status === 'pending' && (
                                          <span className="text-xs text-yellow-600 bg-yellow-100 px-1.5 py-0.5 rounded">待确认</span>
                                        )}
                                      </div>
                                    </td>
                                    <td className="px-5 py-2.5 whitespace-nowrap text-sm text-right text-green-600">
                                      {tx.transaction_type === 'income' ? tx.gold_weight?.toFixed(3) : '-'}
                                    </td>
                                    <td className="px-5 py-2.5 whitespace-nowrap text-sm text-right text-orange-600">
                                      {tx.transaction_type === 'expense' ? tx.gold_weight?.toFixed(3) : '-'}
                                    </td>
                                    <td className="px-5 py-2.5 whitespace-nowrap text-sm text-right text-blue-600">
                                      {tx.transaction_type === 'withdrawal' ? tx.gold_weight?.toFixed(3) : '-'}
                                    </td>
                                    <td className="px-5 py-2.5 whitespace-nowrap text-sm text-right text-gray-400">
                                      {tx.confirmed_at ? new Date(tx.confirmed_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '-'}
                                    </td>
                                  </tr>
                                ))}
                              </React.Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* 收料单列表 - 统一使用新系统 /gold-receipts API */}
        {activeTab === 'receipts' && (
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">收料单列表</h2>
              <div className="flex items-center gap-2">
                {userRole === 'settlement' && (
                  <button
                    onClick={() => {
                      setEditingReceiptId(null);
                      setReceiptForm({ customer_id: '', gold_weight: '', gold_fineness: '足金999', remark: '' });
                      setReceiptCustomerSearch('');
                      setShowReceiptCreateModal(true);
                    }}
                    className="px-4 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors font-medium"
                  >
                    + 创建收料单
                  </button>
                )}
                <button
                  onClick={() => loadPendingGoldReceipts()}
                  className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  刷新
                </button>
              </div>
            </div>

            {/* 所有角色统一使用新系统收料单 */}
            {loadingGoldReceipts ? renderLoading() : (
              !Array.isArray(pendingGoldReceipts) || pendingGoldReceipts.length === 0 ? (
                <div className="text-center py-12 text-gray-500">暂无收料单</div>
              ) : (
                <div className="space-y-4">
                  {pendingGoldReceipts.map((receipt) => (
                    <div key={receipt.id} className={`border rounded-lg p-4 hover:shadow-md transition-shadow ${
                      receipt.status === 'pending' ? 'bg-yellow-50 border-yellow-200' : 'bg-green-50 border-green-200'
                    }`}>
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="flex items-center gap-4 mb-2">
                            <span className="font-semibold text-lg">收料单号：{receipt.receipt_no}</span>
                            <span className={`px-2 py-1 text-xs rounded-full ${
                              receipt.status === 'pending' 
                                ? 'bg-yellow-100 text-yellow-800' 
                                : 'bg-green-100 text-green-800'
                            }`}>
                              {receipt.status === 'pending' ? '待确认' : '已确认'}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-4 text-sm text-gray-600">
                            <div>客户：{receipt.customer_name || '-'}</div>
                            <div>关联结算单：{receipt.settlement_no || '无'}</div>
                            <div className="text-amber-700 font-medium">金料克重：{receipt.gold_weight?.toFixed(3) || '0.000'} 克</div>
                            <div>成色：{receipt.gold_fineness || '-'}</div>
                            <div>开单人：{receipt.created_by || '-'}</div>
                            <div>创建时间：{receipt.created_at ? new Date(receipt.created_at).toLocaleString('zh-CN') : '-'}</div>
                            {receipt.received_by && <div>接收人：{receipt.received_by}</div>}
                            {receipt.received_at && <div>接收时间：{new Date(receipt.received_at).toLocaleString('zh-CN')}</div>}
                          </div>
                          {receipt.remark && (
                            <div className="mt-2 text-sm text-gray-500">备注：{receipt.remark}</div>
                          )}
                        </div>
                        <div className="flex flex-col gap-2 ml-4">
                          {/* 结算角色：pending状态可确认/编辑/删除，received状态可反确认 */}
                          {userRole === 'settlement' && receipt.status === 'pending' && (
                            <>
                              <button
                                onClick={() => handleReceiveGold(receipt.id)}
                                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm"
                              >
                                确认
                              </button>
                              <button
                                onClick={() => startEditReceipt(receipt)}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
                              >
                                编辑
                              </button>
                              <button
                                onClick={() => handleReceiptAction(receipt.id, 'delete')}
                                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm"
                              >
                                删除
                              </button>
                            </>
                          )}
                          {userRole === 'settlement' && receipt.status === 'received' && (
                            <button
                              onClick={() => handleReceiptAction(receipt.id, 'unconfirm')}
                              className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors text-sm"
                            >
                              反确认
                            </button>
                          )}
                          {/* 料部和管理层只查看，不操作收料单 */}
                          <button
                            onClick={() => handlePrintReceipt(receipt.id)}
                            className="px-4 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors text-sm"
                          >
                            打印
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        )}

        {/* 付料单列表 */}
        {activeTab === 'payments' && (userRole === 'material' || userRole === 'manager') && (
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">付料单列表</h2>
              <button
                onClick={() => setShowPaymentModal(true)}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
              >
                创建付料单
              </button>
            </div>

            {paymentsLoading ? renderLoading() : !Array.isArray(payments) || payments.length === 0 ? (
              <div className="text-center py-12 text-gray-500">暂无付料单</div>
            ) : (
              <div className="space-y-4">
                {payments.map((payment: any) => (
                  <div key={payment.id} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center gap-4 mb-2">
                          <span className="font-semibold text-lg">付料单号：{payment.transaction_no}</span>
                          {renderStatusBadge(payment.status)}
                        </div>
                        <div className="grid grid-cols-2 gap-4 text-sm text-gray-600">
                          <div>供应商：{payment.supplier_name || '-'}</div>
                          <div>金料重量：{(payment.gold_weight || 0).toFixed(3)} 克</div>
                          <div>创建时间：{new Date(payment.created_at).toLocaleString('zh-CN')}</div>
                          {payment.confirmed_by && (
                            <div>确认人：{payment.confirmed_by}</div>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => printDocument('payment', payment.id, 'html')}
                          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                        >
                          打印
                        </button>
                        {payment.status === 'pending' && (
                          <button
                            onClick={() => confirmPayment(payment.id)}
                            className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600"
                          >
                            确认
                          </button>
                        )}
                        {payment.status === 'pending' && (
                          <button
                            onClick={() => cancelPayment(payment.id)}
                            className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
                          >
                            取消
                          </button>
                        )}
                        {payment.status === 'confirmed' && userRole === 'manager' && (
                          <button
                            onClick={() => unconfirmPayment(payment.id)}
                            className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600"
                          >
                            反确认
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {payments.length === 0 && renderEmpty()}
              </div>
            )}
          </div>
        )}

        {/* 金料库存 */}
        {activeTab === 'balance' && (userRole === 'material' || userRole === 'manager') && (
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">金料库存余额</h2>
              {(userRole === 'manager' || userRole === 'material') && !initialBalance?.has_initial && (
                <button
                  onClick={() => setShowInitialModal(true)}
                  className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 flex items-center gap-2"
                >
                  <span>⚙️</span>
                  <span>设置期初金料</span>
                </button>
              )}
            </div>
            
            {/* 期初金料信息 */}
            {initialBalance?.has_initial && initialBalance.initial && (
              <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <div className="flex items-center gap-2 text-amber-700 mb-2">
                  <span>📋</span>
                  <span className="font-medium">期初金料</span>
                </div>
                <div className="text-sm text-gray-600">
                  <span className="font-semibold text-amber-600">{(initialBalance.initial.gold_weight || 0).toFixed(3)} 克</span>
                  <span className="mx-2">|</span>
                  <span>单号: {initialBalance.initial.transaction_no}</span>
                  <span className="mx-2">|</span>
                  <span>{initialBalance.initial.remark}</span>
                </div>
              </div>
            )}
            
            {balanceLoading ? renderLoading() : balance ? (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                <div className="bg-blue-50 rounded-lg p-6">
                  <div className="text-sm text-gray-600 mb-2">累计收入（含期初）</div>
                  <div className="text-2xl font-bold text-blue-600">{(balance.total_income || 0).toFixed(3)} 克</div>
                </div>
                <div className="bg-red-50 rounded-lg p-6">
                  <div className="text-sm text-gray-600 mb-2">累计支出</div>
                  <div className="text-2xl font-bold text-red-600">{(balance.total_expense || 0).toFixed(3)} 克</div>
                </div>
                <div className="bg-green-50 rounded-lg p-6">
                  <div className="text-sm text-gray-600 mb-2">当前余额</div>
                  <div className="text-2xl font-bold text-green-600">{(balance.current_balance || 0).toFixed(3)} 克</div>
                </div>
              </div>
            ) : renderEmpty()}
          </div>
        )}

        {/* 供应商欠料统计 */}
        {activeTab === 'supplier-debt' && (userRole === 'material' || userRole === 'finance' || userRole === 'manager') && (
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-semibold">供应商款料查询</h2>
              <div className="flex gap-2">
                <button
                  onClick={() => openDownloadUrl('/api/export/supplier-debt-summary')}
                  className="px-3 py-1.5 text-sm bg-green-500 text-white rounded-lg hover:bg-green-600"
                >
                  导出Excel
                </button>
                <button
                  onClick={() => {
                    loadSupplierDebt();
                    loadDailyTransactions();
                  }}
                  className="px-3 py-1.5 text-sm bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"
                >
                  刷新
                </button>
              </div>
            </div>
            
            {/* 日期筛选器 */}
            <div className="mb-6 p-4 bg-gray-50 rounded-lg">
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium text-gray-700">开始日期：</label>
                  <input
                    type="date"
                    value={dateRange.start}
                    onChange={(e) => {
                      setDateRange({ ...dateRange, start: e.target.value });
                      setTimeout(() => loadDailyTransactions(), 100);
                    }}
                    className="px-3 py-1.5 border rounded-lg text-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium text-gray-700">结束日期：</label>
                  <input
                    type="date"
                    value={dateRange.end}
                    onChange={(e) => {
                      setDateRange({ ...dateRange, end: e.target.value });
                      setTimeout(() => loadDailyTransactions(), 100);
                    }}
                    className="px-3 py-1.5 border rounded-lg text-sm"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      const end = new Date();
                      const start = new Date();
                      start.setDate(start.getDate() - 7);
                      setDateRange({
                        start: start.toISOString().split('T')[0],
                        end: end.toISOString().split('T')[0]
                      });
                      setTimeout(() => loadDailyTransactions(), 100);
                    }}
                    className="px-3 py-1.5 text-xs bg-white border rounded-lg hover:bg-gray-50"
                  >
                    最近7天
                  </button>
                  <button
                    onClick={() => {
                      const end = new Date();
                      const start = new Date();
                      start.setDate(start.getDate() - 30);
                      setDateRange({
                        start: start.toISOString().split('T')[0],
                        end: end.toISOString().split('T')[0]
                      });
                      setTimeout(() => loadDailyTransactions(), 100);
                    }}
                    className="px-3 py-1.5 text-xs bg-white border rounded-lg hover:bg-gray-50"
                  >
                    最近30天
                  </button>
                </div>
                <button
                  onClick={() => setShowDailyDetail(!showDailyDetail)}
                  className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                >
                  {showDailyDetail ? '隐藏' : '显示'}每日明细
                </button>
              </div>
            </div>
            
            {/* 汇总卡片 */}
            {supplierDebt && (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
                <div className="bg-blue-50 rounded-lg p-4">
                  <div className="text-sm text-gray-600 mb-1">入库总重量</div>
                  <div className="text-xl font-bold text-blue-600">{(supplierDebt.summary.total_inbound_weight || 0).toFixed(3)} 克</div>
                </div>
                <div className="bg-green-50 rounded-lg p-4">
                  <div className="text-sm text-gray-600 mb-1">已付料总重量</div>
                  <div className="text-xl font-bold text-green-600">{(supplierDebt.summary.total_paid_weight || 0).toFixed(3)} 克</div>
                </div>
                <div className="bg-red-50 rounded-lg p-4">
                  <div className="text-sm text-gray-600 mb-1">欠料总重量</div>
                  <div className="text-xl font-bold text-red-600">{(supplierDebt.summary.total_debt_weight || 0).toFixed(3)} 克</div>
                </div>
                <div className="bg-orange-50 rounded-lg p-4">
                  <div className="text-sm text-gray-600 mb-1">工费欠款</div>
                  <div className="text-xl font-bold text-orange-600">¥{(supplierDebt.summary.total_labor_debt || 0).toFixed(2)}</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="text-sm text-gray-600 mb-1">供应商数量</div>
                  <div className="text-xl font-bold text-gray-700">{supplierDebt.summary.supplier_count} 家</div>
                </div>
              </div>
            )}
            
            {/* 可视化图表 */}
            {dailyTransactions && Array.isArray(dailyTransactions.daily_summary) && dailyTransactions.daily_summary.length > 0 && (
              <div className="mb-6 p-4 bg-white border rounded-lg">
                <h3 className="text-lg font-semibold mb-4">每日趋势图</h3>
                <div style={{ height: '300px' }}>
                  <Line
                    data={{
                      labels: dailyTransactions.daily_summary.map((d: any) => d.date).reverse(),
                      datasets: [
                        {
                          label: '入库重量 (克)',
                          data: dailyTransactions.daily_summary.map((d: any) => d.total_inbound).reverse(),
                          borderColor: 'rgb(59, 130, 246)',
                          backgroundColor: 'rgba(59, 130, 246, 0.1)',
                          tension: 0.1,
                        },
                        {
                          label: '付料重量 (克)',
                          data: dailyTransactions.daily_summary.map((d: any) => d.total_paid).reverse(),
                          borderColor: 'rgb(34, 197, 94)',
                          backgroundColor: 'rgba(34, 197, 94, 0.1)',
                          tension: 0.1,
                        },
                      ],
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: {
                          position: 'top' as const,
                        },
                        title: {
                          display: false,
                        },
                      },
                      scales: {
                        y: {
                          beginAtZero: true,
                        },
                      },
                    }}
                  />
                </div>
              </div>
            )}
            
            {/* 每日明细表格 */}
            {showDailyDetail && (
              <div className="mb-6">
                <h3 className="text-lg font-semibold mb-4">每日明细</h3>
                {dailyTransactionsLoading ? (
                  renderLoading()
                ) : dailyTransactions && Array.isArray(dailyTransactions.daily_summary) && dailyTransactions.daily_summary.length > 0 ? (
                  <div className="overflow-x-auto border rounded-lg">
                    <table className="w-full text-sm min-w-[600px]">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left font-medium text-gray-600">日期</th>
                          <th className="px-4 py-3 text-right font-medium text-gray-600">入库重量 (克)</th>
                          <th className="px-4 py-3 text-right font-medium text-gray-600">付料重量 (克)</th>
                          <th className="px-4 py-3 text-right font-medium text-gray-600">净增欠料 (克)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {dailyTransactions.daily_summary.map((day: any, idx: number) => (
                          <tr key={idx} className="hover:bg-gray-50">
                            <td className="px-4 py-3 font-medium">{day.date}</td>
                            <td className="px-4 py-3 text-right text-blue-600">{(day.total_inbound || 0).toFixed(3)}</td>
                            <td className="px-4 py-3 text-right text-green-600">{(day.total_paid || 0).toFixed(3)}</td>
                            <td className="px-4 py-3 text-right font-semibold">
                              <span className={day.net_change > 0 ? 'text-red-600' : day.net_change < 0 ? 'text-green-600' : 'text-gray-600'}>
                                {day.net_change > 0 ? '+' : ''}{(day.net_change || 0).toFixed(3)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">暂无数据</div>
                )}
              </div>
            )}
            
            {/* 供应商搜索 + 款料列表 */}
            {supplierDebt && Array.isArray(supplierDebt.suppliers) && supplierDebt.suppliers.length > 0 && (
              <div className="mb-4">
                <input
                  type="text"
                  value={supplierDebtSearch}
                  onChange={(e) => setSupplierDebtSearch(e.target.value)}
                  placeholder="搜索供应商名称..."
                  className="w-full max-w-sm px-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
                />
              </div>
            )}
            {supplierDebtLoading ? renderLoading() : supplierDebt && Array.isArray(supplierDebt.suppliers) && supplierDebt.suppliers.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[600px]">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-gray-600">供应商</th>
                      <th className="px-4 py-3 text-right font-medium text-gray-600">入库重量 (克)</th>
                      <th className="px-4 py-3 text-right font-medium text-gray-600">已付料 (克)</th>
                      <th className="px-4 py-3 text-right font-medium text-gray-600">欠料 (克)</th>
                      <th className="px-4 py-3 text-right font-medium text-gray-600">工费欠款 (元)</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-600">状态</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-600">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {supplierDebt.suppliers.filter((s: any) => !supplierDebtSearch || s.supplier_name?.toLowerCase().includes(supplierDebtSearch.toLowerCase()) || s.supplier_no?.toLowerCase().includes(supplierDebtSearch.toLowerCase())).map((s: any) => (
                      <tr key={s.supplier_id} className="hover:bg-gray-50 cursor-pointer">
                        <td className="px-4 py-3" onClick={() => openSupplierDetail(s.supplier_id)}>
                          <div className="font-medium text-gray-900">{s.supplier_name}</div>
                          <div className="text-xs text-gray-500">{s.supplier_no}</div>
                        </td>
                        <td className="px-4 py-3 text-right text-blue-600">{(s.inbound_weight || 0).toFixed(3)}</td>
                        <td className="px-4 py-3 text-right text-green-600">{(s.paid_weight || 0).toFixed(3)}</td>
                        <td className="px-4 py-3 text-right font-semibold">
                          <span className={s.debt_weight > 0 ? 'text-red-600' : s.debt_weight < 0 ? 'text-green-600' : 'text-gray-600'}>
                            {s.debt_weight > 0 ? '+' : ''}{(s.debt_weight || 0).toFixed(3)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold">
                          <span className={(s.labor_debt || 0) > 0 ? 'text-orange-600' : 'text-gray-600'}>
                            ¥{(s.labor_debt || 0).toFixed(2)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {s.debt_weight > 0 || (s.labor_debt || 0) > 0 ? (
                            <span className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded-full">欠款</span>
                          ) : s.debt_weight < 0 ? (
                            <span className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded-full">多付</span>
                          ) : (
                            <span className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded-full">结清</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex gap-1 justify-center">
                            <button
                              onClick={() => openSupplierDetail(s.supplier_id)}
                              className="px-3 py-1 text-xs bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                            >
                              查看详情
                            </button>
                            {(s.labor_debt || 0) > 0 && userRole === 'material' && (
                              <button
                                onClick={() => {
                                  setCashPaymentPreselectedSupplier({ id: s.supplier_id, name: s.supplier_name });
                                  setCashPaymentForm({ supplier_id: s.supplier_id.toString(), amount: '', payment_method: 'bank_transfer', remark: '' });
                                  setShowCashPaymentModal(true);
                                }}
                                className="px-3 py-1 text-xs bg-orange-500 text-white rounded-lg hover:bg-orange-600"
                              >
                                登记付款
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : renderEmpty()}
          </div>
        )}

        {/* 创建/编辑收料单弹窗（结算用） */}
        {showReceiptCreateModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">{editingReceiptId ? '编辑收料单' : '创建收料单'}</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">选择客户 *</label>
                  <input
                    type="text"
                    placeholder="搜索客户姓名..."
                    value={receiptCustomerSearch}
                    onChange={(e) => setReceiptCustomerSearch(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-400 mb-2"
                  />
                  <div className="max-h-32 overflow-y-auto border border-gray-200 rounded-lg">
                    {customers.filter(c => {
                      if (!receiptCustomerSearch.trim()) return true;
                      return c.name?.toLowerCase().includes(receiptCustomerSearch.toLowerCase());
                    }).slice(0, 10).map((c: any) => (
                      <div
                        key={c.id}
                        onClick={() => {
                          setReceiptForm(prev => ({ ...prev, customer_id: String(c.id) }));
                          setReceiptCustomerSearch(c.name);
                        }}
                        className={`p-2 cursor-pointer hover:bg-amber-50 border-b last:border-b-0 text-sm ${
                          receiptForm.customer_id === String(c.id) ? 'bg-amber-100' : ''
                        }`}
                      >
                        {c.name} {c.phone ? `(${c.phone})` : ''}
                      </div>
                    ))}
                    {customers.filter(c => {
                      if (!receiptCustomerSearch.trim()) return true;
                      return c.name?.toLowerCase().includes(receiptCustomerSearch.toLowerCase());
                    }).length === 0 && (
                      <div className="p-2 text-center text-gray-400 text-sm">暂无匹配客户</div>
                    )}
                  </div>
                  {receiptForm.customer_id && (
                    <div className="mt-1 text-xs text-green-600">
                      已选择：{customers.find((c: any) => String(c.id) === receiptForm.customer_id)?.name}
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">收料克重 (克) *</label>
                  <input
                    type="number"
                    step="0.01"
                    value={receiptForm.gold_weight}
                    onChange={(e) => setReceiptForm(prev => ({ ...prev, gold_weight: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-400"
                    placeholder="请输入克重"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">成色</label>
                  <select
                    value={receiptForm.gold_fineness}
                    onChange={(e) => setReceiptForm(prev => ({ ...prev, gold_fineness: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-400"
                  >
                    <option value="足金999">足金999</option>
                    <option value="足金9999">足金9999</option>
                    <option value="18K">18K</option>
                    <option value="其他">其他</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
                  <textarea
                    value={receiptForm.remark}
                    onChange={(e) => setReceiptForm(prev => ({ ...prev, remark: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-400"
                    rows={2}
                    placeholder="备注信息（可选）"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => {
                    setShowReceiptCreateModal(false);
                    setEditingReceiptId(null);
                    setReceiptForm({ customer_id: '', gold_weight: '', gold_fineness: '足金999', remark: '' });
                    setReceiptCustomerSearch('');
                  }}
                  className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm"
                >
                  取消
                </button>
                <button
                  onClick={editingReceiptId ? updateGoldReceipt : createGoldReceipt}
                  className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors text-sm font-medium"
                >
                  {editingReceiptId ? '保存修改' : '创建'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ==================== 客料回仓单 Tab ==================== */}
        {activeTab === 'customer-gold-transfers' && (
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-semibold text-gray-900">客料回仓单</h2>
              {userRole === 'settlement' && (
                <button
                  onClick={() => {
                    setEditingGoldTransferId(null);
                    setGoldTransferForm({ gold_weight: '', gold_fineness: '足金999', remark: '' });
                    setShowGoldTransferModal(true);
                  }}
                  className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors text-sm font-medium"
                >
                  + 创建回仓单
                </button>
              )}
            </div>

            {customerGoldTransfersLoading ? (
              <div className="text-center py-10 text-gray-400">加载中...</div>
            ) : customerGoldTransfers.length === 0 ? (
              <div className="text-center py-10 text-gray-400">暂无客料回仓单</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px]">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">单号</th>
                      <th className="text-right text-xs font-medium text-gray-500 uppercase px-4 py-3">转交克重(克)</th>
                      <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">成色</th>
                      <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">状态</th>
                      <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">开单人</th>
                      <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">创建时间</th>
                      <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">确认人</th>
                      <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">备注</th>
                      <th className="text-center text-xs font-medium text-gray-500 uppercase px-4 py-3">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {customerGoldTransfers.map((t: any) => (
                      <tr key={t.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-4 py-3 text-sm font-mono text-gray-900">{t.transfer_no}</td>
                        <td className="px-4 py-3 text-right text-sm font-medium text-amber-700">{t.gold_weight?.toFixed(3)}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{t.gold_fineness}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 rounded text-xs font-medium ${
                            t.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                            t.status === 'confirmed' ? 'bg-green-100 text-green-700' :
                            'bg-gray-100 text-gray-600'
                          }`}>
                            {t.status === 'pending' ? '待确认' : t.status === 'confirmed' ? '已确认' : t.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">{t.created_by}</td>
                        <td className="px-4 py-3 text-sm text-gray-500">{t.create_time ? new Date(t.create_time).toLocaleString('zh-CN') : '-'}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {t.confirmed_by ? (
                            <span>{t.confirmed_by} ({t.confirmed_at ? new Date(t.confirmed_at).toLocaleString('zh-CN') : ''})</span>
                          ) : '-'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500">{t.remark || '-'}</td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-2">
                            {/* 结算可以：编辑/删除 pending 的单据 */}
                            {userRole === 'settlement' && t.status === 'pending' && (
                              <>
                                <button
                                  onClick={() => {
                                    setEditingGoldTransferId(t.id);
                                    setGoldTransferForm({
                                      gold_weight: String(t.gold_weight),
                                      gold_fineness: t.gold_fineness || '足金999',
                                      remark: t.remark || ''
                                    });
                                    setShowGoldTransferModal(true);
                                  }}
                                  className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                                >
                                  编辑
                                </button>
                                <button
                                  onClick={() => handleGoldTransferAction(t.id, 'delete')}
                                  className="text-red-600 hover:text-red-800 text-xs font-medium"
                                >
                                  删除
                                </button>
                              </>
                            )}
                            {/* 料部/管理层可以：确认 pending 的单据 */}
                            {(userRole === 'material' || userRole === 'manager') && t.status === 'pending' && (
                              <button
                                onClick={() => handleGoldTransferAction(t.id, 'confirm')}
                                className="text-green-600 hover:text-green-800 text-xs font-medium"
                              >
                                确认接收
                              </button>
                            )}
                            {/* 料部/管理层可以：反确认已确认的单据 */}
                            {(userRole === 'material' || userRole === 'manager') && t.status === 'confirmed' && (
                              <button
                                onClick={() => handleGoldTransferAction(t.id, 'unconfirm')}
                                className="text-orange-600 hover:text-orange-800 text-xs font-medium"
                              >
                                反确认
                              </button>
                            )}
                            {t.status === 'confirmed' && userRole === 'settlement' && (
                              <span className="text-xs text-gray-400">已确认</span>
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
        )}

        {/* 客料回仓单 - 创建/编辑弹窗 */}
        {showGoldTransferModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">
                {editingGoldTransferId ? '编辑客料回仓单' : '创建客料回仓单'}
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">转交克重 (克) *</label>
                  <input
                    type="number"
                    step="0.01"
                    value={goldTransferForm.gold_weight}
                    onChange={(e) => setGoldTransferForm(prev => ({ ...prev, gold_weight: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-400"
                    placeholder="请输入克重"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">成色</label>
                  <select
                    value={goldTransferForm.gold_fineness}
                    onChange={(e) => setGoldTransferForm(prev => ({ ...prev, gold_fineness: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-400"
                  >
                    <option value="足金999">足金999</option>
                    <option value="足金9999">足金9999</option>
                    <option value="18K">18K</option>
                    <option value="其他">其他</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
                  <textarea
                    value={goldTransferForm.remark}
                    onChange={(e) => setGoldTransferForm(prev => ({ ...prev, remark: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-400"
                    rows={3}
                    placeholder="备注信息（可选）"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => {
                    setShowGoldTransferModal(false);
                    setEditingGoldTransferId(null);
                    setGoldTransferForm({ gold_weight: '', gold_fineness: '足金999', remark: '' });
                  }}
                  className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm"
                >
                  取消
                </button>
                <button
                  onClick={editingGoldTransferId ? updateCustomerGoldTransfer : createCustomerGoldTransfer}
                  className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors text-sm font-medium"
                >
                  {editingGoldTransferId ? '保存修改' : '创建'}
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'supplier-cash-payments' && (userRole === 'material' || userRole === 'finance' || userRole === 'manager') && (
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-semibold text-gray-900">供应商工费付款登记</h2>
              {userRole === 'material' && (
                <button
                  onClick={() => {
                    setCashPaymentPreselectedSupplier(null);
                    setEditingCashPaymentId(null);
                    setCashPaymentForm({ supplier_id: '', amount: '', payment_method: 'bank_transfer', remark: '' });
                    setShowCashPaymentModal(true);
                  }}
                  className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 flex items-center gap-2 text-sm"
                >
                  <span>➕</span> 创建付款登记
                </button>
              )}
            </div>

            {supplierCashPaymentsLoading ? (
              <div className="text-center py-12 text-gray-500">加载中...</div>
            ) : supplierCashPayments.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[600px]">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-gray-600">付款单号</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-600">供应商</th>
                      <th className="px-4 py-3 text-right font-medium text-gray-600">金额</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-600">付款方式</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-600">状态</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-600">操作人</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-600">时间</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-600">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {supplierCashPayments.map((p: any) => (
                      <tr key={p.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-mono text-xs">{p.payment_no}</td>
                        <td className="px-4 py-3 font-medium">{p.supplier_name}</td>
                        <td className="px-4 py-3 text-right font-semibold text-orange-600">¥{(p.amount || 0).toFixed(2)}</td>
                        <td className="px-4 py-3 text-center text-xs">
                          {{bank_transfer: '银行转账', cash: '现金', check: '支票'}[p.payment_method as string] || p.payment_method}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {p.status === 'pending' && <span className="px-2 py-1 text-xs bg-yellow-100 text-yellow-700 rounded-full">待确认</span>}
                          {p.status === 'confirmed' && <span className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded-full">已确认</span>}
                          {p.status === 'cancelled' && <span className="px-2 py-1 text-xs bg-gray-100 text-gray-500 rounded-full">已取消</span>}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-600">
                          <div>{p.created_by}</div>
                          {p.confirmed_by && <div className="text-green-600">确认: {p.confirmed_by}</div>}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">
                          {p.create_time ? new Date(p.create_time).toLocaleString('zh-CN') : ''}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex gap-1 justify-center">
                            {p.status === 'pending' && userRole === 'material' && (
                              <>
                                <button
                                  onClick={() => handleCashPaymentAction(p.id, 'confirm')}
                                  className="px-2 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600"
                                >
                                  确认
                                </button>
                                <button
                                  onClick={() => {
                                    setEditingCashPaymentId(p.id);
                                    setCashPaymentForm({
                                      supplier_id: p.supplier_id?.toString() || '',
                                      amount: p.amount?.toString() || '',
                                      payment_method: p.payment_method || 'bank_transfer',
                                      remark: p.remark || ''
                                    });
                                    setCashPaymentPreselectedSupplier(null);
                                    setShowCashPaymentModal(true);
                                  }}
                                  className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
                                >
                                  编辑
                                </button>
                                <button
                                  onClick={() => handleCashPaymentAction(p.id, 'delete')}
                                  className="px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600"
                                >
                                  取消
                                </button>
                              </>
                            )}
                            {p.status === 'confirmed' && userRole === 'material' && (
                              <button
                                onClick={() => {
                                  const reason = prompt('请输入反确认原因：');
                                  if (reason) handleCashPaymentAction(p.id, 'unconfirm', reason);
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
              <div className="text-center py-12 text-gray-400">暂无付款记录</div>
            )}
          </div>
        )}
        
        {/* 供应商详情弹窗 */}
        {showSupplierDetailModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setShowSupplierDetailModal(false)}>
            <div className="bg-white rounded-lg p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-semibold">供应商交易详情</h3>
                <button
                  onClick={() => setShowSupplierDetailModal(false)}
                  className="text-gray-400 hover:text-gray-600 text-2xl"
                >
                  ×
                </button>
              </div>
              
              {supplierDetailLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                </div>
              ) : supplierDetail ? (
                <>
                  {/* 账户信息 */}
                  <div className="mb-6 p-4 bg-gray-50 rounded-lg">
                    <h4 className="font-semibold mb-2">账户信息</h4>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                      <div>
                        <div className="text-sm text-gray-600">供应商名称</div>
                        <div className="font-medium">{supplierDetail.account.supplier_name}</div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-600">当前欠料</div>
                        <div className={`font-medium ${supplierDetail.account.current_balance > 0 ? 'text-red-600' : supplierDetail.account.current_balance < 0 ? 'text-green-600' : 'text-gray-600'}`}>
                          {supplierDetail.account.current_balance > 0 ? '+' : ''}{(supplierDetail.account.current_balance || 0).toFixed(3)} 克
                        </div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-600">工费欠款</div>
                        <div className={`font-medium ${(supplierDetail.account.labor_debt_total || 0) > 0 ? 'text-orange-600' : 'text-gray-600'}`}>
                          ¥{(supplierDetail.account.labor_debt_total || 0).toFixed(2)}
                        </div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-600">工费已付</div>
                        <div className="font-medium text-green-600">
                          ¥{(supplierDetail.account.labor_paid_total || 0).toFixed(2)}
                        </div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-600">状态</div>
                        <div className="font-medium">{supplierDetail.account.status_text}</div>
                      </div>
                    </div>
                  </div>
                  
                  {/* 统一往来账明细 */}
                  <div>
                    <h4 className="font-semibold mb-4">往来账明细</h4>
                    {Array.isArray(supplierDetail.unified_transactions) && supplierDetail.unified_transactions.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm min-w-[600px]">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-3 py-3 text-left font-medium text-gray-600">日期</th>
                              <th className="px-3 py-3 text-left font-medium text-gray-600">类型</th>
                              <th className="px-3 py-3 text-left font-medium text-gray-600">单号</th>
                              <th className="px-3 py-3 text-right font-medium text-gray-600">金料变动(克)</th>
                              <th className="px-3 py-3 text-right font-medium text-gray-600">工费变动(元)</th>
                              <th className="px-3 py-3 text-left font-medium text-gray-600">备注</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {supplierDetail.unified_transactions.map((tx: any, idx: number) => (
                              <tr key={idx} className="hover:bg-gray-50">
                                <td className="px-3 py-3 text-xs text-gray-600 whitespace-nowrap">
                                  {tx.date ? new Date(tx.date).toLocaleDateString('zh-CN') : '-'}
                                </td>
                                <td className="px-3 py-3">
                                  <span className={`px-2 py-1 text-xs rounded-full ${
                                    tx.type === 'inbound' ? 'bg-blue-100 text-blue-700' :
                                    tx.type === 'pay' ? 'bg-green-100 text-green-700' :
                                    tx.type === 'return' ? 'bg-purple-100 text-purple-700' :
                                    'bg-orange-100 text-orange-700'
                                  }`}>
                                    {tx.type_text}
                                  </span>
                                </td>
                                <td className="px-3 py-3 font-mono text-xs">{tx.order_no || '-'}</td>
                                <td className="px-3 py-3 text-right font-medium">
                                  {tx.gold_change != null ? (
                                    <span className={tx.gold_change > 0 ? 'text-red-600' : 'text-green-600'}>
                                      {tx.gold_change > 0 ? '+' : ''}{tx.gold_change.toFixed(3)}
                                    </span>
                                  ) : <span className="text-gray-300">-</span>}
                                </td>
                                <td className="px-3 py-3 text-right font-medium">
                                  {tx.labor_change != null ? (
                                    <span className={tx.labor_change > 0 ? 'text-orange-600' : 'text-green-600'}>
                                      {tx.labor_change > 0 ? '+' : ''}{tx.labor_change.toFixed(2)}
                                    </span>
                                  ) : <span className="text-gray-300">-</span>}
                                </td>
                                <td className="px-3 py-3 text-xs text-gray-600">{tx.remark || '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot className="bg-gray-100 font-semibold">
                            <tr>
                              <td colSpan={3} className="px-3 py-3 text-right text-gray-700">当前余额</td>
                              <td className="px-3 py-3 text-right text-red-600">
                                {(supplierDetail.account.current_balance || 0).toFixed(3)} 克
                              </td>
                              <td className="px-3 py-3 text-right text-orange-600">
                                ¥{(supplierDetail.account.labor_debt_total || 0).toFixed(2)}
                              </td>
                              <td></td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    ) : (
                      <div className="text-center py-8 text-gray-500">暂无往来记录</div>
                    )}
                  </div>
                </>
              ) : (
                <div className="text-center py-12 text-gray-500">加载失败</div>
              )}
            </div>
          </div>
        )}
        
        {/* 设置期初金料弹窗 */}
        {showInitialModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-md">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-semibold">设置期初金料</h3>
                <button
                  onClick={() => setShowInitialModal(false)}
                  className="text-gray-400 hover:text-gray-600 text-2xl"
                >
                  ×
                </button>
              </div>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    期初金料克重 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={initialFormData.gold_weight}
                    onChange={(e) => setInitialFormData({ ...initialFormData, gold_weight: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                    placeholder="请输入期初金料克重"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
                  <input
                    type="text"
                    value={initialFormData.remark}
                    onChange={(e) => setInitialFormData({ ...initialFormData, remark: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                    placeholder="期初金料库存"
                  />
                </div>
                
                <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
                  <strong>提示：</strong>期初金料只能设置一次，设置后不可修改。请确认克重无误后再提交。
                </div>
              </div>
              
              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => setShowInitialModal(false)}
                  className="px-4 py-2 border rounded-lg hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  onClick={submitInitialBalance}
                  disabled={initialSubmitting || !initialFormData.gold_weight}
                  className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  {initialSubmitting ? '提交中...' : '确认设置'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 创建付料单弹窗 */}
        {showPaymentModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-md">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-semibold">创建付料单</h3>
                <button
                  onClick={() => setShowPaymentModal(false)}
                  className="text-gray-400 hover:text-gray-600 text-2xl"
                >
                  ×
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">供应商 *</label>
                  <select
                    value={paymentFormData.supplier_id}
                    onChange={(e) => setPaymentFormData({ ...paymentFormData, supplier_id: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value="">请选择供应商</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">金料重量（克） *</label>
                  <input
                    type="number"
                    step="0.01"
                    value={paymentFormData.gold_weight}
                    onChange={(e) => setPaymentFormData({ ...paymentFormData, gold_weight: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    placeholder="请输入金料重量"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
                  <textarea
                    value={paymentFormData.remark}
                    onChange={(e) => setPaymentFormData({ ...paymentFormData, remark: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    rows={3}
                    placeholder="可选备注信息"
                  />
                </div>
                <div className="flex gap-2 justify-end pt-2">
                  <button
                    onClick={() => setShowPaymentModal(false)}
                    className="px-4 py-2 border rounded-lg hover:bg-gray-50"
                  >
                    取消
                  </button>
                  <button
                    onClick={createPayment}
                    className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                  >
                    创建
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 取料单列表 */}
        {activeTab === 'withdrawals' && (
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">客户取料单</h2>
              {hasPermission(userRole, 'canCreateWithdrawal') && (
                <button
                  onClick={() => {
                    setShowWithdrawalModal(true);
                    loadCustomers();
                  }}
                  className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600"
                >
                  + 创建取料单
                </button>
              )}
            </div>
            
            {withdrawalsLoading ? renderLoading() : !Array.isArray(withdrawals) || withdrawals.length === 0 ? renderEmpty('暂无取料单') : (
              <div className="overflow-x-auto">
                <table className="min-w-[600px] w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">取料单号</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">客户</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">克重</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">取料方式</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">目的地</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">状态</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">创建时间</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">操作</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {withdrawals.map((w) => (
                      <tr key={w.id} className="hover:bg-gray-50">
                        <td className="px-4 py-4 text-sm font-medium text-gray-900">{w.withdrawal_no}</td>
                        <td className="px-4 py-4 text-sm text-gray-600">{w.customer_name}</td>
                        <td className="px-4 py-4 text-sm text-right font-medium">{(w.gold_weight || 0).toFixed(3)}克</td>
                        <td className="px-4 py-4 text-sm text-gray-600">
                          {w.withdrawal_type === 'self' ? '自取' : '送货'}
                        </td>
                        <td className="px-4 py-4 text-sm text-gray-600">
                          {w.destination_company || '-'}
                        </td>
                        <td className="px-4 py-4 text-sm">
                          {(() => {
                            const statusInfo = WITHDRAWAL_STATUS_MAP[w.status] || { label: w.status, color: '#6b7280' };
                            return (
                              <span
                                className="px-2 py-1 rounded text-xs font-medium"
                                style={{
                                  backgroundColor: `${statusInfo.color}20`,
                                  color: statusInfo.color
                                }}
                              >
                                {statusInfo.label}
                              </span>
                            );
                          })()}
                        </td>
                        <td className="px-4 py-4 text-sm text-gray-600">
                          {new Date(w.created_at).toLocaleString('zh-CN')}
                        </td>
                        <td className="px-4 py-4 text-right">
                          <div className="flex gap-2 justify-end">
                            <button
                              onClick={() => printWithdrawal(w.id)}
                              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                            >
                              打印
                            </button>
                            <button
                              onClick={() => window.open(`${API_ENDPOINTS.API_BASE_URL}/api/gold-material/withdrawals/${w.id}/download?format=html`, '_blank')}
                              className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600"
                            >
                              下载
                            </button>
                            {w.status === 'pending' && hasPermission(userRole, 'canCompleteWithdrawal') && (
                              <button
                                onClick={() => completeWithdrawal(w.id)}
                                className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600"
                              >
                                确认
                              </button>
                            )}
                            {w.status === 'pending' && hasPermission(userRole, 'canCreateWithdrawal') && (
                              <button
                                onClick={() => cancelWithdrawal(w.id)}
                                className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
                              >
                                取消
                              </button>
                            )}
                            {w.status === 'completed' && (hasPermission(userRole, 'canCompleteWithdrawal') || userRole === 'manager') && (
                              <button
                                onClick={() => unconfirmWithdrawal(w.id)}
                                className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600"
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
            )}
          </div>
        )}

        {/* 转料单列表 */}
        {activeTab === 'transfers' && (
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">客户转料单</h2>
              {hasPermission(userRole, 'canCreateTransfer') && (
                <button
                  onClick={() => {
                    setShowTransferModal(true);
                    loadCustomers();
                  }}
                  className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600"
                >
                  + 创建转料单
                </button>
              )}
            </div>
            
            {transfersLoading ? renderLoading() : !Array.isArray(transfers) || transfers.length === 0 ? renderEmpty('暂无转料单') : (
              <div className="overflow-x-auto">
                <table className="min-w-[600px] w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">转料单号</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">转出客户</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">转入客户</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">克重</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">状态</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">创建时间</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">操作</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {transfers.map((t) => (
                      <tr key={t.id} className="hover:bg-gray-50">
                        <td className="px-4 py-4 text-sm font-medium text-gray-900">{t.transfer_no}</td>
                        <td className="px-4 py-4 text-sm text-gray-600">{t.from_customer_name}</td>
                        <td className="px-4 py-4 text-sm text-gray-600">{t.to_customer_name}</td>
                        <td className="px-4 py-4 text-sm text-right font-medium">{(t.gold_weight || 0).toFixed(3)}克</td>
                        <td className="px-4 py-4 text-sm">{renderStatusBadge(t.status)}</td>
                        <td className="px-4 py-4 text-sm text-gray-600">
                          {new Date(t.created_at).toLocaleString('zh-CN')}
                        </td>
                        <td className="px-4 py-4 text-right">
                          <div className="flex gap-2 justify-end">
                            <button
                              onClick={() => printTransfer(t.id)}
                              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                            >
                              打印
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* 创建取料单模态框 */}
        {showWithdrawalModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold">创建取料单</h3>
                <button
                  onClick={() => setShowWithdrawalModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ✕
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">客户 *</label>
                  <select
                    value={withdrawalFormData.customer_id}
                    onChange={(e) => setWithdrawalFormData({ ...withdrawalFormData, customer_id: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value="">请选择客户</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">取料克重 *</label>
                  <input
                    type="number"
                    step="0.01"
                    value={withdrawalFormData.gold_weight}
                    onChange={(e) => setWithdrawalFormData({ ...withdrawalFormData, gold_weight: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    placeholder="请输入取料克重"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">取料方式</label>
                  <select
                    value={withdrawalFormData.withdrawal_type}
                    onChange={(e) => setWithdrawalFormData({ ...withdrawalFormData, withdrawal_type: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value="self">自取</option>
                    <option value="deliver">送到其他公司</option>
                  </select>
                </div>
                {withdrawalFormData.withdrawal_type === 'deliver' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">目的地公司</label>
                      <input
                        type="text"
                        value={withdrawalFormData.destination_company}
                        onChange={(e) => setWithdrawalFormData({ ...withdrawalFormData, destination_company: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg"
                        placeholder="如：古唐、鑫韵"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">目的地地址</label>
                      <input
                        type="text"
                        value={withdrawalFormData.destination_address}
                        onChange={(e) => setWithdrawalFormData({ ...withdrawalFormData, destination_address: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg"
                        placeholder="请输入目的地地址"
                      />
                    </div>
                  </>
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">授权取料人</label>
                  <input
                    type="text"
                    value={withdrawalFormData.authorized_person}
                    onChange={(e) => setWithdrawalFormData({ ...withdrawalFormData, authorized_person: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    placeholder="请输入取料人姓名"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">取料人电话</label>
                  <input
                    type="text"
                    value={withdrawalFormData.authorized_phone}
                    onChange={(e) => setWithdrawalFormData({ ...withdrawalFormData, authorized_phone: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    placeholder="请输入取料人电话"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
                  <textarea
                    value={withdrawalFormData.remark}
                    onChange={(e) => setWithdrawalFormData({ ...withdrawalFormData, remark: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    rows={3}
                    placeholder="可选备注信息"
                  />
                </div>
                <div className="flex gap-2 justify-end pt-2">
                  <button
                    onClick={() => setShowWithdrawalModal(false)}
                    className="px-4 py-2 border rounded-lg hover:bg-gray-50"
                  >
                    取消
                  </button>
                  <button
                    onClick={createWithdrawal}
                    className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                  >
                    创建
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 创建/编辑供应商工费付款登记模态框 */}
        {showCashPaymentModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => { setShowCashPaymentModal(false); setEditingCashPaymentId(null); setCashPaymentPreselectedSupplier(null); }}>
            <div className="bg-white rounded-lg p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold">{editingCashPaymentId ? '编辑付款登记' : '创建付款登记'}</h3>
                <button onClick={() => { setShowCashPaymentModal(false); setEditingCashPaymentId(null); setCashPaymentPreselectedSupplier(null); }} className="text-gray-400 hover:text-gray-600">✕</button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">供应商 *</label>
                  {cashPaymentPreselectedSupplier ? (
                    <div className="px-3 py-2 border rounded-lg bg-gray-50 text-gray-800">{cashPaymentPreselectedSupplier.name}</div>
                  ) : (
                    <select
                      value={cashPaymentForm.supplier_id}
                      onChange={(e) => setCashPaymentForm({ ...cashPaymentForm, supplier_id: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg"
                    >
                      <option value="">请选择供应商</option>
                      {suppliers.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">付款金额 (元) *</label>
                  <input
                    type="number"
                    step="0.01"
                    value={cashPaymentForm.amount}
                    onChange={(e) => setCashPaymentForm({ ...cashPaymentForm, amount: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    placeholder="请输入付款金额"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">付款方式</label>
                  <select
                    value={cashPaymentForm.payment_method}
                    onChange={(e) => setCashPaymentForm({ ...cashPaymentForm, payment_method: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value="bank_transfer">银行转账</option>
                    <option value="cash">现金</option>
                    <option value="check">支票</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
                  <textarea
                    value={cashPaymentForm.remark}
                    onChange={(e) => setCashPaymentForm({ ...cashPaymentForm, remark: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    rows={2}
                    placeholder="可选备注信息"
                  />
                </div>
                <div className="flex gap-2 justify-end pt-2">
                  <button
                    onClick={() => { setShowCashPaymentModal(false); setCashPaymentPreselectedSupplier(null); setEditingCashPaymentId(null); }}
                    className="px-4 py-2 border rounded-lg hover:bg-gray-50"
                  >
                    取消
                  </button>
                  <button
                    onClick={editingCashPaymentId ? updateCashPayment : createCashPayment}
                    className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
                  >
                    {editingCashPaymentId ? '保存' : '创建'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 创建转料单模态框 */}
        {showTransferModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-md">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold">创建转料单</h3>
                <button
                  onClick={() => setShowTransferModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ✕
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">转出客户 *</label>
                  <select
                    value={transferFormData.from_customer_id}
                    onChange={(e) => setTransferFormData({ ...transferFormData, from_customer_id: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value="">请选择转出客户</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">转入客户 *</label>
                  <select
                    value={transferFormData.to_customer_id}
                    onChange={(e) => setTransferFormData({ ...transferFormData, to_customer_id: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value="">请选择转入客户</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">转料克重 *</label>
                  <input
                    type="number"
                    step="0.01"
                    value={transferFormData.gold_weight}
                    onChange={(e) => setTransferFormData({ ...transferFormData, gold_weight: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    placeholder="请输入转料克重"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
                  <textarea
                    value={transferFormData.remark}
                    onChange={(e) => setTransferFormData({ ...transferFormData, remark: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    rows={3}
                    placeholder="可选备注信息"
                  />
                </div>
                <div className="flex gap-2 justify-end pt-2">
                  <button
                    onClick={() => setShowTransferModal(false)}
                    className="px-4 py-2 border rounded-lg hover:bg-gray-50"
                  >
                    取消
                  </button>
                  <button
                    onClick={createTransfer}
                    className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                  >
                    创建
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 金料采购 */}
        {activeTab === 'gold-purchase' && (
          <div className="space-y-6">
            {/* 汇总卡片 */}
            {purchaseSummary && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white rounded-lg shadow-sm p-4">
                  <div className="text-sm text-gray-500">采购总重量</div>
                  <div className="text-xl font-bold text-gray-900">{(purchaseSummary.total_weight ?? 0).toFixed(2)}g</div>
                </div>
                <div className="bg-white rounded-lg shadow-sm p-4">
                  <div className="text-sm text-gray-500">采购总金额</div>
                  <div className="text-xl font-bold text-amber-600">¥{(purchaseSummary.total_amount ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</div>
                </div>
                <div className="bg-white rounded-lg shadow-sm p-4">
                  <div className="text-sm text-gray-500">已付款</div>
                  <div className="text-xl font-bold text-green-600">¥{(purchaseSummary.total_paid ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</div>
                </div>
                <div className="bg-white rounded-lg shadow-sm p-4">
                  <div className="text-sm text-gray-500">未付款</div>
                  <div className="text-xl font-bold text-red-600">¥{(purchaseSummary.total_unpaid ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</div>
                </div>
                <div className="bg-white rounded-lg shadow-sm p-4">
                  <div className="text-sm text-gray-500">待结价</div>
                  <div className="text-xl font-bold text-yellow-600">{purchaseSummary.pending_count ?? 0} 单</div>
                </div>
                <div className="bg-white rounded-lg shadow-sm p-4">
                  <div className="text-sm text-gray-500">已结价</div>
                  <div className="text-xl font-bold text-blue-600">{purchaseSummary.priced_count ?? 0} 单</div>
                </div>
                <div className="bg-white rounded-lg shadow-sm p-4">
                  <div className="text-sm text-gray-500">部分付款</div>
                  <div className="text-xl font-bold text-orange-600">{purchaseSummary.partial_paid_count ?? 0} 单</div>
                </div>
                <div className="bg-white rounded-lg shadow-sm p-4">
                  <div className="text-sm text-gray-500">已结清</div>
                  <div className="text-xl font-bold text-green-600">{purchaseSummary.paid_count ?? 0} 单</div>
                </div>
              </div>
            )}

            {/* 创建采购单 */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold">金料采购单</h2>
                <button
                  onClick={() => setShowPurchaseForm(!showPurchaseForm)}
                  className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600"
                >
                  {showPurchaseForm ? '收起' : '+ 新建采购单'}
                </button>
              </div>

              {showPurchaseForm && (
                <div className="bg-gray-50 rounded-lg p-4 mb-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">供应商名称 *</label>
                    <input
                      type="text"
                      value={purchaseForm.supplier_name}
                      onChange={(e) => setPurchaseForm({ ...purchaseForm, supplier_name: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg"
                      placeholder="请输入供应商名称"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">金重(g) *</label>
                    <input
                      type="number"
                      step="0.01"
                      value={purchaseForm.gold_weight}
                      onChange={(e) => setPurchaseForm({ ...purchaseForm, gold_weight: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg"
                      placeholder="请输入金重"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">成色</label>
                    <select
                      value={purchaseForm.gold_fineness}
                      onChange={(e) => setPurchaseForm({ ...purchaseForm, gold_fineness: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg"
                    >
                      <option value="足金999">足金999</option>
                      <option value="足金9999">足金9999</option>
                      <option value="AU9999">AU9999</option>
                      <option value="AU999">AU999</option>
                      <option value="18K">18K</option>
                      <option value="PT950">PT950</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">折算率</label>
                    <input
                      type="number"
                      step="0.0001"
                      value={purchaseForm.conversion_rate}
                      onChange={(e) => setPurchaseForm({ ...purchaseForm, conversion_rate: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
                    <input
                      type="text"
                      value={purchaseForm.remark}
                      onChange={(e) => setPurchaseForm({ ...purchaseForm, remark: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg"
                      placeholder="可选备注"
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      onClick={createPurchaseOrder}
                      className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                    >
                      创建
                    </button>
                  </div>
                </div>
              )}

              {/* 采购单列表 */}
              {purchaseOrdersLoading ? (
                renderLoading()
              ) : purchaseOrders.length === 0 ? (
                <div className="text-center py-8 text-gray-500">暂无采购单数据</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-gray-600">
                        <th className="px-3 py-3 text-left">单号</th>
                        <th className="px-3 py-3 text-left">供应商</th>
                        <th className="px-3 py-3 text-right">金重(g)</th>
                        <th className="px-3 py-3 text-left">成色</th>
                        <th className="px-3 py-3 text-right">折算率</th>
                        <th className="px-3 py-3 text-right">结算重量(g)</th>
                        <th className="px-3 py-3 text-right">金价(元/g)</th>
                        <th className="px-3 py-3 text-right">金额(元)</th>
                        <th className="px-3 py-3 text-right">已付</th>
                        <th className="px-3 py-3 text-right">未付</th>
                        <th className="px-3 py-3 text-center">状态</th>
                        <th className="px-3 py-3 text-left">创建时间</th>
                        <th className="px-3 py-3 text-center">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {purchaseOrders.map((order) => {
                        const statusMap: Record<string, { label: string; className: string }> = {
                          pending: { label: '待结价', className: 'bg-yellow-100 text-yellow-700' },
                          priced: { label: '已结价', className: 'bg-blue-100 text-blue-700' },
                          partial_paid: { label: '部分付款', className: 'bg-orange-100 text-orange-700' },
                          paid: { label: '已结清', className: 'bg-green-100 text-green-700' },
                          cancelled: { label: '已取消', className: 'bg-gray-100 text-gray-500' },
                        };
                        const si = statusMap[order.status] || { label: order.status, className: 'bg-gray-100 text-gray-600' };

                        return (
                          <tr key={order.id} className="hover:bg-gray-50">
                            <td className="px-3 py-3 font-mono text-xs">{order.order_no}</td>
                            <td className="px-3 py-3">{order.supplier_name}</td>
                            <td className="px-3 py-3 text-right">{(order.gold_weight ?? 0).toFixed(2)}</td>
                            <td className="px-3 py-3">{order.gold_fineness}</td>
                            <td className="px-3 py-3 text-right">{(order.conversion_rate ?? 1).toFixed(4)}</td>
                            <td className="px-3 py-3 text-right">{order.settled_weight != null ? order.settled_weight.toFixed(2) : '-'}</td>
                            <td className="px-3 py-3 text-right">{order.gold_price != null ? `¥${order.gold_price.toFixed(2)}` : '-'}</td>
                            <td className="px-3 py-3 text-right font-medium">{order.total_amount != null ? `¥${order.total_amount.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}` : '-'}</td>
                            <td className="px-3 py-3 text-right text-green-600">{order.paid_amount > 0 ? `¥${order.paid_amount.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}` : '-'}</td>
                            <td className="px-3 py-3 text-right text-red-600">{order.unpaid_amount != null && order.unpaid_amount > 0 ? `¥${order.unpaid_amount.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}` : '-'}</td>
                            <td className="px-3 py-3 text-center">
                              <span className={`px-2 py-1 rounded text-xs font-medium ${si.className}`}>{si.label}</span>
                            </td>
                            <td className="px-3 py-3 text-xs text-gray-500">{order.create_time ? new Date(order.create_time).toLocaleDateString('zh-CN') : '-'}</td>
                            <td className="px-3 py-3">
                              <div className="flex gap-1 justify-center flex-wrap">
                                {order.status === 'pending' && (
                                  <>
                                    <button
                                      onClick={() => { setPricingOrderId(order.id); setPricingGoldPrice(''); }}
                                      className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
                                    >
                                      结价
                                    </button>
                                    <button
                                      onClick={() => cancelPurchaseOrder(order.id)}
                                      className="px-2 py-1 text-xs bg-gray-400 text-white rounded hover:bg-gray-500"
                                    >
                                      取消
                                    </button>
                                    <button
                                      onClick={() => deletePurchaseOrder(order.id)}
                                      className="px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600"
                                    >
                                      删除
                                    </button>
                                  </>
                                )}
                                {order.status === 'priced' && (
                                  <>
                                    <button
                                      onClick={() => { setPayingOrderId(order.id); setPaymentForm({ payment_amount: '', payment_method: 'transfer', remark: '' }); }}
                                      className="px-2 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600"
                                    >
                                      付款
                                    </button>
                                    <button
                                      onClick={() => unpricePurchaseOrder(order.id)}
                                      className="px-2 py-1 text-xs bg-yellow-500 text-white rounded hover:bg-yellow-600"
                                    >
                                      撤销结价
                                    </button>
                                  </>
                                )}
                                {order.status === 'partial_paid' && (
                                  <button
                                    onClick={() => { setPayingOrderId(order.id); setPaymentForm({ payment_amount: '', payment_method: 'transfer', remark: '' }); }}
                                    className="px-2 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600"
                                  >
                                    继续付款
                                  </button>
                                )}
                              </div>
                              {/* 付款记录展开 */}
                              {order.payments && order.payments.length > 0 && (
                                <details className="mt-1">
                                  <summary className="text-xs text-blue-500 cursor-pointer">付款记录 ({order.payments.length})</summary>
                                  <ul className="mt-1 space-y-1">
                                    {order.payments.map((p) => (
                                      <li key={p.id} className="text-xs text-gray-500">
                                        {p.payment_no} | ¥{p.payment_amount.toLocaleString('zh-CN', { minimumFractionDigits: 2 })} | {p.payment_method === 'transfer' ? '转账' : p.payment_method === 'cash' ? '现金' : p.payment_method} | {p.create_time ? new Date(p.create_time).toLocaleDateString('zh-CN') : ''}
                                      </li>
                                    ))}
                                  </ul>
                                </details>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* 定价弹窗 */}
            {pricingOrderId && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
                  <h3 className="text-lg font-semibold mb-4">金料结价</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">金价 (元/克) *</label>
                      <input
                        type="number"
                        step="0.01"
                        value={pricingGoldPrice}
                        onChange={(e) => setPricingGoldPrice(e.target.value)}
                        className="w-full px-3 py-2 border rounded-lg"
                        placeholder="请输入当日金价"
                        autoFocus
                      />
                    </div>
                    {(() => {
                      const order = purchaseOrders.find(o => o.id === pricingOrderId);
                      if (!order) return null;
                      const settledWeight = order.gold_weight * (order.conversion_rate || 1);
                      const price = parseFloat(pricingGoldPrice) || 0;
                      return (
                        <div className="bg-gray-50 rounded p-3 text-sm space-y-1">
                          <div className="flex justify-between"><span className="text-gray-500">金重</span><span>{order.gold_weight.toFixed(2)}g</span></div>
                          <div className="flex justify-between"><span className="text-gray-500">折算率</span><span>{(order.conversion_rate ?? 1).toFixed(4)}</span></div>
                          <div className="flex justify-between"><span className="text-gray-500">结算重量</span><span>{settledWeight.toFixed(2)}g</span></div>
                          {price > 0 && (
                            <div className="flex justify-between font-medium text-amber-700 border-t pt-1">
                              <span>预计金额</span><span>¥{(settledWeight * price).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</span>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    <div className="flex gap-2 justify-end pt-2">
                      <button
                        onClick={() => { setPricingOrderId(null); setPricingGoldPrice(''); }}
                        className="px-4 py-2 border rounded-lg hover:bg-gray-50"
                      >
                        取消
                      </button>
                      <button
                        onClick={() => pricePurchaseOrder(pricingOrderId)}
                        className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                      >
                        确认结价
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 付款弹窗 */}
            {payingOrderId && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
                  <h3 className="text-lg font-semibold mb-4">采购付款</h3>
                  {(() => {
                    const order = purchaseOrders.find(o => o.id === payingOrderId);
                    if (!order) return null;
                    return (
                      <div className="bg-gray-50 rounded p-3 text-sm space-y-1 mb-4">
                        <div className="flex justify-between"><span className="text-gray-500">单号</span><span>{order.order_no}</span></div>
                        <div className="flex justify-between"><span className="text-gray-500">供应商</span><span>{order.supplier_name}</span></div>
                        <div className="flex justify-between"><span className="text-gray-500">总金额</span><span>¥{(order.total_amount ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</span></div>
                        <div className="flex justify-between"><span className="text-gray-500">已付</span><span className="text-green-600">¥{(order.paid_amount ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</span></div>
                        <div className="flex justify-between font-medium text-red-600 border-t pt-1">
                          <span>待付</span><span>¥{(order.unpaid_amount ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</span>
                        </div>
                      </div>
                    );
                  })()}
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">付款金额 *</label>
                      <input
                        type="number"
                        step="0.01"
                        value={paymentForm.payment_amount}
                        onChange={(e) => setPaymentForm({ ...paymentForm, payment_amount: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg"
                        placeholder="请输入付款金额"
                        autoFocus
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">付款方式</label>
                      <select
                        value={paymentForm.payment_method}
                        onChange={(e) => setPaymentForm({ ...paymentForm, payment_method: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg"
                      >
                        <option value="transfer">银行转账</option>
                        <option value="cash">现金</option>
                        <option value="gold_offset">金料抵扣</option>
                        <option value="other">其他</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
                      <input
                        type="text"
                        value={paymentForm.remark}
                        onChange={(e) => setPaymentForm({ ...paymentForm, remark: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg"
                        placeholder="可选备注"
                      />
                    </div>
                    <div className="flex gap-2 justify-end pt-2">
                      <button
                        onClick={() => { setPayingOrderId(null); setPaymentForm({ payment_amount: '', payment_method: 'transfer', remark: '' }); }}
                        className="px-4 py-2 border rounded-lg hover:bg-gray-50"
                      >
                        取消
                      </button>
                      <button
                        onClick={() => payPurchaseOrder(payingOrderId)}
                        className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600"
                      >
                        确认付款
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
