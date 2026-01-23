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
  pending: { label: '待取料', color: '#f59e0b' },
  completed: { label: '已取', color: '#10b981' },
  cancelled: { label: '已取消', color: '#6b7280' },
};

const INITIAL_PAYMENT_FORM = {
  supplier_id: '',
  gold_weight: '',
  remark: ''
};

// ==================== 组件 ====================

export default function GoldMaterialPage({ userRole }: GoldMaterialPageProps) {
  const [activeTab, setActiveTab] = useState<'ledger' | 'receipts' | 'payments' | 'balance' | 'withdrawals' | 'transfers' | 'daily-summary' | 'supplier-debt'>('ledger');
  
  // 台账数据
  const [ledger, setLedger] = useState<LedgerDay[]>([]);
  
  // 待接收收料单（新系统）
  const [pendingGoldReceipts, setPendingGoldReceipts] = useState<any[]>([]);
  const [loadingGoldReceipts, setLoadingGoldReceipts] = useState(false);

  // 每日统计
  const [summaryPeriod, setSummaryPeriod] = useState<'today' | 'week' | 'month'>('today');
  const [summaryData, setSummaryData] = useState<any>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [ledgerStartDate, setLedgerStartDate] = useState('');
  const [ledgerEndDate, setLedgerEndDate] = useState('');
  const [ledgerLoading, setLedgerLoading] = useState(false);
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
    summary: { total_inbound_weight: number; total_paid_weight: number; total_debt_weight: number; supplier_count: number };
    suppliers: Array<{ supplier_id: number; supplier_name: string; supplier_no: string; inbound_weight: number; paid_weight: number; debt_weight: number }>;
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
        setPendingGoldReceipts(result.data || []);
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
      const response = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/gold-material/gold-receipts/${receiptId}/receive?received_by=料部专员`, {
        method: 'POST'
      });
      
      if (response.ok) {
        toast.success('金料接收确认成功');
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

  // 加载每日统计
  const loadDailySummary = useCallback(async (period: 'today' | 'week' | 'month' = 'today') => {
    setLoadingSummary(true);
    try {
      const response = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/gold-material/daily-summary?period=${period}`);
      if (response.ok) {
        const result = await response.json();
        setSummaryData(result);
      }
    } catch (error) {
      console.error('加载每日统计失败:', error);
    } finally {
      setLoadingSummary(false);
    }
  }, []);

  const loadLedger = useCallback(async () => {
    setLedgerLoading(true);
    const params = buildQueryString({
      start_date: ledgerStartDate,
      end_date: ledgerEndDate,
      user_role: userRole
    });
    
    const data = await apiGet<{ ledger: LedgerDay[] }>(
      `/api/gold-material/ledger?${params}`,
      { showErrorToast: true }
    );
    
    if (data) {
      setLedger(data.ledger || []);
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
      '/api/suppliers',
      { showErrorToast: false }
    );
    
    if (data) {
      setSuppliers(data.suppliers || []);
    }
  }, []);

  // 加载客户列表
  const loadCustomers = useCallback(async () => {
    const data = await apiGet<{ customers: Customer[] }>(
      '/api/customers',
      { showErrorToast: false }
    );
    
    if (data) {
      setCustomers(data.customers || []);
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
      setWithdrawals(data.withdrawals || []);
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
      summary: { total_inbound_weight: number; total_paid_weight: number; total_debt_weight: number; supplier_count: number };
      suppliers: Array<{ supplier_id: number; supplier_name: string; supplier_no: string; inbound_weight: number; paid_weight: number; debt_weight: number }>;
    }>(
      `/api/suppliers/debt-summary?user_role=${userRole}`,
      { showErrorToast: false }
    );
    
    if (data?.success) {
      setSupplierDebt({ summary: data.summary, suppliers: data.suppliers });
    }
    setSupplierDebtLoading(false);
  }, [userRole]);

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
        setDailyTransactions(data.data);
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
        setSupplierDetail(data.data);
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
      toast.success('取料单创建成功');
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

  // 完成取料单（料部）
  const completeWithdrawal = async (withdrawalId: number) => {
    const data = await apiPost(
      `/api/gold-material/withdrawals/${withdrawalId}/complete?user_role=${userRole}`,
      { completed_by: userRole === 'material' ? '料部' : '管理' },
      { showErrorToast: true }
    );
    
    if (data) {
      toast.success('取料单已完成');
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
      `/api/gold-material/withdrawals/${withdrawalId}/cancel?user_role=${userRole}`,
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
    }
    // 料部只需要加载取料单（用于待发取料）
    if (userRole === 'material') {
      loadCustomers();
      loadWithdrawals();
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
    }
  }, [userRole, loadPendingGoldReceipts, loadPayments, loadBalance, loadSuppliers, loadSupplierDebt, loadCustomers, loadWithdrawals, loadTransfers]);

  // 初始化后加载台账（需要等日期设置完成）
  useEffect(() => {
    if (ledgerStartDate && ledgerEndDate && userRole === 'material') {
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
    } else if (activeTab === 'daily-summary') {
      loadDailySummary(summaryPeriod);
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
        `${API_ENDPOINTS.API_BASE_URL}/api/gold-material/gold-receipts/${receiptId}/receive?received_by=${userRole === 'material' ? '料部' : '系统'}`,
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
                  {renderTabButton('daily-summary', '每日统计')}
                  {renderTabButton('receipts', '收料单管理', (Array.isArray(pendingGoldReceipts) ? pendingGoldReceipts : []).filter((r: any) => r && r.status === 'pending').length)}
                  {renderTabButton('payments', '付料单')}
                  {renderTabButton('withdrawals', '待取料', (Array.isArray(withdrawals) ? withdrawals : []).filter(w => w && w.status === 'pending').length)}
                  {renderTabButton('supplier-debt', '供应商欠料')}
                  {renderTabButton('balance', '金料库存')}
                </>
              )}
              {userRole === 'settlement' && (
                <>
                  {renderTabButton('receipts', '收料单')}
                  {renderTabButton('withdrawals', '取料单')}
                  {renderTabButton('transfers', '转料单')}
                </>
              )}
              {userRole === 'manager' && (
                <>
                  {renderTabButton('ledger', '金料台账')}
                  {renderTabButton('daily-summary', '每日统计')}
                  {renderTabButton('receipts', '收料单')}
                  {renderTabButton('payments', '付料单')}
                  {renderTabButton('withdrawals', '取料单')}
                  {renderTabButton('transfers', '转料单')}
                  {renderTabButton('balance', '金料库存')}
                </>
              )}
            </nav>
          </div>
        </div>

        {/* 每日统计 */}
        {activeTab === 'daily-summary' && (userRole === 'material' || userRole === 'manager') && (
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-semibold">金料每日统计</h2>
              <div className="flex items-center gap-2">
                {/* 时间范围切换 */}
                <div className="flex bg-gray-100 rounded-lg p-1">
                  {[
                    { value: 'today', label: '今日' },
                    { value: 'week', label: '本周' },
                    { value: 'month', label: '本月' }
                  ].map(item => (
                    <button
                      key={item.value}
                      onClick={() => {
                        setSummaryPeriod(item.value as 'today' | 'week' | 'month');
                        loadDailySummary(item.value as 'today' | 'week' | 'month');
                      }}
                      className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                        summaryPeriod === item.value
                          ? 'bg-white text-amber-700 shadow-sm'
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => loadDailySummary(summaryPeriod)}
                  className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  刷新
                </button>
              </div>
            </div>

            {loadingSummary ? renderLoading() : !summaryData ? (
              <div className="text-center py-12 text-gray-500">暂无数据</div>
            ) : (
              <div className="space-y-6">
                {/* 日期范围提示 */}
                <div className="text-sm text-gray-500 text-center">
                  统计周期：{summaryData.date_range?.start} 至 {summaryData.date_range?.end}
                </div>

                {/* 统计卡片 */}
                <div className="grid grid-cols-2 gap-6">
                  {/* 收料汇总 */}
                  <div className="bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200 rounded-xl p-5">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 bg-green-500 rounded-lg flex items-center justify-center">
                        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                      </div>
                      <div>
                        <div className="text-sm text-gray-600">收料统计</div>
                        <div className="text-2xl font-bold text-green-700">
                          {summaryData.receipt_summary?.total_weight?.toFixed(2) || 0} 克
                        </div>
                      </div>
                    </div>
                    <div className="text-sm text-gray-500 mb-3">
                      共 {summaryData.receipt_summary?.total_count || 0} 笔收料
                    </div>
                    {/* 客户汇总 */}
                    {summaryData.receipt_summary?.by_customer?.length > 0 && (
                      <div className="border-t border-green-200 pt-3 space-y-2">
                        <div className="text-xs text-gray-500 font-medium">客户明细</div>
                        {summaryData.receipt_summary.by_customer.map((item: any) => (
                          <div key={item.customer_id} className="flex justify-between text-sm">
                            <span className="text-gray-700">{item.customer_name}</span>
                            <span className="font-medium text-green-600">{item.total_weight?.toFixed(2)} 克 ({item.count}笔)</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* 每笔收料明细 */}
                    {summaryData.receipt_summary?.receipts?.length > 0 && (
                      <div className="border-t border-green-200 pt-3 mt-3 space-y-2">
                        <div className="text-xs text-gray-500 font-medium">收料明细</div>
                        {summaryData.receipt_summary.receipts.map((receipt: any) => (
                          <div key={receipt.id} className="flex justify-between items-center text-sm bg-green-50 rounded-lg px-3 py-2">
                            <div className="flex items-center gap-2">
                              <span className="text-gray-500 text-xs">
                                {receipt.created_at ? new Date(receipt.created_at).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) : '-'}
                              </span>
                              <span className="text-gray-700">{receipt.customer_name}</span>
                              {receipt.gold_fineness && (
                                <span className="text-xs text-yellow-600 bg-yellow-100 px-1.5 py-0.5 rounded">{receipt.gold_fineness}</span>
                              )}
                            </div>
                            <span className="font-medium text-green-600">{receipt.gold_weight?.toFixed(2)} 克</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* 付料汇总 */}
                  <div className="bg-gradient-to-br from-orange-50 to-amber-50 border border-orange-200 rounded-xl p-5">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 bg-orange-500 rounded-lg flex items-center justify-center">
                        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                        </svg>
                      </div>
                      <div>
                        <div className="text-sm text-gray-600">付料统计</div>
                        <div className="text-2xl font-bold text-orange-700">
                          {summaryData.payment_summary?.total_weight?.toFixed(2) || 0} 克
                        </div>
                      </div>
                    </div>
                    <div className="text-sm text-gray-500 mb-3">
                      共 {summaryData.payment_summary?.total_count || 0} 笔付料
                    </div>
                    {/* 付料明细 */}
                    {summaryData.payment_summary?.by_supplier?.length > 0 && (
                      <div className="border-t border-orange-200 pt-3 space-y-2">
                        <div className="text-xs text-gray-500 font-medium">供应商明细</div>
                        {summaryData.payment_summary.by_supplier.map((item: any) => (
                          <div key={item.supplier_id || 'unknown'} className="flex justify-between text-sm">
                            <span className="text-gray-700">{item.supplier_name}</span>
                            <span className="font-medium text-orange-600">{item.total_weight?.toFixed(2)} 克 ({item.count}笔)</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* 客户提料汇总 */}
                <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-5 mt-4">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 bg-blue-500 rounded-lg flex items-center justify-center">
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11l5-5m0 0l5 5m-5-5v12" />
                      </svg>
                    </div>
                    <div>
                      <div className="text-sm text-gray-600">客户提料统计</div>
                      <div className="text-2xl font-bold text-blue-700">
                        {summaryData.withdrawal_summary?.total_weight?.toFixed(2) || 0} 克
                      </div>
                    </div>
                  </div>
                  <div className="text-sm text-gray-500 mb-3">
                    共 {summaryData.withdrawal_summary?.total_count || 0} 笔提料
                  </div>
                  {/* 客户汇总 */}
                  {summaryData.withdrawal_summary?.by_customer?.length > 0 && (
                    <div className="border-t border-blue-200 pt-3 space-y-2">
                      <div className="text-xs text-gray-500 font-medium">客户明细</div>
                      {summaryData.withdrawal_summary.by_customer.map((item: any) => (
                        <div key={item.customer_id} className="flex justify-between text-sm">
                          <span className="text-gray-700">{item.customer_name}</span>
                          <span className="font-medium text-blue-600">{item.total_weight?.toFixed(2)} 克 ({item.count}笔)</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* 每笔提料明细 */}
                  {summaryData.withdrawal_summary?.withdrawals?.length > 0 && (
                    <div className="border-t border-blue-200 pt-3 mt-3 space-y-2">
                      <div className="text-xs text-gray-500 font-medium">提料明细</div>
                      {summaryData.withdrawal_summary.withdrawals.map((w: any) => (
                        <div key={w.id} className="flex justify-between items-center text-sm bg-blue-50 rounded-lg px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span className="text-gray-500 text-xs">
                              {w.created_at ? new Date(w.created_at).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) : '-'}
                            </span>
                            <span className="text-gray-700">{w.customer_name}</span>
                            <span className={`text-xs px-1.5 py-0.5 rounded ${
                              w.status === 'completed' ? 'text-green-600 bg-green-100' : 'text-yellow-600 bg-yellow-100'
                            }`}>
                              {w.status === 'completed' ? '已取' : '待取'}
                            </span>
                          </div>
                          <span className="font-medium text-blue-600">{w.gold_weight?.toFixed(2)} 克</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 净收入/支出 */}
                <div className="bg-gray-50 rounded-xl p-4 text-center">
                  <div className="text-sm text-gray-500 mb-1">净收入</div>
                  <div className={`text-3xl font-bold ${
                    (summaryData.receipt_summary?.total_weight || 0) - (summaryData.payment_summary?.total_weight || 0) >= 0
                      ? 'text-green-600'
                      : 'text-red-600'
                  }`}>
                    {((summaryData.receipt_summary?.total_weight || 0) - (summaryData.payment_summary?.total_weight || 0)).toFixed(2)} 克
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 金料台账 */}
        {activeTab === 'ledger' && (userRole === 'material' || userRole === 'manager') && (
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">每日金料进出台账</h2>
              <div className="flex gap-4">
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={ledgerStartDate}
                    onChange={(e) => setLedgerStartDate(e.target.value)}
                    className="px-3 py-2 border rounded-lg"
                  />
                  <span className="self-center">至</span>
                  <input
                    type="date"
                    value={ledgerEndDate}
                    onChange={(e) => setLedgerEndDate(e.target.value)}
                    className="px-3 py-2 border rounded-lg"
                  />
                  <button
                    onClick={loadLedger}
                    className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                  >
                    查询
                  </button>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => exportLedger('excel')}
                    className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600"
                  >
                    导出Excel
                  </button>
                  <button
                    onClick={() => exportLedger('pdf')}
                    className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
                  >
                    导出PDF
                  </button>
                </div>
              </div>
            </div>

            {ledgerLoading ? renderLoading() : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">日期</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">收入（克）</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">支出（克）</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">净额（克）</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {ledger.map((day) => {
                      const isExpanded = expandedDates.has(day.date);
                      const hasTransactions = day.transactions && day.transactions.length > 0;
                      return (
                        <React.Fragment key={day.date}>
                          <tr 
                            className={`hover:bg-gray-50 ${hasTransactions ? 'cursor-pointer' : ''}`}
                            onClick={() => {
                              if (hasTransactions) {
                                setExpandedDates(prev => {
                                  const next = new Set(prev);
                                  if (next.has(day.date)) {
                                    next.delete(day.date);
                                  } else {
                                    next.add(day.date);
                                  }
                                  return next;
                                });
                              }
                            }}
                          >
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                              <div className="flex items-center gap-2">
                                {hasTransactions && (
                                  <span className={`text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                                )}
                                {day.date}
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">{day.income.toFixed(2)}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">{day.expense.toFixed(2)}</td>
                            <td className={`px-6 py-4 whitespace-nowrap text-sm text-right font-medium ${
                              day.net >= 0 ? 'text-green-600' : 'text-red-600'
                            }`}>
                              {day.net.toFixed(2)}
                            </td>
                          </tr>
                          {/* 展开的交易明细 */}
                          {isExpanded && day.transactions?.map((tx, idx) => (
                            <tr key={`${day.date}-${tx.id || idx}`} className="bg-gray-50">
                              <td className="px-6 py-3 whitespace-nowrap text-sm text-gray-600" colSpan={1}>
                                <div className="flex items-center gap-2 pl-8">
                                  <span className="text-gray-300">└─</span>
                                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                    tx.transaction_type === 'income' 
                                      ? 'bg-green-100 text-green-700' 
                                      : 'bg-orange-100 text-orange-700'
                                  }`}>
                                    {tx.transaction_type === 'income' ? '收料' : '付料'}
                                  </span>
                                  <span className="text-gray-700">{tx.customer_name || tx.supplier_name || '-'}</span>
                                </div>
                              </td>
                              <td className="px-6 py-3 whitespace-nowrap text-sm text-right text-green-600">
                                {tx.transaction_type === 'income' ? tx.gold_weight?.toFixed(2) : '-'}
                              </td>
                              <td className="px-6 py-3 whitespace-nowrap text-sm text-right text-orange-600">
                                {tx.transaction_type === 'expense' ? tx.gold_weight?.toFixed(2) : '-'}
                              </td>
                              <td className="px-6 py-3 whitespace-nowrap text-sm text-right text-gray-400">
                                {tx.confirmed_at ? new Date(tx.confirmed_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '-'}
                              </td>
                            </tr>
                          ))}
                        </React.Fragment>
                      );
                    })}
                    {ledger.length === 0 && renderEmpty(4)}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* 收料单列表 - 统一使用新系统 /gold-receipts API */}
        {activeTab === 'receipts' && (
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">
                {userRole === 'material' ? '待确认收料单' : '收料单列表'}
              </h2>
              <button
                onClick={() => loadPendingGoldReceipts()}
                className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
              >
                刷新
              </button>
            </div>

            {/* 所有角色统一使用新系统收料单 */}
            {loadingGoldReceipts ? renderLoading() : (
              pendingGoldReceipts.length === 0 ? (
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
                              {receipt.status === 'pending' ? '待接收' : '已接收'}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-4 text-sm text-gray-600">
                            <div>客户：{receipt.customer_name || '-'}</div>
                            <div>关联结算单：{receipt.settlement_no || '无'}</div>
                            <div className="text-amber-700 font-medium">金料克重：{receipt.gold_weight?.toFixed(2) || 0} 克</div>
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
                          {/* 料部可以确认接收待接收的收料单 */}
                          {userRole === 'material' && receipt.status === 'pending' && (
                            <button
                              onClick={() => handleReceiveGold(receipt.id)}
                              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm"
                            >
                              确认接收
                            </button>
                          )}
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

            {paymentsLoading ? renderLoading() : (
              <div className="space-y-4">
                {payments.map((payment) => (
                  <div key={payment.id} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center gap-4 mb-2">
                          <span className="font-semibold text-lg">付料单号：{payment.transaction_no}</span>
                          {renderStatusBadge(payment.status)}
                        </div>
                        <div className="grid grid-cols-2 gap-4 text-sm text-gray-600">
                          <div>供应商：{payment.supplier_name || '-'}</div>
                          <div>金料重量：{payment.gold_weight.toFixed(2)} 克</div>
                          <div>创建时间：{new Date(payment.created_at).toLocaleString('zh-CN')}</div>
                        </div>
                      </div>
                      {renderActionButtons(payment.id, 'payment')}
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
                  <span className="font-semibold text-amber-600">{initialBalance.initial.gold_weight.toFixed(2)} 克</span>
                  <span className="mx-2">|</span>
                  <span>单号: {initialBalance.initial.transaction_no}</span>
                  <span className="mx-2">|</span>
                  <span>{initialBalance.initial.remark}</span>
                </div>
              </div>
            )}
            
            {balanceLoading ? renderLoading() : balance ? (
              <div className="grid grid-cols-3 gap-6">
                <div className="bg-blue-50 rounded-lg p-6">
                  <div className="text-sm text-gray-600 mb-2">累计收入（含期初）</div>
                  <div className="text-2xl font-bold text-blue-600">{balance.total_income.toFixed(2)} 克</div>
                </div>
                <div className="bg-red-50 rounded-lg p-6">
                  <div className="text-sm text-gray-600 mb-2">累计支出</div>
                  <div className="text-2xl font-bold text-red-600">{balance.total_expense.toFixed(2)} 克</div>
                </div>
                <div className="bg-green-50 rounded-lg p-6">
                  <div className="text-sm text-gray-600 mb-2">当前余额</div>
                  <div className="text-2xl font-bold text-green-600">{balance.current_balance.toFixed(2)} 克</div>
                </div>
              </div>
            ) : renderEmpty()}
          </div>
        )}

        {/* 供应商欠料统计 */}
        {activeTab === 'supplier-debt' && userRole === 'material' && (
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-semibold">供应商欠料统计</h2>
              <div className="flex gap-2">
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
              <div className="grid grid-cols-4 gap-4 mb-6">
                <div className="bg-blue-50 rounded-lg p-4">
                  <div className="text-sm text-gray-600 mb-1">入库总重量</div>
                  <div className="text-xl font-bold text-blue-600">{supplierDebt.summary.total_inbound_weight.toFixed(2)} 克</div>
                </div>
                <div className="bg-green-50 rounded-lg p-4">
                  <div className="text-sm text-gray-600 mb-1">已付料总重量</div>
                  <div className="text-xl font-bold text-green-600">{supplierDebt.summary.total_paid_weight.toFixed(2)} 克</div>
                </div>
                <div className="bg-red-50 rounded-lg p-4">
                  <div className="text-sm text-gray-600 mb-1">欠料总重量</div>
                  <div className="text-xl font-bold text-red-600">{supplierDebt.summary.total_debt_weight.toFixed(2)} 克</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="text-sm text-gray-600 mb-1">供应商数量</div>
                  <div className="text-xl font-bold text-gray-700">{supplierDebt.summary.supplier_count} 家</div>
                </div>
              </div>
            )}
            
            {/* 可视化图表 */}
            {dailyTransactions && dailyTransactions.daily_summary && dailyTransactions.daily_summary.length > 0 && (
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
                ) : dailyTransactions && dailyTransactions.daily_summary && dailyTransactions.daily_summary.length > 0 ? (
                  <div className="overflow-x-auto border rounded-lg">
                    <table className="w-full text-sm">
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
                            <td className="px-4 py-3 text-right text-blue-600">{day.total_inbound.toFixed(2)}</td>
                            <td className="px-4 py-3 text-right text-green-600">{day.total_paid.toFixed(2)}</td>
                            <td className="px-4 py-3 text-right font-semibold">
                              <span className={day.net_change > 0 ? 'text-red-600' : day.net_change < 0 ? 'text-green-600' : 'text-gray-600'}>
                                {day.net_change > 0 ? '+' : ''}{day.net_change.toFixed(2)}
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
            
            {/* 供应商欠料列表 */}
            {supplierDebtLoading ? renderLoading() : supplierDebt && supplierDebt.suppliers.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-gray-600">供应商</th>
                      <th className="px-4 py-3 text-right font-medium text-gray-600">入库重量 (克)</th>
                      <th className="px-4 py-3 text-right font-medium text-gray-600">已付料 (克)</th>
                      <th className="px-4 py-3 text-right font-medium text-gray-600">欠料 (克)</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-600">状态</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-600">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {supplierDebt.suppliers.map((s) => (
                      <tr key={s.supplier_id} className="hover:bg-gray-50 cursor-pointer">
                        <td className="px-4 py-3" onClick={() => openSupplierDetail(s.supplier_id)}>
                          <div className="font-medium text-gray-900">{s.supplier_name}</div>
                          <div className="text-xs text-gray-500">{s.supplier_no}</div>
                        </td>
                        <td className="px-4 py-3 text-right text-blue-600">{s.inbound_weight.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right text-green-600">{s.paid_weight.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right font-semibold">
                          <span className={s.debt_weight > 0 ? 'text-red-600' : s.debt_weight < 0 ? 'text-green-600' : 'text-gray-600'}>
                            {s.debt_weight > 0 ? '+' : ''}{s.debt_weight.toFixed(2)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {s.debt_weight > 0 ? (
                            <span className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded-full">欠料</span>
                          ) : s.debt_weight < 0 ? (
                            <span className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded-full">多付</span>
                          ) : (
                            <span className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded-full">结清</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => openSupplierDetail(s.supplier_id)}
                            className="px-3 py-1 text-xs bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                          >
                            查看详情
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : renderEmpty()}
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
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <div className="text-sm text-gray-600">供应商名称</div>
                        <div className="font-medium">{supplierDetail.account.supplier_name}</div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-600">当前欠料</div>
                        <div className={`font-medium ${supplierDetail.account.current_balance > 0 ? 'text-red-600' : supplierDetail.account.current_balance < 0 ? 'text-green-600' : 'text-gray-600'}`}>
                          {supplierDetail.account.current_balance > 0 ? '+' : ''}{supplierDetail.account.current_balance.toFixed(2)} 克
                        </div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-600">状态</div>
                        <div className="font-medium">{supplierDetail.account.status_text}</div>
                      </div>
                    </div>
                  </div>
                  
                  {/* 交易记录 */}
                  <div>
                    <h4 className="font-semibold mb-4">交易记录</h4>
                    {supplierDetail.transactions && supplierDetail.transactions.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-4 py-3 text-left font-medium text-gray-600">日期</th>
                              <th className="px-4 py-3 text-left font-medium text-gray-600">类型</th>
                              <th className="px-4 py-3 text-right font-medium text-gray-600">重量 (克)</th>
                              <th className="px-4 py-3 text-right font-medium text-gray-600">余额变化</th>
                              <th className="px-4 py-3 text-left font-medium text-gray-600">关联单号</th>
                              <th className="px-4 py-3 text-left font-medium text-gray-600">备注</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {supplierDetail.transactions.map((tx: any, idx: number) => (
                              <tr key={idx} className="hover:bg-gray-50">
                                <td className="px-4 py-3">
                                  {tx.created_at ? new Date(tx.created_at).toLocaleString('zh-CN') : '-'}
                                </td>
                                <td className="px-4 py-3">
                                  <span className={`px-2 py-1 text-xs rounded-full ${
                                    tx.transaction_type === 'receive' 
                                      ? 'bg-blue-100 text-blue-700' 
                                      : 'bg-green-100 text-green-700'
                                  }`}>
                                    {tx.transaction_type_text}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-right font-medium">
                                  <span className={tx.transaction_type === 'receive' ? 'text-blue-600' : 'text-green-600'}>
                                    {tx.transaction_type === 'receive' ? '+' : '-'}{tx.gold_weight.toFixed(2)}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-right">
                                  <div className="text-xs text-gray-500">
                                    {tx.balance_before.toFixed(2)} → {tx.balance_after.toFixed(2)}
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-xs text-gray-600">
                                  {tx.inbound_order_id ? `入库单#${tx.inbound_order_id}` : 
                                   tx.payment_transaction_id ? `付料单#${tx.payment_transaction_id}` : '-'}
                                </td>
                                <td className="px-4 py-3 text-xs text-gray-600">
                                  {tx.remark || '-'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="text-center py-8 text-gray-500">暂无交易记录</div>
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
            
            {withdrawalsLoading ? renderLoading() : withdrawals.length === 0 ? renderEmpty('暂无取料单') : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
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
                        <td className="px-4 py-4 text-sm text-right font-medium">{w.gold_weight.toFixed(2)}克</td>
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
                                确认已取
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
            
            {transfersLoading ? renderLoading() : transfers.length === 0 ? renderEmpty('暂无转料单') : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
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
                        <td className="px-4 py-4 text-sm text-right font-medium">{t.gold_weight.toFixed(2)}克</td>
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
      </div>
    </div>
  );
}
