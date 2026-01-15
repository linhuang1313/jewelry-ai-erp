---
name: jewelry-erp
description: 珠宝ERP系统开发规范 - 包含数据模型、业务逻辑、API设计和前端组件的开发指南
---

# 珠宝 ERP 系统开发规范

当用户请求开发珠宝 ERP 相关功能时，遵循以下规范和约定。

## 项目结构

```
jewelry-ai-erp/
├── backend/                 # FastAPI 后端
│   ├── app/
│   │   ├── models/         # SQLAlchemy ORM 模型
│   │   ├── routers/        # API 路由
│   │   ├── schemas/        # Pydantic 数据模式
│   │   ├── services/       # 业务逻辑服务
│   │   └── utils/          # 工具函数
│   └── jewelry_erp.db      # SQLite 数据库
└── frontend/               # React + Vite 前端
    └── src/
        ├── components/     # React 组件
        ├── services/       # API 调用服务
        └── types/          # TypeScript 类型定义
```

## 数据模型规范 (SQLAlchemy)

### 字段类型约定

| 业务类型 | SQLAlchemy 类型 | 说明 |
|----------|-----------------|------|
| 金额 | `Column(Float)` | 单位：元（人民币） |
| 重量 | `Column(Float)` | 单位：克 |
| 编码 | `Column(String(50), unique=True, index=True)` | 添加唯一索引 |
| 状态 | `Column(String(20), default="pending")` | 使用英文状态值 |
| 时间 | `Column(DateTime, server_default=func.now())` | 使用数据库时间 |
| 备注 | `Column(Text, nullable=True)` | 可空文本 |

### 状态值约定（使用英文）

| 业务类型 | 状态值 |
|----------|--------|
| 订单状态 | `pending` / `confirmed` / `completed` / `cancelled` |
| 审批状态 | `pending` / `approved` / `rejected` |
| 结算方式 | `cash_price`(结价) / `physical_gold`(结料) / `mixed`(混合) |
| 支付状态 | `full`(全额) / `overpaid`(多付) / `underpaid`(少付) |
| 实体状态 | `active` / `inactive` |

### 模型示例

```python
class NewModel(Base):
    """模型说明"""
    __tablename__ = "table_name"
    
    id = Column(Integer, primary_key=True, index=True)
    order_no = Column(String(50), unique=True, index=True, nullable=False)  # 单号
    amount = Column(Float, default=0.0)  # 金额（元）
    weight = Column(Float, default=0.0)  # 重量（克）
    status = Column(String(20), default="pending")  # 状态
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())
    remark = Column(Text, nullable=True)  # 备注
```

### 关系定义

```python
# 外键关系
customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True)
customer = relationship("Customer", backref="orders")

# 一对多关系（带级联删除）
details = relationship("OrderDetail", backref="order", cascade="all, delete-orphan")
```

## API 路由规范 (FastAPI)

### 路由文件位置

`backend/app/routers/` 目录下按业务模块划分。

### RESTful 命名约定

```python
router = APIRouter(prefix="/api/模块名", tags=["模块名"])

@router.get("/")           # 列表查询
@router.get("/{id}")       # 详情查询
@router.post("/")          # 创建
@router.put("/{id}")       # 更新
@router.delete("/{id}")    # 删除
```

### 分页查询

```python
@router.get("/")
async def get_list(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    search: str = Query(None),
    db: Session = Depends(get_db)
):
    query = db.query(Model)
    if search:
        query = query.filter(Model.name.contains(search))
    total = query.count()
    items = query.offset(skip).limit(limit).all()
    return {"items": items, "total": total}
```

## 前端组件规范 (React + TypeScript)

### 组件文件位置

- 页面组件：`frontend/src/components/XxxPage.tsx`
- 功能组件：`frontend/src/components/xxx/XxxComponent.tsx`
- 类型定义：`frontend/src/types/xxx.ts`
- API 服务：`frontend/src/services/xxxService.ts`

### 状态显示映射

```typescript
const STATUS_MAP = {
  pending: { label: '待处理', color: 'orange' },
  confirmed: { label: '已确认', color: 'blue' },
  completed: { label: '已完成', color: 'green' },
  cancelled: { label: '已取消', color: 'gray' },
};
```

### API 调用

```typescript
import { API_BASE } from '../config';

export const xxxService = {
  getList: async (params: ListParams) => {
    const response = await fetch(`${API_BASE}/api/xxx?${new URLSearchParams(params)}`);
    return response.json();
  },
  create: async (data: CreateData) => {
    const response = await fetch(`${API_BASE}/api/xxx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return response.json();
  },
};
```

## 业务模块说明

### 核心模块

| 模块 | 说明 | 主要模型 |
|------|------|----------|
| 入库 | 商品入库管理 | `InboundOrder`, `InboundDetail` |
| 销售 | 销售订单管理 | `SalesOrder`, `SalesDetail` |
| 结算 | 客户结算（结价/结料） | `SettlementOrder` |
| 库存 | 库存查询和预警 | `Inventory`, `LocationInventory` |
| 金料 | 金料收付管理 | `GoldMaterialTransaction` |
| 退货 | 退货单管理 | `ReturnOrder` |

### 业务实体

| 实体 | 说明 |
|------|------|
| 供应商 `Supplier` | 货品供应方，关联入库单 |
| 客户 `Customer` | 购买方，关联销售单和结算单 |
| 业务员 `Salesperson` | 销售人员 |

### 金额计算规则

1. **克工费** = 重量 × 克工费单价
2. **件工费** = 件数 × 件工费单价
3. **总工费** = 克工费 + 件工费
4. **原料金额** = 金价 × 克重（结价支付时）
5. **应收总额** = 原料金额 + 工费金额

## 编码规范

### 单号格式

| 单据类型 | 前缀 | 格式示例 |
|----------|------|----------|
| 入库单 | RK | RK20260116001 |
| 销售单 | XS | XS20260116001 |
| 结算单 | JS | JS20260116001 |
| 退货单 | TH | TH20260116001 |
| 收料单 | SL | SL20260116001 |
| 付料单 | FL | FL20260116001 |

### 商品编码

- **预定义编码**：JPJZ（精品金镯）等
- **F编码（一码一件）**：F00000001
- **FL编码（批量）**：FL0001

## 注意事项

1. 所有金额保留两位小数
2. 所有重量保留三位小数
3. 时间使用北京时区 (Asia/Shanghai)
4. 中文注释保留在代码中
5. API 响应使用 JSON 格式
6. 前端使用 Ant Design 组件库
7. 使用 Tailwind CSS 进行样式开发

