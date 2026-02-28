import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Package, Store, ArrowRight, ArrowLeft, Warehouse, ChevronDown, ChevronUp } from 'lucide-react';
import { API_BASE_URL } from '../config';

interface InventoryStats {
  location_id: number;
  location_name: string;
  total_weight: number;
  product_count: number;
}

interface TransferStats {
  total_weight: number;
  count: number;
  description: string;
}

interface OverviewData {
  warehouse: InventoryStats | null;
  showroom: InventoryStats | null;
  transfers: {
    outgoing_pending: TransferStats | null;
    incoming_pending: TransferStats | null;
    return_to_warehouse: TransferStats | null;
    return_to_showroom: TransferStats | null;
  };
}

interface InventoryItem {
  product_name: string;
  product_code: string;
  weight: number;
  available_weight?: number;  // 展厅：可用 = 总库存 - draft 销售单占用
}

interface InboundDetailItem {
  id: number;
  product_code: string;
  product_name: string;
  weight: number;
  labor_cost: number;
  piece_labor_cost: number | null;
  total_cost: number;
  supplier: string | null;
  order_no: string;
  inbound_time: string | null;
  source?: string;
}

interface InventoryOverviewProps {
  userRole: string;
}

export default function InventoryOverview({ userRole }: InventoryOverviewProps) {
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [expandedLocation, setExpandedLocation] = useState<'warehouse' | 'showroom' | null>(null);
  const [locationDetails, setLocationDetails] = useState<InventoryItem[]>([]);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);
  const [productDetailsCache, setProductDetailsCache] = useState<Map<string, InboundDetailItem[]>>(new Map());
  const [productDetailLoading, setProductDetailLoading] = useState<string | null>(null);

  const fetchOverview = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/warehouse/overview?user_role=${userRole}`);
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setOverview(data.overview);
          setLastRefresh(new Date());
        }
      }
    } catch (error) {
      console.error('获取库存概览失败:', error);
    } finally {
      setIsLoading(false);
    }
  }, [userRole]);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  // 自动刷新（每60秒）- 减少服务器负载
  useEffect(() => {
    const interval = setInterval(fetchOverview, 60000);
    return () => clearInterval(interval);
  }, [fetchOverview]);

  // 加载指定位置的库存明细
  const fetchLocationDetails = useCallback(async (locationId: number, isShowroom: boolean) => {
    setDetailsLoading(true);
    try {
      const invUrl = `${API_BASE_URL}/api/warehouse/inventory?location_id=${locationId}&limit=500${isShowroom ? '&include_available=true' : ''}`;
      const invRes = await fetch(invUrl);
      const invData = invRes.ok ? await invRes.json() : [];

      const items: InventoryItem[] = (Array.isArray(invData) ? invData : [])
        .map((item: any) => ({
          product_name: item.product_name,
          product_code: item.product_code || '-',
          weight: item.weight || 0,
          available_weight: item.available_weight,
        }))
        .sort((a: InventoryItem, b: InventoryItem) => b.weight - a.weight);

      setLocationDetails(items);
    } catch (error) {
      console.error('加载库存明细失败:', error);
      setLocationDetails([]);
    } finally {
      setDetailsLoading(false);
    }
  }, []);

  // 切换展开/收起
  const toggleLocation = useCallback((type: 'warehouse' | 'showroom') => {
    if (expandedLocation === type) {
      setExpandedLocation(null);
      setLocationDetails([]);
    } else {
      setExpandedLocation(type);
      const locationId = type === 'warehouse'
        ? overview?.warehouse?.location_id
        : overview?.showroom?.location_id;
      if (locationId) fetchLocationDetails(locationId, type === 'showroom');
    }
  }, [expandedLocation, overview, fetchLocationDetails]);

  const toggleProductExpand = useCallback(async (productName: string) => {
    if (expandedProduct === productName) {
      setExpandedProduct(null);
      return;
    }
    setExpandedProduct(productName);
    if (!productDetailsCache.has(productName)) {
      setProductDetailLoading(productName);
      try {
        const url = `${API_BASE_URL}/api/inventory/by-product-name?product_name=${encodeURIComponent(productName)}&limit=500`;
        const res = await fetch(url);
        if (res.ok) {
          const result = await res.json();
          if (result.success) {
            setProductDetailsCache(prev => new Map(prev).set(productName, result.data || []));
          }
        }
      } catch {
        // UI will show empty state
      } finally {
        setProductDetailLoading(null);
      }
    }
  }, [expandedProduct, productDetailsCache]);

  if (isLoading && !overview) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200/60 p-6 mb-6">
        <div className="flex items-center justify-center py-8">
          <RefreshCw className="w-6 h-6 text-gray-400 animate-spin" />
          <span className="ml-2 text-gray-500">加载中...</span>
        </div>
      </div>
    );
  }

  // 根据角色决定显示哪些内容
  const showWarehouse = userRole === 'product' || userRole === 'manager';
  const showShowroom = userRole === 'counter' || userRole === 'settlement' || userRole === 'manager';
  const isManager = userRole === 'manager';

  return (
    <div className="bg-gradient-to-br from-white to-gray-50 rounded-2xl border border-gray-200/60 shadow-sm mb-6 overflow-hidden">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
            isManager ? 'bg-purple-500' : showWarehouse ? 'bg-amber-500' : 'bg-blue-500'
          }`}>
            {isManager ? (
              <Package className="w-5 h-5 text-white" />
            ) : showWarehouse ? (
              <Warehouse className="w-5 h-5 text-white" />
            ) : (
              <Store className="w-5 h-5 text-white" />
            )}
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">
              {isManager ? '全局库存概览' : showWarehouse ? '商品部仓库' : '展厅库存'}
            </h3>
            <p className="text-xs text-gray-500">
              上次刷新: {lastRefresh.toLocaleTimeString('zh-CN')}
            </p>
          </div>
        </div>
        <button
          onClick={fetchOverview}
          disabled={isLoading}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
          title="刷新"
        >
          <RefreshCw className={`w-5 h-5 text-gray-500 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* 库存卡片 */}
      <div className="p-6">
        <div className={`grid gap-4 mb-4 ${isManager ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
          {/* 商品部仓库 */}
          {showWarehouse && overview?.warehouse && (
            <div>
              <div
                className="bg-amber-50 rounded-xl p-4 border border-amber-100 cursor-pointer hover:bg-amber-100/60 transition-colors"
                onClick={() => toggleLocation('warehouse')}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Warehouse className="w-5 h-5 text-amber-600" />
                    <span className="font-medium text-amber-900">{overview.warehouse.location_name}</span>
                  </div>
                  {expandedLocation === 'warehouse'
                    ? <ChevronUp className="w-5 h-5 text-amber-400" />
                    : <ChevronDown className="w-5 h-5 text-amber-400" />
                  }
                </div>
                <div className="text-3xl font-bold text-amber-700 mb-1">
                  {(overview.warehouse.total_weight ?? 0).toFixed(3)} <span className="text-lg">g</span>
                </div>
                <div className="text-sm text-amber-600">
                  {overview.warehouse.product_count} 种商品
                </div>
              </div>
              {expandedLocation === 'warehouse' && (
                <div className="mt-2 bg-white rounded-xl border border-amber-100 overflow-hidden">
                  {detailsLoading ? (
                    <div className="flex items-center justify-center py-6">
                      <RefreshCw className="w-5 h-5 text-amber-400 animate-spin" />
                      <span className="ml-2 text-sm text-gray-500">加载明细...</span>
                    </div>
                  ) : locationDetails.length === 0 ? (
                    <div className="text-center text-sm text-gray-400 py-6">暂无库存数据</div>
                  ) : (
                    <div className="max-h-96 overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-amber-50/80 sticky top-0">
                          <tr>
                            <th className="px-1 py-2 w-6"></th>
                            <th className="px-3 py-2 text-left font-medium text-amber-800">商品编码</th>
                            <th className="px-3 py-2 text-left font-medium text-amber-800">商品名称</th>
                            <th className="px-3 py-2 text-right font-medium text-amber-800">克重</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {locationDetails.map((item, i) => (
                            <React.Fragment key={i}>
                              <tr className="hover:bg-amber-50/40 cursor-pointer" onClick={() => toggleProductExpand(item.product_name)}>
                                <td className="px-1 py-1.5 text-center">
                                  <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${expandedProduct === item.product_name ? 'rotate-180' : ''}`} />
                                </td>
                                <td className="px-3 py-1.5 text-gray-600 font-mono text-xs">{item.product_code}</td>
                                <td className="px-3 py-1.5 text-gray-800">{item.product_name}</td>
                                <td className="px-3 py-1.5 text-right font-medium text-gray-800">{(item.weight ?? 0).toFixed(3)} g</td>
                              </tr>
                              {expandedProduct === item.product_name && (
                                <tr>
                                  <td colSpan={4} className="bg-amber-50/30 p-0">
                                    <div className="px-4 py-2">
                                      <div className="text-xs text-gray-500 mb-1 font-medium">入库明细：</div>
                                      {productDetailLoading === item.product_name ? (
                                        <div className="text-xs text-gray-400 py-2">加载中...</div>
                                      ) : (productDetailsCache.get(item.product_name) || []).length === 0 ? (
                                        <div className="text-xs text-gray-400 py-2">暂无入库明细</div>
                                      ) : (
                                        <table className="w-full text-xs bg-white rounded border border-gray-200">
                                          <thead className="bg-gray-50">
                                            <tr>
                                              <th className="px-2 py-1 text-left text-gray-500">编码</th>
                                              <th className="px-2 py-1 text-right text-gray-500">克重</th>
                                              <th className="px-2 py-1 text-right text-gray-500">克工费</th>
                                              <th className="px-2 py-1 text-left text-gray-500">供应商</th>
                                              <th className="px-2 py-1 text-left text-gray-500">入库时间</th>
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-gray-100">
                                            {(productDetailsCache.get(item.product_name) || []).map((d) => (
                                              <tr key={d.id} className="hover:bg-gray-50">
                                                <td className="px-2 py-1 font-mono text-blue-600">
                                                  {d.product_code}
                                                  {d.source === 'product_codes' && <span className="ml-1 text-amber-500">（仅编码）</span>}
                                                </td>
                                                <td className="px-2 py-1 text-right">{d.source === 'product_codes' ? '-' : `${d.weight.toFixed(3)}g`}</td>
                                                <td className="px-2 py-1 text-right">{d.source === 'product_codes' ? '-' : `¥${d.labor_cost}/g`}</td>
                                                <td className="px-2 py-1 text-gray-600">{d.supplier || '-'}</td>
                                                <td className="px-2 py-1 text-gray-500">{d.inbound_time || '-'}</td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          ))}
                        </tbody>
                        <tfoot className="bg-amber-50/80 sticky bottom-0">
                          <tr>
                            <td className="px-1 py-2"></td>
                            <td className="px-3 py-2 font-medium text-amber-800">合计</td>
                            <td className="px-3 py-2 text-gray-500 text-xs">{locationDetails.length} 种</td>
                            <td className="px-3 py-2 text-right font-bold text-amber-800">
                              {locationDetails.reduce((s, d) => s + (d.weight ?? 0), 0).toFixed(3)} g
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 展厅 */}
          {showShowroom && overview?.showroom && (
            <div>
              <div
                className="bg-blue-50 rounded-xl p-4 border border-blue-100 cursor-pointer hover:bg-blue-100/60 transition-colors"
                onClick={() => toggleLocation('showroom')}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Store className="w-5 h-5 text-blue-600" />
                    <span className="font-medium text-blue-900">{overview.showroom.location_name}</span>
                  </div>
                  {expandedLocation === 'showroom'
                    ? <ChevronUp className="w-5 h-5 text-blue-400" />
                    : <ChevronDown className="w-5 h-5 text-blue-400" />
                  }
                </div>
                <div className="text-3xl font-bold text-blue-700 mb-1">
                  {(overview.showroom.total_weight ?? 0).toFixed(3)} <span className="text-lg">g</span>
                </div>
                <div className="text-sm text-blue-600">
                  {overview.showroom.product_count} 种商品
                </div>
              </div>
              {expandedLocation === 'showroom' && (
                <div className="mt-2 bg-white rounded-xl border border-blue-100 overflow-hidden">
                  {detailsLoading ? (
                    <div className="flex items-center justify-center py-6">
                      <RefreshCw className="w-5 h-5 text-blue-400 animate-spin" />
                      <span className="ml-2 text-sm text-gray-500">加载明细...</span>
                    </div>
                  ) : locationDetails.length === 0 ? (
                    <div className="text-center text-sm text-gray-400 py-6">暂无库存数据</div>
                  ) : (
                    <>
                      <div className="max-h-96 overflow-y-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-blue-50/80 sticky top-0">
                            <tr>
                              <th className="px-1 py-2 w-6"></th>
                              <th className="px-3 py-2 text-left font-medium text-blue-800">商品编码</th>
                              <th className="px-3 py-2 text-left font-medium text-blue-800">商品名称</th>
                              <th className="px-3 py-2 text-right font-medium text-blue-800">克重</th>
                              {locationDetails.some(d => d.available_weight !== undefined) && (
                                <th className="px-3 py-2 text-right font-medium text-blue-800">可用</th>
                              )}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {locationDetails.map((item, i) => {
                              const hasAvailable = locationDetails.some(d => d.available_weight !== undefined);
                              const colCount = hasAvailable ? 5 : 4;
                              return (
                                <React.Fragment key={i}>
                                  <tr className="hover:bg-blue-50/40 cursor-pointer" onClick={() => toggleProductExpand(item.product_name)}>
                                    <td className="px-1 py-1.5 text-center">
                                      <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${expandedProduct === item.product_name ? 'rotate-180' : ''}`} />
                                    </td>
                                    <td className="px-3 py-1.5 text-gray-600 font-mono text-xs">{item.product_code}</td>
                                    <td className="px-3 py-1.5 text-gray-800">{item.product_name}</td>
                                    <td className="px-3 py-1.5 text-right font-medium text-gray-800">{(item.weight ?? 0).toFixed(3)} g</td>
                                    {hasAvailable && (
                                      <td className="px-3 py-1.5 text-right font-medium text-emerald-700">
                                        {(item.available_weight ?? item.weight ?? 0).toFixed(3)} g
                                      </td>
                                    )}
                                  </tr>
                                  {expandedProduct === item.product_name && (
                                    <tr>
                                      <td colSpan={colCount} className="bg-blue-50/30 p-0">
                                        <div className="px-4 py-2">
                                          <div className="text-xs text-gray-500 mb-1 font-medium">入库明细：</div>
                                          {productDetailLoading === item.product_name ? (
                                            <div className="text-xs text-gray-400 py-2">加载中...</div>
                                          ) : (productDetailsCache.get(item.product_name) || []).length === 0 ? (
                                            <div className="text-xs text-gray-400 py-2">暂无入库明细</div>
                                          ) : (
                                            <table className="w-full text-xs bg-white rounded border border-gray-200">
                                              <thead className="bg-gray-50">
                                                <tr>
                                                  <th className="px-2 py-1 text-left text-gray-500">编码</th>
                                                  <th className="px-2 py-1 text-right text-gray-500">克重</th>
                                                  <th className="px-2 py-1 text-right text-gray-500">克工费</th>
                                                  <th className="px-2 py-1 text-left text-gray-500">供应商</th>
                                                  <th className="px-2 py-1 text-left text-gray-500">入库时间</th>
                                                </tr>
                                              </thead>
                                              <tbody className="divide-y divide-gray-100">
                                                {(productDetailsCache.get(item.product_name) || []).map((d) => (
                                                  <tr key={d.id} className="hover:bg-gray-50">
                                                    <td className="px-2 py-1 font-mono text-blue-600">
                                                      {d.product_code}
                                                      {d.source === 'product_codes' && <span className="ml-1 text-amber-500">（仅编码）</span>}
                                                    </td>
                                                    <td className="px-2 py-1 text-right">{d.source === 'product_codes' ? '-' : `${d.weight.toFixed(3)}g`}</td>
                                                    <td className="px-2 py-1 text-right">{d.source === 'product_codes' ? '-' : `¥${d.labor_cost}/g`}</td>
                                                    <td className="px-2 py-1 text-gray-600">{d.supplier || '-'}</td>
                                                    <td className="px-2 py-1 text-gray-500">{d.inbound_time || '-'}</td>
                                                  </tr>
                                                ))}
                                              </tbody>
                                            </table>
                                          )}
                                        </div>
                                      </td>
                                    </tr>
                                  )}
                                </React.Fragment>
                              );
                            })}
                          </tbody>
                          <tfoot className="bg-blue-50/80 sticky bottom-0">
                            <tr>
                              <td className="px-1 py-2"></td>
                              <td className="px-3 py-2 font-medium text-blue-800">合计</td>
                              <td className="px-3 py-2 text-gray-500 text-xs">{locationDetails.length} 种</td>
                              <td className="px-3 py-2 text-right font-bold text-blue-800">
                                {locationDetails.reduce((s, d) => s + (d.weight ?? 0), 0).toFixed(3)} g
                              </td>
                              {locationDetails.some(d => d.available_weight !== undefined) && (
                                <td className="px-3 py-2 text-right font-bold text-emerald-700">
                                  {locationDetails.reduce((s, d) => s + (d.available_weight ?? d.weight ?? 0), 0).toFixed(3)} g
                                </td>
                              )}
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                      {locationDetails.some(d => d.available_weight !== undefined) && (
                        <p className="px-3 py-2 text-xs text-gray-500 border-t border-blue-50">
                          可用 = 总库存 - 未确认销售单占用
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 管理层显示总库存 */}
        {isManager && overview?.warehouse && overview?.showroom && (
          <div className="bg-purple-50 rounded-xl p-4 border border-purple-100 mb-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-purple-700">总库存</span>
              <span className="text-xl font-bold text-purple-800">
                {((overview.warehouse.total_weight ?? 0) + (overview.showroom.total_weight ?? 0)).toFixed(3)} g
              </span>
            </div>
          </div>
        )}

        {/* 流转信息 */}
        {overview?.transfers && (
          <div className="space-y-2">
            <div className="text-sm font-medium text-gray-600 flex items-center gap-2">
              <RefreshCw className="w-4 h-4" />
              流转中
            </div>
            
            <div className="grid gap-2">
              {/* 商品专员看：转出待接收 */}
              {showWarehouse && !showShowroom && overview.transfers.outgoing_pending && (
                <div className="flex items-center justify-between bg-orange-50 rounded-lg px-4 py-3 border border-orange-100">
                  <div className="flex items-center gap-2">
                    <ArrowRight className="w-4 h-4 text-orange-500" />
                    <span className="text-sm text-orange-800">
                      {overview.transfers.outgoing_pending.description}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="font-semibold text-orange-700">
                      {(overview.transfers.outgoing_pending.total_weight ?? 0).toFixed(3)} g
                    </span>
                    <span className="text-xs text-orange-500 ml-2">
                      ({overview.transfers.outgoing_pending.count}批)
                    </span>
                  </div>
                </div>
              )}

              {/* 商品专员看：展厅退货中 */}
              {showWarehouse && !showShowroom && overview.transfers.return_to_warehouse && overview.transfers.return_to_warehouse.count > 0 && (
                <div className="flex items-center justify-between bg-green-50 rounded-lg px-4 py-3 border border-green-100">
                  <div className="flex items-center gap-2">
                    <ArrowLeft className="w-4 h-4 text-green-500" />
                    <span className="text-sm text-green-800">
                      {overview.transfers.return_to_warehouse.description}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="font-semibold text-green-700">
                      {(overview.transfers.return_to_warehouse.total_weight ?? 0).toFixed(3)} g
                    </span>
                    <span className="text-xs text-green-500 ml-2">
                      ({overview.transfers.return_to_warehouse.count}批)
                    </span>
                  </div>
                </div>
              )}

              {/* 柜台/结算看：待接收 */}
              {showShowroom && !showWarehouse && overview.transfers.incoming_pending && (
                <div className="flex items-center justify-between bg-green-50 rounded-lg px-4 py-3 border border-green-100">
                  <div className="flex items-center gap-2">
                    <ArrowLeft className="w-4 h-4 text-green-500" />
                    <span className="text-sm text-green-800">
                      {overview.transfers.incoming_pending.description}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="font-semibold text-green-700">
                      {(overview.transfers.incoming_pending.total_weight ?? 0).toFixed(3)} g
                    </span>
                    <span className="text-xs text-green-500 ml-2">
                      ({overview.transfers.incoming_pending.count}批)
                    </span>
                  </div>
                </div>
              )}

              {/* 柜台/结算看：退货处理中 */}
              {showShowroom && !showWarehouse && overview.transfers.return_to_showroom && overview.transfers.return_to_showroom.count > 0 && (
                <div className="flex items-center justify-between bg-orange-50 rounded-lg px-4 py-3 border border-orange-100">
                  <div className="flex items-center gap-2">
                    <ArrowRight className="w-4 h-4 text-orange-500" />
                    <span className="text-sm text-orange-800">
                      {overview.transfers.return_to_showroom.description}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="font-semibold text-orange-700">
                      {(overview.transfers.return_to_showroom.total_weight ?? 0).toFixed(3)} g
                    </span>
                    <span className="text-xs text-orange-500 ml-2">
                      ({overview.transfers.return_to_showroom.count}批)
                    </span>
                  </div>
                </div>
              )}

              {/* 管理层看全部流转信息 */}
              {isManager && (
                <>
                  {overview.transfers.outgoing_pending && overview.transfers.outgoing_pending.count > 0 && (
                    <div className="flex items-center justify-between bg-orange-50 rounded-lg px-4 py-3 border border-orange-100">
                      <div className="flex items-center gap-2">
                        <ArrowRight className="w-4 h-4 text-orange-500" />
                        <span className="text-sm text-orange-800">
                          商品部→展厅 待接收
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="font-semibold text-orange-700">
                          {(overview.transfers.outgoing_pending.total_weight ?? 0).toFixed(3)} g
                        </span>
                        <span className="text-xs text-orange-500 ml-2">
                          ({overview.transfers.outgoing_pending.count}批)
                        </span>
                      </div>
                    </div>
                  )}
                  {overview.transfers.return_to_warehouse && overview.transfers.return_to_warehouse.count > 0 && (
                    <div className="flex items-center justify-between bg-green-50 rounded-lg px-4 py-3 border border-green-100">
                      <div className="flex items-center gap-2">
                        <ArrowLeft className="w-4 h-4 text-green-500" />
                        <span className="text-sm text-green-800">
                          展厅→商品部 退货中
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="font-semibold text-green-700">
                          {(overview.transfers.return_to_warehouse.total_weight ?? 0).toFixed(3)} g
                        </span>
                        <span className="text-xs text-green-500 ml-2">
                          ({overview.transfers.return_to_warehouse.count}批)
                        </span>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* 无流转时显示 */}
              {!isManager && (
                (showWarehouse && !showShowroom && 
                  (!overview.transfers.outgoing_pending || overview.transfers.outgoing_pending.count === 0) &&
                  (!overview.transfers.return_to_warehouse || overview.transfers.return_to_warehouse.count === 0)) ||
                (showShowroom && !showWarehouse &&
                  (!overview.transfers.incoming_pending || overview.transfers.incoming_pending.count === 0) &&
                  (!overview.transfers.return_to_showroom || overview.transfers.return_to_showroom.count === 0))
              ) && (
                <div className="text-center text-sm text-gray-400 py-2">
                  暂无流转中的货品
                </div>
              )}

              {isManager && 
                (!overview.transfers.outgoing_pending || overview.transfers.outgoing_pending.count === 0) &&
                (!overview.transfers.return_to_warehouse || overview.transfers.return_to_warehouse.count === 0) && (
                <div className="text-center text-sm text-gray-400 py-2">
                  暂无流转中的货品
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


