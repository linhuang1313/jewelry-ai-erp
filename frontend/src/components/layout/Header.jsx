/**
 * 顶部导航栏组件
 */
import React, { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { hasPermission } from '../../config/permissions'
import { USER_ROLES } from '../../constants/roles'
import { 
  DollarSign, ArrowLeft, ChevronDown, BarChart3, Download, 
  Warehouse, Users, UserPlus, FileText, History, Building2, 
  RotateCcw, Package, Calculator, Scale, TrendingUp, LayoutGrid, Archive, MessageSquare, Tag,
  HelpCircle, LogOut, Lock
} from 'lucide-react'
import PendingTasksBell from '../PendingTasksBell'
import HelpGuide from '../HelpGuide'
import { ChangePasswordModal } from '../modals/ChangePasswordModal'

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
  i18n,
  onLogout
}) => {
  const { t } = useTranslation()
  const [openNavMenu, setOpenNavMenu] = useState(null) // 'data' | 'business' | 'people' | 'material' | 'workbench' | null
  const [showHelpGuide, setShowHelpGuide] = useState(false)
  const [showChangePassword, setShowChangePassword] = useState(false)
  const navMenuRef = useRef(null)
  const mobileMenuRef = useRef(null)

  // 点击外部关闭导航下拉菜单
  useEffect(() => {
    const handleClickOutside = (event) => {
      const isInsideNavMenu = navMenuRef.current && navMenuRef.current.contains(event.target)
      const isInsideMobileMenu = mobileMenuRef.current && mobileMenuRef.current.contains(event.target)
      if (!isInsideNavMenu && !isInsideMobileMenu) {
        setOpenNavMenu(null)
      }
    }
    if (openNavMenu) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [openNavMenu])

  // 导航菜单项点击后关闭下拉
  const handleNavClick = (page) => {
    setCurrentPage(page)
    setOpenNavMenu(null)
  }

  return (
    <>
    <header className="bg-white/80 backdrop-blur-xl border-b border-gray-200/60 px-3 md:px-6 py-2.5 md:py-4 
                       sticky top-0 z-10 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2 md:space-x-4 min-w-0">
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
            <h1 className="text-[18px] md:text-[28px] font-semibold text-gray-900 tracking-tight truncate">
              {t('app.title')}
            </h1>
            <p className="text-[11px] md:text-[13px] text-gray-500 mt-0.5 truncate">{t('app.subtitle')}</p>
          </div>

          {/* 语言切换按钮 - 手机端隐藏 */}
          <button
            onClick={() => {
              const newLang = currentLanguage === 'zh' ? 'en' : 'zh'
              i18n.changeLanguage(newLang)
              localStorage.setItem('i18nextLng', newLang)
            }}
            className="hidden md:flex items-center space-x-1.5 px-3 py-2 rounded-xl border border-gray-200
                       hover:bg-gray-50 transition-all duration-200 font-medium text-[14px] text-gray-600"
            title={t('language.switchLanguage')}
          >
            <span className="text-base">{currentLanguage === 'zh' ? '🇨🇳' : '🇺🇸'}</span>
            <span>{currentLanguage === 'zh' ? '中文' : 'EN'}</span>
          </button>
        </div>
        
        {/* 右侧按钮区域 */}
        <div className="flex items-center space-x-1.5 md:space-x-3">
          {/* 使用帮助 */}
          <button
            onClick={() => setShowHelpGuide(true)}
            className="w-8 h-8 md:w-9 md:h-9 rounded-xl border border-gray-200 hover:bg-amber-50 
                       flex items-center justify-center transition-all duration-200"
            title="使用帮助"
          >
            <HelpCircle className="w-4 h-4 text-gray-500 hover:text-amber-600" />
          </button>
          {/* 待办铃铛 */}
          <PendingTasksBell userRole={userRole} />
          {/* 修改密码 */}
          <button
            onClick={() => setShowChangePassword(true)}
            className="w-8 h-8 md:w-9 md:h-9 rounded-xl border border-gray-200 hover:bg-amber-50 
                       flex items-center justify-center transition-all duration-200"
            title="修改密码"
          >
            <Lock className="w-4 h-4 text-gray-500 hover:text-amber-600" />
          </button>
          {/* 退出登录 */}
          {onLogout && (
            <button
              onClick={onLogout}
              className="w-8 h-8 md:w-9 md:h-9 rounded-xl border border-gray-200 hover:bg-red-50 
                         flex items-center justify-center transition-all duration-200"
              title="退出登录"
            >
              <LogOut className="w-4 h-4 text-gray-500 hover:text-red-500" />
            </button>
          )}
  
          {/* 角色选择器 */}
          <div className="relative" ref={roleDropdownRef}>
            <button
              onClick={() => !roleLoading && setRoleDropdownOpen(!roleDropdownOpen)}
              disabled={roleLoading}
              className={`flex items-center space-x-1 md:space-x-2 px-2 md:px-3 py-1.5 md:py-2 rounded-xl border border-gray-200
                         hover:bg-gray-50 transition-all duration-200 font-medium text-[12px] md:text-[14px]
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

          {/* 销售管理按钮 - 手机端隐藏 */}
          {['counter', 'settlement', 'sales'].includes(userRole) && !['counter', 'settlement'].includes(userRole) && (
            <button
              onClick={() => setShowSalesSearchModal(true)}
              className="hidden md:flex items-center space-x-1.5 px-3 py-2 rounded-xl border border-amber-200
                         bg-amber-50 hover:bg-amber-100 transition-all duration-200 font-medium text-[14px] text-amber-700"
              title="销售管理"
            >
              <FileText className="w-4 h-4" />
              <span>销售管理</span>
            </button>
          )}

          {/* 手机端导航菜单按钮 + 下拉菜单 */}
          <div ref={mobileMenuRef} className="md:hidden">
            {currentPage === 'chat' && (
              <button
                onClick={() => setOpenNavMenu(openNavMenu === 'mobile' ? null : 'mobile')}
                className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
              >
                <LayoutGrid className="w-5 h-5 text-gray-600" />
              </button>
            )}

          {/* 手机端导航下拉菜单 */}
          {openNavMenu === 'mobile' && currentPage === 'chat' && (
            <div className="absolute top-full left-0 right-0 bg-white border-b border-gray-200 shadow-lg z-50 py-2 px-3 max-h-[70vh] overflow-y-auto">
              <div className="grid grid-cols-3 gap-2">
                {hasPermission(userRole, 'canCreateSettlement') && (
                  <button onClick={() => { handleNavClick('settlement'); setOpenNavMenu(null); }} className="flex flex-col items-center gap-1 p-3 rounded-xl hover:bg-amber-50 text-center">
                    <Calculator className="w-5 h-5 text-amber-500" />
                    <span className="text-xs text-gray-700">{t('nav.settlement')}</span>
                  </button>
                )}
                {(hasPermission(userRole, 'canReceiveTransfer') || hasPermission(userRole, 'canTransfer')) && (
                  <button onClick={() => { handleNavClick('warehouse'); setOpenNavMenu(null); }} className="flex flex-col items-center gap-1 p-3 rounded-xl hover:bg-indigo-50 text-center">
                    <Warehouse className="w-5 h-5 text-indigo-500" />
                    <span className="text-xs text-gray-700">分仓转移</span>
                  </button>
                )}
                {(hasPermission(userRole, 'canViewCustomers') || hasPermission(userRole, 'canManageCustomers')) && (
                  <button onClick={() => { handleNavClick('customer'); setOpenNavMenu(null); }} className="flex flex-col items-center gap-1 p-3 rounded-xl hover:bg-blue-50 text-center">
                    <UserPlus className="w-5 h-5 text-blue-500" />
                    <span className="text-xs text-gray-700">{t('nav.customers')}</span>
                  </button>
                )}
                {hasPermission(userRole, 'canManageSuppliers') && (
                  <button onClick={() => { handleNavClick('supplier'); setOpenNavMenu(null); }} className="flex flex-col items-center gap-1 p-3 rounded-xl hover:bg-purple-50 text-center">
                    <Building2 className="w-5 h-5 text-purple-500" />
                    <span className="text-xs text-gray-700">{t('nav.suppliers')}</span>
                  </button>
                )}
                {(hasPermission(userRole, 'canViewGoldMaterial') || hasPermission(userRole, 'canManageGoldMaterial')) && (
                  <button onClick={() => { handleNavClick('gold-material'); setOpenNavMenu(null); }} className="flex flex-col items-center gap-1 p-3 rounded-xl hover:bg-amber-50 text-center">
                    <Scale className="w-5 h-5 text-amber-500" />
                    <span className="text-xs text-gray-700">{t('nav.goldMaterial')}</span>
                  </button>
                )}
                {hasPermission(userRole, 'canManageLoan') && (
                  <button onClick={() => { handleNavClick('loan'); setOpenNavMenu(null); }} className="flex flex-col items-center gap-1 p-3 rounded-xl hover:bg-orange-50 text-center">
                    <Package className="w-5 h-5 text-orange-500" />
                    <span className="text-xs text-gray-700">{t('nav.loan')}</span>
                  </button>
                )}
                {(hasPermission(userRole, 'canReturnToSupplier') || hasPermission(userRole, 'canReturnToWarehouse')) && (
                  <button onClick={() => { handleNavClick('returns'); setOpenNavMenu(null); }} className="flex flex-col items-center gap-1 p-3 rounded-xl hover:bg-red-50 text-center">
                    <RotateCcw className="w-5 h-5 text-red-500" />
                    <span className="text-xs text-gray-700">{t('nav.returns')}</span>
                  </button>
                )}
                {hasPermission(userRole, 'canViewFinance') && (
                  <button onClick={() => { handleNavClick('finance'); setOpenNavMenu(null); }} className="flex flex-col items-center gap-1 p-3 rounded-xl hover:bg-green-50 text-center">
                    <DollarSign className="w-5 h-5 text-emerald-500" />
                    <span className="text-xs text-gray-700">{t('nav.finance')}</span>
                  </button>
                )}
                {hasPermission(userRole, 'canViewAnalytics') && (
                  <button onClick={() => { handleNavClick('analytics'); setOpenNavMenu(null); }} className="flex flex-col items-center gap-1 p-3 rounded-xl hover:bg-blue-50 text-center">
                    <BarChart3 className="w-5 h-5 text-blue-500" />
                    <span className="text-xs text-gray-700">数据分析</span>
                  </button>
                )}
                {hasPermission(userRole, 'canViewAnalytics') && (
                  <button onClick={() => { handleNavClick('export'); setOpenNavMenu(null); }} className="flex flex-col items-center gap-1 p-3 rounded-xl hover:bg-green-50 text-center">
                    <Download className="w-5 h-5 text-green-500" />
                    <span className="text-xs text-gray-700">数据导出</span>
                  </button>
                )}
                <button onClick={() => { setShowHistoryPanel(true); setOpenNavMenu(null); }} className="flex flex-col items-center gap-1 p-3 rounded-xl hover:bg-gray-50 text-center">
                  <History className="w-5 h-5 text-gray-500" />
                  <span className="text-xs text-gray-700">{t('nav.history')}</span>
                </button>
              </div>
            </div>
          )}
          </div>

          {/* 导航按钮 - 桌面端 */}
          {currentPage === 'chat' ? (
            <div className="hidden md:flex items-center space-x-2" ref={navMenuRef}>
              {/* 工作台下拉菜单 */}
              {['counter', 'settlement', 'material', 'finance'].includes(userRole) && (
                <div className="relative">
                  <button
                    onClick={() => setOpenNavMenu(openNavMenu === 'workbench' ? null : 'workbench')}
                    className={`flex items-center space-x-1.5 px-3 py-2 rounded-xl border transition-all duration-200 font-medium text-[14px]
                               ${openNavMenu === 'workbench'
                        ? 'bg-amber-500 text-white border-amber-500'
                        : 'border-amber-200 text-amber-600 hover:bg-amber-50'}`}
                  >
                    <LayoutGrid className="w-4 h-4" />
                    <span>工作台</span>
                    {userRole !== 'finance' && (pendingTransferCount + pendingSalesCount > 0) && (
                      <span className="min-w-[18px] h-[18px] flex items-center justify-center bg-red-500 text-white text-xs font-bold rounded-full px-1">
                        {(pendingTransferCount + pendingSalesCount) > 99 ? '99+' : (pendingTransferCount + pendingSalesCount)}
                      </span>
                    )}
                    <ChevronDown className={`w-3 h-3 transition-transform ${openNavMenu === 'workbench' ? 'rotate-180' : ''}`} />
                  </button>
                  {openNavMenu === 'workbench' && (
                    <div className="absolute right-0 mt-2 w-44 bg-white rounded-xl shadow-lg border border-gray-100 py-1 z-50">
                      {['counter', 'settlement', 'material'].includes(userRole) && (
                        <>
                          <button onClick={() => { setShowSalesSearchModal(true); setOpenNavMenu(null); }} className="w-full flex items-center space-x-2 px-3 py-2 text-sm text-gray-700 hover:bg-amber-50">
                            <FileText className="w-4 h-4 text-amber-500" />
                            <span>销售管理</span>
                          </button>
                          {hasPermission(userRole, 'canCreateSettlement') && (
                            <button onClick={() => handleNavClick('settlement')} className="w-full flex items-center justify-between px-3 py-2 text-sm text-gray-700 hover:bg-amber-50">
                              <span className="flex items-center space-x-2">
                                <Calculator className="w-4 h-4 text-amber-500" />
                                <span>{t('nav.settlement')}</span>
                              </span>
                              {pendingSalesCount > 0 && (
                                <span className="min-w-[18px] h-[18px] flex items-center justify-center bg-red-500 text-white text-xs font-bold rounded-full px-1">
                                  {pendingSalesCount > 99 ? '99+' : pendingSalesCount}
                                </span>
                              )}
                            </button>
                          )}
                          {(hasPermission(userRole, 'canReceiveTransfer') || hasPermission(userRole, 'canTransfer')) && (
                            <button onClick={() => handleNavClick('warehouse')} className="w-full flex items-center justify-between px-3 py-2 text-sm text-gray-700 hover:bg-amber-50">
                              <span className="flex items-center space-x-2">
                                <Warehouse className="w-4 h-4 text-indigo-500" />
                                <span>分仓转移</span>
                              </span>
                              {pendingTransferCount > 0 && (
                                <span className="min-w-[18px] h-[18px] flex items-center justify-center bg-red-500 text-white text-xs font-bold rounded-full px-1">
                                  {pendingTransferCount > 99 ? '99+' : pendingTransferCount}
                                </span>
                              )}
                            </button>
                          )}
                          {(hasPermission(userRole, 'canViewCustomers') || hasPermission(userRole, 'canManageCustomers')) && (
                            <button onClick={() => handleNavClick('customer')} className="w-full flex items-center space-x-2 px-3 py-2 text-sm text-gray-700 hover:bg-amber-50">
                              <UserPlus className="w-4 h-4 text-blue-500" />
                              <span>{t('nav.customers')}</span>
                            </button>
                          )}
                          {hasPermission(userRole, 'canManageSuppliers') && (
                            <button onClick={() => handleNavClick('supplier')} className="w-full flex items-center space-x-2 px-3 py-2 text-sm text-gray-700 hover:bg-amber-50">
                              <Building2 className="w-4 h-4 text-purple-500" />
                              <span>{t('nav.suppliers')}</span>
                            </button>
                          )}
                          {(hasPermission(userRole, 'canViewGoldMaterial') || hasPermission(userRole, 'canManageGoldMaterial')) && (
                            <button onClick={() => handleNavClick('gold-material')} className="w-full flex items-center space-x-2 px-3 py-2 text-sm text-gray-700 hover:bg-amber-50">
                              <Scale className="w-4 h-4 text-amber-500" />
                              <span>{t('nav.goldMaterial')}</span>
                            </button>
                          )}
                          {hasPermission(userRole, 'canManageLoan') && (
                            <button onClick={() => handleNavClick('loan')} className="w-full flex items-center space-x-2 px-3 py-2 text-sm text-gray-700 hover:bg-amber-50">
                              <Package className="w-4 h-4 text-orange-500" />
                              <span>{t('nav.loan')}</span>
                            </button>
                          )}
                          {(hasPermission(userRole, 'canReturnToSupplier') || hasPermission(userRole, 'canReturnToWarehouse')) && (
                            <button onClick={() => handleNavClick('returns')} className="w-full flex items-center space-x-2 px-3 py-2 text-sm text-gray-700 hover:bg-amber-50">
                              <RotateCcw className="w-4 h-4 text-red-500" />
                              <span>{t('nav.returns')}</span>
                            </button>
                          )}
                          {hasPermission(userRole, 'canSalesReturn') && (
                            <button onClick={() => handleNavClick('sales-returns')} className="w-full flex items-center space-x-2 px-3 py-2 text-sm text-gray-700 hover:bg-amber-50">
                              <RotateCcw className="w-4 h-4 text-pink-500" />
                              <span>销退管理</span>
                            </button>
                          )}
                          <button onClick={() => { setShowHistoryPanel(true); setOpenNavMenu(null); }} className="w-full flex items-center space-x-2 px-3 py-2 text-sm text-gray-700 hover:bg-amber-50">
                            <History className="w-4 h-4 text-gray-500" />
                            <span>{t('nav.history')}</span>
                          </button>
                        </>
                      )}
                      {userRole === 'finance' && (
                        <>
                          <button onClick={() => handleNavClick('finance')} className="w-full flex items-center space-x-2 px-3 py-2 text-sm text-gray-700 hover:bg-emerald-50">
                            <DollarSign className="w-4 h-4 text-emerald-500" />
                            <span>{t('nav.finance')}</span>
                          </button>
                          <button onClick={() => handleNavClick('voucher')} className="w-full flex items-center space-x-2 px-3 py-2 text-sm text-gray-700 hover:bg-emerald-50">
                            <FileText className="w-4 h-4 text-blue-500" />
                            <span>凭证管理</span>
                          </button>
                          <button onClick={() => handleNavClick('finance-settings')} className="w-full flex items-center space-x-2 px-3 py-2 text-sm text-gray-700 hover:bg-emerald-50">
                            <LayoutGrid className="w-4 h-4 text-purple-500" />
                            <span>基础设置</span>
                          </button>
                          <button onClick={() => handleNavClick('finance-closing')} className="w-full flex items-center space-x-2 px-3 py-2 text-sm text-gray-700 hover:bg-emerald-50">
                            <Archive className="w-4 h-4 text-red-500" />
                            <span>期末结转</span>
                          </button>
                          <button onClick={() => handleNavClick('finance-reports')} className="w-full flex items-center space-x-2 px-3 py-2 text-sm text-gray-700 hover:bg-emerald-50">
                            <BarChart3 className="w-4 h-4 text-indigo-500" />
                            <span>财务报表</span>
                          </button>
                          <button onClick={() => { setShowHistoryPanel(true); setOpenNavMenu(null); }} className="w-full flex items-center space-x-2 px-3 py-2 text-sm text-gray-700 hover:bg-emerald-50">
                            <History className="w-4 h-4 text-gray-500" />
                            <span>{t('nav.history')}</span>
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              {hasPermission(userRole, 'canCreateSales') && userRole !== 'counter' && (
                <button
                  onClick={() => setShowQuickOrderModal(true)}
                  className="flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-jewelry-gold to-jewelry-gold-light text-white rounded-xl 
                             hover:from-jewelry-gold-dark hover:to-jewelry-gold transition-all duration-200 font-medium text-[14px] 
                             shadow-sm hover:shadow-md"
                >
                  <FileText className="w-4 h-4" />
                  <span>{t('nav.quickOrder')}</span>
                </button>
              )}
              
              {/* 数据中心下拉菜单 */}
              {hasPermission(userRole, 'canViewAnalytics') && (
                <div className="relative">
                  <button
                    onClick={() => setOpenNavMenu(openNavMenu === 'data' ? null : 'data')}
                    className={`flex items-center space-x-1.5 px-3 py-2 rounded-xl border transition-all duration-200 font-medium text-[14px]
                               ${openNavMenu === 'data'
                        ? 'bg-blue-500 text-white border-blue-500'
                        : 'border-blue-200 text-blue-600 hover:bg-blue-50'}`}
                  >
                    <BarChart3 className="w-4 h-4" />
                    <span>数据中心</span>
                    <ChevronDown className={`w-3 h-3 transition-transform ${openNavMenu === 'data' ? 'rotate-180' : ''}`} />
                  </button>
                  {openNavMenu === 'data' && (
                    <div className="absolute right-0 mt-2 w-40 bg-white rounded-xl shadow-lg border border-gray-100 py-1 z-50">
                      <button onClick={() => handleNavClick('dashboard')} className="w-full flex items-center space-x-2 px-3 py-2 text-sm text-gray-700 hover:bg-blue-50">
                        <TrendingUp className="w-4 h-4 text-blue-500" />
                        <span>仪表盘</span>
                      </button>
                      <button onClick={() => handleNavClick('analytics')} className="w-full flex items-center space-x-2 px-3 py-2 text-sm text-gray-700 hover:bg-blue-50">
                        <BarChart3 className="w-4 h-4 text-purple-500" />
                        <span>数据分析</span>
                      </button>
                      <button onClick={() => handleNavClick('export')} className="w-full flex items-center space-x-2 px-3 py-2 text-sm text-gray-700 hover:bg-blue-50">
                        <Download className="w-4 h-4 text-green-500" />
                        <span>数据导出</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* 业务管理下拉菜单 */}
              {(hasPermission(userRole, 'canCreateSettlement') || userRole === 'product' || userRole === 'manager') &&
                (hasPermission(userRole, 'canReceiveTransfer') || hasPermission(userRole, 'canTransfer') || userRole === 'product' || userRole === 'manager') && (
                  <div className="relative">
                    <button
                      onClick={() => setOpenNavMenu(openNavMenu === 'business' ? null : 'business')}
                      className={`flex items-center space-x-1.5 px-3 py-2 rounded-xl border transition-all duration-200 font-medium text-[14px]
                               ${openNavMenu === 'business'
                          ? 'bg-amber-500 text-white border-amber-500'
                          : 'border-amber-200 text-amber-600 hover:bg-amber-50'}`}
                    >
                      <Calculator className="w-4 h-4" />
                      <span>业务管理</span>
                      {(pendingTransferCount > 0 || pendingSalesCount > 0) && (
                        <span className="min-w-[18px] h-[18px] flex items-center justify-center bg-red-500 text-white text-xs font-bold rounded-full px-1">
                          {(pendingTransferCount + pendingSalesCount) > 99 ? '99+' : (pendingTransferCount + pendingSalesCount)}
                        </span>
                      )}
                      <ChevronDown className={`w-3 h-3 transition-transform ${openNavMenu === 'business' ? 'rotate-180' : ''}`} />
                    </button>
                    {openNavMenu === 'business' && (
                      <div className="absolute right-0 mt-2 w-44 bg-white rounded-xl shadow-lg border border-gray-100 py-1 z-50">
                        {hasPermission(userRole, 'canCreateSettlement') && (
                          <button onClick={() => handleNavClick('settlement')} className="w-full flex items-center justify-between px-3 py-2 text-sm text-gray-700 hover:bg-amber-50">
                            <span className="flex items-center space-x-2">
                              <Calculator className="w-4 h-4 text-amber-500" />
                              <span>{t('nav.settlement')}</span>
                            </span>
                            {pendingSalesCount > 0 && (
                              <span className="min-w-[18px] h-[18px] flex items-center justify-center bg-red-500 text-white text-xs font-bold rounded-full px-1">
                                {pendingSalesCount > 99 ? '99+' : pendingSalesCount}
                              </span>
                            )}
                          </button>
                        )}
                        {(hasPermission(userRole, 'canReceiveTransfer') || hasPermission(userRole, 'canTransfer')) && (
                          <button onClick={() => handleNavClick('warehouse')} className="w-full flex items-center justify-between px-3 py-2 text-sm text-gray-700 hover:bg-amber-50">
                            <span className="flex items-center space-x-2">
                              <Warehouse className="w-4 h-4 text-indigo-500" />
                              <span>{t('nav.warehouse')}</span>
                            </span>
                            {pendingTransferCount > 0 && (
                              <span className="min-w-[18px] h-[18px] flex items-center justify-center bg-red-500 text-white text-xs font-bold rounded-full px-1">
                                {pendingTransferCount > 99 ? '99+' : pendingTransferCount}
                              </span>
                            )}
                          </button>
                        )}
                        {(userRole === 'product' || userRole === 'manager' || userRole === 'finance') && (
                          <button onClick={() => handleNavClick('inbound-orders')} className="w-full flex items-center space-x-2 px-3 py-2 text-sm text-gray-700 hover:bg-amber-50">
                            <FileText className="w-4 h-4 text-orange-500" />
                            <span>{t('nav.inboundOrders')}</span>
                          </button>
                        )}
                        {userRole === 'product' && (
                          <button onClick={() => handleNavClick('supplier')} className="w-full flex items-center space-x-2 px-3 py-2 text-sm text-gray-700 hover:bg-amber-50">
                            <Building2 className="w-4 h-4 text-purple-500" />
                            <span>{t('nav.suppliers')}</span>
                          </button>
                        )}
                        {userRole === 'product' && (
                          <button onClick={() => handleNavClick('returns')} className="w-full flex items-center space-x-2 px-3 py-2 text-sm text-gray-700 hover:bg-amber-50">
                            <RotateCcw className="w-4 h-4 text-red-500" />
                            <span>{t('nav.returns')}</span>
                          </button>
                        )}
                        {userRole === 'product' && (
                          <button onClick={() => handleNavClick('product-codes')} className="w-full flex items-center space-x-2 px-3 py-2 text-sm text-gray-700 hover:bg-amber-50">
                            <Package className="w-4 h-4 text-gray-500" />
                            <span>{t('nav.productCodes')}</span>
                          </button>
                        )}
                        {userRole === 'product' && (
                          <button onClick={() => handleNavClick('label-design')} className="w-full flex items-center space-x-2 px-3 py-2 text-sm text-gray-700 hover:bg-amber-50">
                            <Tag className="w-4 h-4 text-purple-500" />
                            <span>标签样式管理</span>
                          </button>
                        )}
                        {userRole === 'product' && (
                          <button onClick={() => { setShowHistoryPanel(true); setOpenNavMenu(null); }} className="w-full flex items-center space-x-2 px-3 py-2 text-sm text-gray-700 hover:bg-amber-50">
                            <History className="w-4 h-4 text-gray-500" />
                            <span>{t('nav.history')}</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

              {/* 人员管理下拉菜单 */}
              {userRole !== 'product' && !['counter', 'settlement', 'material'].includes(userRole) &&
                (hasPermission(userRole, 'canViewCustomers') || hasPermission(userRole, 'canManageCustomers')) &&
                (hasPermission(userRole, 'canManageSuppliers') || hasPermission(userRole, 'canManageSalespersons')) && (
                  <div className="relative">
                    <button
                      onClick={() => setOpenNavMenu(openNavMenu === 'people' ? null : 'people')}
                      className={`flex items-center space-x-1.5 px-3 py-2 rounded-xl border transition-all duration-200 font-medium text-[14px]
                               ${openNavMenu === 'people'
                          ? 'bg-indigo-500 text-white border-indigo-500'
                          : 'border-indigo-200 text-indigo-600 hover:bg-indigo-50'}`}
                    >
                      <Users className="w-4 h-4" />
                      <span>人员管理</span>
                      <ChevronDown className={`w-3 h-3 transition-transform ${openNavMenu === 'people' ? 'rotate-180' : ''}`} />
                    </button>
                    {openNavMenu === 'people' && (
                      <div className="absolute right-0 mt-2 w-40 bg-white rounded-xl shadow-lg border border-gray-100 py-1 z-50">
                        {(hasPermission(userRole, 'canViewCustomers') || hasPermission(userRole, 'canManageCustomers')) && (
                          <button onClick={() => handleNavClick('customer')} className="w-full flex items-center space-x-2 px-3 py-2 text-sm text-gray-700 hover:bg-indigo-50">
                            <UserPlus className="w-4 h-4 text-blue-500" />
                            <span>{t('nav.customers')}</span>
                          </button>
                        )}
                        {hasPermission(userRole, 'canManageSuppliers') && (
                          <button onClick={() => handleNavClick('supplier')} className="w-full flex items-center space-x-2 px-3 py-2 text-sm text-gray-700 hover:bg-indigo-50">
                            <Building2 className="w-4 h-4 text-purple-500" />
                            <span>{t('nav.suppliers')}</span>
                          </button>
                        )}
                        {hasPermission(userRole, 'canManageSalespersons') && (
                          <button onClick={() => handleNavClick('salesperson')} className="w-full flex items-center space-x-2 px-3 py-2 text-sm text-gray-700 hover:bg-indigo-50">
                            <Users className="w-4 h-4 text-indigo-500" />
                            <span>业务员管理</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

              {/* 物料管理下拉菜单 */}
              {userRole !== 'product' && !['counter', 'settlement', 'material'].includes(userRole) && (hasPermission(userRole, 'canViewGoldMaterial') ||
                hasPermission(userRole, 'canManageGoldMaterial') ||
                hasPermission(userRole, 'canManageLoan') ||
                hasPermission(userRole, 'canReturnToSupplier') ||
                hasPermission(userRole, 'canReturnToWarehouse') ||
                hasPermission(userRole, 'canManageProductCodes')) && (
                  <div className="relative">
                    <button
                      onClick={() => setOpenNavMenu(openNavMenu === 'material' ? null : 'material')}
                      className={`flex items-center space-x-1.5 px-3 py-2 rounded-xl border transition-all duration-200 font-medium text-[14px]
                               ${openNavMenu === 'material'
                          ? 'bg-jewelry-gold text-white border-jewelry-gold'
                          : 'border-jewelry-gold text-jewelry-gold hover:bg-amber-50'}`}
                    >
                      <Scale className="w-4 h-4" />
                      <span>物料管理</span>
                      <ChevronDown className={`w-3 h-3 transition-transform ${openNavMenu === 'material' ? 'rotate-180' : ''}`} />
                    </button>
                    {openNavMenu === 'material' && (
                      <div className="absolute right-0 mt-2 w-40 bg-white rounded-xl shadow-lg border border-gray-100 py-1 z-50">
                        {(hasPermission(userRole, 'canViewGoldMaterial') || hasPermission(userRole, 'canManageGoldMaterial')) && (
                          <button onClick={() => handleNavClick('gold-material')} className="w-full flex items-center space-x-2 px-3 py-2 text-sm text-gray-700 hover:bg-amber-50">
                            <Scale className="w-4 h-4 text-amber-500" />
                            <span>{t('nav.goldMaterial')}</span>
                          </button>
                        )}
                        {hasPermission(userRole, 'canManageLoan') && (
                          <button onClick={() => handleNavClick('loan')} className="w-full flex items-center space-x-2 px-3 py-2 text-sm text-gray-700 hover:bg-amber-50">
                            <Package className="w-4 h-4 text-orange-500" />
                            <span>{t('nav.loan')}</span>
                          </button>
                        )}
                        {(hasPermission(userRole, 'canReturnToSupplier') || hasPermission(userRole, 'canReturnToWarehouse')) && (
                          <button onClick={() => handleNavClick('returns')} className="w-full flex items-center space-x-2 px-3 py-2 text-sm text-gray-700 hover:bg-amber-50">
                            <RotateCcw className="w-4 h-4 text-red-500" />
                            <span>{t('nav.returns')}</span>
                          </button>
                        )}
                        {hasPermission(userRole, 'canManageProductCodes') && (
                          <button onClick={() => handleNavClick('product-codes')} className="w-full flex items-center space-x-2 px-3 py-2 text-sm text-gray-700 hover:bg-amber-50">
                            <Package className="w-4 h-4 text-gray-500" />
                            <span>{t('nav.productCodes')}</span>
                          </button>
                        )}
                        {hasPermission(userRole, 'canManageProductCodes') && (
                          <button onClick={() => handleNavClick('label-design')} className="w-full flex items-center space-x-2 px-3 py-2 text-sm text-gray-700 hover:bg-amber-50">
                            <Tag className="w-4 h-4 text-purple-500" />
                            <span>标签样式管理</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

              {hasPermission(userRole, 'canViewFinance') && userRole !== 'finance' && (
                <button
                  onClick={() => setCurrentPage('finance')}
                  className="flex items-center space-x-1.5 px-3 py-2 rounded-xl border border-green-200 text-green-600 
                             hover:bg-green-50 transition-all duration-200 font-medium text-[14px]"
                >
                  <DollarSign className="w-4 h-4" />
                  <span>{t('nav.finance')}</span>
                </button>
              )}
              
              {hasPermission(userRole, 'canManageVouchers') && userRole !== 'finance' && (
                <button
                  onClick={() => setCurrentPage('voucher')}
                  className={`flex items-center space-x-1.5 px-3 py-2 rounded-xl border transition-all duration-200 font-medium text-[14px]
                             ${currentPage === 'voucher' ? 'bg-blue-500 text-white border-blue-500' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                >
                  <FileText className="w-4 h-4" />
                  <span>凭证管理</span>
                </button>
              )}
              
              {hasPermission(userRole, 'canManageVouchers') && userRole !== 'finance' && (
                <button
                  onClick={() => setCurrentPage('finance-settings')}
                  className={`flex items-center space-x-1.5 px-3 py-2 rounded-xl border transition-all duration-200 font-medium text-[14px]
                             ${currentPage === 'finance-settings' ? 'bg-purple-500 text-white border-purple-500' : 'border-purple-200 text-purple-600 hover:bg-purple-50'}`}
                >
                  <LayoutGrid className="w-4 h-4" />
                  <span>基础设置</span>
                </button>
              )}
              
              {hasPermission(userRole, 'canManageVouchers') && userRole !== 'finance' && (
                <button
                  onClick={() => setCurrentPage('finance-closing')}
                  className={`flex items-center space-x-1.5 px-3 py-2 rounded-xl border transition-all duration-200 font-medium text-[14px]
                             ${currentPage === 'finance-closing' ? 'bg-red-500 text-white border-red-500' : 'border-red-200 text-red-600 hover:bg-red-50'}`}
                >
                  <Archive className="w-4 h-4" />
                  <span>期末结转</span>
                </button>
              )}
              
              {userRole !== 'product' && !['counter', 'settlement', 'material', 'finance'].includes(userRole) && (
                <button
                  onClick={() => setShowHistoryPanel(true)}
                  className="flex items-center space-x-1.5 px-3 py-2 rounded-xl border border-gray-200 text-gray-600 
                             hover:bg-gray-50 transition-all duration-200 font-medium text-[14px]"
                >
                  <History className="w-4 h-4" />
                  <span>{t('nav.history')}</span>
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setCurrentPage('chat')}
                className="flex items-center space-x-1 md:space-x-2 px-2.5 md:px-4 py-1.5 md:py-2 bg-gray-100 text-gray-700 rounded-xl 
                           hover:bg-gray-200 transition-all duration-200 font-medium text-[13px] md:text-[15px] 
                           shadow-sm hover:shadow-md"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>{t('nav.backToChat')}</span>
              </button>
              <button
                onClick={() => setOpenNavMenu(openNavMenu === 'mobile-sub' ? null : 'mobile-sub')}
                className="md:hidden p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
              >
                <LayoutGrid className="w-5 h-5 text-gray-600" />
              </button>
              {openNavMenu === 'mobile-sub' && (
                <div className="md:hidden absolute top-full left-0 right-0 bg-white border-b border-gray-200 shadow-lg z-50 py-2 px-3 max-h-[70vh] overflow-y-auto">
                  <div className="grid grid-cols-3 gap-2">
                    {hasPermission(userRole, 'canCreateSettlement') && (
                      <button onClick={() => { handleNavClick('settlement'); setOpenNavMenu(null); }} className="flex flex-col items-center gap-1 p-3 rounded-xl hover:bg-amber-50 text-center">
                        <Calculator className="w-5 h-5 text-amber-500" />
                        <span className="text-xs text-gray-700">{t('nav.settlement')}</span>
                      </button>
                    )}
                    {(hasPermission(userRole, 'canReceiveTransfer') || hasPermission(userRole, 'canTransfer')) && (
                      <button onClick={() => { handleNavClick('warehouse'); setOpenNavMenu(null); }} className="flex flex-col items-center gap-1 p-3 rounded-xl hover:bg-indigo-50 text-center">
                        <Warehouse className="w-5 h-5 text-indigo-500" />
                        <span className="text-xs text-gray-700">分仓转移</span>
                      </button>
                    )}
                    {(hasPermission(userRole, 'canViewCustomers') || hasPermission(userRole, 'canManageCustomers')) && (
                      <button onClick={() => { handleNavClick('customer'); setOpenNavMenu(null); }} className="flex flex-col items-center gap-1 p-3 rounded-xl hover:bg-blue-50 text-center">
                        <UserPlus className="w-5 h-5 text-blue-500" />
                        <span className="text-xs text-gray-700">{t('nav.customers')}</span>
                      </button>
                    )}
                    {hasPermission(userRole, 'canManageSuppliers') && (
                      <button onClick={() => { handleNavClick('supplier'); setOpenNavMenu(null); }} className="flex flex-col items-center gap-1 p-3 rounded-xl hover:bg-purple-50 text-center">
                        <Building2 className="w-5 h-5 text-purple-500" />
                        <span className="text-xs text-gray-700">{t('nav.suppliers')}</span>
                      </button>
                    )}
                    {(hasPermission(userRole, 'canViewGoldMaterial') || hasPermission(userRole, 'canManageGoldMaterial')) && (
                      <button onClick={() => { handleNavClick('gold-material'); setOpenNavMenu(null); }} className="flex flex-col items-center gap-1 p-3 rounded-xl hover:bg-amber-50 text-center">
                        <Scale className="w-5 h-5 text-amber-500" />
                        <span className="text-xs text-gray-700">{t('nav.goldMaterial')}</span>
                      </button>
                    )}
                    {hasPermission(userRole, 'canViewFinance') && (
                      <button onClick={() => { handleNavClick('finance'); setOpenNavMenu(null); }} className="flex flex-col items-center gap-1 p-3 rounded-xl hover:bg-green-50 text-center">
                        <DollarSign className="w-5 h-5 text-emerald-500" />
                        <span className="text-xs text-gray-700">{t('nav.finance')}</span>
                      </button>
                    )}
                    <button onClick={() => { handleNavClick('chat'); setOpenNavMenu(null); }} className="flex flex-col items-center gap-1 p-3 rounded-xl hover:bg-gray-50 text-center">
                      <MessageSquare className="w-5 h-5 text-gray-500" />
                      <span className="text-xs text-gray-700">AI对话</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>

    <HelpGuide isOpen={showHelpGuide} onClose={() => setShowHelpGuide(false)} userRole={userRole} />
    <ChangePasswordModal isOpen={showChangePassword} onClose={() => setShowChangePassword(false)} />
    </>
  )
}

export default Header
