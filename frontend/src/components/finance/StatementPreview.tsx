import React from 'react';
import { StatementData, TransactionItem } from '../../services/financeService';

interface StatementPreviewProps {
  data: StatementData;
}

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

  // 判断是否有往来明细（新版格式）
  const hasTransactions = data.transactions && data.transactions.length > 0;

  // A4纸比例
  const a4Width = '210mm';
  const a4Height = '297mm';

  return (
    <div
      className="statement-preview bg-white border-2 border-black mx-auto shadow-lg print:shadow-none print:border-2 print:border-black"
      style={{
        width: a4Width,
        minHeight: a4Height,
        maxWidth: '100%',
        padding: '40px',
        boxSizing: 'border-box',
      }}
    >
      {/* 标题 */}
      <div className="text-center mb-6 print:mb-4">
        <h1 className="text-3xl font-bold text-green-700 mb-2">客户往来账明细表</h1>
      </div>

      {/* 客户信息和期间 */}
      <div className="mb-4 print:mb-3 text-sm">
        <div className="flex justify-between items-center mb-2">
          <div>
            <span className="font-semibold">统计日期：</span>
            <span>{formatDate(data.period.start)} 到 {formatDate(data.period.end)}</span>
          </div>
          <div>
            <span className="font-semibold">对账单号：</span>
            <span>{data.statementNo}</span>
          </div>
        </div>
        <div className="flex justify-between items-center">
          <div>
            <span className="font-semibold">往来客户：</span>
            <span className="font-bold">{data.customer.name}</span>
            {data.customer.customerNo && <span className="ml-2 text-gray-500">({data.customer.customerNo})</span>}
          </div>
          <div>
            <span className="font-semibold">生成时间：</span>
            <span>
              {new Intl.DateTimeFormat('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              }).format(typeof data.generatedAt === 'string' ? new Date(data.generatedAt) : data.generatedAt)}
            </span>
          </div>
        </div>
      </div>

      {/* 往来账明细表 */}
      <div className="mb-6 print:mb-5">
        <table className="w-full border-collapse border border-black text-sm">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-black px-2 py-2 text-center font-bold w-12">序号</th>
              <th className="border border-black px-2 py-2 text-center font-bold w-24">发生日期</th>
              <th className="border border-black px-2 py-2 text-center font-bold w-20">往来类型</th>
              <th className="border border-black px-2 py-2 text-left font-bold">往来单号</th>
              <th className="border border-black px-2 py-2 text-right font-bold w-20">足金</th>
              <th className="border border-black px-2 py-2 text-right font-bold w-24">欠款金额</th>
              <th className="border border-black px-2 py-2 text-left font-bold">单据备注</th>
            </tr>
          </thead>
          <tbody>
            {/* 期初余额 */}
            <tr className="bg-yellow-50">
              <td className="border border-black px-2 py-2 text-center">1</td>
              <td className="border border-black px-2 py-2 text-center">-</td>
              <td className="border border-black px-2 py-2 text-center font-semibold">期初余额</td>
              <td className="border border-black px-2 py-2">-</td>
              <td className="border border-black px-2 py-2 text-right font-mono">
                {(data.summary.openingGold ?? 0).toFixed(3)}
              </td>
              <td className="border border-black px-2 py-2 text-right font-mono">
                {data.summary.openingBalance.toFixed(2)}
              </td>
              <td className="border border-black px-2 py-2">-</td>
            </tr>

            {/* 往来明细 */}
            {hasTransactions ? (
              data.transactions!.map((tx, index) => (
                <tr key={index} className={tx.type === '客户来料' ? 'bg-blue-50' : tx.type === '客户来款' ? 'bg-green-50' : ''}>
                  <td className="border border-black px-2 py-2 text-center">{index + 2}</td>
                  <td className="border border-black px-2 py-2 text-center">{tx.date || '-'}</td>
                  <td className="border border-black px-2 py-2 text-center">{tx.type}</td>
                  <td className="border border-black px-2 py-2 text-xs">{tx.orderNo}</td>
                  <td className={`border border-black px-2 py-2 text-right font-mono ${tx.goldAmount < 0 ? 'text-blue-600' : tx.goldAmount > 0 ? 'text-orange-600' : ''}`}>
                    {tx.goldAmount !== 0 ? formatGold(tx.goldAmount) : ''}
                  </td>
                  <td className={`border border-black px-2 py-2 text-right font-mono ${tx.cashAmount < 0 ? 'text-green-600' : tx.cashAmount > 0 ? 'text-red-600' : ''}`}>
                    {tx.cashAmount !== 0 ? formatCash(tx.cashAmount) : ''}
                  </td>
                  <td className="border border-black px-2 py-2 text-xs">{tx.remark || ''}</td>
                </tr>
              ))
            ) : (
              // 如果没有合并明细，显示旧格式
              <>
                {data.salesDetails.map((detail, index) => (
                  <tr key={`sale-${index}`}>
                    <td className="border border-black px-2 py-2 text-center">{index + 2}</td>
                    <td className="border border-black px-2 py-2 text-center">{formatDate(detail.date)}</td>
                    <td className="border border-black px-2 py-2 text-center">销售结算</td>
                    <td className="border border-black px-2 py-2 text-xs">{detail.orderNo}</td>
                    <td className="border border-black px-2 py-2 text-right font-mono"></td>
                    <td className="border border-black px-2 py-2 text-right font-mono text-red-600">
                      +{detail.amount.toFixed(2)}
                    </td>
                    <td className="border border-black px-2 py-2 text-xs">{detail.salesperson || ''}</td>
                  </tr>
                ))}
                {data.paymentDetails.map((detail, index) => (
                  <tr key={`pay-${index}`} className="bg-green-50">
                    <td className="border border-black px-2 py-2 text-center">{data.salesDetails.length + index + 2}</td>
                    <td className="border border-black px-2 py-2 text-center">{formatDate(detail.date)}</td>
                    <td className="border border-black px-2 py-2 text-center">客户来款</td>
                    <td className="border border-black px-2 py-2 text-xs">-</td>
                    <td className="border border-black px-2 py-2 text-right font-mono"></td>
                    <td className="border border-black px-2 py-2 text-right font-mono text-green-600">
                      -{detail.amount.toFixed(2)}
                    </td>
                    <td className="border border-black px-2 py-2 text-xs">{detail.method}</td>
                  </tr>
                ))}
              </>
            )}

            {/* 合计行 */}
            <tr className="bg-gray-100 font-bold">
              <td className="border border-black px-2 py-2 text-center" colSpan={2}>合计</td>
              <td className="border border-black px-2 py-2"></td>
              <td className="border border-black px-2 py-2"></td>
              <td className="border border-black px-2 py-2 text-right font-mono">
                {(data.summary.totalGold ?? 0).toFixed(3)}
              </td>
              <td className="border border-black px-2 py-2 text-right font-mono">
                {(data.summary.totalCash ?? (data.summary.totalSales - data.summary.totalPayments)).toFixed(2)}
              </td>
              <td className="border border-black px-2 py-2"></td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 期末余额汇总 */}
      <div className="mb-6 print:mb-5">
        <h3 className="text-lg font-bold mb-2">期末余额</h3>
        <div className="grid grid-cols-2 gap-4 text-sm border border-black p-4 bg-gray-50">
          <div className="flex justify-between">
            <span className="font-semibold">期末欠料：</span>
            <span className={`font-mono font-bold ${(data.summary.closingGold ?? 0) > 0 ? 'text-orange-600' : (data.summary.closingGold ?? 0) < 0 ? 'text-blue-600' : ''}`}>
              {(data.summary.closingGold ?? 0).toFixed(3)} 克
              {(data.summary.closingGold ?? 0) > 0 ? ' (客户欠)' : (data.summary.closingGold ?? 0) < 0 ? ' (存料)' : ''}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="font-semibold">期末欠款：</span>
            <span className={`font-mono font-bold text-xl ${data.summary.closingBalance > 0 ? 'text-red-600' : data.summary.closingBalance < 0 ? 'text-green-600' : ''}`}>
              {formatCurrency(data.summary.closingBalance)}
              {data.summary.closingBalance > 0 ? ' (客户欠)' : data.summary.closingBalance < 0 ? ' (预收款)' : ''}
            </span>
          </div>
        </div>
      </div>

      {/* 说明 */}
      <div className="text-xs text-gray-500 mt-4">
        <p>说明：足金栏正数表示客户欠料，负数表示客户给料；欠款金额栏正数表示客户欠款，负数表示客户付款。</p>
      </div>
    </div>
  );
};
