// API 配置
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

export const API_ENDPOINTS = {
  CHAT: `${API_BASE_URL}/api/chat`,
  CHAT_STREAM: `${API_BASE_URL}/api/chat-stream`,  // 流式聊天端点
  RECOGNIZE_INBOUND_SHEET: `${API_BASE_URL}/api/recognize-inbound-sheet`,
  // 入库相关
  INBOUND_ORDERS: `${API_BASE_URL}/api/inbound-orders`,  // 入库单列表
  INBOUND_ORDER: (id) => `${API_BASE_URL}/api/inbound-orders/${id}`,  // 入库单详情
  INBOUND_ORDER_DOWNLOAD: (orderId, format = 'pdf') => `${API_BASE_URL}/api/inbound-orders/${orderId}/download?format=${format}`,  // 下载入库单
  SUPPLIERS: `${API_BASE_URL}/api/suppliers`,  // 供应商列表
  SUPPLIER: (id) => `${API_BASE_URL}/api/suppliers/${id}`,  // 供应商详情
  // 错误报告
  REPORT_ERROR: `${API_BASE_URL}/api/report-error`,  // 错误报告端点
  
  // 仓库管理相关
  LOCATIONS: `${API_BASE_URL}/api/warehouse/locations`,  // 仓库/位置列表
  LOCATION: (id) => `${API_BASE_URL}/api/warehouse/locations/${id}`,  // 仓库/位置详情
  LOCATION_INVENTORY: `${API_BASE_URL}/api/warehouse/inventory`,  // 分仓库存
  INVENTORY_SUMMARY: `${API_BASE_URL}/api/warehouse/inventory/summary`,  // 库存汇总
  // 转移单
  TRANSFERS_BATCH: `${API_BASE_URL}/api/warehouse/transfers/batch`,  // 批量转移
  TRANSFER_ORDERS: `${API_BASE_URL}/api/warehouse/transfer-orders`,  // 转移单列表
  TRANSFER_ORDER: (id) => `${API_BASE_URL}/api/warehouse/transfer-orders/${id}`,  // 转移单详情
  TRANSFER_ORDER_RECEIVE: (id) => `${API_BASE_URL}/api/warehouse/transfer-orders/${id}/receive`,  // 整单接收
  TRANSFER_ORDER_REJECT: (id) => `${API_BASE_URL}/api/warehouse/transfer-orders/${id}/reject`,  // 整单拒收
  TRANSFER_ORDER_CONFIRM: (id) => `${API_BASE_URL}/api/warehouse/transfer-orders/${id}/confirm`,  // 商品部确认（同意）
  TRANSFER_ORDER_REJECT_CONFIRM: (id) => `${API_BASE_URL}/api/warehouse/transfer-orders/${id}/reject-confirm`,  // 商品部拒绝确认
  TRANSFER_ORDER_UPDATE_ACTUAL: (id) => `${API_BASE_URL}/api/warehouse/transfer-orders/${id}/update-actual`,  // 商品部更新实际重量
  TRANSFER_ORDER_RESUBMIT: (id) => `${API_BASE_URL}/api/warehouse/transfer-orders/${id}/resubmit`,  // 重新发起退回的转移单
  TRANSFER_ORDER_DOWNLOAD: (id, format = 'html') => `${API_BASE_URL}/api/warehouse/transfer-orders/${id}/download?format=${format}`,  // 下载进货单
  
  INIT_DEFAULT_LOCATIONS: `${API_BASE_URL}/api/warehouse/init-default-locations`,  // 初始化默认位置
  
  // 结算管理相关
  PENDING_SALES: `${API_BASE_URL}/api/settlement/pending-sales`,  // 待结算销售单
  SETTLEMENT_ORDERS: `${API_BASE_URL}/api/settlement/orders`,  // 结算单列表
  SETTLEMENT_ORDER: (id) => `${API_BASE_URL}/api/settlement/orders/${id}`,  // 结算单详情
  SETTLEMENT_CONFIRM: (id) => `${API_BASE_URL}/api/settlement/orders/${id}/confirm`,  // 确认结算
  SETTLEMENT_PRINT: (id) => `${API_BASE_URL}/api/settlement/orders/${id}/print`,  // 标记已打印
  
  // 入库单确认/反确认
  INBOUND_CONFIRM: (id) => `${API_BASE_URL}/api/inbound-orders/${id}/confirm`,
  INBOUND_UNCONFIRM: (id) => `${API_BASE_URL}/api/inbound-orders/${id}/unconfirm`,
  
  // 销售单确认/反确认
  SALES_CONFIRM: (id) => `${API_BASE_URL}/api/sales/orders/${id}/confirm`,
  SALES_UNCONFIRM: (id) => `${API_BASE_URL}/api/sales/orders/${id}/unconfirm`,
  
  // 退货管理相关
  RETURNS: `${API_BASE_URL}/api/returns`,  // 退货单列表/操作
  RETURN_CONFIRM: (id) => `${API_BASE_URL}/api/returns/${id}/confirm`,
  RETURN_UNCONFIRM: (id) => `${API_BASE_URL}/api/returns/${id}/unconfirm`,
  
  // 导出 API_BASE_URL 供服务使用
  API_BASE_URL,
};

export default {
  API_BASE_URL,
  API_ENDPOINTS,
};

