import React, { useState, useEffect } from 'react';
import { API_ENDPOINTS } from '../config';
import {
  FileText, Check, Printer, Clock, AlertCircle, ChevronRight, 
  RefreshCw, X, DollarSign, Package, User, Calendar
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
    className={`flex items-center space-x-2 px-4 py-3 rounded-lg font-medium transition-all ${
      active
        ? 'bg-cyan-600 text-white shadow-md'
        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
    }`}
  >
    {icon}
    <span>{label}</span>
    {count !== undefined && count > 0 && (
      <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${
        active ? 'bg-white/20' : 'bg-cyan-500 text-white'
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

  // 加载数据
  useEffect(() => {
    loadPendingSales();
    loadSettlements();
  }, []);

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

  // 创建结算单
  const handleCreateSettlement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSalesOrder) return;

    const data: any = {
      sales_order_id: selectedSalesOrder.id,
      payment_method: createForm.payment_method,
      remark: createForm.remark || null
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
      if (!createForm.gold_price) {
        toast.error('混合支付需要填写当日金价');
        return;
      }
      if (!createForm.gold_payment_weight || !createForm.cash_payment_weight) {
        toast.error('请填写结料克重和结价克重');
        return;
      }
      const goldWeight = parseFloat(createForm.gold_payment_weight);
      const cashWeight = parseFloat(createForm.cash_payment_weight);
      const totalInput = goldWeight + cashWeight;
      
      if (Math.abs(totalInput - selectedSalesOrder.total_weight) > 0.01) {
        toast.error(`结料克重(${goldWeight}) + 结价克重(${cashWeight}) = ${totalInput.toFixed(2)}克，必须等于销售总重量(${selectedSalesOrder.total_weight}克)`);
        return;
      }
      
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
        toast.success('结算单创建成功');
        setShowCreateForm(false);
        setSelectedSalesOrder(null);
        setCreateForm({ payment_method: 'cash_price', gold_price: '', physical_gold_weight: '', gold_payment_weight: '', cash_payment_weight: '', remark: '' });
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
            total_weight: confirmingSettlement.total_weight,
            labor_amount: confirmingSettlement.labor_amount,
            material_amount: confirmingSettlement.material_amount,
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

  // 过滤结算单
  const filteredSettlements = settlements.filter(s => {
    if (activeTab === 'pending') return s.status === 'pending';
    if (activeTab === 'confirmed') return s.status === 'confirmed' || s.status === 'printed';
    return true;
  });

  const pendingCount = settlements.filter(s => s.status === 'pending').length;

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* 标题栏 */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">结算管理</h1>
            <p className="text-gray-500 mt-1">确认销售单的原料支付方式并复核打印</p>
          </div>
          <button
            onClick={() => { loadPendingSales(); loadSettlements(); }}
            className="flex items-center space-x-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            <span>刷新</span>
          </button>
        </div>

        {/* 统计卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-gradient-to-br from-orange-500 to-orange-600 rounded-xl p-4 text-white">
            <div className="flex items-center justify-between">
              <span className="text-sm opacity-80">待开结算单</span>
              <FileText className="w-5 h-5 opacity-60" />
            </div>
            <div className="text-3xl font-bold mt-2">{pendingSales.length}</div>
          </div>
          <div className="bg-gradient-to-br from-yellow-500 to-yellow-600 rounded-xl p-4 text-white">
            <div className="flex items-center justify-between">
              <span className="text-sm opacity-80">待确认</span>
              <Clock className="w-5 h-5 opacity-60" />
            </div>
            <div className="text-3xl font-bold mt-2">{pendingCount}</div>
          </div>
          <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl p-4 text-white">
            <div className="flex items-center justify-between">
              <span className="text-sm opacity-80">已完成</span>
              <Check className="w-5 h-5 opacity-60" />
            </div>
            <div className="text-3xl font-bold mt-2">
              {settlements.filter(s => s.status === 'confirmed' || s.status === 'printed').length}
            </div>
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
          <div className="bg-white rounded-xl shadow-sm p-6">
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
                      <StatusBadge status={settlement.status} />
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
                        <button
                          onClick={() => setConfirmingSettlement(settlement)}
                          className="flex-1 flex items-center justify-center space-x-1 px-3 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 transition-colors text-sm"
                        >
                          <Check className="w-4 h-4" />
                          <span>确认</span>
                        </button>
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
                        <span className="flex-1 text-center text-sm text-green-600 py-2">
                          ✓ 已打印
                        </span>
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
      </div>
    </div>
  );
};

export default SettlementPage;



