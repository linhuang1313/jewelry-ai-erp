/**
 * 顶部导航栏组件
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { hasPermission } from '../../config/permissions'
import { USER_ROLES } from '../../constants/roles'
import { 
  DollarSign, ArrowLeft, ChevronDown, BarChart3, Download, 
  Warehouse, Users, UserPlus, FileText, History, Building2, 
  RotateCcw, Package, Calculator, Scale, TrendingUp 
} from 'lucide-react'

export const Header = ({
  currentPage,
  setCurrentPage,
  userRole,
  roleDropdownOpen,
  setRoleDropdownOpen,
  roleLoading,
  roleDropdownRef,
  getCurrentRole,
  changeUserRole,
  sidebarOpen,
  setSidebarOpen,
  pendingTransferCount,
  pendingSalesCount,
  setShowQuickOrderModal,
  setShowSalesSearchModal,
  setShowHistoryPanel,
  currentLanguage,
  i18n
}) => {
  const { t } = useTranslation()

  return (
    <header className="bg-white/80 backdrop-blur-xl border-b border-gray-200/60 px-6 py-4 
                       sticky top-0 z-10 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          {/* 移动端侧边栏开关 */}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="lg:hidden p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          
          <div 
            className="cursor-pointer hover:opacity-80 transition-opacity"
            onClick={() => setCurrentPage('chat')}
            title={currentLanguage === 'en' ? 'Click to return home' : '点击返回首页'}
          >
            <h1 className="text-[28px] font-semibold text-gray-900 tracking-tight">
              {t('app.title')}
            </h1>
            <p className="text-[13px] text-gray-500 mt-0.5">{t('app.subtitle')}</p>
          </div>
        </div>
        
        {/* 右侧按钮区域 */}
        <div className="flex items-center space-x-3">
          {/* 角色选择器 */}
          <div className="relative" ref={roleDropdownRef}>
            <button
              onClick={() => !roleLoading && setRoleDropdownOpen(!roleDropdownOpen)}
              disabled={roleLoading}
              className={`flex items-center space-x-2 px-3 py-2 rounded-xl border border-gray-200
                         hover:bg-gray-50 transition-all duration-200 font-medium text-[14px]
                         ${getCurrentRole().bg} ${roleLoading ? 'opacity-70 cursor-wait' : ''}`}
            >
              {roleLoading ? (
                <svg className="animate-spin w-4 h-4 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : (
                React.createElement(getCurrentRole().icon, { 
                  className: `w-4 h-4 ${getCurrentRole().color}` 
                })
              )}
              <span className={getCurrentRole().color}>
                {roleLoading ? '切换中...' : getCurrentRole().name}
              </span>
              <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-200 
                                      ${roleDropdownOpen ? 'rotate-180' : ''}`} />
            </button>
            
            {/* 角色下拉菜单 */}
            {roleDropdownOpen && (
              <div className="absolute right-0 mt-2 w-44 bg-white rounded-xl shadow-lg border border-gray-100 
                              py-2 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="px-3 py-2 text-xs text-gray-400 font-medium">
                  {currentLanguage === 'en' ? 'Select Role' : '选择角色'}
                </div>
                {USER_ROLES.map((role) => {
                  const IconComponent = role.icon
                  const isActive = userRole === role.id
                  return (
                    <button
                      key={role.id}
                      onClick={() => changeUserRole(role.id)}
                      className={`w-full flex items-center space-x-3 px-3 py-2.5 text-left
                                 hover:bg-gray-50 transition-colors duration-150
                                 ${isActive ? role.bg : ''}`}
                    >
                      <IconComponent className={`w-4 h-4 ${role.color}`} />
                      <span className={`text-[14px] font-medium ${isActive ? role.color : 'text-gray-700'}`}>
                        {role.name}
                      </span>
                      {isActive && (
                        <span className="ml-auto">
                          <svg className={`w-4 h-4 ${role.color}`} fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* 销售管理按钮 */}
          {['counter', 'settlement', 'sales'].includes(userRole) && (
            <button
              onClick={() => setShowSalesSearchModal(true)}
              className="flex items-center space-x-1.5 px-3 py-2 rounded-xl border border-amber-200
                         bg-amber-50 hover:bg-amber-100 transition-all duration-200 font-medium text-[14px] text-amber-700"
              title="销售管理"
            >
              <FileText className="w-4 h-4" />
              <span>销售管理</span>
            </button>
          )}

          {/* 语言切换按钮 */}
          <button
            onClick={() => {
              const newLang = currentLanguage === 'zh' ? 'en' : 'zh'
              i18n.changeLanguage(newLang)
              localStorage.setItem('i18nextLng', newLang)
            }}
            className="flex items-center space-x-1.5 px-3 py-2 rounded-xl border border-gray-200
                       hover:bg-gray-50 transition-all duration-200 font-medium text-[14px] text-gray-600"
            title={t('language.switchLanguage')}
          >
            <span className="text-base">{currentLanguage === 'zh' ? '🇨🇳' : '🇺🇸'}</span>
            <span>{currentLanguage === 'zh' ? '中文' : 'EN'}</span>
          </button>

          {/* 导航按钮 */}
          {currentPage === 'chat' ? (
            <>
              {/* 仪表盘按钮 */}
              {hasPermission(userRole, 'canViewAnalytics') && (
                <button
                  onClick={() => setCurrentPage('dashboard')}
                  className="flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-xl 
                             hover:from-blue-600 hover:to-indigo-600 transition-all duration-200 font-medium text-[15px] 
                             shadow-sm hover:shadow-md"
                >
                  <TrendingUp className="w-4 h-4" />
                  <span>仪表盘</span>
                </button>
              )}
              
              {/* 数据分析按钮 */}
              {hasPermission(userRole, 'canViewAnalytics') && (
                <>
                  <button
                    onClick={() => setCurrentPage('analytics')}
                    className="flex items-center space-x-2 px-4 py-2 bg-purple-500 text-white rounded-xl 
                               hover:bg-purple-600 transition-all duration-200 font-medium text-[15px] 
                               shadow-sm hover:shadow-md"
                  >
                    <BarChart3 className="w-4 h-4" />
                    <span>数据分析</span>
                  </button>
                  <button
                    onClick={() => setCurrentPage('export')}
                    className="flex items-center space-x-2 px-4 py-2 bg-green-500 text-white rounded-xl 
                               hover:bg-green-600 transition-all duration-200 font-medium text-[15px] 
                               shadow-sm hover:shadow-md"
                  >
                    <Download className="w-4 h-4" />
                    <span>数据导出</span>
                  </button>
                </>
              )}
              
              {/* 业务员管理按钮 */}
              {hasPermission(userRole, 'canManageSalespersons') && (
                <button
                  onClick={() => setCurrentPage('salesperson')}
                  className="flex items-center space-x-2 px-4 py-2 bg-indigo-500 text-white rounded-xl 
                             hover:bg-indigo-600 transition-all duration-200 font-medium text-[15px] 
                             shadow-sm hover:shadow-md"
                >
                  <Users className="w-4 h-4" />
                  <span>业务员管理</span>
                </button>
              )}
              
              {/* 分仓库存按钮 */}
              {(hasPermission(userRole, 'canReceiveTransfer') || hasPermission(userRole, 'canTransfer')) && (
                <button
                  onClick={() => setCurrentPage('warehouse')}
                  className="relative flex items-center space-x-2 px-4 py-2 border-2 border-jewelry-navy text-jewelry-navy rounded-xl 
                             hover:bg-jewelry-navy hover:text-white transition-all duration-200 font-medium text-[15px]"
                >
                  <Warehouse className="w-4 h-4" />
                  <span>{t('nav.warehouse')}</span>
                  {pendingTransferCount > 0 && (
                    <span className="absolute -top-2 -right-2 min-w-[20px] h-5 flex items-center justify-center 
                                     bg-red-500 text-white text-xs font-bold rounded-full px-1.5 
                                     shadow-lg animate-pulse">
                      {pendingTransferCount > 99 ? '99+' : pendingTransferCount}
                    </span>
                  )}
                </button>
              )}
              
              {/* 结算管理按钮 */}
              {hasPermission(userRole, 'canCreateSettlement') && (
                <button
                  onClick={() => setCurrentPage('settlement')}
                  className="relative flex items-center space-x-2 px-4 py-2 border-2 border-jewelry-navy text-jewelry-navy rounded-xl 
                             hover:bg-jewelry-navy hover:text-white transition-all duration-200 font-medium text-[15px]"
                >
                  <Calculator className="w-4 h-4" />
                  <span>{t('nav.settlement')}</span>
                  {pendingSalesCount > 0 && (
                    <span className="absolute -top-2 -right-2 min-w-[20px] h-5 flex items-center justify-center 
                                     bg-red-500 text-white text-xs font-bold rounded-full px-1.5 
                                     shadow-lg animate-pulse">
                      {pendingSalesCount > 99 ? '99+' : pendingSalesCount}
                    </span>
                  )}
                </button>
              )}
              
              {/* 快捷开单按钮 */}
              {hasPermission(userRole, 'canCreateSales') && (
                <button
                  onClick={() => setShowQuickOrderModal(true)}
                  className="flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-jewelry-gold to-jewelry-gold-light text-white rounded-xl 
                             hover:from-jewelry-gold-dark hover:to-jewelry-gold transition-all duration-200 font-medium text-[15px] 
                             shadow-sm hover:shadow-md"
                >
                  <FileText className="w-4 h-4" />
                  <span>{t('nav.quickOrder')}</span>
                </button>
              )}
              
              {/* 客户管理按钮 */}
              {(hasPermission(userRole, 'canViewCustomers') || hasPermission(userRole, 'canManageCustomers')) && (
                <button
                  onClick={() => setCurrentPage('customer')}
                  className="flex items-center space-x-2 px-4 py-2 border-2 border-jewelry-navy text-jewelry-navy rounded-xl 
                             hover:bg-jewelry-navy hover:text-white transition-all duration-200 font-medium text-[15px]"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>{t('nav.customers')}</span>
                </button>
              )}
              
              {/* 供应商管理按钮 */}
              {hasPermission(userRole, 'canManageSuppliers') && (
                <button
                  onClick={() => setCurrentPage('supplier')}
                  className="flex items-center space-x-2 px-4 py-2 border-2 border-jewelry-navy text-jewelry-navy rounded-xl 
                             hover:bg-jewelry-navy hover:text-white transition-all duration-200 font-medium text-[15px]"
                >
                  <Building2 className="w-4 h-4" />
                  <span>{t('nav.suppliers')}</span>
                </button>
              )}
              
              {/* 退货管理按钮 */}
              {(hasPermission(userRole, 'canReturnToSupplier') || hasPermission(userRole, 'canReturnToWarehouse')) && (
                <button
                  onClick={() => setCurrentPage('returns')}
                  className="flex items-center space-x-2 px-4 py-2 border-2 border-jewelry-navy text-jewelry-navy rounded-xl 
                             hover:bg-jewelry-navy hover:text-white transition-all duration-200 font-medium text-[15px]"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>{t('nav.returns')}</span>
                </button>
              )}
              
              {/* 金料管理按钮 */}
              {(hasPermission(userRole, 'canViewGoldMaterial') || hasPermission(userRole, 'canManageGoldMaterial')) && (
                <button
                  onClick={() => setCurrentPage('gold-material')}
                  className="flex items-center space-x-2 px-4 py-2 border-2 border-jewelry-gold text-jewelry-gold rounded-xl 
                             hover:bg-jewelry-gold hover:text-white transition-all duration-200 font-medium text-[15px]"
                >
                  <Scale className="w-4 h-4" />
                  <span>{t('nav.goldMaterial')}</span>
                </button>
              )}
              
              {/* 暂借管理按钮 */}
              {hasPermission(userRole, 'canManageLoan') && (
                <button
                  onClick={() => setCurrentPage('loan')}
                  className="flex items-center space-x-2 px-4 py-2 border-2 border-jewelry-navy text-jewelry-navy rounded-xl 
                             hover:bg-jewelry-navy hover:text-white transition-all duration-200 font-medium text-[15px]"
                >
                  <Package className="w-4 h-4" />
                  <span>{t('nav.loan')}</span>
                </button>
              )}
              
              {/* 商品编码按钮 */}
              {hasPermission(userRole, 'canManageProductCodes') && (
                <button
                  onClick={() => setCurrentPage('product-codes')}
                  className="flex items-center space-x-2 px-4 py-2 border-2 border-jewelry-navy text-jewelry-navy rounded-xl 
                             hover:bg-jewelry-navy hover:text-white transition-all duration-200 font-medium text-[15px]"
                >
                  <Package className="w-4 h-4" />
                  <span>{t('nav.productCodes')}</span>
                </button>
              )}
              
              {/* 入库单据按钮 */}
              {(userRole === 'product' || userRole === 'manager') && (
                <button
                  onClick={() => setCurrentPage('inbound-orders')}
                  className="flex items-center space-x-2 px-4 py-2 border-2 border-jewelry-navy text-jewelry-navy rounded-xl 
                             hover:bg-jewelry-navy hover:text-white transition-all duration-200 font-medium text-[15px]"
                >
                  <FileText className="w-4 h-4" />
                  <span>{t('nav.inboundOrders')}</span>
                </button>
              )}
              
              {/* 财务对账按钮 */}
              {hasPermission(userRole, 'canViewFinance') && (
                <button
                  onClick={() => setCurrentPage('finance')}
                  className="flex items-center space-x-2 px-4 py-2 border-2 border-jewelry-navy text-jewelry-navy rounded-xl 
                             hover:bg-jewelry-navy hover:text-white transition-all duration-200 font-medium text-[15px]"
                >
                  <DollarSign className="w-4 h-4" />
                  <span>{t('nav.finance')}</span>
                </button>
              )}
              
              {/* 历史回溯按钮 */}
              <button
                onClick={() => setShowHistoryPanel(true)}
                className="flex items-center space-x-2 px-4 py-2 border-2 border-jewelry-navy text-jewelry-navy rounded-xl 
                           hover:bg-jewelry-navy hover:text-white transition-all duration-200 font-medium text-[15px]"
              >
                <History className="w-4 h-4" />
                <span>{t('nav.history')}</span>
              </button>
            </>
          ) : (
            <button
              onClick={() => setCurrentPage('chat')}
              className="flex items-center space-x-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-xl 
                         hover:bg-gray-200 transition-all duration-200 font-medium text-[15px] 
                         shadow-sm hover:shadow-md"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>{t('nav.backToChat')}</span>
            </button>
          )}
        </div>
      </div>
    </header>
  )
}

export default Header
