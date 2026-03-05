import React from 'react'

// 已有组件直接引用（后续可逐步改为懒加载）
import { FinancePage } from './components/finance'
import { AnalyticsPage } from './components/AnalyticsPage'
import DashboardPage from './components/DashboardPage'
import ManagerDashboardPage from './components/ManagerDashboardPage'
import { ExportPage } from './components/ExportPage'
import { WarehousePage } from './components/WarehousePage'
import { SettlementPage } from './components/SettlementPage'
import { SalespersonPage } from './components/SalespersonPage'
import { CustomerPage } from './components/CustomerPage'
import { SupplierPage } from './components/SupplierPage'
import ReturnPage from './components/ReturnPage'
import GoldMaterialPage from './components/GoldMaterialPage'
import LoanPage from './components/LoanPage'
import DocumentCenterPage from './components/DocumentCenterPage'
import ProductCodePage from './components/ProductCodePage'
import LabelDesignPage from './components/LabelDesignPage'
import InboundOrdersPage from './components/InboundOrdersPage'
import SalesReturnPage from './components/SalesReturnPage'
import VoucherManagement from './components/VoucherManagement'
import FinanceSettings from './components/FinanceSettings'
import FinanceClosing from './components/FinanceClosing'
import FinanceReports from './components/FinanceReports'
import FinanceAdminManagement from './components/FinanceAdminManagement'
import CustomerAccountPage from './components/CustomerAccountPage'

/**
 * currentPage 值与 URL 路径的映射
 * 用于 Header/Sidebar 导航和路由匹配
 */
export const PAGE_PATH_MAP = {
  'chat': '/',
  'finance': '/finance',
  'finance-closing': '/finance-closing',
  'finance-admin': '/finance-admin',
  'voucher': '/voucher',
  'finance-settings': '/finance-settings',
  'finance-reports': '/finance-reports',
  'warehouse': '/warehouse',
  'settlement': '/settlement',
  'analytics': '/analytics',
  'export': '/export',
  'salesperson': '/salesperson',
  'customer': '/customer',
  'supplier': '/supplier',
  'returns': '/returns',
  'gold-material': '/gold-material',
  'loan': '/loan',
  'sales-returns': '/sales-returns',
  'document-center': '/document-center',
  'product-codes': '/product-codes',
  'label-design': '/label-design',
  'inbound-orders': '/inbound-orders',
  'dashboard': '/dashboard',
}

// 反向映射：URL 路径 → currentPage 值
export const PATH_PAGE_MAP = Object.fromEntries(
  Object.entries(PAGE_PATH_MAP).map(([page, path]) => [path, page])
)

/**
 * 将 currentPage 值转为 URL 路径
 */
export function pageToPath(page) {
  if (typeof page === 'object') return '/'
  return PAGE_PATH_MAP[page] || '/'
}

/**
 * 将 URL 路径转为 currentPage 值
 */
export function pathToPage(path) {
  return PATH_PAGE_MAP[path] || 'chat'
}

export {
  FinancePage,
  AnalyticsPage,
  DashboardPage,
  ManagerDashboardPage,
  ExportPage,
  WarehousePage,
  SettlementPage,
  SalespersonPage,
  CustomerPage,
  SupplierPage,
  ReturnPage,
  GoldMaterialPage,
  LoanPage,
  DocumentCenterPage,
  ProductCodePage,
  LabelDesignPage,
  InboundOrdersPage,
  SalesReturnPage,
  VoucherManagement,
  FinanceSettings,
  FinanceClosing,
  FinanceReports,
  FinanceAdminManagement,
  CustomerAccountPage,
}
