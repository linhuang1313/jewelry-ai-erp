/**
 * 入库相关工具函数
 */
import type {
  JewelryInboundCard,
  InboundDetailResponse,
  SupplierResponse,
  InboundOrderCreateRequest,
} from '../types/inbound';
import {
  convertInboundDetailToCard,
  convertCardToInboundRequest,
  generateTempCardId,
  calculateTotalCost,
  validateCard,
} from '../types/inbound';

/**
 * 创建新的入库核对卡片
 */
export function createNewCard(
  data: Partial<JewelryInboundCard>
): JewelryInboundCard {
  const card: JewelryInboundCard = {
    id: data.id || generateTempCardId(),
    productName: data.productName || '',
    barcode: data.barcode || '',
    productCategory: data.productCategory,
    goldWeight: data.goldWeight || 0,
    laborCostPerGram: data.laborCostPerGram || 0,
    pieceCount: data.pieceCount,
    pieceLaborCost: data.pieceLaborCost,
    goldPrice: data.goldPrice,
    totalCost: data.totalCost ?? calculateTotalCost(
      data.goldWeight || 0,
      data.laborCostPerGram || 0,
      data.goldPrice,
      data.pieceCount,
      data.pieceLaborCost
    ),
    gemstones: data.gemstones || [],
    supplier: data.supplier || {
      id: 0,
      name: '',
    },
    status: data.status || 'pending',
    source: data.source || 'manual',
    createdAt: data.createdAt || new Date(),
    ...data,
  };

  return card;
}

/**
 * 从OCR结果创建卡片
 */
export function createCardFromOCR(ocrData: {
  productName?: string;
  barcode?: string;
  goldWeight?: number;
  laborCostPerGram?: number;
  goldPrice?: number;
  supplier?: string;
  gemstones?: Array<{
    stoneType: string;
    weight: number;
    quantity: number;
  }>;
}): JewelryInboundCard {
  return createNewCard({
    productName: ocrData.productName || '',
    barcode: ocrData.barcode || '',
    goldWeight: ocrData.goldWeight || 0,
    laborCostPerGram: ocrData.laborCostPerGram || 0,
    goldPrice: ocrData.goldPrice,
    supplier: {
      id: 0,
      name: ocrData.supplier || '',
    },
    gemstones: ocrData.gemstones,
    source: 'ocr',
  });
}

/**
 * 从后端数据创建卡片
 */
export function createCardFromBackend(
  detail: InboundDetailResponse,
  supplier?: SupplierResponse
): JewelryInboundCard {
  const baseCard = convertInboundDetailToCard(detail, supplier);
  return {
    ...baseCard,
    id: `backend-${detail.id}`,
    status: 'confirmed',
    source: 'api',
    createdAt: new Date(),
  };
}

/**
 * 更新卡片数据
 */
export function updateCard(
  card: JewelryInboundCard,
  updates: Partial<JewelryInboundCard>
): JewelryInboundCard {
  const updated = { ...card, ...updates };
  
  // 如果重量、工费、金价、件数或件工费更新，重新计算总成本
  if (updates.goldWeight !== undefined || updates.laborCostPerGram !== undefined || 
      updates.goldPrice !== undefined || updates.pieceCount !== undefined || 
      updates.pieceLaborCost !== undefined) {
    updated.totalCost = calculateTotalCost(
      updated.goldWeight,
      updated.laborCostPerGram,
      updated.goldPrice,
      updated.pieceCount,
      updated.pieceLaborCost
    );
  }

  return updated;
}

/**
 * 准备提交到后端的请求数据
 */
export function prepareInboundRequest(
  card: JewelryInboundCard
): InboundOrderCreateRequest {
  // 验证卡片数据
  const validation = validateCard(card);
  if (!validation.valid) {
    throw new Error(`卡片数据验证失败：${validation.errors.join(', ')}`);
  }

  // 如果条码为空，使用临时值（入库后会使用订单号作为条码）
  const requestCard = { ...card };
  if (!requestCard.barcode || requestCard.barcode.trim() === '') {
    // 使用临时条码，后端会生成订单号，入库后可以用订单号作为条码
    requestCard.barcode = `TEMP-${Date.now()}`;
  }

  return convertCardToInboundRequest(requestCard);
}

/**
 * 格式化配石信息显示
 */
export function formatGemstones(gemstones?: Array<{
  stoneType: string;
  weight: number;
  quantity: number;
  quality?: string;
}>): string {
  if (!gemstones || gemstones.length === 0) {
    return '无配石';
  }

  return gemstones
    .map(
      (gem) =>
        `${gem.stoneType} ${gem.weight}克拉/${gem.quantity}粒${
          gem.quality ? `(${gem.quality})` : ''
        }`
    )
    .join('、');
}

/**
 * 导出所有工具函数
 */
export {
  generateTempCardId,
  calculateTotalCost,
  validateCard,
  convertInboundDetailToCard,
  convertCardToInboundRequest,
};

