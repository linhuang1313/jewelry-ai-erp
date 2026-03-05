/**
 * 操作结果增强显示组件
 * 用于展示AI执行操作后的详细结果，包括前后对比、单据号、时间戳等
 */
import React, { useState } from 'react';

interface BalanceChange {
  account_type: string;
  account_name: string;
  before: number;
  after: number;
  change: number;
}

interface OperationResult {
  action: string;           // 操作类型：create, update, delete, settle, revert
  action_label: string;     // 操作标签：创建、更新、删除、结算、撤销
  entity_type: string;      // 实体类型：sales_order, settlement_order, customer等
  entity_label: string;     // 实体标签：销售单、结算单、客户等
  entity_no?: string;       // 单据号
  entity_id?: number;       // 实体ID
  timestamp: string;        // 操作时间
  success: boolean;         // 是否成功
  message?: string;         // 操作消息
  changes?: Record<string, { before: any; after: any }>;  // 字段变更
  balance_changes?: BalanceChange[];  // 余额变更
  summary?: string;         // 操作摘要
}

interface OperationResultCardProps {
  result: OperationResult;
  showDetails?: boolean;
}

// 操作类型图标映射
const ACTION_ICONS: Record<string, string> = {
  create: '➕',
  update: '✏️',
  delete: '🗑️',
  settle: '💰',
  revert: '↩️',
  withdraw: '📤',
  deposit: '📥',
  query: '🔍',
};

// 操作类型颜色映射
const ACTION_COLORS: Record<string, string> = {
  create: 'bg-green-50 border-green-200 text-green-800',
  update: 'bg-blue-50 border-blue-200 text-blue-800',
  delete: 'bg-red-50 border-red-200 text-red-800',
  settle: 'bg-purple-50 border-purple-200 text-purple-800',
  revert: 'bg-orange-50 border-orange-200 text-orange-800',
  withdraw: 'bg-amber-50 border-amber-200 text-amber-800',
  deposit: 'bg-teal-50 border-teal-200 text-teal-800',
  query: 'bg-gray-50 border-gray-200 text-gray-800',
};

const OperationResultCard: React.FC<OperationResultCardProps> = ({ result, showDetails = true }) => {
  const [expanded, setExpanded] = useState(false);
  
  const icon = ACTION_ICONS[result.action] || '📋';
  const colorClass = ACTION_COLORS[result.action] || ACTION_COLORS.query;
  
  // 格式化数值
  const formatValue = (value: any): string => {
    if (value === null || value === undefined) return '-';
    if (typeof value === 'number') {
      return value.toLocaleString('zh-CN', { 
        minimumFractionDigits: 2, 
        maximumFractionDigits: 2 
      });
    }
    return String(value);
  };

  // 格式化时间
  const formatTime = (timestamp: string): string => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch {
      return timestamp;
    }
  };

  return (
    <div className={`rounded-lg border-2 p-4 my-3 ${colorClass}`}>
      {/* 头部：操作类型和状态 */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">{icon}</span>
          <span className="font-semibold text-lg">
            {result.action_label}{result.entity_label}
          </span>
          {result.success ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
              ✓ 成功
            </span>
          ) : (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
              ✗ 失败
            </span>
          )}
        </div>
        <span className="text-xs text-gray-500">{formatTime(result.timestamp)}</span>
      </div>

      {/* 单据号 */}
      {result.entity_no && (
        <div className="mb-3 p-2 bg-white/50 rounded border border-current/20">
          <span className="text-sm text-gray-600">单据号：</span>
          <span className="font-mono font-bold text-base ml-1">{result.entity_no}</span>
        </div>
      )}

      {/* 操作摘要 */}
      {result.summary && (
        <div className="mb-3 text-sm">{result.summary}</div>
      )}

      {/* 消息 */}
      {result.message && (
        <div className="mb-3 text-sm italic">{result.message}</div>
      )}

      {/* 余额变更（重点展示） */}
      {result.balance_changes && result.balance_changes.length > 0 && (
        <div className="mb-3">
          <div className="text-sm font-medium mb-2 flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            账户余额变更
          </div>
          <div className="bg-white/70 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-100/50">
                <tr>
                  <th className="px-3 py-2 text-left">账户</th>
                  <th className="px-3 py-2 text-right">变更前</th>
                  <th className="px-3 py-2 text-center">→</th>
                  <th className="px-3 py-2 text-right">变更后</th>
                  <th className="px-3 py-2 text-right">变动</th>
                </tr>
              </thead>
              <tbody>
                {result.balance_changes.map((change, idx) => (
                  <tr key={idx} className="border-t border-gray-100">
                    <td className="px-3 py-2">
                      <span className="text-xs text-gray-500">{change.account_type}</span>
                      <br />
                      {change.account_name}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{formatValue(change.before)}克</td>
                    <td className="px-3 py-2 text-center text-gray-400">→</td>
                    <td className="px-3 py-2 text-right font-mono font-bold">{formatValue(change.after)}克</td>
                    <td className={`px-3 py-2 text-right font-mono font-bold ${
                      change.change > 0 ? 'text-green-600' : change.change < 0 ? 'text-red-600' : ''
                    }`}>
                      {change.change > 0 ? '+' : ''}{formatValue(change.change)}克
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 详细变更（可展开） */}
      {showDetails && result.changes && Object.keys(result.changes).length > 0 && (
        <div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-sm flex items-center gap-1 text-gray-600 hover:text-gray-800"
          >
            <svg 
              className={`w-4 h-4 transition-transform ${expanded ? 'rotate-90' : ''}`} 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            {expanded ? '收起详细变更' : '查看详细变更'}
          </button>
          
          {expanded && (
            <div className="mt-2 bg-white/70 rounded-lg p-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="px-2 py-1 text-left">字段</th>
                    <th className="px-2 py-1 text-right">变更前</th>
                    <th className="px-2 py-1 text-right">变更后</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(result.changes).map(([field, { before, after }]) => (
                    <tr key={field} className="border-b border-gray-100">
                      <td className="px-2 py-1 text-gray-600">{field}</td>
                      <td className="px-2 py-1 text-right font-mono text-red-500 line-through">
                        {formatValue(before)}
                      </td>
                      <td className="px-2 py-1 text-right font-mono text-green-600 font-bold">
                        {formatValue(after)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default OperationResultCard;
