import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Package, Store, ArrowRight, ArrowLeft, Warehouse } from 'lucide-react';
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

interface InventoryOverviewProps {
  userRole: string;
}

export default function InventoryOverview({ userRole }: InventoryOverviewProps) {
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

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

  // 自动刷新（每30秒）
  useEffect(() => {
    const interval = setInterval(fetchOverview, 30000);
    return () => clearInterval(interval);
  }, [fetchOverview]);

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
            <div className="bg-amber-50 rounded-xl p-4 border border-amber-100">
              <div className="flex items-center gap-2 mb-3">
                <Warehouse className="w-5 h-5 text-amber-600" />
                <span className="font-medium text-amber-900">{overview.warehouse.location_name}</span>
              </div>
              <div className="text-3xl font-bold text-amber-700 mb-1">
                {overview.warehouse.total_weight.toFixed(2)} <span className="text-lg">g</span>
              </div>
              <div className="text-sm text-amber-600">
                {overview.warehouse.product_count} 种商品
              </div>
            </div>
          )}

          {/* 展厅 */}
          {showShowroom && overview?.showroom && (
            <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
              <div className="flex items-center gap-2 mb-3">
                <Store className="w-5 h-5 text-blue-600" />
                <span className="font-medium text-blue-900">{overview.showroom.location_name}</span>
              </div>
              <div className="text-3xl font-bold text-blue-700 mb-1">
                {overview.showroom.total_weight.toFixed(2)} <span className="text-lg">g</span>
              </div>
              <div className="text-sm text-blue-600">
                {overview.showroom.product_count} 种商品
              </div>
            </div>
          )}
        </div>

        {/* 管理层显示总库存 */}
        {isManager && overview?.warehouse && overview?.showroom && (
          <div className="bg-purple-50 rounded-xl p-4 border border-purple-100 mb-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-purple-700">总库存</span>
              <span className="text-xl font-bold text-purple-800">
                {(overview.warehouse.total_weight + overview.showroom.total_weight).toFixed(2)} g
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
                      {overview.transfers.outgoing_pending.total_weight.toFixed(2)} g
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
                      {overview.transfers.return_to_warehouse.total_weight.toFixed(2)} g
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
                      {overview.transfers.incoming_pending.total_weight.toFixed(2)} g
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
                      {overview.transfers.return_to_showroom.total_weight.toFixed(2)} g
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
                          {overview.transfers.outgoing_pending.total_weight.toFixed(2)} g
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
                          {overview.transfers.return_to_warehouse.total_weight.toFixed(2)} g
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


