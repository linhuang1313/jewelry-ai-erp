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
  TRANSFERS: `${API_BASE_URL}/api/warehouse/transfers`,  // 货品转移单列表
  TRANSFER: (id) => `${API_BASE_URL}/api/warehouse/transfers/${id}`,  // 转移单详情
  TRANSFER_RECEIVE: (id) => `${API_BASE_URL}/api/warehouse/transfers/${id}/receive`,  // 接收转移
  TRANSFER_REJECT: (id) => `${API_BASE_URL}/api/warehouse/transfers/${id}/reject`,  // 拒收转移
  INIT_DEFAULT_LOCATIONS: `${API_BASE_URL}/api/warehouse/init-default-locations`,  // 初始化默认位置
  
  // 导出 API_BASE_URL 供服务使用
  API_BASE_URL,
};

export default {
  API_BASE_URL,
  API_ENDPOINTS,
};

