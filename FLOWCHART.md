# 📊 珠宝ERP系统流程图

> 本文档包含系统架构、业务流程、数据模型等可视化图表  
> 使用 Mermaid 语法，支持在 GitHub、VSCode、Typora 等工具中渲染

---

## 目录

1. [系统整体架构](#1-系统整体架构)
2. [核心业务流程](#2-核心业务流程)
3. [角色权限体系](#3-角色权限体系)
4. [金料流转流程](#4-金料流转流程)
5. [销售结算流程](#5-销售结算流程)
6. [数据模型关系](#6-数据模型关系)
7. [前端页面结构](#7-前端页面结构)
8. [API请求流程](#8-api请求流程)
9. [模块功能汇总](#9-模块功能汇总)

---

## 1. 系统整体架构

```mermaid
graph TB
    subgraph Frontend["🖥️ 前端 React + Vite + Tailwind"]
        UI[用户界面]
        Chat[AI对话入口]
        Pages[业务页面]
    end
    
    subgraph Backend["⚙️ 后端 FastAPI + SQLAlchemy"]
        API[API路由层]
        BL[业务逻辑层]
        AI[AI解析模块]
        Middleware[权限中间件]
        DB[(SQLite/PostgreSQL)]
    end
    
    subgraph External["🌐 外部服务"]
        DeepSeek[DeepSeek AI<br/>自然语言解析]
        OCR[百度云OCR<br/>图片文字识别]
    end
    
    UI --> API
    Chat --> AI
    AI --> DeepSeek
    API --> Middleware
    Middleware --> BL
    BL --> DB
    Pages --> API
    UI -.-> OCR
```

### 技术栈说明

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端 | React + Vite + Tailwind CSS | 现代化响应式UI |
| 后端 | Python + FastAPI | 高性能异步API |
| 数据库 | SQLite / PostgreSQL | 开发/生产环境 |
| AI | DeepSeek API | 自然语言入库解析 |
| 部署 | Railway + Vercel | 自动化CI/CD |

---

## 2. 核心业务流程

```mermaid
flowchart LR
    subgraph 采购入库["📥 采购入库"]
        A1[供应商来货] --> A2[入库登记]
        A2 --> A3[库存增加]
        A2 --> A4[金料账户记录]
    end
    
    subgraph 销售结算["💰 销售结算"]
        B1[客户选货] --> B2[创建销售单]
        B2 --> B3[结算处理]
        B3 --> B4{结算方式}
        B4 -->|结价| B5[应收账款]
        B4 -->|结料| B6[金料收取]
        B4 -->|混合| B7[部分现金+部分金料]
    end
    
    subgraph 财务管理["📋 财务管理"]
        B5 --> C1[收款记录]
        B6 --> C2[收料确认]
        C1 --> C3[对账单]
        C2 --> C3
    end
    
    A3 -.->|库存商品| B1
```

### 业务流程说明

1. **采购入库**：供应商送货 → 入库登记（商品信息、工费、克重）→ 库存更新
2. **销售结算**：客户选货 → 创建销售单 → 选择结算方式（结价/结料/混合）
3. **财务管理**：应收账款跟踪 → 收款/收料确认 → 生成对账单

---

## 3. 角色权限体系

```mermaid
flowchart TB
    subgraph Roles["👥 系统角色"]
        R1["🔑 管理层<br/>Manager"]
        R2["💼 结算专员<br/>Settlement"]
        R3["📦 料部专员<br/>Material"]
        R4["👔 业务员<br/>Sales"]
    end
    
    subgraph Permissions["🔐 权限矩阵"]
        P1["✅ 全部权限<br/>系统配置、删除操作"]
        P2["✅ 结算管理<br/>客户管理、财务报表"]
        P3["✅ 金料管理<br/>收料确认、库存操作"]
        P4["✅ 销售操作<br/>客户查询、销售创建"]
    end
    
    R1 --> P1
    R2 --> P2
    R3 --> P3
    R4 --> P4
    
    style R1 fill:#e74c3c,color:#fff
    style R2 fill:#3498db,color:#fff
    style R3 fill:#f39c12,color:#fff
    style R4 fill:#27ae60,color:#fff
```

### 权限详细说明

| 角色 | 权限范围 | 禁止操作 |
|------|----------|----------|
| 管理层 | 全部功能 | 无 |
| 结算专员 | 结算、客户、应收账款、报表 | 删除数据、系统配置 |
| 料部专员 | 金料收发、库存查看、取料确认 | 结算、财务、删除 |
| 业务员 | 销售创建、客户查询、自己的销售记录 | 结算、金料、删除 |

---

## 4. 金料流转流程

```mermaid
flowchart TD
    Start((🏁 开始)) --> A{金料来源}
    
    A -->|期初设置| B1["⚙️ 设置期初金料<br/>QC开头单号"]
    A -->|客户来料| B2["📥 创建收料单<br/>SL开头单号"]
    A -->|供应商入库| B3["📦 入库登记<br/>RK开头单号"]
    
    B1 --> C[("💰 金料库存")]
    B2 --> D{"🔍 料部确认"}
    B3 --> C
    
    D -->|✅ 确认接收| F["📊 更新客户金料账户<br/>增加存料/抵扣欠料"]
    D -->|⏳ 待确认| G["等待料部处理"]
    
    F --> C
    G --> D
    
    C --> H{金料去向}
    
    H -->|客户取料| I1["📤 创建取料单<br/>QL开头单号"]
    H -->|供应商付料| I2["💸 创建付料单<br/>FL开头单号"]
    H -->|客户转料| I3["🔄 创建转料单<br/>ZL开头单号"]
    
    I1 --> J1["扣减客户存料余额"]
    I2 --> J2["扣减金料库存"]
    I3 --> J3["A客户→B客户<br/>转移存料余额"]
    
    J1 --> End((✅ 结束))
    J2 --> End
    J3 --> End
    
    style C fill:#f1c40f,stroke:#f39c12,stroke-width:2px
    style F fill:#2ecc71,stroke:#27ae60
    style J1 fill:#e74c3c,stroke:#c0392b
    style J2 fill:#e74c3c,stroke:#c0392b
```

### 金料单据编号规则

| 类型 | 前缀 | 示例 | 说明 |
|------|------|------|------|
| 期初金料 | QC | QC20250122143000 | 系统初始化设置 |
| 收料单 | SL | SL20250122143000 | 客户送料至公司 |
| 付料单 | FL | FL20250122143000 | 公司付料给供应商 |
| 取料单 | QL | QL20250122143000 | 客户从公司取料 |
| 转料单 | ZL | ZL20250122143000 | 客户间转让存料 |

---

## 5. 销售结算流程

```mermaid
flowchart TD
    A["👤 客户下单"] --> B["📝 创建销售单<br/>XS开头单号"]
    B --> C["📋 添加商品明细<br/>品名、克重、工费"]
    C --> D["💰 计算总工费"]
    D --> E["✅ 保存销售单<br/>状态：待结算"]
    
    E --> F{"🔄 结算操作"}
    F --> G["📄 创建结算单<br/>JS开头单号"]
    
    G --> H{"💳 选择结算方式"}
    
    H -->|💵 结价| I1["计算应收金额<br/>工费 × 数量"]
    I1 --> I2["生成应收账款"]
    I2 --> I3["⏳ 等待客户付款"]
    I3 --> I4{"收款确认"}
    I4 -->|✅ 已收款| I5["更新账款状态"]
    I4 -->|⏳ 未收款| I6["催收提醒"]
    
    H -->|🪙 结料| J1["计算应付金料<br/>克重 × 比例"]
    J1 --> J2["创建收料单"]
    J2 --> J3["📦 料部确认接收"]
    J3 --> J4["更新金料账户"]
    
    H -->|🔀 混合| K1["拆分计算<br/>部分现金 + 部分金料"]
    K1 --> I2
    K1 --> J2
    
    I5 --> L["✅ 结算完成"]
    J4 --> L
    I6 --> I3
    
    style L fill:#27ae60,stroke:#1e8449,stroke-width:2px,color:#fff
    style I6 fill:#e74c3c,stroke:#c0392b
```

### 结算方式对比

| 方式 | 适用场景 | 客户支付 | 公司收取 |
|------|----------|----------|----------|
| 结价 | 客户现金结算 | 现金/转账 | 应收账款 |
| 结料 | 客户用金料抵扣 | 实物黄金 | 金料入库 |
| 混合 | 部分现金+部分金料 | 现金+黄金 | 账款+金料 |

---

## 6. 数据模型关系

```mermaid
erDiagram
    Customer ||--o{ SalesOrder : "下单"
    Customer ||--o{ CustomerGoldDeposit : "金料账户"
    Customer ||--o{ AccountReceivable : "应收账款"
    Customer ||--o{ CustomerWithdrawal : "取料"
    Customer ||--o{ CustomerTransfer : "转料"
    
    SalesOrder ||--|{ SalesDetail : "包含明细"
    SalesOrder ||--o{ SettlementOrder : "结算"
    
    SettlementOrder ||--o{ GoldReceipt : "收料"
    SettlementOrder ||--o{ PaymentRecord : "收款"
    
    Supplier ||--o{ InboundOrder : "供货"
    Supplier ||--o{ SupplierGoldAccount : "金料往来"
    
    InboundOrder ||--|{ InboundDetail : "入库明细"
    InboundDetail }|--|| Inventory : "更新库存"
    
    GoldReceipt }o--|| SettlementOrder : "关联结算"
    GoldReceipt }o--|| Customer : "来自客户"
    
    CustomerGoldDeposit ||--o{ CustomerGoldDepositTransaction : "交易记录"
```

### 核心数据表说明

| 表名 | 说明 | 主要字段 |
|------|------|----------|
| `customers` | 客户信息 | name, phone, total_purchase |
| `sales_orders` | 销售单 | order_no, customer_id, total_labor_cost |
| `sales_details` | 销售明细 | product_name, weight, labor_cost |
| `settlement_orders` | 结算单 | payment_method, total_amount |
| `gold_receipts` | 收料单 | gold_weight, status, customer_id |
| `inventory` | 库存 | product_name, quantity, weight |

---

## 7. 前端页面结构

```mermaid
graph TD
    App["🏠 主应用 App.jsx"] --> Nav["📱 导航菜单"]
    
    Nav --> P1["📊 仪表盘<br/>DashboardPage"]
    Nav --> P2["📥 入库管理<br/>InboundOrdersPage"]
    Nav --> P3["📦 库存总览<br/>InventoryOverview"]
    Nav --> P4["👥 客户管理<br/>CustomerPage"]
    Nav --> P5["💰 销售管理<br/>QuickOrderModal"]
    Nav --> P6["📋 结算管理<br/>SettlementPage"]
    Nav --> P7["🪙 金料管理<br/>GoldMaterialPage"]
    Nav --> P8["💵 财务对账<br/>FinancePage"]
    Nav --> P9["📈 数据分析<br/>AnalyticsPage"]
    Nav --> P10["↩️ 退货管理<br/>ReturnPage"]
    Nav --> P11["🏭 供应商管理<br/>SupplierPage"]
    Nav --> P12["👔 业务员管理<br/>SalespersonPage"]
    Nav --> P13["🏷️ 编码管理<br/>ProductCodePage"]
    Nav --> P14["📤 数据导出<br/>ExportPage"]
    Nav --> P15["🏪 仓库管理<br/>WarehousePage"]
    
    P8 --> F1["应收账款表"]
    P8 --> F2["收款记录表"]
    P8 --> F3["对账单生成"]
    
    P9 --> A1["销售分析"]
    P9 --> A2["库存分析"]
    P9 --> A3["财务分析"]
    P9 --> A4["预警中心"]
    
    style App fill:#3498db,color:#fff
    style Nav fill:#9b59b6,color:#fff
```

---

## 8. API请求流程

```mermaid
sequenceDiagram
    participant U as 👤 用户
    participant F as 🖥️ 前端
    participant A as ⚙️ FastAPI
    participant M as 🔐 权限中间件
    participant DB as 🗄️ 数据库
    
    U->>F: 发起操作请求
    F->>A: HTTP请求 + user_role参数
    A->>M: 检查权限
    
    alt ✅ 有权限
        M->>A: 权限通过
        A->>DB: 执行数据操作
        DB-->>A: 返回数据
        A-->>F: 统一响应格式<br/>{success, code, message, data}
        F-->>U: 渲染结果
    else ❌ 无权限
        M-->>A: 拒绝访问
        A-->>F: 403 Forbidden<br/>{success: false, code: 403}
        F-->>U: 显示权限不足提示
    end
    
    Note over A,DB: 所有异常统一捕获<br/>返回标准错误格式
```

### API响应格式

```json
{
    "success": true,
    "code": 200,
    "message": "操作成功",
    "data": {
        "items": [...],
        "total": 100
    }
}
```

---

## 9. 模块功能汇总

| 模块 | 功能描述 | 后端文件 | 前端组件 |
|------|----------|----------|----------|
| 📥 入库管理 | 商品入库登记、库存更新 | `warehouse.py` | `InboundOrdersPage` |
| 👥 客户管理 | 客户CRUD、欠款查询、往来账 | `customers.py` | `CustomerPage` |
| 💰 销售管理 | 销售单创建、明细管理 | `sales.py` | `QuickOrderModal` |
| 📋 结算管理 | 结价/结料结算处理 | `settlement.py` | `SettlementPage` |
| 🪙 金料管理 | 收料/付料/取料/转料 | `gold_material.py` | `GoldMaterialPage` |
| 💵 财务对账 | 应收账款、收款记录、对账单 | `finance.py` | `FinancePage` |
| 📈 数据分析 | 销售/库存/财务报表 | `analytics.py` | `AnalyticsPage` |
| ↩️ 退货管理 | 退货单处理 | `returns.py` | `ReturnPage` |
| 🏭 供应商管理 | 供应商CRUD、金料往来 | `suppliers.py` | `SupplierPage` |
| 👔 业务员管理 | 业务员CRUD | `salespersons.py` | `SalespersonPage` |
| 🏷️ 编码管理 | 商品编码配置 | `product_codes.py` | `ProductCodePage` |
| 📤 数据导出 | Excel/PDF导出 | `export.py` | `ExportPage` |

---

## 附录：单据编号规则

| 单据类型 | 前缀 | 格式 | 示例 |
|----------|------|------|------|
| 入库单 | RK | RK + 日期8位 + 随机4位 | RK202501220001 |
| 销售单 | XS | XS + 时间戳14位 | XS20250122143000 |
| 结算单 | JS | JS + 时间戳14位 | JS20250122143000 |
| 收料单 | SL | SL + 时间戳14位 | SL20250122143000 |
| 付料单 | FL | FL + 时间戳14位 | FL20250122143000 |
| 取料单 | QL | QL + 时间戳14位 | QL20250122143000 |
| 转料单 | ZL | ZL + 时间戳14位 | ZL20250122143000 |
| 期初金料 | QC | QC + 时间戳14位 | QC20250122143000 |
| 客户编号 | KH | KH + 时间戳14位 | KH20250122143000 |

---

> 📅 最后更新：2025-01-22  
> 📝 维护者：AI Assistant

