import React from 'react';
import { TrendingUp, TrendingDown, DollarSign, Calendar, AlertTriangle, Users } from 'lucide-react';
import { FinanceStatistics } from '../../types/finance';

interface FinanceStatsCardsProps {
  statistics: FinanceStatistics;
}

export const FinanceStatsCards: React.FC<FinanceStatsCardsProps> = ({ statistics }) => {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency: 'CNY',
      minimumFractionDigits: 2,
    }).format(amount);
  };

  const cards = [
    {
      title: '总应收账款',
      value: formatCurrency(statistics.totalReceivable),
      icon: DollarSign,
      gradient: 'from-blue-500 to-blue-600',
      bgGradient: 'from-blue-50 to-blue-100',
      textColor: 'text-blue-600',
    },
    {
      title: '本月回款',
      value: formatCurrency(statistics.monthlyPayment),
      change: statistics.monthlyPaymentChange,
      icon: Calendar,
      gradient: 'from-green-500 to-green-600',
      bgGradient: 'from-green-50 to-green-100',
      textColor: 'text-green-600',
    },
    {
      title: '逾期金额',
      value: formatCurrency(statistics.overdueAmount),
      icon: AlertTriangle,
      gradient: 'from-red-500 to-red-600',
      bgGradient: 'from-red-50 to-red-100',
      textColor: 'text-red-600',
    },
    {
      title: '待催款客户',
      value: `${statistics.overdueCustomerCount} 个`,
      icon: Users,
      gradient: 'from-orange-500 to-orange-600',
      bgGradient: 'from-orange-50 to-orange-100',
      textColor: 'text-orange-600',
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {cards.map((card, index) => {
        const Icon = card.icon;
        const isPositive = card.change !== undefined && card.change > 0;
        
        return (
          <div
            key={index}
            className={`bg-gradient-to-br ${card.bgGradient} rounded-xl p-6 shadow-lg hover:shadow-xl transition-all duration-200 transform hover:-translate-y-1`}
          >
            <div className="flex items-center justify-between mb-4">
              <div className={`p-3 rounded-lg bg-white bg-opacity-50 shadow-sm`}>
                <Icon className={`w-6 h-6 ${card.textColor}`} />
              </div>
              {card.change !== undefined && (
                <div className={`flex items-center space-x-1 ${isPositive ? 'text-green-600' : 'text-red-600'} bg-white bg-opacity-70 px-2 py-1 rounded-full`}>
                  {isPositive ? (
                    <TrendingUp className="w-4 h-4" />
                  ) : (
                    <TrendingDown className="w-4 h-4" />
                  )}
                  <span className="text-sm font-semibold">
                    {isPositive ? '↑' : '↓'}
                    {Math.abs(card.change).toFixed(1)}%
                  </span>
                </div>
              )}
            </div>
            <h3 className="text-sm font-medium text-gray-700 mb-2">{card.title}</h3>
            <p className={`text-3xl md:text-4xl font-bold ${card.textColor} tracking-tight`}>
              {card.value}
            </p>
          </div>
        );
      })}
    </div>
  );
};


import { FinanceStatistics } from '../../types/finance';

interface FinanceStatsCardsProps {
  statistics: FinanceStatistics;
}

export const FinanceStatsCards: React.FC<FinanceStatsCardsProps> = ({ statistics }) => {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency: 'CNY',
      minimumFractionDigits: 2,
    }).format(amount);
  };

  const cards = [
    {
      title: '总应收账款',
      value: formatCurrency(statistics.totalReceivable),
      icon: DollarSign,
      gradient: 'from-blue-500 to-blue-600',
      bgGradient: 'from-blue-50 to-blue-100',
      textColor: 'text-blue-600',
    },
    {
      title: '本月回款',
      value: formatCurrency(statistics.monthlyPayment),
      change: statistics.monthlyPaymentChange,
      icon: Calendar,
      gradient: 'from-green-500 to-green-600',
      bgGradient: 'from-green-50 to-green-100',
      textColor: 'text-green-600',
    },
    {
      title: '逾期金额',
      value: formatCurrency(statistics.overdueAmount),
      icon: AlertTriangle,
      gradient: 'from-red-500 to-red-600',
      bgGradient: 'from-red-50 to-red-100',
      textColor: 'text-red-600',
    },
    {
      title: '待催款客户',
      value: `${statistics.overdueCustomerCount} 个`,
      icon: Users,
      gradient: 'from-orange-500 to-orange-600',
      bgGradient: 'from-orange-50 to-orange-100',
      textColor: 'text-orange-600',
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {cards.map((card, index) => {
        const Icon = card.icon;
        const isPositive = card.change !== undefined && card.change > 0;
        
        return (
          <div
            key={index}
            className={`bg-gradient-to-br ${card.bgGradient} rounded-xl p-6 shadow-lg hover:shadow-xl transition-all duration-200 transform hover:-translate-y-1`}
          >
            <div className="flex items-center justify-between mb-4">
              <div className={`p-3 rounded-lg bg-white bg-opacity-50 shadow-sm`}>
                <Icon className={`w-6 h-6 ${card.textColor}`} />
              </div>
              {card.change !== undefined && (
                <div className={`flex items-center space-x-1 ${isPositive ? 'text-green-600' : 'text-red-600'} bg-white bg-opacity-70 px-2 py-1 rounded-full`}>
                  {isPositive ? (
                    <TrendingUp className="w-4 h-4" />
                  ) : (
                    <TrendingDown className="w-4 h-4" />
                  )}
                  <span className="text-sm font-semibold">
                    {isPositive ? '↑' : '↓'}
                    {Math.abs(card.change).toFixed(1)}%
                  </span>
                </div>
              )}
            </div>
            <h3 className="text-sm font-medium text-gray-700 mb-2">{card.title}</h3>
            <p className={`text-3xl md:text-4xl font-bold ${card.textColor} tracking-tight`}>
              {card.value}
            </p>
          </div>
        );
      })}
    </div>
  );
};

