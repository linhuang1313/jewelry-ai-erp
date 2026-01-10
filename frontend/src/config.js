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
  // 导出 API_BASE_URL 供服务使用
  API_BASE_URL,
};

export default {
  API_BASE_URL,
  API_ENDPOINTS,
};

