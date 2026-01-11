import { PaymentMethod } from '../types/finance';

export interface PaymentSubmitData {
  customerId: number;
  customerName: string;
  receivableId: number;
  salesOrderId: number;
  salesOrderNo: string;
  amount: number;
  paymentMethod: PaymentMethod;
  paymentDate: Date;
  voucherImage?: string;
  remark?: string;
}

export interface PaymentSubmitResponse {
  success: boolean;
  paymentId?: string;
  message?: string;
  error?: string;
}

export interface StatementData {
  customer: { id: number; name: string; phone?: string; customerNo: string };
  period: { start: Date; end: Date };
  summary: {
    openingBalance: number;
    totalSales: number;
    totalPayments: number;
    closingBalance: number;
  };
  salesDetails: Array<{
    date: Date;
    orderNo: string;
    amount: number;
    salesperson?: string;
  }>;
  paymentDetails: Array<{
    date: Date;
    amount: number;
    method: string;
    relatedOrderNo?: string;
  }>;
  generatedAt: Date;
  statementNo: string;
}

export interface ReconciliationGenerateResponse {
  success: boolean;
  data?: StatementData;
  error?: string;
  message?: string;
}

/**
 * 提交收款记录（Mock版本）
 */
export async function submitPayment(data: PaymentSubmitData): Promise<PaymentSubmitResponse> {
  // Mock API调用，延迟1秒模拟网络请求
  await new Promise((resolve) => setTimeout(resolve, 1000));
  
  console.log('收款数据:', data);
  
  // 模拟成功响应
  return {
    success: true,
    paymentId: `PAY${Date.now()}`,
    message: '收款记录已保存',
  };
}

/**
 * 获取客户未付清的销售单列表
 */
export async function getUnpaidSalesOrders(customerId: number): Promise<Array<{
  id: number;
  orderNo: string;
  unpaidAmount: number;
  totalAmount: number;
}>> {
  // Mock数据，实际应该从API获取
  await new Promise((resolve) => setTimeout(resolve, 300));
  
  // 这里应该调用真实API，现在返回Mock数据
  // 实际实现时，应该从后端获取该客户所有未付清的销售单
  return [];
}

/**
 * 生成对账单（Mock版本）
 * GET /api/finance/statement?customerId=xxx&start=xxx&end=xxx
 */
export async function generateReconciliationStatement(
  customerId: number,
  startDate: Date,
  endDate: Date
): Promise<ReconciliationGenerateResponse> {
  // Mock API调用，延迟1.5秒模拟网络请求
  await new Promise((resolve) => setTimeout(resolve, 1500));
  
  console.log('生成对账单请求:', { customerId, startDate, endDate });
  
  // 生成对账单号
  const dateStr = startDate.toISOString().slice(0, 10).replace(/-/g, '');
  const statementNo = `DZ${customerId}${dateStr}${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;
  
  // Mock对账单数据（按照用户要求的数据格式）
  const mockData: StatementData = {
    customer: {
      id: customerId,
      name: '李总',
      phone: '138****1234',
      customerNo: 'C001',
    },
    period: {
      start: startDate,
      end: endDate,
    },
    summary: {
      openingBalance: 12000,
      totalSales: 45800,
      totalPayments: 30000,
      closingBalance: 27800,
    },
    salesDetails: [
      {
        date: new Date('2025-01-05'),
        orderNo: 'SO20250105001',
        amount: 15200,
        salesperson: '张业务',
      },
      {
        date: new Date('2025-01-15'),
        orderNo: 'SO20250115002',
        amount: 18600,
        salesperson: '李业务',
      },
      {
        date: new Date('2025-01-28'),
        orderNo: 'SO20250128003',
        amount: 12000,
        salesperson: '王业务',
      },
    ],
    paymentDetails: [
      {
        date: new Date('2025-01-10'),
        amount: 15000,
        method: '转账',
        relatedOrderNo: 'SO20250105001',
      },
      {
        date: new Date('2025-01-25'),
        amount: 15000,
        method: '微信',
        relatedOrderNo: 'SO20250115002',
      },
    ],
    generatedAt: new Date(),
    statementNo,
  };
  
  return {
    success: true,
    data: mockData,
    message: '对账单生成成功',
  };
}


export interface PaymentSubmitData {
  customerId: number;
  customerName: string;
  receivableId: number;
  salesOrderId: number;
  salesOrderNo: string;
  amount: number;
  paymentMethod: PaymentMethod;
  paymentDate: Date;
  voucherImage?: string;
  remark?: string;
}

export interface PaymentSubmitResponse {
  success: boolean;
  paymentId?: string;
  message?: string;
  error?: string;
}

export interface StatementData {
  customer: { id: number; name: string; phone?: string; customerNo: string };
  period: { start: Date; end: Date };
  summary: {
    openingBalance: number;
    totalSales: number;
    totalPayments: number;
    closingBalance: number;
  };
  salesDetails: Array<{
    date: Date;
    orderNo: string;
    amount: number;
    salesperson?: string;
  }>;
  paymentDetails: Array<{
    date: Date;
    amount: number;
    method: string;
    relatedOrderNo?: string;
  }>;
  generatedAt: Date;
  statementNo: string;
}

export interface ReconciliationGenerateResponse {
  success: boolean;
  data?: StatementData;
  error?: string;
  message?: string;
}

/**
 * 提交收款记录（Mock版本）
 */
export async function submitPayment(data: PaymentSubmitData): Promise<PaymentSubmitResponse> {
  // Mock API调用，延迟1秒模拟网络请求
  await new Promise((resolve) => setTimeout(resolve, 1000));
  
  console.log('收款数据:', data);
  
  // 模拟成功响应
  return {
    success: true,
    paymentId: `PAY${Date.now()}`,
    message: '收款记录已保存',
  };
}

/**
 * 获取客户未付清的销售单列表
 */
export async function getUnpaidSalesOrders(customerId: number): Promise<Array<{
  id: number;
  orderNo: string;
  unpaidAmount: number;
  totalAmount: number;
}>> {
  // Mock数据，实际应该从API获取
  await new Promise((resolve) => setTimeout(resolve, 300));
  
  // 这里应该调用真实API，现在返回Mock数据
  // 实际实现时，应该从后端获取该客户所有未付清的销售单
  return [];
}

/**
 * 生成对账单（Mock版本）
 * GET /api/finance/statement?customerId=xxx&start=xxx&end=xxx
 */
export async function generateReconciliationStatement(
  customerId: number,
  startDate: Date,
  endDate: Date
): Promise<ReconciliationGenerateResponse> {
  // Mock API调用，延迟1.5秒模拟网络请求
  await new Promise((resolve) => setTimeout(resolve, 1500));
  
  console.log('生成对账单请求:', { customerId, startDate, endDate });
  
  // 生成对账单号
  const dateStr = startDate.toISOString().slice(0, 10).replace(/-/g, '');
  const statementNo = `DZ${customerId}${dateStr}${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;
  
  // Mock对账单数据（按照用户要求的数据格式）
  const mockData: StatementData = {
    customer: {
      id: customerId,
      name: '李总',
      phone: '138****1234',
      customerNo: 'C001',
    },
    period: {
      start: startDate,
      end: endDate,
    },
    summary: {
      openingBalance: 12000,
      totalSales: 45800,
      totalPayments: 30000,
      closingBalance: 27800,
    },
    salesDetails: [
      {
        date: new Date('2025-01-05'),
        orderNo: 'SO20250105001',
        amount: 15200,
        salesperson: '张业务',
      },
      {
        date: new Date('2025-01-15'),
        orderNo: 'SO20250115002',
        amount: 18600,
        salesperson: '李业务',
      },
      {
        date: new Date('2025-01-28'),
        orderNo: 'SO20250128003',
        amount: 12000,
        salesperson: '王业务',
      },
    ],
    paymentDetails: [
      {
        date: new Date('2025-01-10'),
        amount: 15000,
        method: '转账',
        relatedOrderNo: 'SO20250105001',
      },
      {
        date: new Date('2025-01-25'),
        amount: 15000,
        method: '微信',
        relatedOrderNo: 'SO20250115002',
      },
    ],
    generatedAt: new Date(),
    statementNo,
  };
  
  return {
    success: true,
    data: mockData,
    message: '对账单生成成功',
  };
}

