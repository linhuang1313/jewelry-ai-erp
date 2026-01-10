import React, { useState } from 'react';
import { Check, AlertCircle, Package, Download, Printer } from 'lucide-react';
import type { JewelryInboundCard, CardActions } from '../types/inbound';
import { API_ENDPOINTS, API_BASE_URL } from '../config';

interface JewelryInboundCardProps {
  data: JewelryInboundCard;
  actions: CardActions;
  disabled?: boolean;
  className?: string;
}

/**
 * 珠宝入库核对卡片组件
 */
export const JewelryInboundCardComponent: React.FC<JewelryInboundCardProps> = ({
  data,
  actions,
  disabled = false,
  className = '',
}) => {
  const [isConfirming, setIsConfirming] = useState(false);
  const [isReporting, setIsReporting] = useState(false);

  const handleConfirm = async () => {
    if (disabled || data.status !== 'pending') return;
    setIsConfirming(true);
    try {
      await actions.onConfirm(data);
    } catch (error) {
      console.error('确认入库失败:', error);
    } finally {
      setIsConfirming(false);
    }
  };

  const handleReportError = async () => {
    if (disabled || data.status !== 'pending') return;
    setIsReporting(true);
    try {
      await actions.onReportError(data);
    } catch (error) {
      console.error('数据报错失败:', error);
    } finally {
      setIsReporting(false);
    }
  };

  // 计算总工费
  const totalLaborCost = data.goldWeight * data.laborCostPerGram;
  
  // 计算总成本（如果提供了金价，总成本 = 金重 × (金价 + 工费)；否则只计算工费）
  const totalCost = data.totalCost ?? (
    data.goldPrice 
      ? data.goldWeight * (data.goldPrice + data.laborCostPerGram)
      : totalLaborCost
  );

  return (
    <div className={`bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200 overflow-hidden border border-gray-200 ${className}`}>
      {/* 顶部状态条 */}
      {data.status === 'pending' && (
        <div className="bg-yellow-50 border-b border-yellow-200 px-4 py-2">
          <p className="text-xs text-yellow-800 flex items-center gap-1">
            <AlertCircle size={14} />
            待核对入库
          </p>
        </div>
      )}

      {data.status === 'error' && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-2">
          <p className="text-xs text-red-800 flex items-center gap-1">
            <AlertCircle size={14} />
            {data.errorMessage || '数据有误'}
          </p>
        </div>
      )}

      {data.status === 'confirmed' && (
        <div className="bg-green-50 border-b border-green-200 px-4 py-2">
          <p className="text-xs text-green-800 flex items-center gap-1">
            <Check size={14} />
            已确认入库
            {data.orderNo && <span className="ml-2">({data.orderNo})</span>}
          </p>
        </div>
      )}

      <div className="p-5">
        {/* 主要信息区 */}
        <div className="flex gap-4 mb-4">
          {/* 左侧：产品图标 */}
          <div className="flex-shrink-0">
            <div className="w-20 h-20 bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg flex items-center justify-center">
              <Package className="text-blue-600" size={32} />
            </div>
          </div>

          {/* 右侧：产品信息 */}
          <div className="flex-1 min-w-0">
            {/* 产品名称 */}
            <h3 className="text-lg font-semibold text-gray-900 mb-1 truncate">
              {data.productName}
            </h3>
            
            {data.productCategory && (
              <p className="text-xs text-gray-500 mb-2">{data.productCategory}</p>
            )}
            
            {/* 条码 */}
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs text-gray-500">条码:</span>
              <code className="text-xs font-mono bg-gray-100 px-2 py-1 rounded">
                {data.barcode}
              </code>
            </div>

            {/* 供应商 */}
            <p className="text-sm text-gray-600">
              供应商: <span className="font-medium">{data.supplier.name}</span>
              {data.supplier.supplierNo && (
                <span className="text-gray-500 ml-1">({data.supplier.supplierNo})</span>
              )}
            </p>
          </div>
        </div>

        {/* 详细参数网格 */}
        <div className="grid grid-cols-2 gap-3 mb-4 p-3 bg-gray-50 rounded-lg">
          {/* 金重 */}
          <div>
            <p className="text-xs text-gray-500 mb-1">金重</p>
            <p className="text-sm font-semibold text-gray-900">
              {data.goldWeight.toFixed(2)} 克
            </p>
          </div>

          {/* 克工费 */}
          <div>
            <p className="text-xs text-gray-500 mb-1">克工费</p>
            <p className="text-sm font-semibold text-gray-900">
              ¥{data.laborCostPerGram.toFixed(2)}/克
            </p>
          </div>

          {/* 当日金价（如果有） */}
          {data.goldPrice !== undefined && (
            <div>
              <p className="text-xs text-gray-500 mb-1">当日金价</p>
              <p className="text-sm font-semibold text-gray-900">
                ¥{data.goldPrice.toFixed(2)}/克
              </p>
            </div>
          )}

          {/* 总工费 */}
          <div>
            <p className="text-xs text-gray-500 mb-1">总工费</p>
            <p className="text-sm font-semibold text-gray-900">
              ¥{totalLaborCost.toFixed(2)}
            </p>
          </div>
        </div>

        {/* 配石详情（如果有） */}
        {data.gemstones && data.gemstones.length > 0 && (
          <div className="mb-4 p-3 bg-purple-50 rounded-lg border border-purple-200">
            <p className="text-xs text-purple-800 font-semibold mb-2">配石详情</p>
            <div className="space-y-1">
              {data.gemstones.map((gem, index) => (
                <div key={index} className="flex justify-between text-xs">
                  <span className="text-purple-700">
                    {gem.stoneType}
                    {gem.quality && <span className="text-purple-500 ml-1">({gem.quality})</span>}
                  </span>
                  <span className="text-purple-900 font-medium">
                    {gem.weight}ct / {gem.quantity}粒
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 总成本 */}
        <div className="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
          <div className="flex justify-between items-center">
            <span className="text-sm text-blue-800 font-medium">总成本</span>
            <span className="text-xl font-bold text-blue-900">
              ¥{totalCost.toFixed(2)}
            </span>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-3">
          {/* 确认入库按钮 */}
          <button
            onClick={handleConfirm}
            disabled={disabled || isConfirming || isReporting || data.status !== 'pending'}
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium py-2.5 px-4 rounded-lg transition-colors duration-200 flex items-center justify-center gap-2"
          >
            {isConfirming ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                处理中...
              </>
            ) : (
              <>
                <Check size={16} />
                确认入库
              </>
            )}
          </button>

          {/* 数据报错按钮 */}
          <button
            onClick={handleReportError}
            disabled={disabled || isConfirming || isReporting || data.status !== 'pending'}
            className="px-4 py-2.5 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 disabled:text-gray-400 disabled:hover:bg-transparent disabled:cursor-not-allowed rounded-lg transition-colors duration-200 flex items-center gap-2"
          >
            {isReporting ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                处理中...
              </>
            ) : (
              <>
                <AlertCircle size={16} />
                数据报错
              </>
            )}
          </button>
        </div>
        
        {/* 已确认入库后的下载和打印按钮 */}
        {data.status === 'confirmed' && data.orderId && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <div className="flex gap-3">
              <button
                onClick={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  
                  if (!data.orderId) {
                    console.error('入库单ID不存在，无法下载');
                    alert('入库单ID不存在，无法下载');
                    return;
                  }
                  
                  try {
                    console.log('准备下载入库单，orderId:', data.orderId);
                    console.log('orderId类型:', typeof data.orderId);
                    console.log('orderNo:', data.orderNo);
                    console.log('完整卡片数据:', data);
                    
                    // 确保orderId是有效的数字
                    if (!data.orderId) {
                      throw new Error(`入库单ID不存在。请确认入库操作是否成功完成。`);
                    }
                    
                    const orderId = Number(data.orderId);
                    if (!orderId || isNaN(orderId) || orderId <= 0) {
                      throw new Error(`无效的入库单ID: ${data.orderId} (类型: ${typeof data.orderId})`);
                    }
                    
                    // 下载PDF - 确保URL正确构建
                    const baseUrl = API_ENDPOINTS.API_BASE_URL || 'http://localhost:8000';
                    const url = `${baseUrl}/api/inbound-orders/${orderId}/download?format=pdf`;
                    console.log('下载URL:', url);
                    console.log('API_BASE_URL:', baseUrl);
                    console.log('orderId:', orderId);
                    
                    // 使用 fetch 下载，确保正确处理
                    const response = await fetch(url, {
                      method: 'GET',
                      headers: {
                        'Accept': 'application/pdf',
                      },
                    });
                    
                    if (!response.ok) {
                      throw new Error(`下载失败: ${response.status} ${response.statusText}`);
                    }
                    
                    // 获取 blob 数据
                    const blob = await response.blob();
                    const downloadUrl = window.URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = downloadUrl;
                    link.download = `入库单_${data.orderNo || data.orderId}.pdf`;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    window.URL.revokeObjectURL(downloadUrl);
                    
                    console.log('下载成功');
                  } catch (error) {
                    console.error('下载入库单失败:', error);
                    alert(`下载失败: ${error instanceof Error ? error.message : '未知错误'}`);
                  }
                }}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 px-4 rounded-lg transition-colors duration-200 flex items-center justify-center gap-2"
              >
                <Download size={16} />
                下载入库单
              </button>
              <button
                onClick={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  
                  if (!data.orderId) {
                    console.error('入库单ID不存在，无法打印');
                    alert('入库单ID不存在，无法打印');
                    return;
                  }
                  
                  try {
                    console.log('准备打印入库单，orderId:', data.orderId);
                    console.log('orderId类型:', typeof data.orderId);
                    console.log('orderNo:', data.orderNo);
                    
                    // 确保orderId是有效的数字
                    const orderId = Number(data.orderId);
                    if (!orderId || isNaN(orderId) || orderId <= 0) {
                      throw new Error(`无效的入库单ID: ${data.orderId}`);
                    }
                    
                    // 打印（打开HTML版本）- 确保URL正确构建
                    const baseUrl = API_BASE_URL || API_ENDPOINTS.API_BASE_URL || 'http://localhost:8000';
                    if (!baseUrl || baseUrl.startsWith(':')) {
                      throw new Error(`API_BASE_URL配置错误: ${baseUrl}`);
                    }
                    const url = `${baseUrl}/api/inbound-orders/${orderId}/download?format=html`;
                    console.log('打印URL:', url);
                    console.log('API_BASE_URL:', baseUrl);
                    console.log('orderId:', orderId);
                    
                    const printWindow = window.open(url, '_blank');
                    if (printWindow) {
                      printWindow.addEventListener('load', () => {
                        setTimeout(() => {
                          printWindow.print();
                        }, 500);
                      });
                      
                      // 如果窗口被阻止，尝试直接打开
                      if (!printWindow || printWindow.closed || typeof printWindow.closed === 'undefined') {
                        // 如果弹窗被阻止，使用 iframe 方式
                        const iframe = document.createElement('iframe');
                        iframe.style.display = 'none';
                        iframe.src = url;
                        document.body.appendChild(iframe);
                        iframe.onload = () => {
                          setTimeout(() => {
                            iframe.contentWindow?.print();
                            document.body.removeChild(iframe);
                          }, 500);
                        };
                      }
                    } else {
                      // 如果弹窗被阻止，提示用户
                      alert('请允许弹窗以进行打印，或手动访问: ' + url);
                    }
                  } catch (error) {
                    console.error('打印入库单失败:', error);
                    alert(`打印失败: ${error instanceof Error ? error.message : '未知错误'}`);
                  }
                }}
                className="flex-1 bg-green-600 hover:bg-green-700 text-white font-medium py-2.5 px-4 rounded-lg transition-colors duration-200 flex items-center justify-center gap-2"
              >
                <Printer size={16} />
                打印入库单
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default JewelryInboundCardComponent;
