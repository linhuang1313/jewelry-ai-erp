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

// ==================== 常量定义 ====================

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  pending: { label: '待确认', color: '#f59e0b' },
  confirmed: { label: '已确认', color: '#10b981' },
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
  const [activeTab, setActiveTab] = useState<'ledger' | 'receipts' | 'payments' | 'balance'>('ledger');
  
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
  
  // 待确认收料单（料部）
  const [pendingReceipts, setPendingReceipts] = useState<GoldTransaction[]>([]);
  const [pendingLoading, setPendingLoading] = useState(false);

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

  // ==================== 初始化 ====================

  useEffect(() => {
    // 设置默认日期范围（最近30天）
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);
    setLedgerEndDate(endDate.toISOString().split('T')[0]);
    setLedgerStartDate(startDate.toISOString().split('T')[0]);
    
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
  }, [userRole, loadPendingReceipts, loadPayments, loadBalance, loadSuppliers, loadInboundOrders, loadReceipts]);

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
            <nav className="flex -mb-px">
              {userRole === 'material' && (
                <>
                  {renderTabButton('ledger', '金料台账')}
                  {renderTabButton('receipts', '待确认收料', pendingReceipts.length)}
                  {renderTabButton('payments', '付料单')}
                  {renderTabButton('balance', '金料库存')}
                </>
              )}
              {userRole === 'settlement' && renderTabButton('receipts', '收料单')}
            </nav>
          </div>
        </div>

        {/* 金料台账 */}
        {activeTab === 'ledger' && userRole === 'material' && (
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
        {activeTab === 'payments' && userRole === 'material' && (
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
        {activeTab === 'balance' && userRole === 'material' && (
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="text-xl font-semibold mb-4">金料库存余额</h2>
            {balanceLoading ? renderLoading() : balance ? (
              <div className="grid grid-cols-3 gap-6">
                <div className="bg-blue-50 rounded-lg p-6">
                  <div className="text-sm text-gray-600 mb-2">累计收入</div>
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
      </div>
    </div>
  );
}
