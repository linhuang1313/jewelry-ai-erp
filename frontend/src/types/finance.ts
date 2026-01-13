/**
 * 财务对账模块 - TypeScript 类型定义
 */

// ============= 枚举类型定义 =============

export enum AccountReceivableStatus {
  UNPAID = 'unpaid',
  PAID = 'paid',
  OVERDUE = 'overdue',
  CANCELLED = 'cancelled',
}

export enum PaymentMethod {
  CASH = 'cash',
  BANK_TRANSFER = 'bank_transfer',
  WECHAT = 'wechat',
  ALIPAY = 'alipay',
  CARD = 'card',
  CHECK = 'check',
  OTHER = 'other',
}

export enum ReminderMethod {
  PHONE = 'phone',
  WECHAT = 'wechat',
  VISIT = 'visit',
  SMS = 'sms',
  EMAIL = 'email',
  OTHER = 'other',
}

export enum ReminderStatus {
  PENDING_FOLLOW_UP = 'pending_follow_up',
  CUSTOMER_PROMISED = 'customer_promised',
  CUSTOMER_REFUSED = 'customer_refused',
  PAID = 'paid',
  CANCELLED = 'cancelled',
}

export enum ReconciliationStatus {
  DRAFT = 'draft',
  SENT = 'sent',
  CONFIRMED = 'confirmed',
  DISPUTED = 'disputed',
  ARCHIVED = 'archived',
}

// ============= 基础类型定义 =============

export interface CustomerReference {
  id: number;
  customerNo: string;
  name: string;
  phone?: string;
  wechat?: string;
}

export interface SalesOrderReference {
  id: number;
  orderNo: string;
  orderDate: Date;
  salesperson: string;
  storeCode?: string;
  totalAmount: number;
}

// ============= 主表接口定义 =============

export interface AccountReceivable {
  id: number;
  salesOrderId: number;
  salesOrder?: SalesOrderReference;
  customerId: number;
  customer?: CustomerReference;
  totalAmount: number;
  receivedAmount: number;
  unpaidAmount: number;
  creditDays: number;
  creditStartDate: Date;
  dueDate: Date;
  overdueDays: number;
  status: AccountReceivableStatus;
  isOverdue: boolean;
  salesperson: string;
  storeCode?: string;
  remark?: string;
  createTime: Date;
  updateTime: Date;
  operator: string;
  lastUpdater?: string;
  contractNo?: string;
  invoiceNo?: string;
  expectedPaymentDate?: Date;
}

export interface PaymentRecord {
  id: number;
  accountReceivableId: number;
  accountReceivable?: {
    id: number;
    salesOrderNo: string;
    totalAmount: number;
    unpaidAmount: number;
  };
  customerId: number;
  customer?: CustomerReference;
  paymentDate: Date;
  amount: number;
  paymentMethod: PaymentMethod;
  voucherImages?: string;
  voucherImageList?: string[];
  bankName?: string;
  bankAccount?: string;
  transferNo?: string;
  operator: string;
  remark?: string;
  createTime: Date;
  updateTime?: Date;
  actualReceivedDate?: Date;
  handlingFee?: number;
  exchangeRate?: number;
}

export interface ReminderRecord {
  id: number;
  accountReceivableId: number;
  accountReceivable?: {
    id: number;
    salesOrderNo: string;
    unpaidAmount: number;
    overdueDays: number;
  };
  customerId: number;
  customer?: CustomerReference;
  reminderDate: Date;
  reminderPerson: string;
  reminderMethod: ReminderMethod;
  reminderContent?: string;
  customerFeedback?: string;
  promisedPaymentDate?: Date;
  promisedAmount?: number;
  nextFollowUpDate?: Date;
  status: ReminderStatus;
  remark?: string;
  createTime: Date;
  updateTime?: Date;
  mediaUrl?: string;
  contactInfo?: string;
  effectivenessScore?: number;
}

export interface ReconciliationStatement {
  id: number;
  customerId: number;
  customer?: CustomerReference;
  periodStartDate: Date;
  periodEndDate: Date;
  periodDescription?: string;
  openingBalance: number;
  periodSalesAmount: number;
  periodPaymentAmount: number;
  closingBalance: number;
  salesDetails: ReconciliationSalesDetail[];
  paymentDetails: ReconciliationPaymentDetail[];
  status: ReconciliationStatus;
  sentDate?: Date;
  confirmedDate?: Date;
  statementNo: string;
  remark?: string;
  createTime: Date;
  updateTime: Date;
  operator: string;
  lastUpdater?: string;
  pdfUrl?: string;
  confirmedBy?: string;
  disputeReason?: string;
}

export interface ReconciliationSalesDetail {
  salesOrderId: number;
  salesOrderNo: string;
  salesDate: Date;
  salesAmount: number;
  salesperson: string;
  storeCode?: string;
}

export interface ReconciliationPaymentDetail {
  paymentRecordId: number;
  paymentDate: Date;
  paymentAmount: number;
  paymentMethod: PaymentMethod;
  relatedSalesOrderNo?: string;
}

// ============= 统计类型定义 =============

export interface FinanceStatistics {
  totalReceivable: number;
  monthlyPayment: number;
  overdueAmount: number;
  overdueCustomerCount: number;
  monthlyPaymentChange?: number; // 环比变化百分比
}


