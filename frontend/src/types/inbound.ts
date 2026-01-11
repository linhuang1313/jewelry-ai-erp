/**
 * 珠宝入库核对卡片 - 类型定义
 * 与后端数据结构兼容，支持扩展
 */

// ============= 基础类型定义 =============

/**
 * 配石信息
 */
export interface GemstoneDetail {
  /** 宝石类型：如"钻石"、"红宝石"、"蓝宝石"等 */
  stoneType: string;
  /** 石重（克拉） */
  weight: number;
  /** 粒数 */
  quantity: number;
  /** 品质等级（可选） */
  quality?: string;
  /** 备注信息（可选） */
  remark?: string;
}

/**
 * 供应商信息
 */
export interface SupplierInfo {
  /** 供应商ID（与后端 Integer 对应） */
  id: number;
  /** 供应商名称 */
  name: string;
  /** 供应商编号（可选） */
  supplierNo?: string;
  /** 联系方式（可选） */
  contact?: string;
  /** 联系人（可选） */
  contactPerson?: string;
}

/**
 * 产品状态
 */
export type ProductStatus = 'pending' | 'confirmed' | 'error' | 'processing';

/**
 * 数据来源
 */
export type DataSource = 'ocr' | 'manual' | 'api';

// ============= 主接口定义 =============

/**
 * 珠宝入库核对卡片
 */
export interface JewelryInboundCard {
  // 基本信息
  /** 前端临时唯一标识（用于UI渲染） */
  id: string;
  /** 产品名称（对应后端 product_name） */
  productName: string;
  /** 条码（后端需要扩展） */
  barcode: string;
  /** 产品类别（对应后端 product_category） */
  productCategory?: string;
  
  // 重量和工费
  /** 金重（克）（对应后端 weight） */
  goldWeight: number;
  /** 克工费（元/克）（对应后端 labor_cost） */
  laborCostPerGram: number;
  /** 当日金价（元/克）（可选） */
  goldPrice?: number;
  /** 总成本（元）= 金重 × 克工费（对应后端 total_cost） */
  totalCost?: number;
  
  // 配石信息（可选）- 新功能，后端需要扩展
  /** 配石详情列表 */
  gemstones?: GemstoneDetail[];
  
  // 供应商
  /** 供应商信息 */
  supplier: SupplierInfo;
  
  // 状态
  /** 卡片状态 */
  status: ProductStatus;
  
  // 元数据
  /** 创建时间 */
  createdAt?: Date;
  /** 数据来源 */
  source?: DataSource;
  
  // 关联信息（确认入库后填充）
  /** 入库单ID */
  orderId?: number;
  /** 入库单号 */
  orderNo?: string;
  
  // 错误信息（当状态为 error 时使用）
  /** 错误信息 */
  errorMessage?: string;
}

/**
 * 卡片操作回调
 */
export interface CardActions {
  /** 确认入库回调 */
  onConfirm: (card: JewelryInboundCard) => Promise<void>;
  /** 数据报错回调 */
  onReportError: (card: JewelryInboundCard, errorReason?: string) => Promise<void>;
}

/**
 * 卡片组件 Props（用于 React 组件）
 */
export interface JewelryInboundCardProps {
  /** 卡片数据 */
  card: JewelryInboundCard;
  /** 操作回调函数 */
  actions: CardActions;
  /** 是否禁用操作按钮 */
  disabled?: boolean;
  /** 加载状态 */
  loading?: boolean;
  /** 自定义样式类名 */
  className?: string;
}

// ============= 后端数据接口（用于API交互） =============

/**
 * 后端入库详情响应（对应 InboundDetailResponse）
 */
export interface InboundDetailResponse {
  id: number;
  product_name: string;
  product_category?: string | null;
  weight: number;
  labor_cost: number;
  supplier?: string | null;
  supplier_id?: number | null;
  total_cost: number;
}

/**
 * 后端供应商响应（对应 SupplierResponse）
 */
export interface SupplierResponse {
  id: number;
  supplier_no: string;
  name: string;
  phone?: string | null;
  wechat?: string | null;
  address?: string | null;
  contact_person?: string | null;
  supplier_type: string;
  status: string;
}

/**
 * 创建入库单请求（对应 InboundOrderCreate）
 */
export interface InboundOrderCreateRequest {
  product_name: string;
  product_category?: string;
  weight: number;
  labor_cost: number;
  supplier?: string;
  supplier_id?: number;
  barcode?: string;
  gemstones?: Array<{
    stone_type: string;
    weight: number;
    quantity: number;
    quality?: string;
  }>;
}

// ============= 数据转换工具函数 =============

/**
 * 从后端 InboundDetail 转换为前端卡片数据
 */
export function convertInboundDetailToCard(
  detail: InboundDetailResponse,
  supplier?: SupplierResponse
): Omit<JewelryInboundCard, 'id' | 'status' | 'source' | 'createdAt'> {
  return {
    productName: detail.product_name,
    barcode: '', // 后端暂无条码字段，需要扩展
    productCategory: detail.product_category || undefined,
    goldWeight: detail.weight,
    laborCostPerGram: detail.labor_cost,
    totalCost: detail.total_cost,
    gemstones: undefined, // 后端暂无配石字段，需要扩展
    supplier: supplier ? {
      id: supplier.id,
      name: supplier.name,
      supplierNo: supplier.supplier_no,
      contact: supplier.phone || supplier.wechat || undefined,
      contactPerson: supplier.contact_person || undefined,
    } : {
      id: detail.supplier_id || 0,
      name: detail.supplier || '未知供应商',
    },
    orderId: detail.id,
  };
}

/**
 * 从前端卡片数据转换为后端创建请求
 */
export function convertCardToInboundRequest(
  card: JewelryInboundCard
): InboundOrderCreateRequest {
  return {
    product_name: card.productName,
    product_category: card.productCategory,
    weight: card.goldWeight,
    labor_cost: card.laborCostPerGram,
    supplier_id: card.supplier.id > 0 ? card.supplier.id : undefined,
    supplier: card.supplier.id === 0 ? card.supplier.name : undefined,
    barcode: card.barcode || undefined,
    gemstones: card.gemstones?.map(gem => ({
      stone_type: gem.stoneType,
      weight: gem.weight,
      quantity: gem.quantity,
      quality: gem.quality,
    })),
  };
}

/**
 * 创建临时卡片ID
 */
export function generateTempCardId(): string {
  return `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 计算总成本
 */
export function calculateTotalCost(
  goldWeight: number,
  laborCostPerGram: number,
  goldPrice?: number
): number {
  if (goldPrice !== undefined) {
    // 总成本 = 金重 × (金价 + 工费)
    return goldWeight * (goldPrice + laborCostPerGram);
  }
  // 如果没有金价，只计算工费
  return goldWeight * laborCostPerGram;
}

/**
 * 验证卡片数据完整性
 */
export function validateCard(card: JewelryInboundCard): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!card.productName || card.productName.trim() === '') {
    errors.push('产品名称不能为空');
  }

  // 条码是可选的，如果为空，入库后会使用订单号作为条码
  // if (!card.barcode || card.barcode.trim() === '') {
  //   errors.push('条码不能为空');
  // }

  if (card.goldWeight <= 0) {
    errors.push('金重必须大于0');
  }

  if (card.laborCostPerGram < 0) {
    errors.push('克工费不能为负数');
  }

  if (!card.supplier || !card.supplier.name) {
    errors.push('供应商信息不能为空');
  }

  if (card.gemstones) {
    card.gemstones.forEach((gem, index) => {
      if (!gem.stoneType) {
        errors.push(`配石${index + 1}：宝石类型不能为空`);
      }
      if (gem.weight < 0) {
        errors.push(`配石${index + 1}：石重不能为负数`);
      }
      if (gem.quantity <= 0) {
        errors.push(`配石${index + 1}：粒数必须大于0`);
      }
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

