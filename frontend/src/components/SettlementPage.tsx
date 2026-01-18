import React, { useState, useEffect } from 'react';
import { API_ENDPOINTS } from '../config';
import {
  FileText, Check, Printer, Clock, AlertCircle, ChevronRight, 
  RefreshCw, X, DollarSign, Package, User, Calendar, Download
} from 'lucide-react';
import toast from 'react-hot-toast';

// 类型定义
interface SalesDetail {
  id: number;
  product_name: string;
  weight: number;
  labor_cost: number;
  total_labor_cost: number;
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
    pending: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: '待确认' },
    confirmed: { bg: 'bg-blue-100', text: 'text-blue-700', label: '已确认' },
    printed: { bg: 'bg-green-100', text: 'text-green-700', label: '已打印' },
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

// 结算单确认后的回调数据
interface SettlementConfirmedData {
  settlement_id: number;
  settlement_no: string;
  customer_name: string;
  salesperson: string;
  payment_method: string;
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
  const [activeTab, setActiveTab] = useState<'pending' | 'confirmed' | 'all'>('pending');
  const [pendingSales, setPendingSales] = useState<SalesOrder[]>([]);
  const [settlements, setSettlements] = useState<SettlementOrder[]>([]);
  const [loading, setLoading] = useState(false);

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

  // 确认结算单
  const [confirmingSettlement, setConfirmingSettlement] = useState<SettlementOrder | null>(null);
  
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

  // 快捷收料弹窗
  const [showQuickReceiptForm, setShowQuickReceiptForm] = useState(false);
  const [customers, setCustomers] = useState<Array<{id: number; name: string; phone?: string}>>([]);
  const [quickReceiptForm, setQuickReceiptForm] = useState({
    customer_id: '',
    gold_weight: '',
    gold_fineness: '足金999',
    remark: ''
  });
  const [customerSearch, setCustomerSearch] = useState('');

  // 加载数据
  useEffect(() => {
    loadPendingSales();
    loadSettlements();
  }, []);

  // 加载客户列表
  const loadCustomers = async () => {
    try {
      const response = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/customers`);
      if (response.ok) {
        const data = await response.json();
        setCustomers(data.data || data || []);
      }
    } catch (error) {
      console.error('加载客户列表失败:', error);
    }
  };

  // 打开快捷收料弹窗
  const openQuickReceiptForm = () => {
    loadCustomers();
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

      const response = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/gold-material/gold-receipts?${params}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        const result = await response.json();
        toast.success(`收料单创建成功：${result.data.receipt_no}`);
        setShowQuickReceiptForm(false);
        
        // 打开打印页面
        if (result.data.id) {
          window.open(`${API_ENDPOINTS.API_BASE_URL}/api/gold-material/gold-receipts/${result.data.id}/print`, '_blank');
        }
      } else {
        const error = await response.json();
        toast.error(error.detail || '创建收料单失败');
      }
    } catch (error) {
      toast.error('创建收料单失败');
    }
  };

  // 筛选客户
  const filteredCustomers = customers.filter(c => 
    c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
    (c.phone && c.phone.includes(customerSearch))
  );

  const loadPendingSales = async () => {
    try {
      const response = await fetch(API_ENDPOINTS.PENDING_SALES);
      if (response.ok) {
        const data = await response.json();
        setPendingSales(data);
      }
    } catch (error) {
      console.error('加载待结算销售单失败:', error);
    }
  };

  const loadSettlements = async () => {
    setLoading(true);
    try {
      const response = await fetch(API_ENDPOINTS.SETTLEMENT_ORDERS);
      if (response.ok) {
        const data = await response.json();
        setSettlements(data);
      }
    } catch (error) {
      console.error('加载结算单失败:', error);
    } finally {
      setLoading(false);
    }
  };

  // 创建结算单（支持灵活支付）
  const handleCreateSettlement = async (e: React.FormEvent, confirmedUnderpay: boolean = false) => {
    e.preventDefault();
    if (!selectedSalesOrder) return;

    // 调试日志
    console.log('[结算单] 开始创建，支付方式:', createForm.payment_method);
    console.log('[结算单] 表单数据:', createForm);
    console.log('[结算单] 已确认少付:', confirmedUnderpay);

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
      // 混合支付验证
      console.log('[混合支付] 开始验证');
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
      
      console.log('[混合支付] 结料:', goldWeight, '结价:', cashWeight, '总计:', totalInput);
      console.log('[混合支付] 应付:', selectedSalesOrder.total_weight, '差额:', difference);
      console.log('[混合支付] 已确认少付:', confirmedUnderpay);
      
      // 少付时需要确认
      if (difference < -0.01 && !confirmedUnderpay) {
        console.log('[混合支付] 触发少付确认对话框');
        setUnderpayData({
          totalInput,
          totalWeight: selectedSalesOrder.total_weight,
          difference: Math.abs(difference)
        });
        setShowUnderpayConfirm(true);
        return;
      }
      
      console.log('[混合支付] 验证通过，准备发送请求');
      data.gold_price = parseFloat(createForm.gold_price);
      data.gold_payment_weight = goldWeight;
      data.cash_payment_weight = cashWeight;
    }

    try {
      const response = await fetch(API_ENDPOINTS.SETTLEMENT_ORDERS, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    console.log('[少付确认] 用户点击确认继续');
    setShowUnderpayConfirm(false);
    handleCreateSettlement(e, true);
  };

  // 确认结算单
  const handleConfirmSettlement = async () => {
    if (!confirmingSettlement) return;

    try {
      const response = await fetch(API_ENDPOINTS.SETTLEMENT_CONFIRM(confirmingSettlement.id), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

      const response = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/settlement/orders/${editingSettlement.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
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
      const response = await fetch(API_ENDPOINTS.SETTLEMENT_PRINT(settlement.id), {
        method: 'POST'
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

      const response = await fetch(`${API_ENDPOINTS.API_BASE_URL}/api/gold-material/gold-receipts?${params}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        const result = await response.json();
        toast.success(`收料单创建成功：${result.data.receipt_no}`);
        setShowReceiptForm(false);
        setSelectedSettlementForReceipt(null);
        
        // 打开打印页面
        if (result.data.id) {
          window.open(`${API_ENDPOINTS.API_BASE_URL}/api/gold-material/gold-receipts/${result.data.id}/print`, '_blank');
        }
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

  // 过滤结算单
  const filteredSettlements = settlements.filter(s => {
    if (activeTab === 'pending') return s.status === 'pending';
    if (activeTab === 'confirmed') return s.status === 'confirmed' || s.status === 'printed';
    return true;
  });

  const pendingCount = settlements.filter(s => s.status === 'pending').length;

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
                <span className="font-medium">{underpayData.totalInput.toFixed(2)} 克</span>
              </div>
              <div className="flex justify-between py-2 border-b">
                <span className="text-gray-600">应付金额</span>
                <span className="font-medium">{underpayData.totalWeight.toFixed(2)} 克</span>
              </div>
              <div className="flex justify-between py-2 bg-red-50 px-3 rounded-lg">
                <span className="text-red-700 font-medium">差额欠款</span>
                <span className="text-red-700 font-bold">{underpayData.difference.toFixed(2)} 克</span>
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
              onClick={() => { loadPendingSales(); loadSettlements(); }}
              className="flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-gray-500 to-gray-600 text-white 
                rounded-xl shadow-lg shadow-gray-200/50 hover:from-gray-600 hover:to-gray-700 
                transition-all font-medium"
            >
              <RefreshCw className="w-4 h-4" />
              <span>刷新</span>
            </button>
          </div>
        </div>

        {/* 统计卡片 - 可点击筛选 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {/* 待开结算单卡片 - 点击滚动到销售单列表 */}
          <div 
            onClick={() => {
              // 滚动到待开结算单列表区域
              const element = document.getElementById('pending-sales-section');
              if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }
            }}
            className="bg-gradient-to-br from-orange-500 to-orange-600 rounded-xl p-4 text-white 
              cursor-pointer hover:from-orange-600 hover:to-orange-700 hover:shadow-lg hover:shadow-orange-300/50
              transition-all transform hover:scale-[1.02] active:scale-[0.98]"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm opacity-80">待开结算单</span>
              <FileText className="w-5 h-5 opacity-60" />
            </div>
            <div className="text-3xl font-bold mt-2">{pendingSales.length}</div>
          </div>
          
          {/* 待确认卡片 - 点击切换到待确认Tab */}
          <div 
            onClick={() => setActiveTab('pending')}
            className={`relative bg-gradient-to-br from-yellow-500 to-yellow-600 rounded-xl p-4 text-white 
              cursor-pointer hover:from-yellow-600 hover:to-yellow-700 hover:shadow-lg hover:shadow-yellow-300/50
              transition-all transform hover:scale-[1.02] active:scale-[0.98]
              ${activeTab === 'pending' ? 'ring-4 ring-white/50 shadow-lg shadow-yellow-300/50' : ''}`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm opacity-80">待确认</span>
              <Clock className="w-5 h-5 opacity-60" />
            </div>
            <div className="text-3xl font-bold mt-2">{pendingCount}</div>
            {activeTab === 'pending' && (
              <div className="absolute top-2 right-2">
                <Check className="w-4 h-4 text-white/80" />
              </div>
            )}
          </div>
          
          {/* 已完成卡片 - 点击切换到已确认Tab */}
          <div 
            onClick={() => setActiveTab('confirmed')}
            className={`relative bg-gradient-to-br from-green-500 to-green-600 rounded-xl p-4 text-white 
              cursor-pointer hover:from-green-600 hover:to-green-700 hover:shadow-lg hover:shadow-green-300/50
              transition-all transform hover:scale-[1.02] active:scale-[0.98]
              ${activeTab === 'confirmed' ? 'ring-4 ring-white/50 shadow-lg shadow-green-300/50' : ''}`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm opacity-80">已完成</span>
              <Check className="w-5 h-5 opacity-60" />
            </div>
            <div className="text-3xl font-bold mt-2">
              {settlements.filter(s => s.status === 'confirmed' || s.status === 'printed').length}
            </div>
            {activeTab === 'confirmed' && (
              <div className="absolute top-2 right-2">
                <Check className="w-4 h-4 text-white/80" />
              </div>
            )}
          </div>
        </div>

        {/* Tab 切换 */}
        <div className="flex space-x-3 mb-6">
          <TabButton
            active={activeTab === 'pending'}
            onClick={() => setActiveTab('pending')}
            icon={<Clock className="w-4 h-4" />}
            label="待确认"
            count={pendingCount}
          />
          <TabButton
            active={activeTab === 'confirmed'}
            onClick={() => setActiveTab('confirmed')}
            icon={<Check className="w-4 h-4" />}
            label="已确认"
          />
          <TabButton
            active={activeTab === 'all'}
            onClick={() => setActiveTab('all')}
            icon={<FileText className="w-4 h-4" />}
            label="全部"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 左侧：待结算销售单 */}
          <div id="pending-sales-section" className="bg-white rounded-xl shadow-sm p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center">
              <FileText className="w-5 h-5 mr-2 text-orange-500" />
              待开结算单的销售单
            </h2>
            
            {pendingSales.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Package className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                <p>暂无待结算销售单</p>
              </div>
            ) : (
              <div className="space-y-3">
                {pendingSales.map(order => (
                  <div
                    key={order.id}
                    className="border border-gray-200 rounded-lg p-4 hover:border-orange-300 transition-colors cursor-pointer"
                    onClick={() => {
                      setSelectedSalesOrder(order);
                      setShowCreateForm(true);
                    }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono text-sm text-gray-500">{order.order_no}</span>
                      <StatusBadge status={order.status} />
                    </div>
                    <div className="flex items-center text-gray-700 mb-2">
                      <User className="w-4 h-4 mr-1" />
                      <span className="font-medium">{order.customer_name}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm text-gray-500">
                      <span>{order.total_weight.toFixed(2)}g</span>
                      <span>工费 ¥{order.total_labor_cost.toFixed(2)}</span>
                      <ChevronRight className="w-4 h-4 text-orange-400" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 右侧：结算单列表 */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center">
              <Check className="w-5 h-5 mr-2 text-cyan-500" />
              结算单列表
            </h2>
            
            {loading ? (
              <div className="text-center py-8 text-gray-500">加载中...</div>
            ) : filteredSettlements.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <FileText className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                <p>暂无结算单</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredSettlements.map(settlement => (
                  <div
                    key={settlement.id}
                    className={`border rounded-lg p-4 ${
                      settlement.status === 'pending' 
                        ? 'border-yellow-200 bg-yellow-50' 
                        : 'border-gray-200'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono text-sm">{settlement.settlement_no}</span>
                      <div className="flex items-center space-x-2">
                        {/* 支付状态标签 */}
                        {settlement.payment_status === 'overpaid' && (
                          <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded-full">
                            多付 {Math.abs(settlement.payment_difference || 0).toFixed(2)}克
                          </span>
                        )}
                        {settlement.payment_status === 'underpaid' && (
                          <span className="px-2 py-0.5 text-xs bg-red-100 text-red-700 rounded-full">
                            欠款 {Math.abs(settlement.payment_difference || 0).toFixed(2)}克
                          </span>
                        )}
                        <StatusBadge status={settlement.status} />
                      </div>
                    </div>
                    <div className="text-sm text-gray-600 mb-2">
                      销售单: {settlement.sales_order?.order_no || '-'}
                    </div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-gray-500">
                        {settlement.payment_method === 'cash_price' 
                          ? `结价 (¥${settlement.gold_price}/g)`
                          : settlement.payment_method === 'mixed'
                            ? `混合支付 (结料${settlement.gold_payment_weight || 0}g + 结价${settlement.cash_payment_weight || 0}g)`
                            : `结料 (${settlement.physical_gold_weight}g)`
                        }
                      </span>
                      <span className="font-bold text-lg text-cyan-600">
                        ¥{settlement.total_amount.toFixed(2)}
                      </span>
                    </div>
                    
                    {/* 操作按钮 */}
                    <div className="flex space-x-2 mt-3">
                      {settlement.status === 'pending' && (
                        <>
                          <button
                            onClick={() => handleOpenEdit(settlement)}
                            className="flex items-center justify-center space-x-1 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm"
                          >
                            <FileText className="w-4 h-4" />
                            <span>编辑</span>
                          </button>
                          <button
                            onClick={() => setConfirmingSettlement(settlement)}
                            className="flex-1 flex items-center justify-center space-x-1 px-3 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 transition-colors text-sm"
                          >
                            <Check className="w-4 h-4" />
                            <span>确认</span>
                          </button>
                        </>
                      )}
                      {settlement.status === 'confirmed' && (
                        <button
                          onClick={() => handlePrint(settlement)}
                          className="flex-1 flex items-center justify-center space-x-1 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm"
                        >
                          <Printer className="w-4 h-4" />
                          <span>打印</span>
                        </button>
                      )}
                      {settlement.status === 'printed' && (
                        <>
                          <span className="text-center text-sm text-green-600 py-2">
                            ✓ 已打印
                          </span>
                          <button
                            onClick={() => window.open(`${API_ENDPOINTS.API_BASE_URL}/api/settlement/orders/${settlement.id}/download?format=html`, '_blank')}
                            className="flex items-center justify-center space-x-1 px-3 py-2 bg-green-100 text-green-600 rounded-lg hover:bg-green-200 transition-colors text-sm"
                          >
                            <Printer className="w-4 h-4" />
                            <span>打印</span>
                          </button>
                        </>
                      )}
                      {/* 下载按钮 - 已确认/已打印时显示 */}
                      {(settlement.status === 'confirmed' || settlement.status === 'printed') && (
                        <button
                          onClick={() => window.open(`${API_ENDPOINTS.API_BASE_URL}/api/settlement/orders/${settlement.id}/download?format=pdf`, '_blank')}
                          className="flex items-center justify-center space-x-1 px-3 py-2 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 transition-colors text-sm"
                        >
                          <Download className="w-4 h-4" />
                          <span>下载</span>
                        </button>
                      )}
                      {/* 开具收料单按钮 - 只在支付方式包含金料且已确认/已打印时显示 */}
                      {needsGoldReceipt(settlement) && (settlement.status === 'confirmed' || settlement.status === 'printed') && (
                        <button
                          onClick={() => openReceiptForm(settlement)}
                          className="flex-1 flex items-center justify-center space-x-1 px-3 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 transition-colors text-sm"
                        >
                          <Package className="w-4 h-4" />
                          <span>收料单</span>
                        </button>
                      )}
                      {/* 重新结算按钮 - 已确认/已打印时显示 */}
                      {(settlement.status === 'confirmed' || settlement.status === 'printed') && (
                        <button
                          onClick={async () => {
                            if (!confirm('确定要撤销此结算单吗？撤销后可以重新选择支付方式进行结算。')) return
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
                              console.error('撤销结算单失败:', error)
                              toast.error('撤销失败')
                            }
                          }}
                          className="flex items-center justify-center space-x-1 px-3 py-2 bg-orange-100 text-orange-600 rounded-lg hover:bg-orange-200 transition-colors text-sm"
                        >
                          <RefreshCw className="w-4 h-4" />
                          <span>重新结算</span>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

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
                  <span className="font-medium">{selectedSalesOrder.total_weight.toFixed(2)}g</span>
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
                      <span className="text-gray-500">{detail.weight}g × ¥{detail.labor_cost}/g</span>
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
                        onChange={(e) => setCreateForm({ ...createForm, payment_method: e.target.value })}
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
                    <label className="block text-sm font-medium text-gray-700 mb-1">客户提供黄金重量 (克)</label>
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
                      <div className={`text-sm p-2 rounded ${
                        Math.abs((parseFloat(createForm.gold_payment_weight || '0') + parseFloat(createForm.cash_payment_weight || '0')) - selectedSalesOrder.total_weight) <= 0.01
                          ? 'bg-green-100 text-green-700'
                          : 'bg-red-100 text-red-700'
                      }`}>
                        结料 {parseFloat(createForm.gold_payment_weight || '0').toFixed(2)} 克 + 
                        结价 {parseFloat(createForm.cash_payment_weight || '0').toFixed(2)} 克 = 
                        {(parseFloat(createForm.gold_payment_weight || '0') + parseFloat(createForm.cash_payment_weight || '0')).toFixed(2)} 克
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
                            <span>{parseFloat(createForm.gold_payment_weight || '0').toFixed(2)} 克</span>
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
                            ? `${selectedSalesOrder.total_weight.toFixed(2)} 克`
                            : `${parseFloat(createForm.gold_payment_weight || '0').toFixed(2)} 克`
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
                  className="flex-1 px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 transition-colors"
                >
                  确认结算
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
                  <span className="font-medium">{editingSettlement.total_weight?.toFixed(2)}g</span>
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
                        className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                          editForm.payment_method === opt.value
                            ? 'bg-cyan-600 text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 金价 */}
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
                      placeholder={`建议与商品克重一致 (${editingSettlement.total_weight?.toFixed(2)}g)`}
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
                      合计: {(parseFloat(editForm.gold_payment_weight || '0') + parseFloat(editForm.cash_payment_weight || '0')).toFixed(2)}g
                      {' '}(商品: {editingSettlement.total_weight?.toFixed(2)}g)
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
                      ? `${selectedSettlementForReceipt.total_weight.toFixed(2)} 克`
                      : `${(selectedSettlementForReceipt.gold_payment_weight || 0).toFixed(2)} 克`
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
                    className="flex-1 px-4 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 transition-colors flex items-center justify-center space-x-2"
                  >
                    <Printer className="w-4 h-4" />
                    <span>创建并打印</span>
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
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500 mb-2"
                  />
                  <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg">
                    {filteredCustomers.length === 0 ? (
                      <div className="p-3 text-center text-gray-500 text-sm">暂无匹配客户</div>
                    ) : (
                      filteredCustomers.slice(0, 10).map(customer => (
                        <div
                          key={customer.id}
                          onClick={() => setQuickReceiptForm({ ...quickReceiptForm, customer_id: customer.id.toString() })}
                          className={`p-3 cursor-pointer hover:bg-yellow-50 border-b last:border-b-0 flex justify-between items-center ${
                            quickReceiptForm.customer_id === customer.id.toString() ? 'bg-yellow-100' : ''
                          }`}
                        >
                          <span className="font-medium">{customer.name}</span>
                          <span className="text-sm text-gray-500">{customer.phone || '-'}</span>
                        </div>
                      ))
                    )}
                  </div>
                  {quickReceiptForm.customer_id && (
                    <div className="mt-2 text-sm text-green-600">
                      已选择：{customers.find(c => c.id.toString() === quickReceiptForm.customer_id)?.name}
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
                    className="flex-1 px-4 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 transition-colors flex items-center justify-center space-x-2"
                  >
                    <Printer className="w-4 h-4" />
                    <span>创建并打印</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SettlementPage;



