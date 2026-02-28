import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { StatementData } from '../services/financeService';

/**
 * 格式化金额
 */
const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 2,
  }).format(amount);
};

/**
 * 格式化日期
 */
const formatDate = (date: Date): string => {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
};

/**
 * 格式化日期时间
 */
const formatDateTime = (date: Date): string => {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

/**
 * 创建用于导出的HTML内容
 */
const createStatementHTML = (data: StatementData): string => {
  const salesRows = data.salesDetails.map((detail, index) => `
    <tr>
      <td style="border: 1px solid #000; padding: 8px; text-align: center;">${index + 1}</td>
      <td style="border: 1px solid #000; padding: 8px;">${detail.orderNo}</td>
      <td style="border: 1px solid #000; padding: 8px;">${formatDate(detail.date)}</td>
      <td style="border: 1px solid #000; padding: 8px; text-align: right;">${formatCurrency(detail.amount)}</td>
      <td style="border: 1px solid #000; padding: 8px;">${detail.salesperson || '-'}</td>
    </tr>
  `).join('');

  const paymentRows = data.paymentDetails.map((detail, index) => `
    <tr>
      <td style="border: 1px solid #000; padding: 8px; text-align: center;">${index + 1}</td>
      <td style="border: 1px solid #000; padding: 8px;">${formatDate(detail.date)}</td>
      <td style="border: 1px solid #000; padding: 8px; text-align: right; color: green;">${formatCurrency(detail.amount)}</td>
      <td style="border: 1px solid #000; padding: 8px;">${detail.method}</td>
      <td style="border: 1px solid #000; padding: 8px;">${detail.relatedOrderNo || '-'}</td>
    </tr>
  `).join('');

  return `
    <div id="pdf-content" style="width: 794px; padding: 40px; font-family: 'Microsoft YaHei', 'SimSun', sans-serif; background: white; color: #000;">
      <!-- 标题 -->
      <div style="text-align: center; margin-bottom: 30px;">
        <h1 style="font-size: 32px; font-weight: bold; margin: 0 0 10px 0;">对账单</h1>
        <p style="font-size: 14px; color: #666;">对账单号：${data.statementNo}</p>
      </div>

      <!-- 客户信息 -->
      <div style="margin-bottom: 20px; padding-bottom: 15px; border-bottom: 2px solid #000;">
        <div style="display: flex; flex-wrap: wrap;">
          <div style="width: 50%; margin-bottom: 8px;">
            <span style="font-weight: bold;">客户名称：</span>${data.customer.name}
          </div>
          <div style="width: 50%; margin-bottom: 8px;">
            <span style="font-weight: bold;">客户编号：</span>${data.customer.customerNo}
          </div>
          ${data.customer.phone ? `
          <div style="width: 50%; margin-bottom: 8px;">
            <span style="font-weight: bold;">联系电话：</span>${data.customer.phone}
          </div>
          ` : ''}
          <div style="width: 50%; margin-bottom: 8px;">
            <span style="font-weight: bold;">对账期间：</span>${formatDate(data.period.start)} 至 ${formatDate(data.period.end)}
          </div>
        </div>
      </div>

      <!-- 金额汇总 -->
      <div style="margin-bottom: 25px;">
        <h2 style="font-size: 18px; font-weight: bold; margin: 0 0 10px 0;">金额汇总</h2>
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="background: #f0f0f0;">
              <th style="border: 1px solid #000; padding: 10px; text-align: left; font-weight: bold;">项目</th>
              <th style="border: 1px solid #000; padding: 10px; text-align: right; font-weight: bold;">金额</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="border: 1px solid #000; padding: 10px;">期初欠款</td>
              <td style="border: 1px solid #000; padding: 10px; text-align: right; font-family: monospace;">${formatCurrency(data.summary.openingBalance)}</td>
            </tr>
            <tr>
              <td style="border: 1px solid #000; padding: 10px;">本期销售</td>
              <td style="border: 1px solid #000; padding: 10px; text-align: right; font-family: monospace; color: blue;">${formatCurrency(data.summary.totalSales)}</td>
            </tr>
            <tr>
              <td style="border: 1px solid #000; padding: 10px;">本期收款</td>
              <td style="border: 1px solid #000; padding: 10px; text-align: right; font-family: monospace; color: green;">${formatCurrency(data.summary.totalPayments)}</td>
            </tr>
            <tr style="background: #fff0f0;">
              <td style="border: 1px solid #000; padding: 10px; font-weight: bold;">期末欠款</td>
              <td style="border: 1px solid #000; padding: 10px; text-align: right; font-family: monospace; font-weight: bold; font-size: 18px; color: red;">${formatCurrency(data.summary.closingBalance)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 销售明细 -->
      ${data.salesDetails.length > 0 ? `
      <div style="margin-bottom: 25px;">
        <h2 style="font-size: 18px; font-weight: bold; margin: 0 0 10px 0;">销售明细</h2>
        <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
          <thead>
            <tr style="background: #f0f0f0;">
              <th style="border: 1px solid #000; padding: 8px; text-align: center; font-weight: bold;">序号</th>
              <th style="border: 1px solid #000; padding: 8px; text-align: left; font-weight: bold;">销售单号</th>
              <th style="border: 1px solid #000; padding: 8px; text-align: left; font-weight: bold;">销售日期</th>
              <th style="border: 1px solid #000; padding: 8px; text-align: right; font-weight: bold;">销售金额</th>
              <th style="border: 1px solid #000; padding: 8px; text-align: left; font-weight: bold;">业务员</th>
            </tr>
          </thead>
          <tbody>
            ${salesRows}
            <tr style="background: #f0f0f0;">
              <td colspan="3" style="border: 1px solid #000; padding: 8px; text-align: center; font-weight: bold;">合计</td>
              <td style="border: 1px solid #000; padding: 8px; text-align: right; font-weight: bold;">${formatCurrency(data.summary.totalSales)}</td>
              <td style="border: 1px solid #000; padding: 8px;"></td>
            </tr>
          </tbody>
        </table>
      </div>
      ` : ''}

      <!-- 收款明细 -->
      ${data.paymentDetails.length > 0 ? `
      <div style="margin-bottom: 25px;">
        <h2 style="font-size: 18px; font-weight: bold; margin: 0 0 10px 0;">收款明细</h2>
        <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
          <thead>
            <tr style="background: #f0f0f0;">
              <th style="border: 1px solid #000; padding: 8px; text-align: center; font-weight: bold;">序号</th>
              <th style="border: 1px solid #000; padding: 8px; text-align: left; font-weight: bold;">收款日期</th>
              <th style="border: 1px solid #000; padding: 8px; text-align: right; font-weight: bold;">收款金额</th>
              <th style="border: 1px solid #000; padding: 8px; text-align: left; font-weight: bold;">收款方式</th>
              <th style="border: 1px solid #000; padding: 8px; text-align: left; font-weight: bold;">关联销售单</th>
            </tr>
          </thead>
          <tbody>
            ${paymentRows}
            <tr style="background: #f0f0f0;">
              <td colspan="2" style="border: 1px solid #000; padding: 8px; text-align: center; font-weight: bold;">合计</td>
              <td style="border: 1px solid #000; padding: 8px; text-align: right; font-weight: bold; color: green;">${formatCurrency(data.summary.totalPayments)}</td>
              <td colspan="2" style="border: 1px solid #000; padding: 8px;"></td>
            </tr>
          </tbody>
        </table>
      </div>
      ` : ''}

      <!-- 生成时间 -->
      <div style="text-align: right; font-size: 12px; color: #666; margin-top: 30px;">
        生成时间：${formatDateTime(data.generatedAt)}
      </div>
    </div>
  `;
};

/**
 * 导出对账单为PDF（使用html2canvas渲染，支持中文）
 */
export const exportStatementToPDF = async (data: StatementData): Promise<void> => {
  // 创建临时容器
  const container = document.createElement('div');
  container.innerHTML = createStatementHTML(data);
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  container.style.top = '0';
  document.body.appendChild(container);

  const content = container.querySelector('#pdf-content') as HTMLElement;

  try {
    // 使用html2canvas渲染为图片
    const canvas = await html2canvas(content, {
      scale: 2, // 提高清晰度
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
    });

    // 创建PDF
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();
    
    // 计算图片在PDF中的尺寸
    const imgWidth = canvas.width;
    const imgHeight = canvas.height;
    const ratio = Math.min(pdfWidth / (imgWidth / 2), pdfHeight / (imgHeight / 2));
    
    const finalWidth = (imgWidth / 2) * ratio * 0.95; // 留一点边距
    const finalHeight = (imgHeight / 2) * ratio * 0.95;
    const x = (pdfWidth - finalWidth) / 2;
    const y = 5;

    pdf.addImage(imgData, 'PNG', x, y, finalWidth, finalHeight);

    // 保存PDF
    const dateStr = formatDate(data.period.start).replace(/\//g, '');
    const fileName = `对账单_${data.customer.name}_${dateStr}.pdf`;
    pdf.save(fileName);

  } finally {
    // 清理临时容器
    document.body.removeChild(container);
  }
};
