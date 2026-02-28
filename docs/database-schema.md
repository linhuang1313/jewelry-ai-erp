# Jewelry AI-ERP 数据库表结构文档

> 最后更新：2026-02-24
>
> 数据库：PostgreSQL | ORM：SQLAlchemy 2.0
>
> 共 55 张表，按业务模块分类

---

## 目录

- [一、入库模块（3 张）](#一入库模块3-张)
- [二、仓库/位置模块（6 张）](#二仓库位置模块6-张)
- [三、供应商 & 业务员（2 张）](#三供应商--业务员2-张)
- [四、客户模块（1 张）](#四客户模块1-张)
- [五、销售模块（2 张）](#五销售模块2-张)
- [六、结算模块（1 张）](#六结算模块1-张)
- [七、退货模块（4 张）](#七退货模块4-张)
- [八、销退结算（1 张）](#八销退结算1-张)
- [九、金料管理模块（8 张）](#九金料管理模块8-张)
- [十、财务 - 应收模块（3 张）](#十财务---应收模块3-张)
- [十一、财务 - 应付模块（2 张）](#十一财务---应付模块2-张)
- [十二、财务 - 资金管理（4 张）](#十二财务---资金管理4-张)
- [十三、财务 - 其他（4 张）](#十三财务---其他4-张)
- [十四、暂借模块（4 张）](#十四暂借模块4-张)
- [十五、商品编码（2 张）](#十五商品编码2-张)
- [十六、系统/日志模块（6 张）](#十六系统日志模块6-张)
- [十七、协同模块（2 张）](#十七协同模块2-张)
- [附录：单号前缀汇总](#附录单号前缀汇总)
- [附录：状态值汇总](#附录状态值汇总)
- [附录：数据迁移建议顺序](#附录数据迁移建议顺序)

---

## 一、入库模块（3 张）

### 1. `inbound_orders` — 入库单主表

每次供应商送货到仓库时创建的入库单据。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK, 自增 | 主键 |
| order_no | String(50) | 唯一, 非空 | 入库单号，格式 RK + 日期 + 随机码，如 RK20260224A3B |
| create_time | DateTime | 默认当前时间 | 入库单创建时间 |
| operator | String(50) | 默认"系统管理员" | 创建入库单的操作人姓名 |
| status | String(20) | 默认"draft" | 单据状态：draft 草稿（可编辑）/ confirmed 已确认（库存已更新） |
| is_audited | Boolean | 默认 False | 财务是否已审核此入库单，审核后不可修改 |
| audited_by | String(50) | 可空 | 执行审核操作的财务人员姓名 |
| audited_at | DateTime | 可空 | 审核完成的时间 |

### 2. `inbound_details` — 入库单明细

入库单中每一件商品的详细信息，一个入库单可包含多条明细。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| order_id | Integer | FK→inbound_orders.id | 所属入库单 |
| product_code | String(20) | 可空 | 商品编码，如 JPJZ（金品金钻）、F00000001（一码一件） |
| product_name | String(200) | 非空 | 商品名称，如"足金古法手镯" |
| product_category | String(100) | 可空 | 商品大类，如"手镯"、"项链" |
| weight | Numeric(12,4) | 非空 | 商品净重（克），精确到 0.0001 克 |
| labor_cost | Numeric(10,2) | 非空 | 克工费（元/克），即每克的加工费用 |
| piece_count | Integer | 可空 | 件数，部分商品按件计费时使用 |
| piece_labor_cost | Numeric(10,2) | 可空 | 件工费（元/件），按件计费的加工费用 |
| supplier | String(100) | 可空 | 供应商名称（字符串冗余，向后兼容旧数据） |
| supplier_id | Integer | FK→suppliers.id | 关联供应商表的外键 |
| total_cost | Numeric(14,2) | 非空 | 总成本 = 克重 × 克工费 + 件数 × 件工费 |
| fineness | String(50) | 可空 | 成色，如"足金999"、"足金9999"、"18K" |
| craft | String(50) | 可空 | 工艺，如"3D硬金"、"古法"、"珐琅"、"镶嵌" |
| style | String(50) | 可空 | 款式，如"手镯"、"吊坠"、"戒指"、"项链" |
| main_stone_weight | Numeric(10,4) | 可空 | 主石重量（克拉），镶嵌产品专用 |
| main_stone_count | Integer | 可空 | 主石粒数，镶嵌产品专用 |
| main_stone_price | Numeric(14,2) | 可空 | 主石单价（元），镶嵌产品专用 |
| main_stone_amount | Numeric(14,2) | 可空 | 主石金额 = 粒数 × 单价 |
| sub_stone_weight | Numeric(10,4) | 可空 | 副石重量（克拉） |
| sub_stone_count | Integer | 可空 | 副石粒数 |
| sub_stone_price | Numeric(14,2) | 可空 | 副石单价（元） |
| sub_stone_amount | Numeric(14,2) | 可空 | 副石金额 |
| stone_setting_fee | Numeric(14,2) | 可空 | 镶石费（元），镶嵌工艺的镶嵌加工费 |
| total_amount | Numeric(14,2) | 可空 | 总金额，镶嵌产品用此字段（含石料+镶嵌费+金料） |
| main_stone_mark | String(50) | 可空 | 主石字印/标记 |
| sub_stone_mark | String(50) | 可空 | 副石字印/标记 |
| pearl_weight | Numeric(12,4) | 可空 | 珍珠重量（克），珍珠镶嵌产品用 |
| bearing_weight | Numeric(12,4) | 可空 | 轴承/配件重量（克），需从净重中扣除 |
| sale_labor_cost | Numeric(10,2) | 可空 | 销售克工费（元/克），销售时使用的工费标准 |
| sale_piece_labor_cost | Numeric(10,2) | 可空 | 销售件工费（元/件），销售时使用的件工费标准 |

### 3. `inventory` — 库存汇总表

按商品名称汇总的库存总量，每种商品一条记录。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| product_name | String(200) | 唯一, 非空 | 商品名称，与入库明细的 product_name 对应 |
| total_weight | Numeric(12,4) | 默认 0 | 该商品的总库存克重（所有仓位合计） |
| last_update | DateTime | 自动更新 | 库存最后变动时间 |

---

## 二、仓库/位置模块（6 张）

### 4. `locations` — 仓库/位置表

定义系统中所有的库存存放位置（仓库、展厅等）。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| code | String(50) | 唯一, 非空 | 位置代码，如 warehouse、showroom_1、showroom_2 |
| name | String(100) | 非空 | 位置名称，如"商品部仓库"、"一楼展厅" |
| location_type | String(20) | 非空 | 位置类型：warehouse 仓库 / showroom 展厅 / transit 在途 |
| description | Text | 可空 | 位置的详细描述 |
| is_active | Integer | 默认 1 | 是否启用：1 启用 / 0 停用 |
| created_at | DateTime | 默认当前时间 | 创建时间 |

### 5. `location_inventory` — 分仓库存表

按位置细分的库存记录，同一商品在不同仓位各有一条记录。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| product_name | String(200) | 非空 | 商品名称 |
| location_id | Integer | FK→locations.id | 所在位置 |
| weight | Numeric(12,4) | 默认 0 | 该位置的库存克重 |
| last_update | DateTime | 自动更新 | 最后更新时间 |
| *(约束)* | | 唯一(product_name + location_id) | 同位置同商品只允许一条记录 |

### 6. `inventory_transfers` — 转移记录（旧版单表，已弃用）

旧版单表结构的库存转移记录，新系统使用下方的主表+明细表。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| transfer_no | String(50) | 唯一, 非空 | 转移单号 |
| product_name | String(200) | 非空 | 转移的商品名称 |
| weight | Numeric(12,4) | 非空 | 预期转移克重 |
| from_location_id | Integer | FK→locations.id | 发出位置（如仓库） |
| to_location_id | Integer | FK→locations.id | 目标位置（如展厅） |
| status | String(20) | 默认"pending" | pending 待接收 / received 已接收 / rejected 已拒收 |
| created_by | String(50) | 可空 | 发起转移的操作人 |
| created_at | DateTime | 默认当前时间 | 发起时间 |
| remark | Text | 可空 | 备注说明 |
| received_by | String(50) | 可空 | 目标位置的接收人 |
| received_at | DateTime | 可空 | 接收时间 |
| actual_weight | Numeric(12,4) | 可空 | 实际接收克重（可能与预期有差异） |
| weight_diff | Numeric(12,4) | 可空 | 重量差异 = 实际 - 预期 |
| diff_reason | Text | 可空 | 差异原因说明 |

### 7. `inventory_transfer_orders` — 转移单主表（新版）

新版转移单，支持一单多商品，一个转移单对应多条明细。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| transfer_no | String(50) | 唯一, 非空 | 转移单号，格式 TR + 日期 + 序号 |
| from_location_id | Integer | FK→locations.id | 发出位置 |
| to_location_id | Integer | FK→locations.id | 目标位置 |
| status | String(20) | 默认"pending" | pending / received / rejected / pending_confirm |
| created_by | String(50) | 可空 | 发起人 |
| created_at | DateTime | 可空 | 创建时间 |
| remark | Text | 可空 | 备注 |
| received_by | String(50) | 可空 | 接收人 |
| received_at | DateTime | 可空 | 接收时间 |
| source_order_id | Integer | FK→自身.id | 重新发起时关联的原转移单ID |

### 8. `inventory_transfer_items` — 转移单明细

转移单中每一件商品的转移详情。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| order_id | Integer | FK→inventory_transfer_orders.id | 所属转移单 |
| product_name | String(200) | 非空 | 商品名称 |
| weight | Numeric(12,4) | 非空 | 预期转移克重 |
| actual_weight | Numeric(12,4) | 可空 | 实际接收克重 |
| weight_diff | Numeric(12,4) | 可空 | 重量差异 |
| diff_reason | Text | 可空 | 差异原因 |

### 9. `inventory_alert_settings` — 库存预警设置

为每种商品配置库存预警阈值，低于阈值时系统提示补货。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| product_name | String(200) | 唯一, 非空 | 商品名称 |
| min_weight | Numeric(12,4) | 默认 50 | 最低库存阈值（克），低于此值触发预警 |
| slow_days | Integer | 默认 30 | 滞销天数阈值，超过此天数未出库视为滞销 |
| is_enabled | Integer | 默认 1 | 是否启用预警：1 启用 / 0 关闭 |
| created_at | DateTime | 默认当前时间 | 创建时间 |
| updated_at | DateTime | 自动更新 | 更新时间 |

---

## 三、供应商 & 业务员（2 张）

### 10. `suppliers` — 供应商表

管理所有供货商的基本信息和统计数据。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| supplier_no | String(50) | 唯一 | 供应商编号，系统自动生成 |
| name | String(100) | 非空 | 供应商名称/姓名 |
| phone | String(20) | 可空 | 联系电话 |
| wechat | String(50) | 可空 | 微信号 |
| address | String(200) | 可空 | 地址 |
| contact_person | String(50) | 可空 | 联系人姓名（公司型供应商） |
| supplier_type | String(20) | 默认"个人" | 供应商类型：个人 / 公司 |
| total_supply_amount | Numeric(14,2) | 默认 0 | 累计供货总工费金额（元），入库确认时自动累加 |
| total_supply_weight | Numeric(12,4) | 默认 0 | 累计供货总克重（克） |
| total_supply_count | Integer | 默认 0 | 累计供货次数 |
| last_supply_time | DateTime | 可空 | 最后一次供货时间 |
| status | String(20) | 默认"active" | active 正常 / inactive 停用 |
| create_time | DateTime | 默认当前时间 | 创建时间 |
| remark | Text | 可空 | 备注 |

### 11. `salespersons` — 业务员表

管理销售团队的业务员信息。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| name | String(50) | 唯一, 非空 | 业务员姓名 |
| phone | String(20) | 可空 | 联系电话 |
| status | String(20) | 默认"active" | active 在职 / inactive 离职 |
| create_time | DateTime | 默认当前时间 | 创建时间 |
| remark | Text | 可空 | 备注 |

---

## 四、客户模块（1 张）

### 12. `customers` — 客户表

管理所有客户（经销商/零售客户）的基本信息和购买统计。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| customer_no | String(50) | 唯一 | 客户编号，系统自动生成 |
| name | String(100) | 非空 | 客户名称/姓名 |
| phone | String(20) | 可空 | 联系电话 |
| wechat | String(50) | 可空 | 微信号 |
| address | String(200) | 可空 | 地址 |
| customer_type | String(20) | 默认"个人" | 客户类型：个人 / 公司 |
| total_purchase_amount | Numeric(14,2) | 默认 0 | 累计购买总工费金额（元） |
| total_purchase_weight | Numeric(12,4) | 默认 0 | 累计购买总克重（克） |
| total_purchase_count | Integer | 默认 0 | 累计购买次数 |
| last_purchase_time | DateTime | 可空 | 最后购买时间 |
| status | String(20) | 默认"active" | active 正常 / inactive 停用 |
| create_time | DateTime | 默认当前时间 | 创建时间 |
| remark | Text | 可空 | 备注 |

---

## 五、销售模块（2 张）

### 13. `sales_orders` — 销售单主表

记录每次向客户销售商品的单据。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| order_no | String(50) | 唯一, 非空 | 销售单号，格式 XS + 时间戳 |
| order_date | DateTime | 非空 | 销售日期 |
| customer_id | Integer | FK→customers.id | 客户ID（关联客户表） |
| customer_name | String(100) | 非空 | 客户姓名（冗余存储，便于查询展示） |
| salesperson | String(50) | 非空 | 负责此单的业务员姓名 |
| store_code | String(50) | 可空 | 门店代码（多门店场景） |
| total_labor_cost | Numeric(14,2) | 默认 0 | 本单总工费（元），所有明细工费之和 |
| total_weight | Numeric(12,4) | 默认 0 | 本单总克重（克） |
| remark | Text | 可空 | 备注信息 |
| status | String(20) | 默认"draft" | draft 草稿 / confirmed 已确认 / cancelled 已取消 |
| create_time | DateTime | 默认当前时间 | 创建时间 |
| operator | String(50) | 默认"系统管理员" | 操作人 |

### 14. `sales_details` — 销售单明细

销售单中每一件销售商品的详情。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| order_id | Integer | FK→sales_orders.id | 所属销售单 |
| product_code | String(50) | 可空 | 商品编码 |
| product_name | String(200) | 非空 | 商品名称 |
| weight | Numeric(12,4) | 非空 | 销售克重（克） |
| labor_cost | Numeric(10,2) | 非空 | 克工费（元/克） |
| piece_count | Integer | 可空 | 件数 |
| piece_labor_cost | Numeric(10,2) | 可空 | 件工费（元/件） |
| total_labor_cost | Numeric(14,2) | 非空 | 总工费 = 克重 × 克工费 + 件数 × 件工费 |
| inventory_id | Integer | FK→inventory.id | 关联库存记录（用于扣减库存） |

---

## 六、结算模块（1 张）

### 15. `settlement_orders` — 结算单

确认销售单的原料支付方式。珠宝行业特殊：客户购买黄金饰品时，除了支付工费，还需要支付黄金原料，可以用现金（结价）或实物黄金（结料）支付。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| settlement_no | String(50) | 唯一, 非空 | 结算单号，格式 JS + 时间戳 |
| sales_order_id | Integer | FK→sales_orders.id | 关联的销售单 |
| payment_method | String(20) | 非空 | 原料支付方式：cash_price 结价（现金买料）/ physical_gold 结料（实物黄金抵扣）/ mixed 混合支付 |
| gold_price | Numeric(14,2) | 可空 | 当日金价（元/克），结价或混合支付时必填 |
| physical_gold_weight | Numeric(12,4) | 可空 | 客户需支付的黄金克重（结料时） |
| gold_payment_weight | Numeric(12,4) | 可空 | 混合支付中结料部分的克重 |
| cash_payment_weight | Numeric(12,4) | 可空 | 混合支付中结价部分的克重 |
| total_weight | Numeric(12,4) | 非空 | 商品总克重 |
| material_amount | Numeric(14,2) | 可空 | 原料金额 = 金价 × 结价克重（结价支付时产生的现金应收） |
| labor_amount | Numeric(14,2) | 非空 | 工费金额（从销售单汇总） |
| total_amount | Numeric(14,2) | 非空 | 应收总额 = 原料金额 + 工费金额 |
| previous_cash_debt | Numeric(14,2) | 默认 0 | 客户历史现金欠款快照（创建时记录，用于结算单打印） |
| previous_gold_debt | Numeric(14,2) | 默认 0 | 客户历史金料欠款快照（克） |
| gold_deposit_balance | Numeric(14,2) | 默认 0 | 客户存料余额快照（克） |
| cash_deposit_balance | Numeric(14,2) | 默认 0 | 客户存款余额快照（元） |
| payment_difference | Numeric(14,2) | 默认 0 | 支付差额：正数=客户多付 / 负数=客户少付 |
| payment_status | String(20) | 默认"full" | full 全额 / overpaid 多付 / underpaid 少付 |
| status | String(20) | 默认"draft" | draft 待结算 / confirmed 已确认 / printed 已打印 |
| created_by | String(50) | 可空 | 创建人（通常是柜台人员） |
| confirmed_by | String(50) | 可空 | 确认人（通常是结算专员） |
| confirmed_at | DateTime | 可空 | 确认时间 |
| printed_at | DateTime | 可空 | 结算单打印时间 |
| remark | Text | 可空 | 备注 |
| created_at | DateTime | 默认当前时间 | 创建时间 |

---

## 七、退货模块（4 张）

### 16. `return_orders` — 退货单（供应商退货）

商品部退货给供应商，或展厅退货给商品部的退货单据。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| return_no | String(50) | 唯一, 非空 | 退货单号，格式 TH + 日期 + 序号 |
| return_type | String(30) | 非空 | to_supplier 退给供应商 / to_warehouse 展厅退给商品部 |
| product_name | String(200) | 非空 | 主商品名称 |
| return_weight | Numeric(12,4) | 非空 | 主商品退货克重 |
| from_location_id | Integer | FK→locations.id | 发起退货的位置 |
| supplier_id | Integer | FK→suppliers.id | 退给哪个供应商（退给供应商时） |
| inbound_order_id | Integer | FK→inbound_orders.id | 关联原入库单（便于追溯来源） |
| return_reason | String(50) | 非空 | 退货原因分类：质量问题/款式不符/数量差异/工艺瑕疵/其他 |
| reason_detail | Text | 可空 | 退货原因详细描述 |
| status | String(20) | 默认"draft" | draft 未确认 / confirmed 已确认 / cancelled 已取消 |
| created_by | String(50) | 可空 | 发起人 |
| created_at | DateTime | 默认当前时间 | 创建时间 |
| approved_by | String(50) | 可空 | 审批人 |
| approved_at | DateTime | 可空 | 审批时间 |
| reject_reason | Text | 可空 | 驳回原因（审批不通过时填写） |
| completed_by | String(50) | 可空 | 完成操作人 |
| completed_at | DateTime | 可空 | 完成时间 |
| images | Text | 可空 | 退货商品照片（JSON 数组存储图片 URL） |
| remark | Text | 可空 | 备注 |
| total_weight | Numeric(12,4) | 默认 0 | 总退货克重（多商品汇总） |
| total_labor_cost | Numeric(14,2) | 默认 0 | 总工费（多商品汇总） |
| item_count | Integer | 默认 1 | 退货商品数量 |
| is_audited | Boolean | 默认 False | 是否已财务审核 |
| audited_by | String(50) | 可空 | 审核人 |
| audited_at | DateTime | 可空 | 审核时间 |

### 17. `return_order_details` — 退货单明细

退货单中每一件商品的退货详情。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| order_id | Integer | FK→return_orders.id | 所属退货单 |
| product_name | String(200) | 非空 | 商品名称 |
| return_weight | Numeric(12,4) | 非空 | 退货克重 |
| labor_cost | Numeric(10,2) | 默认 0 | 克工费（元/克） |
| piece_count | Integer | 可空 | 件数 |
| piece_labor_cost | Numeric(10,2) | 可空 | 件工费（元/件） |
| total_labor_cost | Numeric(14,2) | 默认 0 | 总工费 |
| remark | Text | 可空 | 备注 |

### 18. `sales_return_orders` — 销退单（客户退货）

客户将已购商品退回的单据，退货后库存恢复。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| return_no | String(50) | 唯一, 非空 | 销退单号，格式 XT + 日期时间 |
| order_date | DateTime | 非空 | 销退日期 |
| customer_id | Integer | FK→customers.id | 退货客户ID |
| customer_name | String(100) | 非空 | 客户姓名 |
| salesperson | String(50) | 可空 | 业务员 |
| return_to | String(20) | 默认"showroom" | 退回地点：showroom 展厅 / warehouse 仓库 |
| return_reason | String(50) | 非空 | 退货原因 |
| reason_detail | Text | 可空 | 详细说明 |
| total_weight | Numeric(12,4) | 默认 0 | 退货总克重 |
| total_labor_cost | Numeric(14,2) | 默认 0 | 退货总工费 |
| remark | Text | 可空 | 备注 |
| status | String(20) | 默认"draft" | draft / confirmed / 待结算 / 已结算 |
| create_time | DateTime | 默认当前时间 | 创建时间 |
| created_by | String(50) | 可空 | 创建人 |
| operator | String(50) | 默认"系统管理员" | 操作人 |

### 19. `sales_return_details` — 销退单明细

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| order_id | Integer | FK→sales_return_orders.id | 所属销退单 |
| product_code | String(50) | 可空 | 商品编码 |
| product_name | String(200) | 非空 | 商品名称 |
| weight | Numeric(12,4) | 非空 | 退货克重 |
| labor_cost | Numeric(10,2) | 非空 | 克工费 |
| piece_count | Integer | 可空 | 件数 |
| piece_labor_cost | Numeric(10,2) | 可空 | 件工费 |
| total_labor_cost | Numeric(14,2) | 非空 | 总工费 |

---

## 八、销退结算（1 张）

### 20. `sales_return_settlements` — 销退结算单

确认客户退货后的退款方式（与结算单镜像对称）。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| settlement_no | String(50) | 唯一, 非空 | 单号，格式 XTJS + 日期 + 序号 |
| sales_return_order_id | Integer | FK→sales_return_orders.id | 关联销退单 |
| payment_method | String(20) | 非空 | cash_price 退价 / physical_gold 退料 / mixed 混合 |
| gold_price | Numeric(14,2) | 可空 | 退款时金价 |
| physical_gold_weight | Numeric(12,4) | 可空 | 退还金料克重 |
| gold_payment_weight | Numeric(12,4) | 可空 | 混合：退料部分克重 |
| cash_payment_weight | Numeric(12,4) | 可空 | 混合：退价部分克重 |
| total_weight | Numeric(12,4) | 非空 | 总克重 |
| material_amount | Numeric(14,2) | 可空 | 原料退款金额 |
| labor_amount | Numeric(14,2) | 非空 | 工费退款金额 |
| total_amount | Numeric(14,2) | 非空 | 退款总额 |
| status | String(20) | 默认"draft" | draft / confirmed / printed |
| created_by | String(50) | 可空 | 创建人 |
| confirmed_by | String(50) | 可空 | 确认人 |
| confirmed_at | DateTime | 可空 | 确认时间 |
| printed_at | DateTime | 可空 | 打印时间 |
| remark | Text | 可空 | 备注 |
| created_at | DateTime | 默认当前时间 | 创建时间 |

---

## 九、金料管理模块（8 张）

### 21. `gold_material_transactions` — 金料流转记录

记录所有黄金原料的收入（从客户收料）和支出（付给供应商）。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| transaction_no | String(50) | 唯一, 非空 | 流转单号：SL 开头=收料 / FL 开头=付料 |
| transaction_type | String(20) | 非空 | income 收入（客户交料）/ expense 支出（付给供应商） |
| settlement_order_id | Integer | FK | 关联结算单（收料场景：客户结算时交料） |
| customer_id | Integer | FK | 交料的客户ID |
| customer_name | String(100) | 可空 | 客户名称（冗余，便于查询） |
| inbound_order_id | Integer | FK | 关联入库单（付料场景：给供应商付料抵货款） |
| supplier_id | Integer | FK | 收料的供应商ID |
| supplier_name | String(100) | 可空 | 供应商名称（冗余） |
| gold_weight | Numeric(12,4) | 非空 | 金料克重 |
| status | String(20) | 默认"pending" | pending 待确认 / confirmed 已确认 / cancelled 已取消 |
| created_by | String(50) | 可空 | 创建人（结算专员/料部） |
| confirmed_by | String(50) | 可空 | 确认人（料部确认收发） |
| confirmed_at | DateTime | 可空 | 确认时间 |
| created_at | DateTime | 默认当前时间 | 创建时间 |
| receipt_printed_at | DateTime | 可空 | 收料单打印时间 |
| payment_printed_at | DateTime | 可空 | 付料单打印时间 |
| remark | Text | 可空 | 备注 |

### 22. `customer_gold_deposits` — 客户存料余额

每个客户一条记录，记录该客户在公司预存的黄金余额。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| customer_id | Integer | FK, 唯一 | 客户ID（每客户仅一条记录） |
| customer_name | String(100) | 非空 | 客户名称 |
| current_balance | Numeric(14,2) | 默认 0 | 当前存料余额（克），可用于结算时抵扣 |
| total_deposited | Numeric(14,2) | 默认 0 | 历史累计存入总量（克） |
| total_used | Numeric(14,2) | 默认 0 | 历史累计使用总量（克） |
| last_transaction_at | DateTime | 可空 | 最后一次存取交易时间 |
| created_at | DateTime | 默认当前时间 | 创建时间 |
| updated_at | DateTime | 自动更新 | 更新时间 |

### 23. `customer_gold_deposit_transactions` — 客户存料交易记录

客户存料账户的每一笔存入/使用/退还的明细流水。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| customer_id | Integer | FK | 客户ID |
| customer_name | String(100) | 非空 | 客户名称 |
| transaction_type | String(20) | 非空 | deposit 存入 / use 使用（结算抵扣）/ refund 退还 |
| gold_transaction_id | Integer | FK | 关联收料单（存入时） |
| settlement_order_id | Integer | FK | 关联结算单（使用时） |
| amount | Numeric(14,2) | 非空 | 本次交易金额（克） |
| balance_before | Numeric(14,2) | 非空 | 交易前余额 |
| balance_after | Numeric(14,2) | 非空 | 交易后余额 |
| status | String(20) | 默认"active" | active 有效 / cancelled 已取消 |
| created_at | DateTime | 默认当前时间 | 交易时间 |
| created_by | String(50) | 可空 | 操作人 |
| remark | Text | 可空 | 备注 |

### 24. `customer_transactions` — 客户往来账

客户的所有业务往来记录（销售、结算、收料、付款），用于生成对账单。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| customer_id | Integer | FK | 客户ID |
| customer_name | String(100) | 非空 | 客户名称 |
| transaction_type | String(20) | 非空 | sales 销售 / settlement 结算 / gold_receipt 收料 / payment 付款 |
| sales_order_id | Integer | FK, 可空 | 关联销售单 |
| settlement_order_id | Integer | FK, 可空 | 关联结算单 |
| gold_transaction_id | Integer | FK, 可空 | 关联金料交易 |
| amount | Numeric(14,2) | 默认 0 | 涉及金额（元） |
| gold_weight | Numeric(12,4) | 默认 0 | 涉及金料克重 |
| gold_due_before | Numeric(14,2) | 默认 0 | 本次交易前的金料欠款 |
| gold_due_after | Numeric(14,2) | 默认 0 | 本次交易后的金料欠款 |
| status | String(20) | 默认"active" | active / cancelled |
| created_at | DateTime | 默认当前时间 | 交易时间 |
| remark | Text | 可空 | 备注 |

### 25. `customer_withdrawals` — 客户取料单

客户从存料中取走黄金原料的单据。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| withdrawal_no | String(50) | 唯一, 非空 | 取料单号，格式 QL + 日期 + 序号 |
| customer_id | Integer | FK | 客户ID |
| customer_name | String(100) | 非空 | 客户名称 |
| gold_weight | Numeric(12,4) | 非空 | 取料克重 |
| withdrawal_type | String(20) | 默认"self" | self 客户自取 / deliver 送到其他公司 |
| destination_company | String(100) | 可空 | 目的地公司名称（送料时填写，如"古唐"、"鑫韵"） |
| destination_address | Text | 可空 | 目的地地址 |
| authorized_person | String(100) | 可空 | 授权取料人姓名（非客户本人取料时） |
| authorized_phone | String(20) | 可空 | 取料人联系电话 |
| status | String(20) | 默认"pending" | pending 待处理 / completed 已完成 / cancelled 已取消 |
| created_by | String(50) | 可空 | 创建人（结算专员） |
| created_at | DateTime | 默认当前时间 | 创建时间 |
| completed_by | String(50) | 可空 | 完成人（料部确认发出） |
| completed_at | DateTime | 可空 | 完成时间 |
| printed_at | DateTime | 可空 | 单据打印时间 |
| remark | Text | 可空 | 备注 |

### 26. `customer_transfers` — 客户转料单

客户之间转移存料的单据（A 客户转给 B 客户）。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| transfer_no | String(50) | 唯一, 非空 | 转料单号，格式 ZL + 日期 + 序号 |
| from_customer_id | Integer | FK | 转出客户ID |
| from_customer_name | String(100) | 非空 | 转出客户名称 |
| to_customer_id | Integer | FK | 转入客户ID |
| to_customer_name | String(100) | 非空 | 转入客户名称 |
| gold_weight | Numeric(12,4) | 非空 | 转料克重 |
| status | String(20) | 默认"pending" | pending / completed / cancelled |
| created_by | String(50) | 可空 | 创建人 |
| created_at | DateTime | 默认当前时间 | 创建时间 |
| confirmed_by | String(50) | 可空 | 确认人（料部） |
| confirmed_at | DateTime | 可空 | 确认时间 |
| printed_at | DateTime | 可空 | 打印时间 |
| remark | Text | 可空 | 备注 |

### 27. `supplier_gold_accounts` — 供应商金料账户

每个供应商一条记录，记录公司与该供应商之间的金料往来净值。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| supplier_id | Integer | FK, 唯一 | 供应商ID（每供应商一条） |
| supplier_name | String(100) | 非空 | 供应商名称 |
| current_balance | Numeric(14,2) | 默认 0 | 净金料值：**正数** = 我们欠供应商料 / **负数** = 供应商欠我们料 / **零** = 已结清 |
| total_received | Numeric(14,2) | 默认 0 | 累计从供应商收货的总克重 |
| total_paid | Numeric(14,2) | 默认 0 | 累计付给供应商的总克重 |
| last_transaction_at | DateTime | 可空 | 最后交易时间 |
| created_at | DateTime | 默认当前时间 | 创建时间 |
| updated_at | DateTime | 自动更新 | 更新时间 |

### 28. `supplier_gold_transactions` — 供应商金料交易记录

供应商金料账户的每一笔收货/付料流水。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| supplier_id | Integer | FK | 供应商ID |
| supplier_name | String(100) | 非空 | 供应商名称 |
| transaction_type | String(20) | 非空 | receive 收货（供应商发货，欠料增加）/ pay 付料（我们付料，欠料减少） |
| inbound_order_id | Integer | FK, 可空 | 关联入库单（收货时） |
| payment_transaction_id | Integer | FK, 可空 | 关联付料单（付料时） |
| gold_weight | Numeric(12,4) | 非空 | 本次交易克重 |
| balance_before | Numeric(14,2) | 非空 | 交易前账户余额 |
| balance_after | Numeric(14,2) | 非空 | 交易后账户余额 |
| status | String(20) | 默认"active" | active / cancelled |
| created_at | DateTime | 默认当前时间 | 交易时间 |
| created_by | String(50) | 可空 | 操作人 |
| remark | Text | 可空 | 备注 |

---

## 十、财务 - 应收模块（3 张）

### 29. `account_receivables` — 应收账款

记录客户欠公司的款项，每笔销售确认后自动生成。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| sales_order_id | Integer | FK | 关联销售单 |
| customer_id | Integer | FK | 欠款客户ID |
| total_amount | Numeric(14,2) | 非空 | 应收总额（元） |
| received_amount | Numeric(14,2) | 默认 0 | 已收金额（客户已付的部分） |
| unpaid_amount | Numeric(14,2) | 默认 0 | 未收金额 = 总额 - 已收 |
| credit_days | Integer | 默认 30 | 账期天数（约定的付款期限） |
| credit_start_date | Date | 非空 | 账期起算日（通常为销售确认日） |
| due_date | Date | 非空 | 到期日 = 起算日 + 账期天数 |
| overdue_days | Integer | 默认 0 | 逾期天数（超过到期日的天数） |
| status | String(20) | 默认"unpaid" | unpaid 未收 / paid 已收齐 / overdue 逾期 / cancelled 已取消 |
| is_overdue | Boolean | 默认 False | 是否已逾期 |
| salesperson | String(50) | 可空 | 负责此单的业务员 |
| store_code | String(50) | 可空 | 门店代码 |
| contract_no | String(50) | 可空 | 合同编号 |
| invoice_no | String(50) | 可空 | 发票编号 |
| expected_payment_date | Date | 可空 | 预计收款日期（催款后更新） |
| remark | Text | 可空 | 备注 |
| create_time | DateTime | 默认当前时间 | 创建时间 |
| update_time | DateTime | 自动更新 | 更新时间 |
| operator | String(50) | 默认"系统管理员" | 操作人 |
| last_updater | String(50) | 可空 | 最后更新人 |

### 30. `payment_records` — 收款记录

记录客户的每一笔付款，FIFO（先进先出）自动冲抵最早的应收账款。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| payment_no | String(50) | 唯一 | 收款单号，格式 SK + 时间戳 |
| account_receivable_id | Integer | FK, 可空 | 冲抵的应收账款（一笔收款可能冲多笔，此字段可空） |
| customer_id | Integer | FK | 付款客户ID |
| payment_date | Date | 非空 | 收款日期 |
| amount | Numeric(14,2) | 非空 | 收款总金额（元） |
| gold_amount | Numeric(14,2) | 默认 0 | 其中金款部分（元） |
| labor_amount | Numeric(14,2) | 默认 0 | 其中工费部分（元） |
| payment_method | String(20) | 非空 | 收款方式：cash 现金 / bank_transfer 银行转账 / wechat 微信 / alipay 支付宝 / card 刷卡 / check 支票 / other 其他 |
| receipt_reason | String(100) | 默认"货款" | 收款事由说明 |
| voucher_images | Text | 可空 | 收款凭证图片URL（逗号分隔） |
| bank_name | String(100) | 可空 | 付款银行名称 |
| bank_account | String(50) | 可空 | 付款银行账号 |
| transfer_no | String(100) | 可空 | 银行转账流水号 |
| action_card_id | String(50) | 可空 | 关联的协同任务卡片ID（跨角色收款确认场景） |
| actual_received_date | Date | 可空 | 实际到账日期（可能与收款日不同） |
| handling_fee | Numeric(10,2) | 默认 0 | 手续费（元） |
| exchange_rate | Numeric(10,6) | 默认 1.0 | 汇率（跨币种场景预留） |
| remark | Text | 可空 | 备注 |
| status | String(20) | 默认"confirmed" | pending / confirmed / cancelled |
| confirmed_by | String(50) | 可空 | 财务确认人 |
| confirmed_at | DateTime | 可空 | 确认时间 |
| reviewed_by | String(50) | 可空 | 复核人（结算专员） |
| operator | String(50) | 默认"系统管理员" | 操作人 |
| create_time | DateTime | 默认当前时间 | 创建时间 |
| update_time | DateTime | 自动更新 | 更新时间 |

### 31. `reminder_records` — 催款记录

对逾期应收账款的催收跟进记录。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| account_receivable_id | Integer | FK | 催收的应收账款 |
| customer_id | Integer | FK | 被催收客户ID |
| reminder_date | Date | 非空 | 催款日期 |
| reminder_person | String(50) | 非空 | 催款人姓名 |
| reminder_method | String(20) | 非空 | 催款方式：phone 电话 / wechat 微信 / visit 上门 / sms 短信 / email 邮件 / other |
| reminder_content | Text | 可空 | 催款沟通内容 |
| customer_feedback | Text | 可空 | 客户的反馈 |
| promised_payment_date | Date | 可空 | 客户承诺的付款日期 |
| promised_amount | Numeric(14,2) | 可空 | 客户承诺的付款金额 |
| next_follow_up_date | Date | 可空 | 下次跟进日期 |
| status | String(30) | 默认"pending_follow_up" | pending_follow_up 待跟进 / customer_promised 客户已承诺 / customer_refused 客户拒绝 / paid 已付 / cancelled 已取消 |
| effectiveness_score | Integer | 可空 | 催款效果评分 1-5 |
| media_url | Text | 可空 | 相关媒体文件URL |
| contact_info | String(100) | 可空 | 联系方式 |
| remark | Text | 可空 | 备注 |
| create_time | DateTime | 默认当前时间 | 创建时间 |
| update_time | DateTime | 自动更新 | 更新时间 |

---

## 十一、财务 - 应付模块（2 张）

### 32. `account_payables` — 应付账款

记录公司欠供应商的款项（工费），入库确认后自动生成。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| payable_no | String(50) | 唯一, 非空 | 应付单号，格式 YF + 日期 + 序号 |
| supplier_id | Integer | FK | 欠款供应商ID |
| inbound_order_id | Integer | FK, 可空 | 来源入库单 |
| total_amount | Numeric(14,2) | 非空 | 应付总额（工费金额） |
| paid_amount | Numeric(14,2) | 默认 0 | 已付金额 |
| unpaid_amount | Numeric(14,2) | 默认 0 | 未付金额 |
| credit_days | Integer | 默认 30 | 账期天数 |
| credit_start_date | Date | 非空 | 账期起算日（入库日期） |
| due_date | Date | 非空 | 到期日 |
| overdue_days | Integer | 默认 0 | 逾期天数 |
| status | String(20) | 默认"unpaid" | unpaid 未付 / partial 部分付 / paid 已付清 / cancelled |
| is_overdue | Boolean | 默认 False | 是否逾期 |
| remark | Text | 可空 | 备注 |
| create_time | DateTime | 默认当前时间 | 创建时间 |
| update_time | DateTime | 自动更新 | 更新时间 |
| operator | String(50) | 默认"系统管理员" | 操作人 |

### 33. `supplier_payments` — 供应商付款记录

记录公司给供应商的每一笔现金付款。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| payment_no | String(50) | 唯一, 非空 | 付款单号，格式 FK + 日期 + 序号 |
| supplier_id | Integer | FK | 收款供应商ID |
| payable_id | Integer | FK, 可空 | 冲抵的应付账款 |
| payment_date | Date | 非空 | 付款日期 |
| amount | Numeric(14,2) | 非空 | 付款金额（元） |
| payment_method | String(20) | 非空 | bank_transfer 银行转账 / cash 现金 / check 支票 / acceptance 承兑 |
| bank_account_id | Integer | FK, 可空 | 付款银行账户 |
| bank_name | String(100) | 可空 | 银行名称 |
| transfer_no | String(100) | 可空 | 转账流水号 |
| remark | Text | 可空 | 备注 |
| status | String(20) | 默认"confirmed" | pending / confirmed / cancelled |
| confirmed_by | String(50) | 可空 | 确认人 |
| confirmed_at | DateTime | 可空 | 确认时间 |
| created_by | String(50) | 默认"系统管理员" | 创建人 |
| create_time | DateTime | 默认当前时间 | 创建时间 |
| update_time | DateTime | 自动更新 | 更新时间 |

---

## 十二、财务 - 资金管理（4 张）

### 34. `bank_accounts` — 银行账户

管理公司所有资金账户（银行卡、现金、微信、支付宝等）。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| account_name | String(100) | 非空 | 账户名称，如"工商银行主账户"、"现金" |
| account_no | String(50) | 可空 | 银行账号 |
| bank_name | String(100) | 可空 | 开户银行名称 |
| account_type | String(20) | 默认"bank" | 账户类型：bank 银行 / cash 现金 / alipay 支付宝 / wechat 微信 |
| initial_balance | Numeric(14,2) | 默认 0 | 期初余额（系统上线时设定） |
| current_balance | Numeric(14,2) | 默认 0 | 当前余额（随资金流水自动更新） |
| is_default | Boolean | 默认 False | 是否默认收付款账户 |
| status | String(20) | 默认"active" | active / inactive |
| description | Text | 可空 | 账户描述 |
| remark | Text | 可空 | 备注 |
| create_time | DateTime | 默认当前时间 | 创建时间 |
| update_time | DateTime | 自动更新 | 更新时间 |
| created_by | String(50) | 默认"系统管理员" | 创建人 |

### 35. `cash_flows` — 资金流水

记录所有资金账户的每一笔进出，形成完整的资金流水账。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| flow_no | String(50) | 唯一, 非空 | 流水号，格式 LS + 日期 + 序号 |
| account_id | Integer | FK→bank_accounts.id | 涉及的资金账户 |
| flow_type | String(20) | 非空 | income 收入 / expense 支出 |
| category | String(50) | 非空 | 分类：销售收款 / 供应商付款 / 费用支出 / 其他收入 / 其他支出 |
| amount | Numeric(14,2) | 非空 | 金额（元） |
| balance_before | Numeric(14,2) | 非空 | 交易前账户余额 |
| balance_after | Numeric(14,2) | 非空 | 交易后账户余额 |
| related_type | String(50) | 可空 | 关联业务类型：payment_record / supplier_payment / expense / transfer |
| related_id | Integer | 可空 | 关联业务单据ID |
| flow_date | DateTime | 非空 | 资金发生日期 |
| counterparty | String(100) | 可空 | 交易对方名称 |
| remark | Text | 可空 | 备注 |
| created_by | String(50) | 默认"系统管理员" | 创建人 |
| create_time | DateTime | 默认当前时间 | 创建时间 |

### 36. `expense_categories` — 费用类别

管理日常费用的分类体系，支持多级分类。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| code | String(20) | 唯一, 非空 | 类别编码：rent / salary / utilities / office / transport 等 |
| name | String(50) | 非空 | 类别名称：房租 / 工资 / 水电费 / 办公用品 / 交通费 等 |
| parent_id | Integer | FK→自身.id | 父类别ID（支持多级分类树） |
| description | Text | 可空 | 类别描述 |
| sort_order | Integer | 默认 0 | 显示排序 |
| is_active | Boolean | 默认 True | 是否启用 |
| create_time | DateTime | 默认当前时间 | 创建时间 |
| update_time | DateTime | 自动更新 | 更新时间 |

### 37. `expenses` — 费用记录

记录公司的每一笔日常运营费用（房租、工资、水电等）。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| expense_no | String(50) | 唯一, 非空 | 费用单号，格式 FY + 日期 + 序号 |
| category_id | Integer | FK | 费用类别 |
| account_id | Integer | FK | 付款账户 |
| amount | Numeric(14,2) | 非空 | 费用金额（元） |
| expense_date | Date | 非空 | 费用发生日期 |
| payee | String(100) | 可空 | 收款方（如房东、电力公司） |
| payment_method | String(20) | 可空 | 支付方式 |
| attachment | String(500) | 可空 | 附件路径（发票、收据扫描件） |
| status | String(20) | 默认"pending" | pending 待审批 / approved 已通过 / rejected 已驳回 |
| approved_by | String(50) | 可空 | 审批人 |
| approved_at | DateTime | 可空 | 审批时间 |
| reject_reason | Text | 可空 | 驳回原因 |
| remark | Text | 可空 | 备注 |
| created_by | String(50) | 默认"系统管理员" | 创建人 |
| create_time | DateTime | 默认当前时间 | 创建时间 |
| update_time | DateTime | 自动更新 | 更新时间 |

---

## 十三、财务 - 其他（4 张）

### 38. `gold_receipts` — 收料单

结算专员开具的收料单据，记录从客户手中收到的黄金原料。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| receipt_no | String(50) | 唯一, 非空 | 收料单号：SL 开头（正常收料）/ QC 开头（期初金料） |
| settlement_id | Integer | FK, 可空 | 关联结算单（客户结算时交料） |
| customer_id | Integer | FK, 可空 | 交料客户ID |
| gold_weight | Numeric(12,4) | 非空 | 收料克重（克） |
| gold_fineness | String(50) | 默认"足金999" | 黄金成色 |
| is_initial_balance | Boolean | 默认 False | 是否为期初金料（系统上线时录入的历史数据） |
| status | String(20) | 默认"pending" | pending 待接收（料部未确认）/ received 已接收 |
| created_by | String(50) | 非空 | 开单人（结算专员） |
| received_by | String(50) | 可空 | 料部接收确认人 |
| received_at | DateTime | 可空 | 接收确认时间 |
| remark | Text | 可空 | 备注 |
| created_at | DateTime | 默认当前时间 | 创建时间 |
| updated_at | DateTime | 自动更新 | 更新时间 |

### 39. `reconciliation_statements` — 对账单

与客户核对往来账的对账单据。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| customer_id | Integer | FK | 对账客户ID |
| statement_no | String(50) | 唯一, 非空 | 对账单号 |
| period_start_date | Date | 非空 | 对账期间起始日 |
| period_end_date | Date | 非空 | 对账期间截止日 |
| period_description | String(100) | 可空 | 期间描述，如"2026年1月" |
| opening_balance | Numeric(14,2) | 默认 0 | 期初欠款金额 |
| period_sales_amount | Numeric(14,2) | 默认 0 | 本期销售金额 |
| period_payment_amount | Numeric(14,2) | 默认 0 | 本期收款金额 |
| closing_balance | Numeric(14,2) | 默认 0 | 期末欠款 = 期初 + 销售 - 收款 |
| sales_details | Text | 可空 | 销售明细数据（JSON 格式） |
| payment_details | Text | 可空 | 收款明细数据（JSON 格式） |
| status | String(20) | 默认"draft" | draft 草稿 / sent 已发送 / confirmed 已确认 / disputed 有争议 / archived 已归档 |
| sent_date | DateTime | 可空 | 发送给客户的时间 |
| confirmed_date | DateTime | 可空 | 客户确认时间 |
| confirmed_by | String(50) | 可空 | 确认人 |
| dispute_reason | Text | 可空 | 争议原因 |
| pdf_url | Text | 可空 | 生成的 PDF 文件 URL |
| remark | Text | 可空 | 备注 |
| create_time | DateTime | 默认当前时间 | 创建时间 |
| update_time | DateTime | 自动更新 | 更新时间 |
| operator | String(50) | 默认"系统管理员" | 操作人 |
| last_updater | String(50) | 可空 | 最后更新人 |

### 40. `customer_gold_transfers` — 客料回仓单

结算部将从客户手中收到的黄金原料转交给料部的内部单据。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| transfer_no | String(50) | 唯一, 非空 | 单号，格式 KHH + 日期 + 序号 |
| gold_weight | Numeric(12,4) | 非空 | 转交的黄金克重 |
| gold_fineness | String(50) | 默认"足金999" | 黄金成色 |
| status | String(20) | 默认"pending" | pending 待确认 / confirmed 料部已确认 / unconfirmed 料部拒绝 |
| created_by | String(50) | 非空 | 开单人（结算部） |
| create_time | DateTime | 默认当前时间 | 创建时间 |
| confirmed_by | String(50) | 可空 | 确认人（料部） |
| confirmed_at | DateTime | 可空 | 确认时间 |
| remark | Text | 可空 | 备注 |

### 41. `deposit_settlements` — 存料结价单

将客户存放的黄金按当日金价折算成现金，用于抵扣客户欠款。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| settlement_no | String(50) | 唯一, 非空 | 编号，格式 CJ + 日期 + 序号 |
| customer_id | Integer | FK | 客户ID |
| customer_name | String(100) | 非空 | 客户名称 |
| gold_weight | Numeric(12,4) | 非空 | 结价的黄金克重 |
| gold_price | Numeric(14,2) | 非空 | 当日金价（元/克） |
| total_amount | Numeric(14,2) | 非空 | 折算现金总额 = 克重 × 金价 |
| status | String(20) | 默认"draft" | draft / confirmed / cancelled |
| created_by | String(50) | 非空 | 创建人 |
| created_at | DateTime | 默认当前时间 | 创建时间 |
| confirmed_by | String(50) | 可空 | 确认人 |
| confirmed_at | DateTime | 可空 | 确认时间 |
| remark | Text | 可空 | 备注 |

---

## 十四、暂借模块（4 张）

### 42. `loan_orders` — 暂借单主表

客户临时借用商品的单据（如客户拿样品去展示）。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| loan_no | String(50) | 唯一, 非空 | 暂借单号，格式 ZJ + 日期 + 序号 |
| customer_id | Integer | FK | 借用客户ID |
| customer_name | String(100) | 非空 | 客户姓名 |
| product_name | String(200) | 可空 | 旧版单商品字段（兼容历史数据） |
| weight | Numeric(12,4) | 可空 | 旧版单商品字段 |
| labor_cost | Numeric(10,2) | 可空 | 旧版单商品字段 |
| total_weight | Numeric(12,4) | 默认 0 | 所有借出商品总克重 |
| total_labor_cost | Numeric(14,2) | 默认 0 | 所有借出商品总工费 |
| salesperson | String(50) | 非空 | 负责业务员 |
| loan_date | DateTime | 非空 | 暂借日期 |
| status | String(20) | 默认"pending" | pending 待确认 / borrowed 已借出 / partial_returned 部分归还 / returned 已全部归还 / cancelled 已撤销 |
| created_by | String(50) | 可空 | 创建人（结算专员） |
| created_at | DateTime | 默认当前时间 | 创建时间 |
| confirmed_at | DateTime | 可空 | 确认借出时间 |
| returned_at | DateTime | 可空 | 全部归还时间 |
| returned_by | String(50) | 可空 | 归还确认人 |
| cancelled_at | DateTime | 可空 | 撤销时间 |
| cancelled_by | String(50) | 可空 | 撤销操作人 |
| cancel_reason | Text | 可空 | 撤销原因（留痕审计） |
| printed_at | DateTime | 可空 | 打印时间 |
| remark | Text | 可空 | 备注 |

### 43. `loan_details` — 暂借单明细

暂借单中每一件借出商品的详情，每行可独立归还。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| loan_id | Integer | FK→loan_orders.id | 所属暂借单 |
| product_name | String(200) | 非空 | 商品名称 |
| weight | Numeric(12,4) | 非空 | 克重 |
| labor_cost | Numeric(10,2) | 非空 | 克工费 |
| piece_count | Integer | 可空 | 件数 |
| piece_labor_cost | Numeric(10,2) | 可空 | 件工费 |
| total_labor_cost | Numeric(14,2) | 非空 | 总工费 |
| status | String(20) | 默认"pending" | pending / borrowed / returned（每行独立状态） |
| returned_at | DateTime | 可空 | 此商品的归还时间 |
| returned_by | String(50) | 可空 | 归还确认人 |

### 44. `loan_returns` — 还货单

记录暂借商品归还的单据。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| return_no | String(50) | 唯一, 非空 | 还货单号，格式 HH + 日期 + 序号 |
| loan_id | Integer | FK→loan_orders.id | 归还的暂借单 |
| customer_id | Integer | 非空 | 客户ID |
| customer_name | String(100) | 非空 | 客户名称 |
| total_weight | Numeric(12,4) | 默认 0 | 本次归还总克重 |
| total_labor_cost | Numeric(14,2) | 默认 0 | 本次归还总工费 |
| operator | String(50) | 可空 | 操作人 |
| created_at | DateTime | 默认当前时间 | 创建时间 |
| remark | Text | 可空 | 备注 |
| printed_at | DateTime | 可空 | 打印时间 |

### 45. `loan_return_details` — 还货单明细

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| return_id | Integer | FK→loan_returns.id | 所属还货单 |
| loan_detail_id | Integer | FK→loan_details.id | 对应的暂借明细行 |
| product_name | String(200) | 非空 | 商品名称 |
| weight | Numeric(12,4) | 非空 | 归还克重 |
| labor_cost | Numeric(10,2) | 非空 | 克工费 |
| total_labor_cost | Numeric(14,2) | 非空 | 总工费 |

---

## 十五、商品编码（2 张）

### 46. `product_codes` — 商品编码表

管理系统中所有商品编码，支持预定义编码和自动生成编码。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| code | String(20) | 唯一, 非空 | 商品编码，如 JPJZ（预定义）、F00000001（一码一件）、FL0001（批量） |
| name | String(200) | 非空 | 商品名称 |
| code_type | String(20) | 非空 | predefined 预定义编码 / f_single F 编码（一码一件）/ fl_batch FL 编码（批量） |
| is_unique | Integer | 默认 0 | 是否唯一编码：1 = 唯一（F 编码），一个编码只能对应一件商品 |
| is_used | Integer | 默认 0 | 是否已使用：1 = 已使用（F 编码被入库后标记） |
| created_by | String(50) | 可空 | 创建人（F/FL 编码由用户创建） |
| created_at | DateTime | 默认当前时间 | 创建时间 |
| updated_at | DateTime | 自动更新 | 更新时间 |
| remark | Text | 可空 | 备注 |

### 47. `product_attributes` — 商品属性配置

管理成色、工艺、款式等下拉选项的配置表。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| category | String(50) | 非空 | 属性分类：fineness 成色 / craft 工艺 / style 款式 |
| value | String(100) | 非空 | 属性值，如"足金999"、"3D硬金"、"手镯" |
| sort_order | Integer | 默认 0 | 下拉菜单排序 |
| is_active | Boolean | 默认 True | 是否启用 |
| created_at | DateTime | 默认当前时间 | 创建时间 |
| updated_at | DateTime | 自动更新 | 更新时间 |

---

## 十六、系统/日志模块（6 张）

### 48. `chat_logs` — 对话日志

记录用户与 AI 的每一轮对话，用于数据分析和系统优化。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| session_id | String(50) | 索引 | 对话会话ID（同一次对话的多轮共享一个 session_id） |
| user_id | String(100) | 可空 | 用户ID（预留，接入登录系统后填充） |
| user_role | String(20) | 索引 | 用户角色：product / counter / settlement / sales / finance / manager |
| message_type | String(10) | — | 消息类型：user 用户消息 / assistant AI 回复 |
| content | Text | — | 消息文本内容 |
| intent | String(50) | 可空 | AI 识别出的用户意图，如"入库"、"查询库存" |
| entities | Text | 可空 | AI 提取的实体信息（JSON 格式），如商品名、克重等 |
| response_time_ms | Integer | 可空 | AI 响应耗时（毫秒），用于性能监控 |
| is_successful | Integer | 默认 1 | 此次对话是否成功处理：1 成功 / 0 失败 |
| error_message | Text | 可空 | 失败时的错误信息 |
| created_at | DateTime | 默认当前时间 | 消息创建时间 |

### 49. `chat_session_meta` — 会话元数据

存储对话会话的自定义名称等元信息。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| session_id | String(50) | 唯一, 非空 | 会话ID |
| user_id | String(100) | 可空 | 用户ID |
| user_role | String(20) | 可空 | 用户角色 |
| custom_name | String(200) | 可空 | 用户给此会话设置的自定义名称 |
| is_pinned | Integer | 默认 0 | 是否置顶：1 置顶 / 0 不置顶 |
| is_archived | Integer | 默认 0 | 是否归档：1 归档 / 0 正常 |
| created_at | DateTime | 默认当前时间 | 创建时间 |
| updated_at | DateTime | 自动更新 | 更新时间 |

### 50. `order_status_logs` — 单据状态变更日志

记录所有单据的确认/反确认等状态变更操作。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| order_type | String(30) | 非空 | 单据类型：inbound / return / sales / settlement |
| order_id | Integer | 非空 | 单据ID |
| action | String(30) | 非空 | 操作类型：confirm 确认 / unconfirm 反确认 |
| old_status | String(20) | 可空 | 操作前状态 |
| new_status | String(20) | 可空 | 操作后状态 |
| operated_by | String(50) | 可空 | 操作人 |
| operated_at | DateTime | 默认当前时间 | 操作时间 |
| remark | Text | 可空 | 备注 |

### 51. `loan_order_logs` — 暂借单操作日志

暂借单的全生命周期操作记录（留痕审计）。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| loan_order_id | Integer | FK→loan_orders.id | 关联暂借单 |
| action | String(50) | 非空 | create 创建 / confirm 确认借出 / return 归还 / cancel 撤销 |
| operator | String(50) | 非空 | 操作人 |
| action_time | DateTime | 默认当前时间 | 操作时间 |
| old_status | String(20) | 可空 | 操作前状态 |
| new_status | String(20) | 非空 | 操作后状态 |
| remark | Text | 可空 | 备注 |

### 52. `audit_logs` — 审计日志

记录系统中所有敏感操作的完整审计日志。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| user_id | String(100) | 可空 | 操作用户ID |
| user_role | String(20) | 可空 | 操作用户角色 |
| action | String(50) | 非空 | 操作类型：create / update / delete / confirm / cancel / revert / balance_change |
| entity_type | String(50) | 非空 | 操作的实体类型，如 InboundOrder、SettlementOrder |
| entity_id | Integer | 可空 | 操作的实体ID |
| old_value | Text | 可空 | 变更前的值（JSON 格式，用于回溯） |
| new_value | Text | 可空 | 变更后的值（JSON 格式） |
| ip_address | String(50) | 可空 | 操作者的 IP 地址 |
| remark | Text | 可空 | 备注 |
| created_at | DateTime | 默认当前时间 | 操作时间 |

### 53. `balance_change_logs` — 余额变动日志

专门记录金料余额和现金余额的每一次变动，便于对账和争议追溯。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| account_type | String(20) | 非空 | 账户类型：customer_gold 客户金料 / supplier_gold 供应商金料 / cash 现金 |
| account_id | Integer | 非空 | 客户ID 或供应商ID |
| account_name | String(100) | 可空 | 账户名称（客户/供应商姓名） |
| change_type | String(30) | 非空 | 变动原因：settlement 结算 / receipt 收料 / payment 付款 / withdrawal 取料 / transfer 转料 / adjustment 调整 |
| change_amount | String(20) | 非空 | 变动金额（正数增加 / 负数减少） |
| balance_before | String(20) | 非空 | 变动前余额 |
| balance_after | String(20) | 非空 | 变动后余额 |
| reference_type | String(30) | 可空 | 关联单据类型 |
| reference_id | Integer | 可空 | 关联单据ID |
| reference_no | String(50) | 可空 | 关联单据号 |
| operator | String(50) | 可空 | 操作人 |
| operator_role | String(20) | 可空 | 操作人角色 |
| remark | Text | 可空 | 备注 |
| created_at | DateTime | 默认当前时间 | 变动时间 |

---

## 十七、协同模块（2 张）

### 54. `action_cards` — 协同任务卡片

跨角色协同的任务卡片，如柜台发起收款请求→财务确认→结算复核。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| card_id | String(50) | 唯一, 非空 | 卡片唯一标识 |
| creator_id | String(50) | 非空 | 创建者的用户标识 |
| creator_role | String(20) | 非空 | 创建者的角色（如 counter 柜台） |
| target_roles | JSON | 非空 | 目标角色列表（如 ["finance", "settlement"]） |
| card_type | String(50) | 非空 | 卡片类型，如 payment_confirm（收款确认） |
| payload | JSON | 非空 | 卡片携带的业务数据（JSON 格式） |
| status | String(20) | 默认"pending" | pending 待处理 / completed 已完成 / cancelled 已取消 |
| actions_taken | JSON | 默认 [] | 已执行的操作记录列表 |
| business_result | JSON | 可空 | 操作完成后的业务结果数据 |
| session_id | String(100) | 可空 | 关联的对话会话ID |
| create_time | DateTime | 默认当前时间 | 创建时间 |
| update_time | DateTime | 自动更新 | 更新时间 |
| expire_time | DateTime | 可空 | 过期时间（超时自动关闭） |

### 55. `notifications` — 通知

任务卡片完成后推送给相关人员的闭环通知。

| 字段 | 类型 | 约束 | 用途说明 |
|------|------|------|---------|
| id | Integer | PK | 主键 |
| target_role | String(20) | 非空 | 通知目标角色 |
| target_user | String(50) | 可空 | 通知目标用户（如果指定到具体人） |
| title | String(200) | 非空 | 通知标题 |
| body | Text | 可空 | 通知正文内容 |
| card_id | String(50) | 可空 | 关联的任务卡片ID |
| notification_type | String(50) | 非空 | 通知类型，如 payment_confirmed（收款已确认） |
| is_read | Boolean | 默认 False | 是否已读 |
| create_time | DateTime | 默认当前时间 | 创建时间 |

---

## 附录：单号前缀汇总

| 前缀 | 表 | 含义 |
|------|-----|------|
| RK | inbound_orders | 入库单 |
| XS | sales_orders | 销售单 |
| JS | settlement_orders | 结算单 |
| TH | return_orders | 退货单（供应商） |
| XT | sales_return_orders | 销退单（客户） |
| XTJS | sales_return_settlements | 销退结算单 |
| TR | inventory_transfer_orders | 转移单 |
| SL | gold_material_transactions / gold_receipts | 收料单 |
| FL | gold_material_transactions | 付料单 |
| QC | gold_receipts | 期初金料 |
| QL | customer_withdrawals | 客户取料单 |
| ZL | customer_transfers | 客户转料单 |
| ZJ | loan_orders | 暂借单 |
| HH | loan_returns | 还货单 |
| SK | payment_records | 收款单 |
| FK | supplier_payments | 供应商付款单 |
| YF | account_payables | 应付账款 |
| LS | cash_flows | 资金流水 |
| FY | expenses | 费用单 |
| KHH | customer_gold_transfers | 客料回仓单 |
| CJ | deposit_settlements | 存料结价单 |

---

## 附录：状态值汇总

### 通用单据状态

| 状态值 | 含义 | 适用表 |
|--------|------|--------|
| draft | 草稿/待确认 | inbound_orders, sales_orders, settlement_orders 等 |
| confirmed | 已确认 | 大部分单据 |
| cancelled | 已取消 | 大部分单据 |
| printed | 已打印 | settlement_orders |

### 应收/应付状态

| 状态值 | 含义 |
|--------|------|
| unpaid | 未付/未收 |
| partial | 部分付款 |
| paid | 已付清/已收齐 |
| overdue | 已逾期 |

### 暂借单状态

| 状态值 | 含义 |
|--------|------|
| pending | 待确认 |
| borrowed | 已借出 |
| partial_returned | 部分归还 |
| returned | 已全部归还 |
| cancelled | 已撤销 |

### 金料交易状态

| 状态值 | 含义 |
|--------|------|
| pending | 待确认 |
| confirmed | 已确认 |
| cancelled | 已取消 |
| active | 有效（交易记录） |

---

## 附录：数据迁移建议顺序

从旧系统迁移数据时，建议按以下顺序导入（考虑外键依赖）：

```
第一批 — 基础数据（无外键依赖）：
  ① locations          → 仓库/位置
  ② suppliers          → 供应商
  ③ customers          → 客户
  ④ salespersons       → 业务员
  ⑤ product_codes      → 商品编码
  ⑥ product_attributes → 商品属性
  ⑦ bank_accounts      → 银行账户
  ⑧ expense_categories → 费用类别

第二批 — 入库数据（依赖供应商）：
  ⑨ inbound_orders     → 入库单
  ⑩ inbound_details    → 入库明细
  ⑪ inventory          → 库存汇总
  ⑫ location_inventory → 分仓库存

第三批 — 销售数据（依赖客户）：
  ⑬ sales_orders       → 销售单
  ⑭ sales_details      → 销售明细
  ⑮ settlement_orders  → 结算单

第四批 — 金料数据（依赖客户+供应商）：
  ⑯ customer_gold_deposits             → 客户存料余额
  ⑰ supplier_gold_accounts             → 供应商金料账户
  ⑱ gold_material_transactions         → 金料流转记录
  ⑲ customer_gold_deposit_transactions → 客户存料交易
  ⑳ supplier_gold_transactions         → 供应商金料交易

第五批 — 财务数据（依赖销售单+客户+供应商）：
  ㉑ account_receivables    → 应收账款
  ㉒ payment_records        → 收款记录
  ㉓ account_payables       → 应付账款
  ㉔ supplier_payments      → 供应商付款

第六批 — 其他业务数据：
  ㉕ return_orders + details    → 退货单
  ㉖ sales_return_orders        → 销退单
  ㉗ loan_orders + details      → 暂借单
  ㉘ customer_withdrawals       → 取料单
  ㉙ customer_transfers         → 转料单
  ㉚ expenses                   → 费用记录
  ㉛ cash_flows                 → 资金流水
  ㉜ reconciliation_statements  → 对账单
```
