import React from 'react';
import { RefreshCw, Crown, Sparkles } from 'lucide-react';

// ============= 页面头部组件 =============
interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
}

export const PageHeader: React.FC<PageHeaderProps> = ({ title, subtitle, icon, actions }) => (
  <div className="bg-white/80 backdrop-blur-sm border-b border-amber-100/50 sticky top-0 z-10">
    <div className="px-6 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {icon || (
            <div className="p-2 bg-gradient-to-br from-amber-400 to-yellow-500 rounded-xl shadow-lg shadow-amber-200/50">
              <Crown className="w-5 h-5 text-white" />
            </div>
          )}
          <div>
            <h1 className="text-xl font-bold text-gray-900">{title}</h1>
            {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex items-center gap-3">{actions}</div>}
      </div>
    </div>
  </div>
);

// ============= 指标卡片组件 =============
interface MetricCardProps {
  title: string;
  value: string | number;
  subValue?: string;
  variant?: 'gold' | 'emerald' | 'sapphire' | 'amethyst' | 'rose';
  icon?: React.ReactNode;
}

const variantStyles = {
  gold: 'bg-gradient-to-br from-amber-400 to-yellow-500 text-white',
  emerald: 'bg-gradient-to-br from-emerald-500 to-teal-500 text-white',
  sapphire: 'bg-gradient-to-br from-blue-500 to-indigo-500 text-white',
  amethyst: 'bg-gradient-to-br from-purple-500 to-pink-500 text-white',
  rose: 'bg-gradient-to-br from-rose-500 to-red-500 text-white',
};

export const MetricCard: React.FC<MetricCardProps> = ({ 
  title, 
  value, 
  subValue, 
  variant = 'gold',
  icon 
}) => (
  <div className={`relative overflow-hidden rounded-2xl p-5 ${variantStyles[variant]} 
    shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-0.5`}>
    <div className="absolute top-0 right-0 w-24 h-24 opacity-10">
      <div className="absolute inset-0 bg-white rounded-full transform translate-x-6 -translate-y-6" />
    </div>
    <div className="relative">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium opacity-80">{title}</p>
          <p className="text-2xl font-bold mt-1">{value}</p>
          {subValue && <p className="text-xs opacity-70 mt-1">{subValue}</p>}
        </div>
        {icon && (
          <div className="p-2 bg-white/20 rounded-lg">
            {icon}
          </div>
        )}
      </div>
    </div>
  </div>
);

// ============= 卡片容器组件 =============
interface CardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
}

export const Card: React.FC<CardProps> = ({ children, className = '', hover = true }) => (
  <div className={`bg-white rounded-2xl shadow-sm border border-gray-100/50 
    ${hover ? 'hover:shadow-md transition-shadow' : ''} ${className}`}>
    {children}
  </div>
);

export const CardHeader: React.FC<{ 
  title: string; 
  icon?: React.ReactNode;
  action?: React.ReactNode;
  iconBg?: string;
}> = ({ title, icon, action, iconBg = 'from-amber-100 to-yellow-100' }) => (
  <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
    <div className="flex items-center gap-2">
      {icon && (
        <div className={`p-2 bg-gradient-to-br ${iconBg} rounded-lg`}>
          {icon}
        </div>
      )}
      <h3 className="font-semibold text-gray-900">{title}</h3>
    </div>
    {action}
  </div>
);

export const CardBody: React.FC<{ children: React.ReactNode; className?: string }> = ({ 
  children, 
  className = '' 
}) => (
  <div className={`p-6 ${className}`}>{children}</div>
);

// ============= 按钮组件 =============
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'gold';
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
  loading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  icon,
  loading,
  className = '',
  disabled,
  ...props
}) => {
  const baseStyles = 'inline-flex items-center justify-center gap-2 font-medium rounded-xl transition-all duration-200 active:scale-95';
  
  const variants = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm',
    secondary: 'bg-gray-100 text-gray-700 hover:bg-gray-200',
    danger: 'bg-red-500 text-white hover:bg-red-600',
    ghost: 'text-gray-600 hover:bg-gray-100',
    gold: 'bg-gradient-to-r from-amber-500 to-yellow-500 text-white hover:from-amber-600 hover:to-yellow-600 shadow-lg shadow-amber-200/50',
  };
  
  const sizes = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2',
    lg: 'px-6 py-3 text-lg',
  };

  return (
    <button
      className={`${baseStyles} ${variants[variant]} ${sizes[size]} 
        ${disabled || loading ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : icon}
      {children}
    </button>
  );
};

// ============= Tab 切换组件 =============
interface TabItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
  count?: number;
}

interface TabsProps {
  items: TabItem[];
  activeKey: string;
  onChange: (key: string) => void;
  variant?: 'default' | 'pills' | 'underline';
}

export const Tabs: React.FC<TabsProps> = ({ items, activeKey, onChange, variant = 'pills' }) => {
  if (variant === 'pills') {
    return (
      <div className="flex gap-2 p-1 bg-gray-100 rounded-xl">
        {items.map((item) => (
          <button
            key={item.key}
            onClick={() => onChange(item.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
              activeKey === item.key
                ? 'bg-white text-amber-700 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {item.icon}
            <span>{item.label}</span>
            {item.count !== undefined && item.count > 0 && (
              <span className={`px-2 py-0.5 text-xs rounded-full ${
                activeKey === item.key ? 'bg-amber-100 text-amber-700' : 'bg-gray-200 text-gray-600'
              }`}>
                {item.count}
              </span>
            )}
          </button>
        ))}
      </div>
    );
  }
  
  return (
    <div className="flex gap-1 border-b border-gray-200">
      {items.map((item) => (
        <button
          key={item.key}
          onClick={() => onChange(item.key)}
          className={`flex items-center gap-2 px-4 py-3 font-medium border-b-2 transition-all ${
            activeKey === item.key
              ? 'border-amber-500 text-amber-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          {item.icon}
          <span>{item.label}</span>
          {item.count !== undefined && item.count > 0 && (
            <span className="px-2 py-0.5 text-xs rounded-full bg-red-500 text-white">
              {item.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
};

// ============= 输入框组件 =============
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ReactNode;
  error?: string;
}

export const Input: React.FC<InputProps> = ({ icon, error, className = '', ...props }) => (
  <div className="relative">
    {icon && (
      <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
        {icon}
      </div>
    )}
    <input
      className={`w-full px-4 py-2.5 ${icon ? 'pl-10' : ''} border border-gray-200 rounded-xl
        focus:ring-2 focus:ring-amber-500 focus:border-amber-500 
        transition-colors placeholder:text-gray-400
        ${error ? 'border-red-500 focus:ring-red-500' : ''} ${className}`}
      {...props}
    />
    {error && <p className="mt-1 text-sm text-red-500">{error}</p>}
  </div>
);

// ============= 徽章组件 =============
interface BadgeProps {
  children: React.ReactNode;
  variant?: 'success' | 'warning' | 'error' | 'info' | 'gold' | 'default';
}

export const Badge: React.FC<BadgeProps> = ({ children, variant = 'default' }) => {
  const variants = {
    success: 'bg-green-100 text-green-700',
    warning: 'bg-amber-100 text-amber-700',
    error: 'bg-red-100 text-red-700',
    info: 'bg-blue-100 text-blue-700',
    gold: 'bg-gradient-to-r from-amber-100 to-yellow-100 text-amber-800',
    default: 'bg-gray-100 text-gray-700',
  };

  return (
    <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${variants[variant]}`}>
      {children}
    </span>
  );
};

// ============= 加载状态组件 =============
export const LoadingSpinner: React.FC<{ text?: string }> = ({ text = '加载中...' }) => (
  <div className="flex flex-col items-center justify-center py-12">
    <div className="relative">
      <div className="w-12 h-12 border-4 border-amber-200 rounded-full animate-pulse" />
      <Sparkles className="w-6 h-6 text-amber-500 absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 animate-spin" />
    </div>
    <p className="mt-4 text-gray-500 font-medium">{text}</p>
  </div>
);

// ============= 空状态组件 =============
interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, description, action }) => (
  <div className="flex flex-col items-center justify-center py-16 text-center">
    {icon && <div className="text-gray-300 mb-4">{icon}</div>}
    <h3 className="text-lg font-medium text-gray-900 mb-1">{title}</h3>
    {description && <p className="text-gray-500 mb-4">{description}</p>}
    {action}
  </div>
);

// ============= 表格组件 =============
interface TableColumn<T> {
  key: string;
  title: string;
  render?: (value: any, record: T, index: number) => React.ReactNode;
  align?: 'left' | 'center' | 'right';
  width?: string;
}

interface TableProps<T> {
  columns: TableColumn<T>[];
  data: T[];
  rowKey: keyof T | ((record: T) => string | number);
  loading?: boolean;
  emptyText?: string;
  onRowClick?: (record: T) => void;
  hoverable?: boolean;
}

export function Table<T extends object>({
  columns,
  data,
  rowKey,
  loading,
  emptyText = '暂无数据',
  onRowClick,
  hoverable = true,
}: TableProps<T>) {
  const getRowKey = (record: T, index: number): string | number => {
    if (typeof rowKey === 'function') {
      return rowKey(record);
    }
    return record[rowKey] as string | number;
  };

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="bg-gradient-to-r from-gray-50 to-amber-50/30 border-b border-gray-100">
            {columns.map((col) => (
              <th
                key={col.key}
                className={`px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wider
                  ${col.align === 'center' ? 'text-center' : col.align === 'right' ? 'text-right' : 'text-left'}`}
                style={{ width: col.width }}
              >
                {col.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="py-12 text-center text-gray-500">
                {emptyText}
              </td>
            </tr>
          ) : (
            data.map((record, index) => (
              <tr
                key={getRowKey(record, index)}
                onClick={() => onRowClick?.(record)}
                className={`${hoverable ? 'hover:bg-amber-50/50' : ''} 
                  ${onRowClick ? 'cursor-pointer' : ''} transition-colors`}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-4 py-3 text-sm text-gray-700
                      ${col.align === 'center' ? 'text-center' : col.align === 'right' ? 'text-right' : ''}`}
                  >
                    {col.render
                      ? col.render((record as any)[col.key], record, index)
                      : (record as any)[col.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ============= 金额显示组件 =============
interface AmountDisplayProps {
  value: number;
  prefix?: string;
  size?: 'sm' | 'md' | 'lg';
  color?: 'default' | 'gold' | 'success' | 'danger';
}

export const AmountDisplay: React.FC<AmountDisplayProps> = ({
  value,
  prefix = '¥',
  size = 'md',
  color = 'default',
}) => {
  const sizes = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-xl',
  };
  
  const colors = {
    default: 'text-gray-900',
    gold: 'text-amber-600',
    success: 'text-green-600',
    danger: 'text-red-600',
  };

  return (
    <span className={`font-mono font-bold ${sizes[size]} ${colors[color]}`}>
      {prefix}{value.toFixed(2)}
    </span>
  );
};

// ============= 克重显示组件 =============
interface WeightDisplayProps {
  value: number;
  size?: 'sm' | 'md' | 'lg';
}

export const WeightDisplay: React.FC<WeightDisplayProps> = ({ value, size = 'md' }) => {
  const sizes = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-lg',
  };

  return (
    <span className={`font-mono text-gray-700 ${sizes[size]}`}>
      {value.toFixed(2)}
      <span className="text-gray-400 text-sm ml-0.5">g</span>
    </span>
  );
};

// ============= 页面容器组件 =============
export const PageContainer: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="min-h-screen bg-gradient-to-br from-gray-50 via-amber-50/30 to-gray-50">
    {children}
  </div>
);

export const PageContent: React.FC<{ children: React.ReactNode; className?: string }> = ({ 
  children, 
  className = '' 
}) => (
  <div className={`p-6 ${className}`}>{children}</div>
);

