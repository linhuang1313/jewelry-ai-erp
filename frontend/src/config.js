/**
 * config.js - 前端全局配置
 * 集中管理 API 端点、功能开关、路由配置等
 */

// ============================================================
// API 基础配置
// ============================================================

/**
 * API 基础 URL
 * - 开发环境：通过 Vite proxy 转发到后端（同源，无跨域问题）
 * - 生产环境：需设置实际后端地址
 */
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || ''

// ============================================================
// 认证相关端点
// ============================================================

export const AUTH_ENDPOINTS = {
  login: `${API_BASE_URL}/api/auth/login`,
  register: `${API_BASE_URL}/api/auth/register`,
  me: `${API_BASE_URL}/api/auth/me`,
  changePassword: `${API_BASE_URL}/api/auth/change-password`,
  changeUsername: `${API_BASE_URL}/api/auth/change-username`,
}

// ============================================================
// 业务 API 端点
// ============================================================

export const API_ENDPOINTS = {
  // 商品管理
  products: `${API_BASE_URL}/api/products`,
  productsSearch: `${API_BASE_URL}/api/products/search`,
  productsBatch: `${API_BASE_URL}/api/products/batch`,
  productsImport: `${API_BASE_URL}/api/products/import`,
  productsExport: `${API_BASE_URL}/api/products/export`,

  // 客户管理
  customers: `${API_BASE_URL}/api/customers`,
  customersSearch: `${API_BASE_URL}/api/customers/search`,

  // 销售订单
  orders: `${API_BASE_URL}/api/orders`,
  ordersSearch: `${API_BASE_URL}/api/orders/search`,
  ordersPrint: (id) => `${API_BASE_URL}/api/orders/${id}/print`,

  // 库存管理
  inventory: `${API_BASE_URL}/api/inventory`,
  inventoryAdjust: `${API_BASE_URL}/api/inventory/adjust`,

  // 料部管理
  materials: `${API_BASE_URL}/api/materials`,
  materialsTransfer: `${API_BASE_URL}/api/materials/transfer`,

  // 财务结算
  settlements: `${API_BASE_URL}/api/settlements`,
  settlementsReport: `${API_BASE_URL}/api/settlements/report`,

  // OCR & AI
  ocrUpload: `${API_BASE_URL}/api/ocr/upload`,
  aiSearch: `${API_BASE_URL}/api/ai/search`,
  aiSuggest: `${API_BASE_URL}/api/ai/suggest`,

  // 系统
  health: `${API_BASE_URL}/api/health`,
  dbInit: `${API_BASE_URL}/api/db/init`,
  seedAuth: `${API_BASE_URL}/api/auth/seed`,

  // 打印
  printOrder: (id) => `${API_BASE_URL}/api/print/order/${id}`,
  printLabel: (id) => `${API_BASE_URL}/api/print/label/${id}`,
}

// ============================================================
// 功能开关（Feature Flags）
// ============================================================

export const FEATURES = {
  // OCR 功能（需要后端支持）
  ocr: import.meta.env.VITE_ENABLE_OCR === 'true',

  // AI 功能（需要 DeepSeek API Key）
  ai: import.meta.env.VITE_ENABLE_AI !== 'false', // 默认开启

  // 向量搜索
  vectorSearch: import.meta.env.VITE_ENABLE_VECTOR_SEARCH !== 'false',

  // 批量操作
  batchOperations: true,

  // 数据导出
  dataExport: true,

  // 打印功能
  print: true,
}

// ============================================================
// 分页配置
// ============================================================

export const PAGINATION = {
  defaultPageSize: 20,
  pageSizeOptions: [10, 20, 50, 100],
}

// ============================================================
// 角色权限配置
// ============================================================

export const ROLES = {
  counter: {
    name: '柜台',
    permissions: ['view_products', 'create_orders', 'view_customers'],
  },
  sales: {
    name: '业务员',
    permissions: ['view_products', 'create_orders', 'view_customers', 'manage_customers'],
  },
  product: {
    name: '商品专员',
    permissions: ['manage_products', 'view_inventory', 'manage_inventory'],
  },
  settlement: {
    name: '结算专员',
    permissions: ['view_orders', 'manage_settlements', 'view_reports'],
  },
  material: {
    name: '料部',
    permissions: ['manage_materials', 'view_inventory'],
  },
  finance: {
    name: '财务',
    permissions: ['view_all', 'manage_finance', 'export_reports'],
  },
  manager: {
    name: '管理层',
    permissions: ['*'], // 所有权限
  },
}

// ============================================================
// 本地存储 Key
// ============================================================

export const STORAGE_KEYS = {
  authToken: 'auth_token',
  authUser: 'auth_user',
  theme: 'app_theme',
  language: 'app_language',
  sidebarCollapsed: 'sidebar_collapsed',
}

// ============================================================
// 系统信息
// ============================================================

export const APP_INFO = {
  name: '珠宝 AI-ERP',
  version: '1.0.0',
  description: '智能珠宝企业资源管理系统',
  company: '珠宝企业',
}
