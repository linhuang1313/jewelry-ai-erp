import React from 'react';
import { StatementData } from '../../services/financeService';

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
    const d = typeof date === 'string' ? new Date(date) : date;
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  };

  const getPaymentMethodText = (method: string) => {
    return method;
  };

  // A4纸比例：210mm × 297mm ≈ 794px × 1123px (96 DPI)
  // 使用更合理的比例：210mm × 297mm = 8.27in × 11.69in
  // 在屏幕上使用固定宽度，保持A4比例
  const a4Width = '210mm'; // 或使用 '794px'
  const a4Height = '297mm'; // 或使用 '1123px'

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
      <div className="text-center mb-8 print:mb-6">
        <h1 className="text-4xl font-bold text-black mb-2 print:text-4xl">对账单</h1>
        <p className="text-base text-gray-700">
          对账单号：<span className="font-semibold">{data.statementNo}</span>
        </p>
      </div>

      {/* 客户信息和期间 */}
      <div className="mb-6 print:mb-5 border-b-2 border-black pb-4">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="font-semibold">客户名称：</span>
            <span className="ml-2">{data.customer.name}</span>
          </div>
          <div>
            <span className="font-semibold">客户编号：</span>
            <span className="ml-2">{data.customer.customerNo}</span>
          </div>
          {data.customer.phone && (
            <div>
              <span className="font-semibold">联系电话：</span>
              <span className="ml-2">{data.customer.phone}</span>
            </div>
          )}
          <div>
            <span className="font-semibold">对账期间：</span>
            <span className="ml-2">
              {formatDate(data.period.start)} 至 {formatDate(data.period.end)}
            </span>
          </div>
        </div>
      </div>

      {/* 金额汇总 */}
      <div className="mb-6 print:mb-5">
        <h2 className="text-xl font-bold text-black mb-3 print:mb-2">金额汇总</h2>
        <table className="w-full border-collapse border-2 border-black">
          <thead>
            <tr className="bg-gray-100">
              <th className="border-2 border-black px-4 py-3 text-left font-bold">项目</th>
              <th className="border-2 border-black px-4 py-3 text-right font-bold">金额</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border-2 border-black px-4 py-3">期初欠款</td>
              <td className="border-2 border-black px-4 py-3 text-right font-mono">
                {formatCurrency(data.summary.openingBalance)}
              </td>
            </tr>
            <tr>
              <td className="border-2 border-black px-4 py-3">本期销售</td>
              <td className="border-2 border-black px-4 py-3 text-right font-mono text-blue-600">
                {formatCurrency(data.summary.totalSales)}
              </td>
            </tr>
            <tr>
              <td className="border-2 border-black px-4 py-3">本期收款</td>
              <td className="border-2 border-black px-4 py-3 text-right font-mono text-green-600">
                {formatCurrency(data.summary.totalPayments)}
              </td>
            </tr>
            <tr className="bg-gray-50">
              <td className="border-2 border-black px-4 py-3 font-bold">期末欠款</td>
              <td className="border-2 border-black px-4 py-3 text-right font-mono font-bold text-xl text-red-600">
                {formatCurrency(data.summary.closingBalance)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 销售明细 */}
      <div className="mb-6 print:mb-5">
        <h2 className="text-xl font-bold text-black mb-3 print:mb-2">销售明细</h2>
        <table className="w-full border-collapse border-2 border-black text-sm">
          <thead>
            <tr className="bg-gray-100">
              <th className="border-2 border-black px-3 py-2 text-center font-bold">序号</th>
              <th className="border-2 border-black px-3 py-2 text-left font-bold">销售单号</th>
              <th className="border-2 border-black px-3 py-2 text-left font-bold">销售日期</th>
              <th className="border-2 border-black px-3 py-2 text-right font-bold">销售金额</th>
              <th className="border-2 border-black px-3 py-2 text-left font-bold">业务员</th>
            </tr>
          </thead>
          <tbody>
            {data.salesDetails.length === 0 ? (
              <tr>
                <td colSpan={5} className="border-2 border-black px-3 py-3 text-center text-gray-500">
                  本期无销售记录
                </td>
              </tr>
            ) : (
              <>
                {data.salesDetails.map((detail, index) => (
                  <tr key={index}>
                    <td className="border-2 border-black px-3 py-2 text-center">{index + 1}</td>
                    <td className="border-2 border-black px-3 py-2">{detail.orderNo}</td>
                    <td className="border-2 border-black px-3 py-2">{formatDate(detail.date)}</td>
                    <td className="border-2 border-black px-3 py-2 text-right font-mono">
                      {formatCurrency(detail.amount)}
                    </td>
                    <td className="border-2 border-black px-3 py-2">{detail.salesperson || '-'}</td>
                  </tr>
                ))}
                <tr className="bg-gray-50">
                  <td colSpan={3} className="border-2 border-black px-3 py-2 font-bold text-center">
                    合计
                  </td>
                  <td className="border-2 border-black px-3 py-2 text-right font-mono font-bold">
                    {formatCurrency(data.summary.totalSales)}
                  </td>
                  <td className="border-2 border-black px-3 py-2"></td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* 收款明细 */}
      <div className="mb-6 print:mb-5">
        <h2 className="text-xl font-bold text-black mb-3 print:mb-2">收款明细</h2>
        <table className="w-full border-collapse border-2 border-black text-sm">
          <thead>
            <tr className="bg-gray-100">
              <th className="border-2 border-black px-3 py-2 text-center font-bold">序号</th>
              <th className="border-2 border-black px-3 py-2 text-left font-bold">收款日期</th>
              <th className="border-2 border-black px-3 py-2 text-right font-bold">收款金额</th>
              <th className="border-2 border-black px-3 py-2 text-left font-bold">收款方式</th>
              <th className="border-2 border-black px-3 py-2 text-left font-bold">关联销售单</th>
            </tr>
          </thead>
          <tbody>
            {data.paymentDetails.length === 0 ? (
              <tr>
                <td colSpan={5} className="border-2 border-black px-3 py-3 text-center text-gray-500">
                  本期无收款记录
                </td>
              </tr>
            ) : (
              <>
                {data.paymentDetails.map((detail, index) => (
                  <tr key={index}>
                    <td className="border-2 border-black px-3 py-2 text-center">{index + 1}</td>
                    <td className="border-2 border-black px-3 py-2">{formatDate(detail.date)}</td>
                    <td className="border-2 border-black px-3 py-2 text-right font-mono text-green-600 font-semibold">
                      {formatCurrency(detail.amount)}
                    </td>
                    <td className="border-2 border-black px-3 py-2">{getPaymentMethodText(detail.method)}</td>
                    <td className="border-2 border-black px-3 py-2">{detail.relatedOrderNo || '-'}</td>
                  </tr>
                ))}
                <tr className="bg-gray-50">
                  <td colSpan={2} className="border-2 border-black px-3 py-2 font-bold text-center">
                    合计
                  </td>
                  <td className="border-2 border-black px-3 py-2 text-right font-mono font-bold text-green-600">
                    {formatCurrency(data.summary.totalPayments)}
                  </td>
                  <td colSpan={2} className="border-2 border-black px-3 py-2"></td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* 生成时间 */}
      <div className="text-right text-sm text-gray-600 mt-8 print:mt-6">
        <p>
          生成时间：{' '}
          {new Intl.DateTimeFormat('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          }).format(typeof data.generatedAt === 'string' ? new Date(data.generatedAt) : data.generatedAt)}
        </p>
      </div>
    </div>
  );
};



