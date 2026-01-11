# 珠宝入库核对卡片 - 类型定义和使用指南

## 📁 文件结构

```
frontend/src/
├── types/
│   ├── inbound.ts          # 入库相关类型定义
│   ├── index.ts            # 类型统一导出
│   └── README.md           # 本文档
├── components/
│   └── JewelryInboundCard.tsx  # 入库核对卡片组件
└── utils/
    └── inboundHelpers.ts   # 入库相关工具函数
```

## 🎯 核心类型

### `JewelryInboundCard`

珠宝入库核对卡片的主接口，包含所有必要字段：

```typescript
interface JewelryInboundCard {
  id: string;                    // 前端临时唯一标识
  productName: string;           // 产品名称
  barcode: string;               // 条码
  goldWeight: number;            // 金重（克）
  laborCostPerGram: number;      // 克工费（元/克）
  totalCost?: number;            // 总成本（自动计算）
  gemstones?: GemstoneDetail[];  // 配石详情
  supplier: SupplierInfo;       // 供应商信息
  status: ProductStatus;         // 状态
  // ... 更多字段
}
```

### `CardActions`

卡片操作回调接口：

```typescript
interface CardActions {
  onConfirm: (card: JewelryInboundCard) => Promise<void>;
  onReportError: (card: JewelryInboundCard, errorReason?: string) => Promise<void>;
}
```

## 🚀 快速开始

### 1. 创建新卡片

```typescript
import { createNewCard } from '../utils/inboundHelpers';

const card = createNewCard({
  productName: '古法黄金戒指',
  barcode: 'JZ20240109001',
  goldWeight: 10.5,
  laborCostPerGram: 6.0,
  supplier: {
    id: 1,
    name: '金源珠宝',
  },
});
```

### 2. 使用卡片组件

```typescript
import { JewelryInboundCardComponent } from '../components/JewelryInboundCard';
import type { CardActions } from '../types/inbound';

const actions: CardActions = {
  onConfirm: async (card) => {
    // 调用API提交入库
    const response = await fetch('/api/inbound-orders', {
      method: 'POST',
      body: JSON.stringify(prepareInboundRequest(card)),
    });
  },
  onReportError: async (card, reason) => {
    // 处理错误报告
    console.log('数据报错:', reason);
  },
};

<JewelryInboundCardComponent
  data={card}
  actions={actions}
/>
```

### 3. 从OCR结果创建卡片

```typescript
import { createCardFromOCR } from '../utils/inboundHelpers';

const ocrCard = createCardFromOCR({
  productName: '18K金项链',
  barcode: 'JZ20240109002',
  goldWeight: 15.8,
  laborCostPerGram: 5.5,
  supplier: '林煌珠宝',
});
```

### 4. 从后端数据创建卡片

```typescript
import { createCardFromBackend } from '../utils/inboundHelpers';

const card = createCardFromBackend(
  inboundDetailResponse,
  supplierResponse
);
```

## 🛠️ 工具函数

### `createNewCard(data)`

创建新的入库核对卡片，自动生成ID和计算总成本。

### `createCardFromOCR(ocrData)`

从OCR识别结果创建卡片。

### `createCardFromBackend(detail, supplier)`

从后端API响应创建卡片。

### `updateCard(card, updates)`

更新卡片数据，自动重新计算总成本。

### `prepareInboundRequest(card)`

准备提交到后端的请求数据，包含数据验证。

### `validateCard(card)`

验证卡片数据的完整性和正确性。

### `calculateTotalCost(goldWeight, laborCostPerGram)`

计算总成本。

## 📊 数据转换

### 前端 → 后端

```typescript
import { convertCardToInboundRequest } from '../types/inbound';

const request = convertCardToInboundRequest(card);
// 返回 InboundOrderCreateRequest
```

### 后端 → 前端

```typescript
import { convertInboundDetailToCard } from '../types/inbound';

const card = convertInboundDetailToCard(
  inboundDetailResponse,
  supplierResponse
);
```

## ✅ 数据验证

```typescript
import { validateCard } from '../utils/inboundHelpers';

const validation = validateCard(card);
if (!validation.valid) {
  console.error('验证失败:', validation.errors);
}
```

## 🎨 组件Props

```typescript
interface JewelryInboundCardProps {
  data: JewelryInboundCard;      // 卡片数据（注意：使用 data 而不是 card）
  actions: CardActions;          // 操作回调
  disabled?: boolean;            // 是否禁用
  className?: string;           // 自定义样式
}
```

## 📝 完整示例

查看 `frontend/src/App.jsx` 中 `JewelryInboundCardComponent` 的使用示例。

## 🔗 与后端数据结构对应关系

| 前端字段 | 后端字段 | 说明 |
|---------|---------|------|
| `productName` | `product_name` | 产品名称 |
| `goldWeight` | `weight` | 金重（克） |
| `laborCostPerGram` | `labor_cost` | 克工费（元/克） |
| `totalCost` | `total_cost` | 总成本 |
| `productCategory` | `product_category` | 产品类别 |
| `supplier.id` | `supplier_id` | 供应商ID |
| `supplier.name` | `supplier` | 供应商名称 |
| `barcode` | - | 条码（后端需扩展） |
| `gemstones` | - | 配石详情（后端需扩展） |

## 🚧 待扩展功能

1. **条码字段**：后端数据库需要添加 `barcode` 字段
2. **配石详情**：后端需要创建 `gemstone_details` 表或JSON字段
3. **批量操作**：支持批量确认入库
4. **历史记录**：查看已入库的卡片历史

## 📚 相关文档

- [后端API文档](../backend/README.md)
- [组件样式指南](./STYLE_GUIDE.md)


## 📁 文件结构

```
frontend/src/
├── types/
│   ├── inbound.ts          # 入库相关类型定义
│   ├── index.ts            # 类型统一导出
│   └── README.md           # 本文档
├── components/
│   └── JewelryInboundCard.tsx  # 入库核对卡片组件
└── utils/
    └── inboundHelpers.ts   # 入库相关工具函数
```

## 🎯 核心类型

### `JewelryInboundCard`

珠宝入库核对卡片的主接口，包含所有必要字段：

```typescript
interface JewelryInboundCard {
  id: string;                    // 前端临时唯一标识
  productName: string;           // 产品名称
  barcode: string;               // 条码
  goldWeight: number;            // 金重（克）
  laborCostPerGram: number;      // 克工费（元/克）
  totalCost?: number;            // 总成本（自动计算）
  gemstones?: GemstoneDetail[];  // 配石详情
  supplier: SupplierInfo;       // 供应商信息
  status: ProductStatus;         // 状态
  // ... 更多字段
}
```

### `CardActions`

卡片操作回调接口：

```typescript
interface CardActions {
  onConfirm: (card: JewelryInboundCard) => Promise<void>;
  onReportError: (card: JewelryInboundCard, errorReason?: string) => Promise<void>;
}
```

## 🚀 快速开始

### 1. 创建新卡片

```typescript
import { createNewCard } from '../utils/inboundHelpers';

const card = createNewCard({
  productName: '古法黄金戒指',
  barcode: 'JZ20240109001',
  goldWeight: 10.5,
  laborCostPerGram: 6.0,
  supplier: {
    id: 1,
    name: '金源珠宝',
  },
});
```

### 2. 使用卡片组件

```typescript
import { JewelryInboundCardComponent } from '../components/JewelryInboundCard';
import type { CardActions } from '../types/inbound';

const actions: CardActions = {
  onConfirm: async (card) => {
    // 调用API提交入库
    const response = await fetch('/api/inbound-orders', {
      method: 'POST',
      body: JSON.stringify(prepareInboundRequest(card)),
    });
  },
  onReportError: async (card, reason) => {
    // 处理错误报告
    console.log('数据报错:', reason);
  },
};

<JewelryInboundCardComponent
  data={card}
  actions={actions}
/>
```

### 3. 从OCR结果创建卡片

```typescript
import { createCardFromOCR } from '../utils/inboundHelpers';

const ocrCard = createCardFromOCR({
  productName: '18K金项链',
  barcode: 'JZ20240109002',
  goldWeight: 15.8,
  laborCostPerGram: 5.5,
  supplier: '林煌珠宝',
});
```

### 4. 从后端数据创建卡片

```typescript
import { createCardFromBackend } from '../utils/inboundHelpers';

const card = createCardFromBackend(
  inboundDetailResponse,
  supplierResponse
);
```

## 🛠️ 工具函数

### `createNewCard(data)`

创建新的入库核对卡片，自动生成ID和计算总成本。

### `createCardFromOCR(ocrData)`

从OCR识别结果创建卡片。

### `createCardFromBackend(detail, supplier)`

从后端API响应创建卡片。

### `updateCard(card, updates)`

更新卡片数据，自动重新计算总成本。

### `prepareInboundRequest(card)`

准备提交到后端的请求数据，包含数据验证。

### `validateCard(card)`

验证卡片数据的完整性和正确性。

### `calculateTotalCost(goldWeight, laborCostPerGram)`

计算总成本。

## 📊 数据转换

### 前端 → 后端

```typescript
import { convertCardToInboundRequest } from '../types/inbound';

const request = convertCardToInboundRequest(card);
// 返回 InboundOrderCreateRequest
```

### 后端 → 前端

```typescript
import { convertInboundDetailToCard } from '../types/inbound';

const card = convertInboundDetailToCard(
  inboundDetailResponse,
  supplierResponse
);
```

## ✅ 数据验证

```typescript
import { validateCard } from '../utils/inboundHelpers';

const validation = validateCard(card);
if (!validation.valid) {
  console.error('验证失败:', validation.errors);
}
```

## 🎨 组件Props

```typescript
interface JewelryInboundCardProps {
  data: JewelryInboundCard;      // 卡片数据（注意：使用 data 而不是 card）
  actions: CardActions;          // 操作回调
  disabled?: boolean;            // 是否禁用
  className?: string;           // 自定义样式
}
```

## 📝 完整示例

查看 `frontend/src/App.jsx` 中 `JewelryInboundCardComponent` 的使用示例。

## 🔗 与后端数据结构对应关系

| 前端字段 | 后端字段 | 说明 |
|---------|---------|------|
| `productName` | `product_name` | 产品名称 |
| `goldWeight` | `weight` | 金重（克） |
| `laborCostPerGram` | `labor_cost` | 克工费（元/克） |
| `totalCost` | `total_cost` | 总成本 |
| `productCategory` | `product_category` | 产品类别 |
| `supplier.id` | `supplier_id` | 供应商ID |
| `supplier.name` | `supplier` | 供应商名称 |
| `barcode` | - | 条码（后端需扩展） |
| `gemstones` | - | 配石详情（后端需扩展） |

## 🚧 待扩展功能

1. **条码字段**：后端数据库需要添加 `barcode` 字段
2. **配石详情**：后端需要创建 `gemstone_details` 表或JSON字段
3. **批量操作**：支持批量确认入库
4. **历史记录**：查看已入库的卡片历史

## 📚 相关文档

- [后端API文档](../backend/README.md)
- [组件样式指南](./STYLE_GUIDE.md)

