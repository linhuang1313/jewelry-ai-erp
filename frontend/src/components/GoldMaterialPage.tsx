import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { API_ENDPOINTS } from '../config';
import { hasPermission } from '../config/permissions';
import { apiGet, apiPost, buildQueryString, openDownloadUrl } from '../utils/api';

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

interface InboundOrder {
  id: number;
  order_no: string;
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

const INITIAL_PAYMENT_FORM = {
  supplier_id: '',
  inbound_order_id: '',
  gold_weight: '',
  remark: ''
};

// ==================== 组件 ====================

export default function GoldMaterialPage({ userRole }: GoldMaterialPageProps) {
  const [activeTab, setActiveTab] = useState<'ledger' | 'receipts' | 'payments' | 'balance' | 'withdrawals' | 'transfers'>('ledger');
  
  // 台账数据
  const [ledger, setLedger] = useState<LedgerDay[]>([]);
  const [ledgerStartDate, setLedgerStartDate] = useState('');
  const [ledgerEndDate, setLedgerEndDate] = useState('');
  const [ledgerLoading, setLedgerLoading] = useState(false);
  
  // 收料单数据
  const [receipts, setReceipts] = useState<GoldTransaction[]>([]);
  const [receiptsLoading, setReceiptsLoading] = useState(false);
  
  // 付料单数据
  const [payments, setPayments] = useState<GoldTransaction[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentFormData, setPaymentFormData] = useState(INITIAL_PAYMENT_FORM);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [inboundOrders, setInboundOrders] = useState<InboundOrder[]>([]);
  
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
  
  // 待确认收料单（料部）
  const [pendingReceipts, setPendingReceipts] = useState<GoldTransaction[]>([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  
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

  // ==================== API 调用函数 ====================

  // 加载台账数据
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

  // 加载收料单列表
  const loadReceipts = useCallback(async () => {
    setReceiptsLoading(true);
    const params = buildQueryString({ user_role: userRole });
    
    const data = await apiGet<{ receipts: GoldTransaction[] }>(
      `/api/gold-material/receipts?${params}`,
      { showErrorToast: true }
    );
    
    if (data) {
      setReceipts(data.receipts || []);
    }
    setReceiptsLoading(false);
  }, [userRole]);

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

  // 加载待确认收料单（料部）
  const loadPendingReceipts = useCallback(async () => {
    setPendingLoading(true);
    const params = buildQueryString({ status: 'pending', user_role: userRole });
    
    const data = await apiGet<{ receipts: GoldTransaction[] }>(
      `/api/gold-material/receipts?${params}`,
      { showErrorToast: true }
    );
    
    if (data) {
      setPendingReceipts(data.receipts || []);
    }
    setPendingLoading(false);
  }, [userRole]);

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

  // 加载入库单列表
  const loadInboundOrders = useCallback(async () => {
    const data = await apiGet<{ orders: any[] }>(
      '/api/inbound/orders?limit=100',
      { showErrorToast: false }
    );
    
    if (data?.orders) {
      setInboundOrders(data.orders.map((o: any) => ({ id: o.id, order_no: o.order_no })));
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
    
    // 根据角色加载数据
    if (userRole === 'material') {
      loadPendingReceipts();
      loadPayments();
      loadBalance();
      loadSuppliers();
      loadInboundOrders();
    } else if (userRole === 'settlement') {
      loadReceipts();
    }
  }, [userRole, loadPendingReceipts, loadPayments, loadBalance, loadSuppliers, loadInboundOrders, loadReceipts, loadCustomers, loadWithdrawals, loadTransfers]);

  // 初始化后加载台账（需要等日期设置完成）
  useEffect(() => {
    if (ledgerStartDate && ledgerEndDate && userRole === 'material') {
      loadLedger();
    }
  }, [ledgerStartDate, ledgerEndDate, userRole, loadLedger]);

  // 切换标签页时加载数据
  useEffect(() => {
    if (activeTab === 'ledger' && ledgerStartDate && ledgerEndDate) {
      loadLedger();
    } else if (activeTab === 'receipts') {
      loadReceipts();
    } else if (activeTab === 'payments') {
      loadPayments();
    } else if (activeTab === 'balance') {
      loadBalance();
      loadInitialBalance();
    } else if (activeTab === 'withdrawals') {
      loadWithdrawals();
      loadCustomers();
    } else if (activeTab === 'transfers' && (userRole === 'settlement' || userRole === 'manager')) {
      loadTransfers();
      loadCustomers();
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

  // 确认收到原料（料部）
  const confirmReceive = async (receiptId: number) => {
    const data = await apiPost(
      `/api/gold-material/transactions/${receiptId}/receive?user_role=${userRole}`,
      { confirmed_by: userRole === 'material' ? '料部' : '系统' },
      { showSuccessToast: true, successMessage: '确认成功' }
    );
    
    if (data) {
      loadPendingReceipts();
      loadBalance();
      loadLedger();
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
        inbound_order_id: paymentFormData.inbound_order_id ? parseInt(paymentFormData.inbound_order_id) : null,
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

  // 渲染标签页按钮
  const renderTabButton = (tab: typeof activeTab, label: string, badge?: number) => (
    <button
      onClick={() => setActiveTab(tab)}
      className={`px-6 py-3 text-sm font-medium ${
        activeTab === tab
          ? 'border-b-2 border-blue-500 text-blue-600'
          : 'text-gray-500 hover:text-gray-700'
      }`}
    >
      {label} {badge !== undefined && badge > 0 && `(${badge})`}
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
  const renderEmpty = (colSpan?: number) => {
    if (colSpan) {
      return (
        <tr>
          <td colSpan={colSpan} className="px-6 py-8 text-center text-gray-500">暂无数据</td>
        </tr>
      );
    }
    return <div className="text-center py-8 text-gray-500">暂无数据</div>;
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">金料管理</h1>
          <p className="text-gray-600 mt-2">管理金料收料、付料和台账</p>
        </div>

        {/* 标签页 */}
        <div className="bg-white rounded-lg shadow-sm mb-6">
          <div className="border-b border-gray-200">
            <nav className="flex -mb-px flex-wrap">
              {userRole === 'material' && (
                <>
                  {renderTabButton('ledger', '金料台账')}
                  {renderTabButton('receipts', '待确认收料', pendingReceipts.length)}
                  {renderTabButton('payments', '付料单')}
                  {renderTabButton('withdrawals', '待发取料', withdrawals.filter(w => w.status === 'pending').length)}
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
                    {ledger.map((day) => (
                      <tr key={day.date} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{day.date}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">{day.income.toFixed(2)}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">{day.expense.toFixed(2)}</td>
                        <td className={`px-6 py-4 whitespace-nowrap text-sm text-right font-medium ${
                          day.net >= 0 ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {day.net.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                    {ledger.length === 0 && renderEmpty(4)}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* 收料单列表 */}
        {activeTab === 'receipts' && (
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">
                {userRole === 'material' ? '待确认收料单' : '收料单列表'}
              </h2>
            </div>

            {receiptsLoading || pendingLoading ? renderLoading() : (
              <div className="space-y-4">
                {(userRole === 'material' ? pendingReceipts : receipts).map((receipt) => (
                  <div key={receipt.id} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center gap-4 mb-2">
                          <span className="font-semibold text-lg">收料单号：{receipt.transaction_no}</span>
                          {renderStatusBadge(receipt.status)}
                        </div>
                        <div className="grid grid-cols-2 gap-4 text-sm text-gray-600">
                          <div>客户：{receipt.customer_name || '-'}</div>
                          <div>结算单号：{receipt.settlement_no || '-'}</div>
                          <div>金料重量：{receipt.gold_weight.toFixed(2)} 克</div>
                          <div>创建时间：{new Date(receipt.created_at).toLocaleString('zh-CN')}</div>
                        </div>
                      </div>
                      {userRole === 'material' && receipt.status === 'pending' ? (
                        renderActionButtons(receipt.id, 'receipt', true, () => confirmReceive(receipt.id))
                      ) : (
                        (userRole === 'settlement' || receipt.status === 'confirmed') && 
                        renderActionButtons(receipt.id, 'receipt')
                      )}
                    </div>
                  </div>
                ))}
                {(userRole === 'material' ? pendingReceipts : receipts).length === 0 && renderEmpty()}
              </div>
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
                          <div>入库单号：{payment.inbound_order_no || '-'}</div>
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">入库单号（可选）</label>
                  <select
                    value={paymentFormData.inbound_order_id}
                    onChange={(e) => setPaymentFormData({ ...paymentFormData, inbound_order_id: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value="">请选择入库单</option>
                    {inboundOrders.map((o) => (
                      <option key={o.id} value={o.id}>{o.order_no}</option>
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
                        <td className="px-4 py-4 text-sm">{renderStatusBadge(w.status)}</td>
                        <td className="px-4 py-4 text-sm text-gray-600">
                          {new Date(w.created_at).toLocaleString('zh-CN')}
                        </td>
                        <td className="px-4 py-4 text-right">
                          {renderActionButtons([
                            {
                              label: '打印',
                              onClick: () => printWithdrawal(w.id),
                              color: 'blue'
                            },
                            w.status === 'pending' && hasPermission(userRole, 'canCompleteWithdrawal') && {
                              label: '完成',
                              onClick: () => completeWithdrawal(w.id),
                              color: 'green'
                            },
                            w.status === 'pending' && {
                              label: '取消',
                              onClick: () => cancelWithdrawal(w.id),
                              color: 'red'
                            }
                          ].filter(Boolean) as Array<{label: string; onClick: () => void; color: string}>)}
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
                          {renderActionButtons([
                            {
                              label: '打印',
                              onClick: () => printTransfer(t.id),
                              color: 'blue'
                            }
                          ])}
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
