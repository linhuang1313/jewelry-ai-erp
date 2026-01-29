import React, { useState, useCallback } from 'react';
import { API_BASE_URL } from '../config';
import {
  X, Search, FileText, Loader2, Printer, Download, Package, User, Calendar, DollarSign
} from 'lucide-react';
import toast from 'react-hot-toast';

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
  store_code?: string;
  total_labor_cost: number;
  total_weight: number;
  status: string;
  remark?: string;
  details: SalesDetail[];
}

interface SettlementOrder {
  id: number;
  settlement_no: string;
  sales_order_id: number;
  status: string;
  payment_method?: string;
  gold_price?: number;
  total_gold_amount?: number;
  total_labor_cost?: number;
  total_amount?: number;
  discount_amount?: number;
  final_amount?: number;
  received_amount?: number;
  gold_received_weight?: number;
  balance_due?: number;
  created_at: string;
  confirmed_at?: string;
  sales_order?: SalesOrder;
}

interface SalesSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type SearchResult = {
  type: 'sales';
  data: SalesOrder;
} | {
  type: 'settlement';
  data: SettlementOrder;
} | null;

const SalesSearchModal: React.FC<SalesSearchModalProps> = ({ isOpen, onClose }) => {
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<SearchResult>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  const handleSearch = useCallback(async () => {
    const keyword = searchKeyword.trim().toUpperCase();
    if (!keyword) {
      toast.error('请输入单号');
      return;
    }

    setSearching(true);
    setSearchResult(null);
    setSearchError(null);

    try {
      // 根据前缀判断搜索类型
      if (keyword.startsWith('XS')) {
        // 搜索销售单
        const response = await fetch(`${API_BASE_URL}/api/sales/orders?order_no=${encodeURIComponent(keyword)}`);
        const data = await response.json();
        
        if (data.success && data.orders && data.orders.length > 0) {
          setSearchResult({ type: 'sales', data: data.orders[0] });
        } else {
          setSearchError('未找到该销售单');
        }
      } else if (keyword.startsWith('JS')) {
        // 搜索结算单
        const response = await fetch(`${API_BASE_URL}/api/settlement/orders?settlement_no=${encodeURIComponent(keyword)}`);
        const data = await response.json();
        
        if (Array.isArray(data) && data.length > 0) {
          setSearchResult({ type: 'settlement', data: data[0] });
        } else {
          setSearchError('未找到该结算单');
        }
      } else {
        // 同时搜索销售单和结算单
        const [salesRes, settlementRes] = await Promise.all([
          fetch(`${API_BASE_URL}/api/sales/orders?order_no=${encodeURIComponent(keyword)}`),
          fetch(`${API_BASE_URL}/api/settlement/orders?settlement_no=${encodeURIComponent(keyword)}`)
        ]);
        
        const salesData = await salesRes.json();
        const settlementData = await settlementRes.json();
        
        if (salesData.success && salesData.orders && salesData.orders.length > 0) {
          setSearchResult({ type: 'sales', data: salesData.orders[0] });
        } else if (Array.isArray(settlementData) && settlementData.length > 0) {
          setSearchResult({ type: 'settlement', data: settlementData[0] });
        } else {
          setSearchError('未找到相关单据，请检查单号是否正确');
        }
      }
    } catch (error) {
      console.error('搜索失败:', error);
      setSearchError('搜索失败，请稍后重试');
    } finally {
      setSearching(false);
    }
  }, [searchKeyword]);

  const handlePrint = useCallback(async () => {
    if (!searchResult) return;

    try {
      let url = '';
      if (searchResult.type === 'sales') {
        url = `${API_BASE_URL}/api/sales/orders/${searchResult.data.id}/download?format=html`;
      } else {
        url = `${API_BASE_URL}/api/settlement/orders/${searchResult.data.id}/download?format=html`;
      }
      
      const response = await fetch(url);
      const html = await response.text();
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(html);
        printWindow.document.close();
        printWindow.print();
      }
    } catch (error) {
      toast.error('打印失败');
    }
  }, [searchResult]);

  const handleDownload = useCallback(async () => {
    if (!searchResult) return;

    try {
      let url = '';
      let filename = '';
      if (searchResult.type === 'sales') {
        url = `${API_BASE_URL}/api/sales/orders/${searchResult.data.id}/download?format=pdf`;
        filename = `销售单_${searchResult.data.order_no}.pdf`;
      } else {
        url = `${API_BASE_URL}/api/settlement/orders/${searchResult.data.id}/download?format=pdf`;
        filename = `结算单_${searchResult.data.settlement_no}.pdf`;
      }
      
      const response = await fetch(url);
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(downloadUrl);
      toast.success('下载成功');
    } catch (error) {
      toast.error('下载失败');
    }
  }, [searchResult]);

  const handleClose = () => {
    setSearchKeyword('');
    setSearchResult(null);
    setSearchError(null);
    onClose();
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden">
        {/* 头部 */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-amber-100 rounded-xl">
              <FileText className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">销售管理</h2>
              <p className="text-sm text-gray-500">查询销售单或结算单</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-gray-100 rounded-xl transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* 搜索区域 */}
        <div className="p-6 border-b border-gray-100">
          <div className="flex space-x-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value.toUpperCase())}
                onKeyPress={handleKeyPress}
                placeholder="输入销售单号 (XS...) 或结算单号 (JS...)"
                className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all"
                autoFocus
              />
            </div>
            <button
              onClick={handleSearch}
              disabled={searching}
              className="px-6 py-3 bg-amber-500 text-white rounded-xl hover:bg-amber-600 transition-colors flex items-center space-x-2 disabled:opacity-50"
            >
              {searching ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Search className="w-5 h-5" />
              )}
              <span>搜索</span>
            </button>
          </div>
        </div>

        {/* 结果区域 */}
        <div className="p-6 overflow-y-auto max-h-[50vh]">
          {searching && (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-amber-500 mb-4" />
              <p className="text-gray-500">搜索中...</p>
            </div>
          )}

          {searchError && (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="p-3 bg-red-100 rounded-full mb-4">
                <FileText className="w-8 h-8 text-red-500" />
              </div>
              <p className="text-gray-600">{searchError}</p>
            </div>
          )}

          {searchResult && searchResult.type === 'sales' && (
            <div className="space-y-4">
              {/* 销售单信息卡片 */}
              <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl p-4 border border-amber-200">
                <div className="flex items-center justify-between mb-3">
                  <span className="px-3 py-1 bg-amber-500 text-white text-sm rounded-full font-medium">
                    销售单
                  </span>
                  <span className={`px-3 py-1 text-sm rounded-full font-medium ${
                    searchResult.data.status === '已结算' 
                      ? 'bg-green-100 text-green-700' 
                      : 'bg-yellow-100 text-yellow-700'
                  }`}>
                    {searchResult.data.status}
                  </span>
                </div>
                
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="flex items-center space-x-2">
                    <FileText className="w-4 h-4 text-gray-400" />
                    <span className="text-gray-500">单号：</span>
                    <span className="font-medium text-gray-900">{searchResult.data.order_no}</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <User className="w-4 h-4 text-gray-400" />
                    <span className="text-gray-500">客户：</span>
                    <span className="font-medium text-gray-900">{searchResult.data.customer_name}</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <User className="w-4 h-4 text-gray-400" />
                    <span className="text-gray-500">业务员：</span>
                    <span className="font-medium text-gray-900">{searchResult.data.salesperson}</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Calendar className="w-4 h-4 text-gray-400" />
                    <span className="text-gray-500">日期：</span>
                    <span className="font-medium text-gray-900">
                      {new Date(searchResult.data.order_date).toLocaleDateString('zh-CN')}
                    </span>
                  </div>
                </div>
              </div>

              {/* 商品明细 */}
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                  <h3 className="font-medium text-gray-700 flex items-center space-x-2">
                    <Package className="w-4 h-4" />
                    <span>商品明细</span>
                  </h3>
                </div>
                <div className="divide-y divide-gray-100">
                  {searchResult.data.details?.map((detail, index) => (
                    <div key={detail.id || index} className="px-4 py-3 flex justify-between items-center">
                      <div>
                        <span className="font-medium text-gray-900">{detail.product_name}</span>
                        <span className="ml-2 text-sm text-gray-500">
                          {detail.weight}g × ¥{detail.labor_cost}/g
                        </span>
                      </div>
                      <span className="font-medium text-amber-600">¥{detail.total_labor_cost?.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
                <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 flex justify-between items-center">
                  <div className="text-sm text-gray-600">
                    总克重：<span className="font-medium">{searchResult.data.total_weight}g</span>
                  </div>
                  <div className="text-lg font-bold text-amber-600">
                    总工费：¥{searchResult.data.total_labor_cost?.toFixed(2)}
                  </div>
                </div>
              </div>

              {/* 操作按钮 */}
              <div className="flex space-x-3">
                <button
                  onClick={handlePrint}
                  className="flex-1 flex items-center justify-center space-x-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all font-medium"
                >
                  <Printer className="w-4 h-4" />
                  <span>打印</span>
                </button>
                <button
                  onClick={handleDownload}
                  className="flex-1 flex items-center justify-center space-x-2 px-4 py-2.5 bg-green-600 text-white rounded-xl hover:bg-green-700 transition-all font-medium"
                >
                  <Download className="w-4 h-4" />
                  <span>下载</span>
                </button>
              </div>
            </div>
          )}

          {searchResult && searchResult.type === 'settlement' && (
            <div className="space-y-4">
              {/* 结算单信息卡片 */}
              <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl p-4 border border-green-200">
                <div className="flex items-center justify-between mb-3">
                  <span className="px-3 py-1 bg-green-500 text-white text-sm rounded-full font-medium">
                    结算单
                  </span>
                  <span className={`px-3 py-1 text-sm rounded-full font-medium ${
                    searchResult.data.status === 'confirmed' 
                      ? 'bg-green-100 text-green-700' 
                      : searchResult.data.status === 'pending'
                      ? 'bg-yellow-100 text-yellow-700'
                      : 'bg-gray-100 text-gray-700'
                  }`}>
                    {searchResult.data.status === 'confirmed' ? '已确认' : 
                     searchResult.data.status === 'pending' ? '待确认' : searchResult.data.status}
                  </span>
                </div>
                
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="flex items-center space-x-2">
                    <FileText className="w-4 h-4 text-gray-400" />
                    <span className="text-gray-500">结算单号：</span>
                    <span className="font-medium text-gray-900">{searchResult.data.settlement_no}</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <User className="w-4 h-4 text-gray-400" />
                    <span className="text-gray-500">客户：</span>
                    <span className="font-medium text-gray-900">{searchResult.data.sales_order?.customer_name || '-'}</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <DollarSign className="w-4 h-4 text-gray-400" />
                    <span className="text-gray-500">金价：</span>
                    <span className="font-medium text-gray-900">¥{searchResult.data.gold_price || '-'}/g</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Calendar className="w-4 h-4 text-gray-400" />
                    <span className="text-gray-500">创建时间：</span>
                    <span className="font-medium text-gray-900">
                      {new Date(searchResult.data.created_at).toLocaleDateString('zh-CN')}
                    </span>
                  </div>
                </div>
              </div>

              {/* 金额明细 */}
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                  <h3 className="font-medium text-gray-700 flex items-center space-x-2">
                    <DollarSign className="w-4 h-4" />
                    <span>金额明细</span>
                  </h3>
                </div>
                <div className="p-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">金料金额：</span>
                    <span className="font-medium">¥{searchResult.data.total_gold_amount?.toFixed(2) || '0.00'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">工费金额：</span>
                    <span className="font-medium">¥{searchResult.data.total_labor_cost?.toFixed(2) || '0.00'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">总金额：</span>
                    <span className="font-medium">¥{searchResult.data.total_amount?.toFixed(2) || '0.00'}</span>
                  </div>
                  {searchResult.data.discount_amount && searchResult.data.discount_amount > 0 && (
                    <div className="flex justify-between text-red-600">
                      <span>优惠金额：</span>
                      <span className="font-medium">-¥{searchResult.data.discount_amount.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between pt-2 border-t border-gray-200">
                    <span className="text-gray-700 font-medium">应收金额：</span>
                    <span className="text-lg font-bold text-green-600">¥{searchResult.data.final_amount?.toFixed(2) || '0.00'}</span>
                  </div>
                  {searchResult.data.gold_received_weight && searchResult.data.gold_received_weight > 0 && (
                    <div className="flex justify-between text-amber-600">
                      <span>收取金料：</span>
                      <span className="font-medium">{searchResult.data.gold_received_weight}g</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-gray-500">已收金额：</span>
                    <span className="font-medium text-green-600">¥{searchResult.data.received_amount?.toFixed(2) || '0.00'}</span>
                  </div>
                  {searchResult.data.balance_due && searchResult.data.balance_due > 0 && (
                    <div className="flex justify-between text-red-600">
                      <span>待收余额：</span>
                      <span className="font-medium">¥{searchResult.data.balance_due.toFixed(2)}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* 关联销售单 */}
              {searchResult.data.sales_order && (
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                    <h3 className="font-medium text-gray-700 flex items-center space-x-2">
                      <FileText className="w-4 h-4" />
                      <span>关联销售单</span>
                    </h3>
                  </div>
                  <div className="p-4 text-sm">
                    <div className="flex justify-between mb-2">
                      <span className="text-gray-500">销售单号：</span>
                      <span className="font-medium">{searchResult.data.sales_order.order_no}</span>
                    </div>
                    <div className="flex justify-between mb-2">
                      <span className="text-gray-500">业务员：</span>
                      <span className="font-medium">{searchResult.data.sales_order.salesperson}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">总克重：</span>
                      <span className="font-medium">{searchResult.data.sales_order.total_weight}g</span>
                    </div>
                  </div>
                </div>
              )}

              {/* 操作按钮 */}
              <div className="flex space-x-3">
                <button
                  onClick={handlePrint}
                  className="flex-1 flex items-center justify-center space-x-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all font-medium"
                >
                  <Printer className="w-4 h-4" />
                  <span>打印</span>
                </button>
                <button
                  onClick={handleDownload}
                  className="flex-1 flex items-center justify-center space-x-2 px-4 py-2.5 bg-green-600 text-white rounded-xl hover:bg-green-700 transition-all font-medium"
                >
                  <Download className="w-4 h-4" />
                  <span>下载</span>
                </button>
              </div>
            </div>
          )}

          {!searching && !searchError && !searchResult && (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400">
              <Search className="w-12 h-12 mb-4 opacity-50" />
              <p>输入单号开始搜索</p>
              <p className="text-sm mt-2">支持销售单号 (XS...) 和结算单号 (JS...)</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SalesSearchModal;
