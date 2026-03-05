import React, { useState } from 'react';
import { 
  BarChart3, ArrowLeft, RefreshCw,
  TrendingUp, Package, DollarSign, Bell
} from 'lucide-react';
import { SalesAnalysisTab } from './analytics/SalesAnalysisTab';
import { InventoryAnalysisTab } from './analytics/InventoryAnalysisTab';
import { FinanceAnalysisTab } from './analytics/FinanceAnalysisTab';
import { AlertCenterTab } from './analytics/AlertCenterTab';

// Tab 配置
const TABS = [
  { id: 'sales', name: '销售分析', icon: TrendingUp, color: 'text-blue-500' },
  { id: 'inventory', name: '库存分析', icon: Package, color: 'text-green-500' },
  { id: 'finance', name: '财务分析', icon: DollarSign, color: 'text-purple-500' },
  { id: 'alerts', name: '预警中心', icon: Bell, color: 'text-red-500' }
];

export const AnalyticsPage: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [activeTab, setActiveTab] = useState('sales');

  const renderTabContent = () => {
    switch (activeTab) {
      case 'sales':
        return <SalesAnalysisTab />;
      case 'inventory':
        return <InventoryAnalysisTab />;
      case 'finance':
        return <FinanceAnalysisTab />;
      case 'alerts':
        return <AlertCenterTab />;
      default:
        return <SalesAnalysisTab />;
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-gray-50">
      {/* 顶部导航 */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <button
              onClick={onBack}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-gray-600" />
            </button>
            <div>
              <h1 className="text-xl font-semibold text-gray-900 flex items-center">
                <BarChart3 className="w-6 h-6 mr-2 text-blue-500" />
                数据分析中心
              </h1>
              <p className="text-sm text-gray-500">销售、库存、财务分析与预警监控</p>
            </div>
          </div>
        </div>
        
        {/* Tab 导航 */}
        <div className="flex space-x-1 mt-4 bg-gray-100 rounded-xl p-1">
          {TABS.map(tab => {
            const IconComponent = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 flex items-center justify-center space-x-2 px-4 py-2.5 rounded-lg 
                           transition-all duration-200 ${
                  isActive 
                    ? 'bg-white text-gray-900 shadow-sm' 
                    : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
                }`}
              >
                <IconComponent className={`w-4 h-4 ${isActive ? tab.color : ''}`} />
                <span className="font-medium text-sm">{tab.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab 内容 */}
      <div className="p-6 max-w-7xl mx-auto">
        {renderTabContent()}
      </div>
    </div>
  );
};

export default AnalyticsPage;
