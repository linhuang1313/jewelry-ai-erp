import React from 'react';
import { StatementData, TransactionItem } from '../../services/financeService';

interface StatementPreviewProps {
  data: StatementData;
}

// 公司信息配置
const COMPANY_INFO = {
  name: '深圳市梵贝琳珠宝有限公司',
  address: '深圳市罗湖区布心路水贝壹号A座16楼',
  disclaimer: '本对账单一式两份，双方各执一份。如有异议请于收到后3个工作日内书面提出，逾期未提出异议视为双方确认无误。',
};

export const StatementPreview: React.FC<StatementPreviewProps> = ({ data }) => {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency: 'CNY',
      minimumFractionDigits: 2,
    }).format(amount);
  };

  const formatDate = (date: Date | string) => {
    if (!date) return '-';
    const d = typeof date === 'string' ? new Date(date) : date;
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  };

  const formatGold = (amount: number) => {
    if (Math.abs(amount) < 0.001) return '0.000';
    const sign = amount > 0 ? '+' : '';
    return `${sign}${amount.toFixed(3)}`;
  };

  const formatCash = (amount: number) => {
    if (Math.abs(amount) < 0.01) return '0.00';
    const sign = amount > 0 ? '+' : '';
    return `${sign}${amount.toFixed(2)}`;
  };

  // 获取今天的日期（打印日期）
  const getTodayDate = () => {
    const now = new Date();
    return `${now.getFullYear()}年${String(now.getMonth() + 1).padStart(2, '0')}月${String(now.getDate()).padStart(2, '0')}日`;
  };

  // 判断是否有往来明细（新版格式）
  const hasTransactions = data.transactions && data.transactions.length > 0;

  // A4纸比例
  const a4Width = '210mm';
  const a4Height = '297mm';

  return (
    <div
      className="statement-preview bg-white border-2 border-gray-300 mx-auto shadow-lg print:shadow-none print:border-2 print:border-gray-400"
      style={{
        width: a4Width,
        minHeight: a4Height,
        maxWidth: '100%',
        padding: '32px 40px',
        boxSizing: 'border-box',
      }}
    >
      {/* ========== 公司信息头部 ========== */}
      <div className="text-center mb-6 print:mb-5">
        <h1 className="text-2xl font-bold text-gray-800 tracking-wider mb-1">
          {COMPANY_INFO.name}
        </h1>
        <h2 className="text-xl font-bold text-amber-700 mb-1">客户往来账对账单</h2>
        <div className="w-full h-0.5 bg-gradient-to-r from-transparent via-amber-600 to-transparent"></div>
      </div>

      {/* ========== 客户信息和期间 ========== */}
      <div className="mb-4 print:mb-3 text-sm border border-gray-300 rounded p-3 bg-gray-50">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <span className="text-gray-600">客户名称：</span>
            <span className="font-bold text-gray-900">{data.customer.name}</span>
          </div>
          <div className="text-right">
            <span className="text-gray-600">对账单号：</span>
            <span className="font-mono text-gray-700">{data.statementNo}</span>
          </div>
          <div>
            <span className="text-gray-600">客户编号：</span>
            <span className="font-mono text-gray-700">{data.customer.customerNo || '-'}</span>
          </div>
          <div className="text-right">
            <span className="text-gray-600">对账期间：</span>
            <span className="text-gray-700">{formatDate(data.period.start)} 至 {formatDate(data.period.end)}</span>
          </div>
        </div>
      </div>

      {/* ========== 往来账明细表 ========== */}
      <div className="mb-5 print:mb-4">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-amber-50">
              <th className="border border-gray-400 px-2 py-2 text-center font-bold w-10">序号</th>
              <th className="border border-gray-400 px-2 py-2 text-center font-bold w-20">发生日期</th>
              <th className="border border-gray-400 px-2 py-2 text-center font-bold w-20">往来类型</th>
              <th className="border border-gray-400 px-2 py-2 text-left font-bold">往来单号</th>
              <th className="border border-gray-400 px-2 py-2 text-right font-bold w-20">足金(克)</th>
              <th className="border border-gray-400 px-2 py-2 text-right font-bold w-24">金额(元)</th>
              <th className="border border-gray-400 px-2 py-2 text-left font-bold w-24">备注</th>
            </tr>
          </thead>
          <tbody>
            {/* 期初余额 */}
            <tr className="bg-amber-50/50">
              <td className="border border-gray-400 px-2 py-1.5 text-center">1</td>
              <td className="border border-gray-400 px-2 py-1.5 text-center text-gray-500">-</td>
              <td className="border border-gray-400 px-2 py-1.5 text-center font-semibold text-amber-700">期初余额</td>
              <td className="border border-gray-400 px-2 py-1.5 text-gray-500">-</td>
              <td className="border border-gray-400 px-2 py-1.5 text-right font-mono">
                {(data.summary.openingGold ?? 0).toFixed(3)}
              </td>
              <td className="border border-gray-400 px-2 py-1.5 text-right font-mono">
                {data.summary.openingBalance.toFixed(2)}
              </td>
              <td className="border border-gray-400 px-2 py-1.5 text-gray-500">-</td>
            </tr>

            {/* 往来明细 */}
            {hasTransactions ? (
              data.transactions!.map((tx, index) => (
                <tr 
                  key={index} 
                  className={
                    tx.type === '客户来料' ? 'bg-blue-50/50' : 
                    tx.type === '客户来款' ? 'bg-green-50/50' : 
                    'bg-white'
                  }
                >
                  <td className="border border-gray-400 px-2 py-1.5 text-center">{index + 2}</td>
                  <td className="border border-gray-400 px-2 py-1.5 text-center">{tx.date || '-'}</td>
                  <td className="border border-gray-400 px-2 py-1.5 text-center">{tx.type}</td>
                  <td className="border border-gray-400 px-2 py-1.5 text-xs font-mono">{tx.orderNo}</td>
                  <td className={`border border-gray-400 px-2 py-1.5 text-right font-mono ${tx.goldAmount < 0 ? 'text-blue-600' : tx.goldAmount > 0 ? 'text-orange-600' : ''}`}>
                    {tx.goldAmount !== 0 ? formatGold(tx.goldAmount) : ''}
                  </td>
                  <td className={`border border-gray-400 px-2 py-1.5 text-right font-mono ${tx.cashAmount < 0 ? 'text-green-600' : tx.cashAmount > 0 ? 'text-red-600' : ''}`}>
                    {tx.cashAmount !== 0 ? formatCash(tx.cashAmount) : ''}
                  </td>
                  <td className="border border-gray-400 px-2 py-1.5 text-xs text-gray-600">{tx.remark || ''}</td>
                </tr>
              ))
            ) : (
              // 如果没有合并明细，显示旧格式
              <>
                {(data.salesDetails || []).map((detail, index) => (
                  <tr key={`sale-${index}`} className="bg-white">
                    <td className="border border-gray-400 px-2 py-1.5 text-center">{index + 2}</td>
                    <td className="border border-gray-400 px-2 py-1.5 text-center">{formatDate(detail.date)}</td>
                    <td className="border border-gray-400 px-2 py-1.5 text-center">销售结算</td>
                    <td className="border border-gray-400 px-2 py-1.5 text-xs font-mono">{detail.orderNo}</td>
                    <td className="border border-gray-400 px-2 py-1.5 text-right font-mono"></td>
                    <td className="border border-gray-400 px-2 py-1.5 text-right font-mono text-red-600">
                      +{detail.amount.toFixed(2)}
                    </td>
                    <td className="border border-gray-400 px-2 py-1.5 text-xs text-gray-600">{detail.salesperson || ''}</td>
                  </tr>
                ))}
                {(data.paymentDetails || []).map((detail, index) => (
                  <tr key={`pay-${index}`} className="bg-green-50/50">
                    <td className="border border-gray-400 px-2 py-1.5 text-center">{(data.salesDetails || []).length + index + 2}</td>
                    <td className="border border-gray-400 px-2 py-1.5 text-center">{formatDate(detail.date)}</td>
                    <td className="border border-gray-400 px-2 py-1.5 text-center">客户来款</td>
                    <td className="border border-gray-400 px-2 py-1.5 text-xs font-mono">-</td>
                    <td className="border border-gray-400 px-2 py-1.5 text-right font-mono"></td>
                    <td className="border border-gray-400 px-2 py-1.5 text-right font-mono text-green-600">
                      -{detail.amount.toFixed(2)}
                    </td>
                    <td className="border border-gray-400 px-2 py-1.5 text-xs text-gray-600">{detail.method}</td>
                  </tr>
                ))}
              </>
            )}

            {/* 合计行 */}
            <tr className="bg-gray-100 font-bold">
              <td className="border border-gray-400 px-2 py-2 text-center" colSpan={2}>本期合计</td>
              <td className="border border-gray-400 px-2 py-2"></td>
              <td className="border border-gray-400 px-2 py-2"></td>
              <td className="border border-gray-400 px-2 py-2 text-right font-mono">
                {(data.summary.totalGold ?? 0).toFixed(3)}
              </td>
              <td className="border border-gray-400 px-2 py-2 text-right font-mono">
                {(data.summary.totalCash ?? (data.summary.totalSales - data.summary.totalPayments)).toFixed(2)}
              </td>
              <td className="border border-gray-400 px-2 py-2"></td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ========== 期末余额汇总（优化样式） ========== */}
      <div className="mb-5 print:mb-4">
        <div className="flex gap-4">
          {/* 金料账户卡片 */}
          <div className="flex-1 border-2 border-amber-200 rounded-lg p-4 bg-gradient-to-br from-amber-50 to-orange-50">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xl">🪙</span>
              <span className="font-bold text-gray-700">金料账户</span>
            </div>
            <div className="text-right">
              <span className={`text-2xl font-bold font-mono ${
                (data.summary.closingGold ?? 0) > 0 ? 'text-orange-600' : 
                (data.summary.closingGold ?? 0) < 0 ? 'text-blue-600' : 'text-gray-600'
              }`}>
                {Math.abs(data.summary.closingGold ?? 0).toFixed(3)} 克
              </span>
              <div className="text-sm text-gray-500 mt-1">
                {(data.summary.closingGold ?? 0) > 0 ? '客户欠料' : 
                 (data.summary.closingGold ?? 0) < 0 ? '客户存料' : '已结清'}
              </div>
            </div>
          </div>
          
          {/* 现金账户卡片 */}
          <div className="flex-1 border-2 border-emerald-200 rounded-lg p-4 bg-gradient-to-br from-emerald-50 to-green-50">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xl">💰</span>
              <span className="font-bold text-gray-700">现金账户</span>
            </div>
            <div className="text-right">
              <span className={`text-2xl font-bold font-mono ${
                data.summary.closingBalance > 0 ? 'text-red-600' : 
                data.summary.closingBalance < 0 ? 'text-green-600' : 'text-gray-600'
              }`}>
                ¥{Math.abs(data.summary.closingBalance).toFixed(2)}
              </span>
              <div className="text-sm text-gray-500 mt-1">
                {data.summary.closingBalance > 0 ? '客户欠款' : 
                 data.summary.closingBalance < 0 ? '预收款项' : '已结清'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ========== 客户确认签字区 ========== */}
      <div className="mb-5 print:mb-4 border-2 border-gray-300 rounded-lg p-4 bg-gray-50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-8">
            <span className="font-bold text-gray-700">客户确认</span>
            <div className="flex items-center gap-2">
              <span className="text-gray-600">确认签字：</span>
              <span className="inline-block w-40 border-b-2 border-gray-400"></span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-600">日期：</span>
            <span className="font-mono text-gray-800">{getTodayDate()}</span>
          </div>
        </div>
      </div>

      {/* ========== 页脚：公司地址和声明条款 ========== */}
      <div className="border-t-2 border-gray-300 pt-3 mt-auto">
        <div className="text-xs text-gray-500 space-y-1">
          <div className="flex items-center gap-1">
            <span>📍</span>
            <span>地址：{COMPANY_INFO.address}</span>
          </div>
          <div className="flex items-start gap-1 mt-2">
            <span>※</span>
            <span>{COMPANY_INFO.disclaimer}</span>
          </div>
        </div>
      </div>

      {/* ========== 数据说明（小字） ========== */}
      <div className="text-xs text-gray-400 mt-3 print:mt-2">
        <p>说明：足金栏正数表示客户欠料，负数表示客户给料；金额栏正数表示客户欠款，负数表示客户付款。</p>
      </div>
    </div>
  );
};
