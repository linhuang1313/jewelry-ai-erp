/**
 * 欢迎界面组件 - 聊天页面初始状态
 */
import React from 'react'
import { hasPermission } from '../../config/permissions'
import InventoryOverview from '../InventoryOverview'

export const WelcomeScreen = ({ 
  userRole, 
  setInput,
  setShowQuickOrderModal,
  setShowQuickInboundModal,
  setShowQuickReturnModal,
  setCurrentPage
}) => {
  // 角色对应的快捷建议按钮
  const getSuggestButtons = () => {
    const buttons = {
      counter: [
        { text: '开销售单', onClick: () => setInput('帮我开一张销售单'), color: 'blue' },
        { text: '今日销售', onClick: () => setInput('查询今天的销售情况'), color: 'blue' },
        { text: '查库存', onClick: () => setInput('库存还有多少'), color: 'blue' }
      ],
      product: [
        { text: '入库商品', onClick: () => setInput('古法黄金戒指 100克 工费6元 供应商金源珠宝 帮我入库'), color: 'orange' },
        { text: '今日入库', onClick: () => setInput('查询今天的入库单'), color: 'orange' },
        { text: '库存分析', onClick: () => setInput('库存分析'), color: 'orange' }
      ],
      settlement: [
        { text: '待结算', onClick: () => setInput('查看今天待结算的订单'), color: 'green' },
        { text: '客户提料', onClick: () => setInput('张老板提5克'), color: 'green' },
        { text: '收料登记', onClick: () => setInput('收料登记'), color: 'green' }
      ],
      finance: [
        { text: '月度对账', onClick: () => setInput('查看本月财务对账情况'), color: 'purple' },
        { text: '收款汇总', onClick: () => setInput('今日收款汇总'), color: 'purple' }
      ],
      sales: [
        { text: '客户销售', onClick: () => setInput('帮我查询张三今天的销售情况'), color: 'indigo' },
        { text: '欠款查询', onClick: () => setInput('王五有多少欠款'), color: 'indigo' },
        { text: '退货记录', onClick: () => setInput('查询退货记录'), color: 'indigo' }
      ],
      material: [
        { text: '今日收付', onClick: () => setInput('查看今日金料收付情况'), color: 'yellow' },
        { text: '库存统计', onClick: () => setInput('金料库存统计'), color: 'yellow' }
      ],
      manager: [
        { text: '今日汇总', onClick: () => setInput('查看今日销售数据汇总'), color: 'red' },
        { text: '业绩分析', onClick: () => setInput('本月业绩分析'), color: 'red' },
        { text: '库存预警', onClick: () => setInput('库存预警'), color: 'red' }
      ]
    }
    return buttons[userRole] || []
  }

  const colorClass = {
    blue: 'bg-blue-50 text-blue-600 hover:bg-blue-100',
    orange: 'bg-orange-50 text-orange-600 hover:bg-orange-100',
    green: 'bg-green-50 text-green-600 hover:bg-green-100',
    purple: 'bg-purple-50 text-purple-600 hover:bg-purple-100',
    indigo: 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100',
    yellow: 'bg-yellow-50 text-yellow-600 hover:bg-yellow-100',
    red: 'bg-red-50 text-red-600 hover:bg-red-100'
  }

  return (
    <div className="text-center pt-8">
      {/* 智能时间问候 + AI标识 */}
      <div className="mb-6">
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-amber-50 to-yellow-50 rounded-full border border-amber-200">
          <img src="/ai-avatar.png" alt="AI" className="w-6 h-6 rounded-full object-cover" />
          <span className="text-sm text-gray-700">
            {(() => {
              const hour = new Date().getHours()
              if (hour < 9) return '早上好！今天也要加油哦'
              if (hour < 12) return '上午好！有什么可以帮您的？'
              if (hour < 14) return '中午好！记得休息一下'
              if (hour < 18) return '下午好！我随时准备为您服务'
              return '晚上好！辛苦了'
            })()}
          </span>
        </div>
      </div>
      
      {/* 智能快捷建议按钮 */}
      <div className="flex flex-wrap justify-center gap-2 mb-6">
        <span className="text-gray-400 text-sm">试试：</span>
        {getSuggestButtons().map((btn, idx) => (
          <button 
            key={idx}
            onClick={btn.onClick} 
            className={`px-3 py-1.5 text-sm rounded-full transition-colors ${colorClass[btn.color]}`}
          >
            {btn.text}
          </button>
        ))}
      </div>
      
      {/* 库存概览 */}
      {(userRole === 'product' || userRole === 'counter' || userRole === 'settlement' || userRole === 'manager') && (
        <div className="max-w-2xl mx-auto mb-6">
          <InventoryOverview userRole={userRole} />
        </div>
      )}

      {/* 角色快捷操作卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl mx-auto">
        
        {/* 快速开单卡片 */}
        {hasPermission(userRole, 'canCreateSales') && (
          <div 
            onClick={() => setShowQuickOrderModal(true)}
            className="p-6 bg-white rounded-2xl border border-gray-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
          >
            <div className="text-2xl mb-3">🧾</div>
            <h3 className="font-semibold text-gray-900 mb-2">快速开单</h3>
            <p className="text-sm text-gray-600">创建销售单</p>
          </div>
        )}
        
        {/* 接收库存卡片 */}
        {hasPermission(userRole, 'canReceiveTransfer') && (
          <div 
            onClick={() => setCurrentPage('warehouse')}
            className="p-6 bg-white rounded-2xl border border-gray-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
          >
            <div className="text-2xl mb-3">📥</div>
            <h3 className="font-semibold text-gray-900 mb-2">接收库存</h3>
            <p className="text-sm text-gray-600">接收从仓库转移的商品</p>
          </div>
        )}
        
        {/* 快捷入库卡片 */}
        {hasPermission(userRole, 'canInbound') && (
          <div 
            onClick={() => setShowQuickInboundModal(true)}
            className="p-6 bg-white rounded-2xl border border-gray-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
          >
            <div className="text-2xl mb-3">📦</div>
            <h3 className="font-semibold text-gray-900 mb-2">快捷入库</h3>
            <p className="text-sm text-gray-600">表格形式批量入库</p>
          </div>
        )}
        
        {/* 库存转移卡片 */}
        {hasPermission(userRole, 'canTransfer') && (
          <div 
            onClick={() => setCurrentPage('warehouse')}
            className="p-6 bg-white rounded-2xl border border-gray-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
          >
            <div className="text-2xl mb-3">📊</div>
            <h3 className="font-semibold text-gray-900 mb-2">分仓库存</h3>
            <p className="text-sm text-gray-600">管理仓库库存和转移</p>
          </div>
        )}
        
        {/* 快捷退货卡片 - 商品专员 */}
        {hasPermission(userRole, 'canReturnToSupplier') && (
          <div 
            onClick={() => setShowQuickReturnModal(true)}
            className="p-6 bg-white rounded-2xl border border-gray-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
          >
            <div className="text-2xl mb-3">🔄</div>
            <h3 className="font-semibold text-gray-900 mb-2">快捷退货</h3>
            <p className="text-sm text-gray-600">快速创建退货单（退给供应商）</p>
          </div>
        )}
        
        {/* 快捷退货卡片 - 柜台 */}
        {hasPermission(userRole, 'canReturnToWarehouse') && !hasPermission(userRole, 'canReturnToSupplier') && (
          <div 
            onClick={() => setShowQuickReturnModal(true)}
            className="p-6 bg-white rounded-2xl border border-gray-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
          >
            <div className="text-2xl mb-3">🔄</div>
            <h3 className="font-semibold text-gray-900 mb-2">快捷退货</h3>
            <p className="text-sm text-gray-600">快速创建退货单（退给商品部）</p>
          </div>
        )}
        
        {/* 结算管理卡片 */}
        {hasPermission(userRole, 'canCreateSettlement') && (
          <div 
            onClick={() => setCurrentPage('settlement')}
            className="p-6 bg-white rounded-2xl border border-gray-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
          >
            <div className="text-2xl mb-3">📋</div>
            <h3 className="font-semibold text-gray-900 mb-2">待结算订单</h3>
            <p className="text-sm text-gray-600">查看待结算的销售单</p>
          </div>
        )}
        
        {/* 客户管理卡片 */}
        {(hasPermission(userRole, 'canViewCustomers') || hasPermission(userRole, 'canManageCustomers')) && (
          <div 
            onClick={() => setCurrentPage('customer')}
            className="p-6 bg-white rounded-2xl border border-gray-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
          >
            <div className="text-2xl mb-3">👥</div>
            <h3 className="font-semibold text-gray-900 mb-2">
              {userRole === 'sales' ? '客户查询' : '客户管理'}
            </h3>
            <p className="text-sm text-gray-600">
              {userRole === 'sales' 
                ? '查询客户销售、退货、欠款、往来账目' 
                : '管理客户信息'}
            </p>
          </div>
        )}
        
        {/* 财务对账卡片 */}
        {hasPermission(userRole, 'canViewFinance') && (
          <div 
            onClick={() => setCurrentPage('finance')}
            className="p-6 bg-white rounded-2xl border border-gray-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
          >
            <div className="text-2xl mb-3">💰</div>
            <h3 className="font-semibold text-gray-900 mb-2">财务对账</h3>
            <p className="text-sm text-gray-600">查看财务对账情况</p>
          </div>
        )}
        
        {/* 供应商管理卡片 */}
        {hasPermission(userRole, 'canManageSuppliers') && (
          <div 
            onClick={() => setCurrentPage('supplier')}
            className="p-6 bg-white rounded-2xl border border-gray-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
          >
            <div className="text-2xl mb-3">🏭</div>
            <h3 className="font-semibold text-gray-900 mb-2">供应商管理</h3>
            <p className="text-sm text-gray-600">管理供应商信息</p>
          </div>
        )}
        
        {/* 仪表盘卡片 */}
        {hasPermission(userRole, 'canViewAnalytics') && (
          <div 
            onClick={() => setCurrentPage('dashboard')}
            className="p-6 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl border border-blue-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
          >
            <div className="text-2xl mb-3">📈</div>
            <h3 className="font-semibold text-gray-900 mb-2">数据仪表盘</h3>
            <p className="text-sm text-gray-600">今日销售、业绩排行</p>
          </div>
        )}
        
        {/* 数据分析卡片 */}
        {hasPermission(userRole, 'canViewAnalytics') && (
          <div 
            onClick={() => setCurrentPage('analytics')}
            className="p-6 bg-white rounded-2xl border border-gray-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
          >
            <div className="text-2xl mb-3">📊</div>
            <h3 className="font-semibold text-gray-900 mb-2">数据分析</h3>
            <p className="text-sm text-gray-600">查看业务数据分析</p>
          </div>
        )}
        
        {/* 金料管理卡片 */}
        {(hasPermission(userRole, 'canViewGoldMaterial') || hasPermission(userRole, 'canManageGoldMaterial')) && (
          <div 
            onClick={() => setCurrentPage('gold-material')}
            className="p-6 bg-white rounded-2xl border border-gray-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
          >
            <div className="text-2xl mb-3">⚖️</div>
            <h3 className="font-semibold text-gray-900 mb-2">金料管理</h3>
            <p className="text-sm text-gray-600">金料台账、收料、付料</p>
          </div>
        )}
        
        {/* 商品编码管理卡片 */}
        {hasPermission(userRole, 'canManageProductCodes') && (
          <div 
            onClick={() => setCurrentPage('product-codes')}
            className="p-6 bg-white rounded-2xl border border-gray-200/60 hover:shadow-lg transition-all cursor-pointer active:scale-95"
          >
            <div className="text-2xl mb-3">🏷️</div>
            <h3 className="font-semibold text-gray-900 mb-2">商品编码</h3>
            <p className="text-sm text-gray-600">管理F编码、FL编码</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default WelcomeScreen
