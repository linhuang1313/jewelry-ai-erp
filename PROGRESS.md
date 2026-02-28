# PROGRESS.md — 珠宝 AI-ERP 项目进度存档

> 最后更新：2026-02-26（第十次对话结束存档）
> 维护者：AI CTO
> 规则：每次对话开始前静默读取，结束前更新

---

## [Done] 已完成功能

### 核心业务模块
- [x] 入库管理：单品入库、批量入库、Excel/CSV 导入、镶嵌类入库、确认/反确认
- [x] 销售管理：创建销售单、确认/反确认、库存扣减
- [x] 退库管理：退给供应商、退给商品部、退货确认、库存回滚（原"退货管理"，第五次对话重命名）
- [x] 结算管理：结价/结料/混合支付三种模式、创建/确认/取消/撤销/打印
- [x] 金料管理：收料（客户来料）、付料（给供应商）、提料（客户取料）、转料
- [x] 仓库管理：多位置库存（商品部/展厅）、库存转移、转移确认
- [x] 暂借管理：创建暂借单、确认借出、归还、件工费、商品编码显示
- [x] 销退管理：销售退货、库存恢复

### 人员管理
- [x] 客户管理：CRUD、往来账目、金料存料余额、模糊搜索
- [x] 供应商管理：CRUD、供货统计、金料账户
- [x] 业务员管理：CRUD
- [x] 商品编码管理：预定义编码、F/FL 编码

### 财务模块
- [x] 应收账款管理：自动生成（结算确认时）、状态追踪
- [x] 收款登记：手动登记、AI 对话登记、收款凭证 OCR 识别
- [x] 应付账款管理：供应商付款
- [x] 对账单生成：PDF 导出
- [x] 催款管理：催款记录
- [x] 收款自动化：ActionCard 确认 → 收据自动生成 → FBL 凭证自动创建（未记账状态）
- [x] FBL 凭证系统集成：`fbl_voucher_service.py` 连接外部财务数据库（`gl_doc`/`gl_entry`/`gl_auxiliaryinfo`）

### AI 能力
- [x] 自然语言解析：DeepSeek 意图识别（第六次对话移除正则兜底，纯 AI 解析）
- [x] AI 对话入库/销售/退货/查询/收款/金料/结算/暂借/对账/凭证/报销操作
- [x] 流式响应（SSE）
- [x] 百度 OCR 集成：入库单图片识别、收款凭证识别（严格 1 元误差校验）
- [x] 行为决策日志：pgvector 向量存储 + 相似决策检索
- [x] 上下文管理器：会话状态持久化（JSON 文件）、知识库注入
- [x] 业务知识库：knowledge_base.md 完整操作手册
- [x] 跨角色 Agentic 任务协同：@角色检测 + AI 解析 + ActionCard（3 种类型）+ 多角色确认 + 自动平账

### 前端
- [x] 40+ 页面组件，覆盖所有业务模块
- [x] 响应式设计（桌面/移动端）
- [x] 中英文国际化
- [x] 图片上传 OCR 入口（聊天界面 + 收款对话框）
- [x] Excel 导入/导出
- [x] PDF 导出（对账单、标签）
- [x] @角色 MentionPopup 弹窗 + ActionCardRenderer 交互卡片（3 种类型：payment/settlement/withdrawal）
- [x] 系统内嵌帮助指南（HelpGuide 抽屉组件，按角色显示操作指南）

### 基础设施
- [x] Railway 部署配置
- [x] PostgreSQL + pgvector 数据库
- [x] CORS 配置
- [x] 角色权限系统（6 种角色）
- [x] 审计日志
- [x] 基于文件的记忆系统：.cursorrules（项目宪法）+ PROGRESS.md（进度存档）
- [x] 阿里云服务器部署（前端 Vite + 后端 uvicorn）

### 第一次对话完成的修复（2026-02-21）

#### 权限修复
- [x] 结算专员增加客户收款权限（前端 permissions.js + 后端 permissions.py）
- [x] 确认结算单接口增加 user_role 参数和权限检查（settlement.py confirm_settlement_order）

#### 结算单金料扣减时机修复（settlement.py，核心修改）
- [x] 创建结算单时移除金料扣减（draft 状态不影响客户账户）
- [x] 确认结算单时增加金料扣减逻辑（confirmed 时才扣减）
- [x] 混合支付少付差额处理：少付部分记为金料欠款（额外扣减 + 独立交易记录）
- [x] 取消结算单简化：draft 状态取消无需回滚金料（因为没扣过）
- [x] 修改结算单简化：draft 状态修改无需回滚/补扣金料
- [x] 撤销结算增强：查找所有关联扣减记录（正常结料 + 少付差额）逐条回滚

#### 金额计算修复
- [x] 修改结算单时混合支付 material_amount 计算错误修复：`total_weight * gold_price` → `cash_payment_weight * gold_price`

#### 功能缺陷修复
- [x] 已取消结算单不再阻止重新创建（查询排除 cancelled 状态）
- [x] chat_handlers.py 中 `receivable_no` 属性错误修复（改为 `receivable.id` + `receivable.sales_order_id`）

### 第二次对话完成的修复（2026-02-21）

#### 数据迁移兼容性修复
- [x] JSON 序列化 NaN/Infinity 修复：全局 SafeJSONResponse + sanitize_floats 工具函数
- [x] 结算单一览 500 错误修复：Pydantic schema 字段改 Optional，NULL 值防护
- [x] 结算单确认 500 错误修复：typo 修正 + try-except 包裹
- [x] 客户详情"暂无销售记录"修复：放宽 status 过滤条件
- [x] 客户"累计购买 ¥0.00"修复：新增 recalculate-stats API + merge-duplicates API
- [x] 备注中供应商敏感信息过滤：正则过滤 `[实出供应商...]` 内容

#### 分页功能
- [x] 结算单一览分页（后端 page/page_size + 前端分页控件）
- [x] 销售单一览分页（后端 + 前端，支持 78000+ 条记录）
- [x] 供应商列表分页（后端 + 前端）

#### 高并发防护
- [x] 关键操作加行级锁 `SELECT ... FOR UPDATE`（结算确认/撤销、销售确认/反确认）

### 第三次对话完成的修复（2026-02-21）

#### 安全加固 — 速率限制（slowapi）
- [x] 安装 slowapi，配置全局 Limiter（main.py）
- [x] AI 聊天接口限速 10/min（chat.py: /api/chat, /api/chat-stream）
- [x] 导出接口限速 10/min（export.py: 全部 13 个端点）

#### 安全加固 — 后端权限强制执行
- [x] 创建 `backend/app/dependencies/auth.py`（get_current_role + require_permission 依赖注入）
- [x] 前端 api.ts 自动发送 X-User-Role Header
- [x] 所有 user_role 默认值从 "manager" 改为 "sales"（最小权限原则）
- [x] 10 个路由文件 42 个写入端点添加 require_permission 检查：
  - sales.py: confirm/unconfirm/update → can_create_sales
  - settlement.py: create/confirm/revert → can_create_settlement
  - inbound.py: create/batch/confirm → can_inbound
  - finance.py: record_payment/supplier_payment → can_record_payment / can_record_supplier_payment
  - warehouse.py: create/batch/receive/confirm transfer → can_transfer / can_receive_transfer
  - gold_material.py: create receipt/payment/confirm → can_create_gold_receipt / can_create_gold_payment / can_confirm_gold_receive
  - customers.py: create/update/delete/batch_import → can_manage_customers / can_delete
  - suppliers.py: create/update/delete → can_manage_suppliers / can_delete
  - data_cleanup.py: 全部 6 个端点 → can_delete
  - export.py: 全部 13 个端点 → can_export

### 第四次对话完成的修复（2026-02-21）

#### 异常处理规范化
- [x] 全部 bare `except: pass` 改为 `except (ValueError, TypeError): pass`（8 个文件 30+ 处）
- [x] 涉及文件：settlement.py, sales.py, inbound.py, suppliers.py, export.py, customers.py, fbl_finance.py, finance.py, ai_analyzer.py

#### context_manager 完全接入 chat 路由
- [x] 失败的写操作记录到上下文（非流式 + 流式端点）
- [x] 查询/分析结果记录到上下文（流式端点）
- [x] chat.py 中 `ctx.append_action` 调用从 2 处增加到 5 处

#### 前端确认按钮防重复点击
- [x] SettlementPage.tsx：确认结算 + 确认销退按钮（loading + disabled）
- [x] SalesOrdersPage.tsx：确认按钮（2 处）
- [x] InboundOrdersPage.tsx：确认入库按钮
- [x] SalesReturnPage.tsx：确认退货 + 确认结算按钮

### 第五次对话完成的功能与修复（2026-02-22）

#### 跨角色 Agentic 任务协同（全栈，核心新功能）
- [x] ActionCard + Notification 数据模型（`models/__init__.py`）
- [x] ActionCard API：创建/查询/执行/待办列表（`chat.py`）
- [x] card_executor 平账逻辑：所有角色确认 → 自动写入应收账款 + 金料账户（`services/card_executor.py` 新建）
- [x] @角色检测（`_detect_role_mentions` 正则）+ DeepSeek AI 解析（`_ai_parse_collaboration_message`）
- [x] DeepSeek 同步调用 → `asyncio.to_thread` + 15s timeout，防止阻塞事件循环
- [x] @角色协同整体 try-except 兜底，确保错误消息始终返回
- [x] ActionCardRenderer 前端组件（`components/chat/cards/ActionCardRenderer.jsx` 新建）
- [x] MentionPopup @角色弹窗（`ChatView.jsx`），支持键盘导航 + 鼠标点击
- [x] ChatView SSE 流中 `interactive_card` 类型渲染
- [x] 铃铛待办列表入口（`Header.jsx`）

#### 数据迁移兼容性修复
- [x] 客户销售数据查询改用 `customer_id` 优先 + `customer_name` 兜底（`customers.py`、`export.py`）
- [x] 销售单客户搜索下拉框：集成 `FilterSearchSelect` 组件（`SalesOrdersPage.tsx`）

#### 分页功能（续）
- [x] 销退单分页（`sales_returns.py` + `SalesReturnPage.tsx`）
- [x] 借货单分页（`loan.py` + `LoanPage.tsx`）
- [x] 还货单分页（`loan.py` + `LoanPage.tsx`）

#### 暂借单功能增强
- [x] 件工费字段：`piece_count` + `piece_labor_cost`（模型/Schema/表单/展示/数据库自动迁移）
- [x] 商品编码显示：列表视图 + 详情弹窗（`ProductCode` 表关联查询）

#### 收款凭证上传优化
- [x] 上传后仅预览不自动发送，用户可在输入框补充文字后一起发送（`App.jsx` + `ChatView.jsx`）
- [x] 发送按钮在有附件时也可点击（即使无文字）
- [x] 用户消息气泡支持显示附带图片

#### UI 重命名
- [x] "退货管理" → "退库管理"（`zh.json`、`Header.jsx`、`QuickReturnModal.tsx`、`config.js`）

#### Bug 修复（8 项）
- [x] `ReturnPage.tsx` `stats.total_completed_weight` 为 null 时 `.toFixed()` 崩溃 → `?? 0` 防护
- [x] `SettlementPage.tsx` `physical_gold_weight` 为 null 显示 `nullg` → `?? 0` 防护
- [x] `chat_helpers.py` `is_successful` PostgreSQL Integer vs Python bool 类型不匹配 → 显式转 int
- [x] `chat.py` DeepSeek 同步调用阻塞 SSE 事件循环 → `asyncio.to_thread` + timeout
- [x] `chat.py` @角色协同处理无兜底 → 整体 try-except + 错误消息返回
- [x] `ChatView.jsx` @mention 弹窗点击无效（mousedown 事件提前关闭弹窗）→ `mentionPopupRef` 排除
- [x] `chat.py` / `export.py` 全角字符导致 SyntaxError → 替换为半角
- [x] `export.py` 嵌套 f-string / 参数顺序错误 → 修正

### 第六次对话完成的功能与修复（2026-02-22 ~ 2026-02-23）

#### ActionCard 安全审计与加固
- [x] 事务安全（审查项1）：`card_executor.py` 的 `execute_action_card` 已有 try-except + `db.rollback()` 保护
- [x] 多模态风控（审查项3）：OCR 金额与口述金额严格 1 元误差校验、无截图/OCR 失败直接拦截卡片创建
- [x] 权限校验（审查项2）：后端 `/execute` 路由已通过 `has_permission` 校验角色权限
- [x] 并发防护（审查项4）：`with_for_update()` + 状态前置检查防止重复执行

#### 收款自动化全链路（ActionCard → 收据 → FBL 凭证）
- [x] 收款确认后自动更新客户款料表（`card_executor.py`）
- [x] 自动生成 `PaymentRecord` 收据（含收据编号 SK+日期+微秒序号）
- [x] 自动在 FBL 凭证系统创建"未记账"收款凭证（`fbl_voucher_service.py` 新建）
- [x] FBL ID 生成改用 `pg_advisory_xact_lock` 原子锁，修复 P0 竞态条件
- [x] 金额明细校验：`gold_amount + labor_amount` 与 `total_amount` 自动校正（P1 修复）
- [x] FBL 往来单位（`aa_partner`）不自动创建，找不到返回错误

#### 自然语言功能扩展（6 个新聊天动作）
- [x] 创建结算单（`handle_create_settlement`）— 通过聊天直接创建
- [x] 查询结算单（`handle_query_settlement`）— 按单号/客户/日期范围查询
- [x] 创建暂借单（`handle_create_loan`）— 客户+商品+克重解析
- [x] 归还暂借（`handle_loan_return`）— 自动匹配借出记录
- [x] 查询暂借单（`handle_query_loan`）— 按单号/客户查询
- [x] 查询对账单（`handle_reconciliation`）— 按客户+月份生成
- [x] 查询 FBL 凭证（`handle_query_voucher`）— 按类型/日期/关键词查询
- [x] 费用报销（`handle_expense`）— 提交报销请求

#### 协同卡片类型扩展（settlement_confirm + withdrawal_confirm）
- [x] 结算确认卡片：`chat.py` AI 解析 + `card_executor.py` 自动创建结算单
- [x] 提料确认卡片：`chat.py` AI 解析 + `card_executor.py` 自动扣减客户金料
- [x] `ActionCardRenderer.jsx` 支持三种卡片类型的差异化渲染

#### 结算确认卡片前置验证优化
- [x] 卡片创建前验证客户是否存在
- [x] 卡片创建前验证是否有已确认/待结算的销售单
- [x] 卡片创建前验证是否已有结算单（防重复）
- [x] 结价方式必须提供金价，否则阻止卡片创建
- [x] `payload` 中携带 `sales_order_id`，执行时优先使用（防止延迟期间数据变化）

#### 去正则化 — AI 纯智能解析
- [x] 移除 `_parse_payment_amounts`（~10 个正则模式）
- [x] 移除 `_extract_customer_name`（~5 个正则模式）
- [x] AI 解析失败不再降级到正则猜测，直接返回错误提示用户重试

#### 并发锁加固（行级锁 `with_for_update()`）
- [x] `loan.py` — 确认借出锁定暂借单 + 库存行
- [x] `loan.py` — 创建还货锁定暂借单
- [x] `inbound.py` — 确认入库锁定入库单 + 库存行

#### 前端 Bug 修复
- [x] `CustomerPage.tsx` 借/还记录 Tab 崩溃修复 — `ordersData.data.orders` 正确提取数组
- [x] 客户"累计购买 ¥0.00" — 引导使用 `/api/customers/recalculate-stats` API 修复

#### 依赖清理
- [x] `requirements.txt` 移除未使用的 `anthropic>=0.7.0` 依赖

#### 角色使用指南（帮助系统）
- [x] `docs/USER_GUIDES.md` — 7 个角色完整使用指南 + 通用操作 + FAQ
- [x] `frontend/src/components/HelpGuide.jsx` — 系统内嵌帮助抽屉组件（按角色显示）
- [x] `frontend/src/components/layout/Header.jsx` — 右上角 `?` 帮助按钮入口

### 第七次对话完成的功能与修复（2026-02-23 ~ 2026-02-24）

#### AI 驱动查询引擎（核心架构升级）
- [x] `backend/app/query_engine.py` — 新建，AI 动态生成 JSON 查询计划 + ORM 安全执行 + AI 结果摘要
- [x] `backend/app/routers/chat.py` — 集成查询引擎路径（查询/分析意图走新引擎，操作类走旧路径）
- [x] `backend/app/ai_prompts.py` — `_fallback_classify` 接收 `conversation_history` 支持追问上下文
- [x] `backend/app/ai_parser.py` — `parse_user_message` 传递 `conversation_history` 给 `pre_classify`
- [x] `backend/app/ai_analyzer.py` — 客户查询智能过滤（按名称或限制 50）、中文 token 估算优化

#### AI 上下文管理修复
- [x] `chat.py` 对话历史查询从 `ChatLog.user_role` 改为 `ChatLog.session_id`（修复跨会话上下文污染）
- [x] `_fallback_classify` 和 `pre_classify` 接收并使用 `conversation_history`（修复追问被分类为"闲聊"）

#### 结算金价验证修复
- [x] `settlement.py` — `gold_price < 0` 拒绝、结价/混合支付要求 `gold_price > 0`、结料模式 `material_amount` 修正为 0

#### 前端 console.log 清理
- [x] `useChatStream.js` — 移除 28 处 `console.log`/`console.warn`
- [x] `SystemMessage.jsx` — 移除 15 处 `console.log`
- [x] `SettlementPage.tsx` — 移除 13 处 `console.log`
- [x] `JewelryInboundCard.tsx` — 移除 12 处 `console.log`
- [x] `WarehousePage.tsx` — 移除冗余 `console.error`

#### 前端统一错误处理
- [x] `frontend/src/utils/api.ts` — 新增 `handleApiError()` 统一错误处理工具函数、移除内部 `console.error`

#### 经理仪表盘数据补全
- [x] `backend/app/routers/analytics.py` — dashboard-summary 新增 `loan.outstanding_weight`（暂借克重统计）
- [x] `frontend/src/components/ManagerDashboardPage.tsx` — "暂借克重"卡片从占位符改为实际数据

#### 后端性能优化 — 序号生成并发锁（6 处）
- [x] `loan.py` — `generate_loan_no()` / `generate_return_no()` 加 `with_for_update()` + 碰撞检测 + 重试
- [x] `action_card.py` — `_generate_card_id()` 加 `with_for_update()` + 碰撞检测 + 重试
- [x] `finance.py` — 新增 `_generate_safe_no()` 通用函数，替换 6 处内联序号生成（付款单 FK、费用单 FY、流水号 LS×4）

#### 后端性能优化 — DeepSeek API 超时保护（5 处）
- [x] `ai_parser.py` — OpenAI client `timeout=60.0`（主客户端，被 ai_analyzer/query_engine 复用）
- [x] `services/behavior_logger.py` — DeepSeek LLM `timeout=60.0`、阿里云 Embedding `timeout=30.0`
- [x] `baidu_ocr.py` — DeepSeek client `timeout=60.0`
- [x] `services/prompt_optimizer.py` — DeepSeek client `timeout=60.0`

#### 后端性能优化 — 数据库索引（13 个新索引）
- [x] `models/__init__.py` — 7 个 `created_at` 字段加 `index=True`（SettlementOrder, InventoryTransferOrder, GoldMaterialTransaction, CustomerTransaction, LoanOrder, LoanReturn, SalesReturnSettlement）
- [x] `models/finance.py` — 6 个字段加 `index=True`（AccountReceivable.due_date, AccountPayable.due_date, AccountPayable.create_time, SupplierPayment.create_time, CustomerGoldTransfer.create_time, DepositSettlement.created_at）
- [x] `alembic/versions/001_add_indexes_on_frequently_queried_columns.py` — Alembic 迁移脚本

#### 前端交互优化 — 替换 window.confirm()（12 个文件，23 处）
- [x] `CustomerPage.tsx` — 删除客户确认弹窗
- [x] `SupplierPage.jsx` — 删除供应商确认弹窗
- [x] `SalespersonPage.tsx` — 删除业务员确认弹窗
- [x] `ProductCodePage.tsx` — 删除品名/属性确认弹窗（2 处）
- [x] `VoucherManagement.jsx` — 删除/记账/反记账/批量记账确认弹窗（4 处）
- [x] `FinanceSettings.jsx` — 删除设置确认弹窗
- [x] `FinanceAdminManagement.jsx` — 删除管理员确认弹窗
- [x] `LabelDesignPage.tsx` — 删除模板/元素确认弹窗（2 处）
- [x] `design/ProjectSidebar.jsx` — 删除项目确认弹窗
- [x] `FinanceClosing.jsx` — 结账/反结账确认弹窗（2 处）
- [x] `LoanPage.tsx` — 确认借出确认弹窗
- [x] `SettlementPage.tsx` — 确认/取消/撤销结算确认弹窗（6 处）

#### 前端交互优化 — 分析页面空状态（3 个 Tab）
- [x] `SalesAnalysisTab.tsx` — 业务员/客户表格空数据提示
- [x] `InventoryAnalysisTab.tsx` — 库存周转/产品价值等表格空数据提示
- [x] `FinanceAnalysisTab.tsx` — 供应商成本等表格空数据提示

#### 前端交互优化 — 搜索式下拉选择器
- [x] `frontend/src/components/ui/AsyncSearchSelect.tsx` — 新建，通用异步搜索选择组件（防抖 300ms + 下拉 + loading + 清除）
- [x] `LoanPage.tsx` — 客户选择从 `page_size=9999` 改为 AsyncSearchSelect（`page_size=50`）
- [x] `modals/QuickWithdrawalModal.jsx` — 客户选择从 `page_size=500` 改为 AsyncSearchSelect
- [x] `modals/QuickReceiptModal.jsx` — 客户选择从 `page_size=500` 改为 AsyncSearchSelect

#### 前端交互优化 — 移动端响应式（5 个页面）
- [x] `VoucherManagement.jsx` — 筛选栏网格断点 + 主表格 `overflow-x-auto` + 弹窗表单网格
- [x] `FinanceReports.jsx` — 利润摘要/账户余额/期间选择器网格断点优化
- [x] `WarehousePage.tsx` — 表单网格 `grid-cols-2` + 5 个转移单明细表 `overflow-x-auto`
- [x] `SettlementPage.tsx` — 收款记录表 `min-w-[600px]`
- [x] `GoldMaterialPage.tsx` — 摘要/余额网格断点 + 主表格 `min-w-[600px]`

---

## [WIP] 进行中 / 半完成

### 上下文工程（context_manager.py 已有框架，未完全接入）
- [x] 会话状态持久化：框架完成，chat 路由已完全接入（第四次对话修复）
- [~] 阶段管理（task_phases）：代码已写，但无业务场景触发
- [x] 错误痕迹保留：append_action 已在 chat.py 中统一调用（成功+失败均记录）
- [x] AI 对话上下文：conversation_history 按 session_id 过滤 + 传递给 pre_classify（第七次对话修复）
- [ ] 上下文压缩/摘要：当 completed_actions 过长时无自动裁剪机制

### 行为学习系统（behavior_logger.py）
- [~] 决策记录：已在 settlement、inbound、chat_handlers 中埋点
- [~] 相似决策检索：已实现两阶段检索（客户级 → 全局）
- [ ] 用户纠正反馈闭环：用户修改 AI 建议后，未将纠正写回向量库
- [ ] 决策质量评估：无机制评估历史决策的准确性

### OCR 解析映射
- [~] 百度 OCR 文字识别：完成（4 种识别模式）
- [~] OCR → 结构化数据：依赖 DeepSeek 解析，无规则引擎兜底
- [ ] 表格 OCR 到入库字段的精确映射（如识别"克重"列、"工费"列）
- [ ] 多页/多表格识别支持

### 结算管理迁移数据显示不完整
- [ ] `SettlementOrder` 缺少 `customer_name` 冗余字段，旧 `sales_order_id` 无法关联新系统 `SalesOrder`
- [ ] `import_sales_xlsx.py` 硬编码 `total_weight=0.0`、`material_amount=0.0`，导致迁移数据克重和金额显示为 0
- [ ] 需要数据修复/重导入，或添加 `customer_name` 字段 + 回填脚本

### 前端下拉选择器优化（部分完成）
- [x] `LoanPage.tsx`、`QuickWithdrawalModal.jsx`、`QuickReceiptModal.jsx` 已改为 AsyncSearchSelect
- [ ] `SettlementPage.tsx`（page_size=500）、`SalesOrdersPage.tsx`（page_size=9999）、`GoldMaterialPage.tsx`（page_size=500）、`App.jsx`（page_size=500）、`QuickOrderModal.tsx`（page_size=500）— 模式更复杂，待后续替换

### 数据导入架构一致性（第十次对话识别并部分修复）
- [x] 仓库导入（`import_inventory_xlsx.py`）创建 `InboundOrder` + `InboundDetail` — 展开行有完整明细
- [x] 展厅导入（`import_showroom_inventory.py`）现已同步创建 `InboundOrder` + `InboundDetail`（第十次对话修复）
- [x] 展厅历史数据已通过 `backfill_showroom_details.py` + 远程数据库直连补全（817 条记录）
- [~] 两种导入脚本的 operator 标识不同：仓库=`"Excel批量导入"`，展厅=`"展厅Excel导入"`
- [ ] 未来新增导入方式时，必须同时创建 `InboundDetail` 记录，否则库存展开行无明细

### 前端 window.confirm() 替换（部分完成）
- [x] 12 个文件 23 处已替换为 ConfirmationDialog
- [ ] `ChatView.jsx`、`SystemMessage.jsx`、`SalesOrdersPage.tsx`、`QuickOrderModal.tsx`、`ChatHistoryPanel.jsx` — 内联 onClick 中的 confirm() 模式更复杂，待后续替换

### Cursor Rules 持久化（第十次对话新增）
- [x] `.cursor/rules/infra-config.mdc` — 远程数据库连接 + 服务器 SSH 信息
- [ ] 数据导入架构知识规则（两种导入脚本差异、InboundOrder.status 取值、operator 标识）
- [ ] 远程操作指南规则（Cursor 沙箱限制、Python paramiko/sqlalchemy 直连方式）

---

## [Pending] 待开发

### 安全与鉴权
- [ ] 用户认证系统（登录/注册/JWT Token）— 当前仅靠前端 localStorage 存角色
- [x] ~~API 接口鉴权中间件~~ → 已通过 require_permission 依赖注入实现后端权限强制执行
- [x] ~~速率限制~~ → 已通过 slowapi 实现（AI 聊天 + 导出接口）
- [ ] `fbl_finance.py` 25 个写入接口无权限控制（P0，第六次对话识别）
- [ ] `loan.py` 写入接口未使用已导入的权限检查（P1，第六次对话识别）
- [ ] `chat_history.py` 无权限检查（P2，第六次对话识别）
- [ ] 操作审计增强（谁在什么时间做了什么操作的完整链路）
- [ ] 敏感数据加密（客户手机号、金额等）

### 数据完整性
- [ ] 数据库外键约束增强（部分外键缺失 ON DELETE 策略）
- [x] ~~并发控制~~ → 关键操作已加行级锁 SELECT ... FOR UPDATE（含 loan/inbound 第六次对话补充）
- [ ] 数据备份与恢复机制（PostgreSQL 备份策略待确认）

### 安全漏洞
- [ ] `fbl_finance.py` 多处 f-string 拼接 SQL（P1 SQL 注入风险，第六次对话识别）
- [ ] 依赖版本未锁定（P2，`requirements.txt` 部分包无 `==` 固定版本）

### 报表与分析
- [ ] 日/周/月销售报表自动生成
- [ ] 库存预警（低库存、滞销品）
- [ ] 供应商绩效分析
- [ ] 利润分析（按商品/客户/时间维度）

### AI 增强
- [x] ~~多轮对话上下文优化~~ → 已完成（第七次对话：session_id 过滤 + conversation_history 传递 + AI 驱动查询引擎）
- [ ] AI 建议置信度展示（让用户知道 AI 有多确定）
- [ ] 异常检测（如异常大额交易、异常退货频率）
- [ ] 智能定价建议（基于历史数据和市场金价）

### 前端体验
- [x] ~~确认按钮防重复点击~~ → 已完成（4 个页面 6 个按钮，loading+disabled 保护）
- [x] ~~window.confirm() 替换~~ → 大部分完成（12 个文件 23 处，剩余 5 个复杂文件待后续处理）
- [x] ~~分析页面空状态~~ → 已完成（3 个 Tab 所有表格加空数据提示）
- [x] ~~移动端响应式~~ → 已完成（5 个页面表格 overflow-x-auto + 网格断点优化）
- [ ] 数字输入框 `min="0"` 验证（50+ 处，防止输入负数）
- [ ] 离线模式 / PWA 支持
- [ ] 操作撤销（Ctrl+Z）
- [ ] 批量操作优化（批量确认、批量打印）

### 后端性能
- [ ] 查询加 LIMIT（80+ 处 `.all()` 无限制加载，数据量大后会慢）
  - 重灾区：analytics.py（Inventory 全表扫描 7 次）、customers.py（15+ 处）、gold_material.py（20+ 处）、export.py（ChatLog 全表）、finance_service.py（7 处）

---

## 技术债务

| 问题 | 严重度 | 位置 | 状态 |
|------|--------|------|------|
| 无用户认证，角色仅存 localStorage | 高 | 全局 | 待修复 |
| `fbl_finance.py` 25 个写入接口无权限控制 | P0 | `fbl_finance.py` | 待修复（第六次对话识别） |
| `fbl_finance.py` 多处 f-string 拼接 SQL | P1 | `fbl_finance.py` | 待修复（SQL 注入风险，第六次对话识别） |
| `loan.py` 写入接口未使用已导入的权限检查 | P1 | `loan.py` | 待修复（第六次对话识别） |
| 80+ 处 `.all()` 查询无 LIMIT | 中 | analytics/customers/gold_material/export/finance_service | 待修复（第七次对话识别，数据量大后性能风险） |
| 50+ 处数字输入框缺少 `min="0"` | 中 | SettlementPage/InboundOrdersPage/GoldMaterialPage 等 | 待修复（第七次对话识别，可输入负数） |
| 5 个文件 confirm() 未替换 | 低 | ChatView/SystemMessage/SalesOrdersPage/QuickOrderModal/ChatHistoryPanel | 待修复（第七次对话识别，内联 onClick 模式复杂） |
| 7 个页面下拉选择器仍用大 page_size | 中 | SettlementPage/SalesOrdersPage/GoldMaterialPage/App.jsx/QuickOrderModal 等 | 待修复（第七次对话识别） |
| 依赖版本未锁定 | P2 | `requirements.txt` | 待修复（部分包无 `==` 固定版本） |
| `chat_history.py` 无权限检查 | P2 | `chat_history.py` | 待修复（第六次对话识别） |
| 结算单迁移数据缺客户名/克重/金额 | 中 | `import_sales_xlsx.py` + `SettlementOrder` 模型 | 待修复（需数据修复/重导入） |
| SettlementOrder 无 customer_name 冗余字段 | 中 | `models/__init__.py` | 待修复（需加字段+回填） |
| PostgreSQL 备份策略 | 中 | 运维 | 待确认（第六次对话识别） |
| 新增导入方式须同步创建 InboundDetail | 中 | 导入脚本 | 架构约束（第十次对话识别，否则库存展开行无明细） |
| ~~展厅导入不创建 InboundDetail~~ | ~~中~~ | ~~import_showroom_inventory.py~~ | **已修复 2026-02-26（增加 InboundOrder+InboundDetail 创建）** |
| ~~展厅库存展开行无明细数据~~ | ~~中~~ | ~~inventory_maintenance.py + 前端~~ | **已修复 2026-02-26（product_codes 回退 + 数据补全 817 条）** |
| ~~InboundOrder.status 过滤遗漏 completed~~ | ~~中~~ | ~~inventory_maintenance.py~~ | **已修复 2026-02-26（改为 in\_(['confirmed','completed'])）** |
| ~~导入脚本手动指定 ID 导致重复~~ | ~~P0~~ | ~~导入脚本~~ | **已修复 2026-02-25（Bug #31: setval + nextval）** |
| ~~product_codes 脏数据（空格/NULL）~~ | ~~中~~ | ~~product_codes 表~~ | **已修复 2026-02-25（启动时 TRIM + NULL→0）** |
| ~~Decimal vs float 类型不兼容~~ | ~~中~~ | ~~sales.py/sales_returns.py/warehouse.py~~ | **已修复 2026-02-25（显式 float() 转换）** |
| ~~客户搜索精确匹配被挤出~~ | ~~中~~ | ~~customers.py~~ | **已修复 2026-02-25（case 排序）** |
| ~~InventoryOverview null toFixed 崩溃~~ | ~~中~~ | ~~InventoryOverview.tsx~~ | **已修复 2026-02-25（?? 0 防护）** |
| ~~商品编码列显示 -~~ | ~~中~~ | ~~warehouse.py + InventoryOverview.tsx~~ | **已修复 2026-02-25（后端嵌入 product_code）** |
| ~~QuickOrderModal 未发送 product_code~~ | ~~中~~ | ~~QuickOrderModal.tsx + sales.py~~ | **已修复 2026-02-25** |
| ~~结算单号并发竞争~~ | ~~低~~ | ~~settlement.py~~ | **已修复 2026-02-24（全部序号生成加 with_for_update）** |
| ~~序号生成并发竞争（loan/action_card/finance）~~ | ~~中~~ | ~~loan.py / action_card.py / finance.py~~ | **已修复 2026-02-24（with_for_update + 碰撞检测）** |
| ~~DeepSeek API 无超时保护~~ | ~~中~~ | ~~ai_parser/behavior_logger/baidu_ocr~~ | **已修复 2026-02-24（timeout=60s）** |
| ~~频繁查询字段缺索引~~ | ~~中~~ | ~~13 个 created_at/due_date 字段~~ | **已修复 2026-02-24（Alembic migration）** |
| ~~前端大量 console.log~~ | ~~低~~ | ~~useChatStream/SystemMessage/SettlementPage 等~~ | **已修复 2026-02-23（68+ 处移除）** |
| ~~前端错误处理不统一~~ | ~~中~~ | ~~api.ts~~ | **已修复 2026-02-23（handleApiError 工具函数）** |
| ~~经理仪表盘暂借克重为占位符~~ | ~~低~~ | ~~ManagerDashboardPage.tsx~~ | **已修复 2026-02-23（接入真实数据）** |
| ~~AI 追问被分类为闲聊~~ | ~~中~~ | ~~ai_prompts.py~~ | **已修复 2026-02-23（conversation_history 传递）** |
| ~~AI 查询 token 溢出~~ | ~~P0~~ | ~~ai_analyzer.py / chat.py~~ | **已修复 2026-02-23（AI 驱动查询引擎架构）** |
| ~~结算金价验证缺失~~ | ~~中~~ | ~~settlement.py~~ | **已修复 2026-02-23（负数/零值校验）** |
| ~~window.confirm() 样式不统一~~ | ~~中~~ | ~~12 个前端文件~~ | **已修复 2026-02-24（ConfirmationDialog 替换 23 处）** |
| ~~分析页面表格无空状态~~ | ~~低~~ | ~~3 个 analytics Tab~~ | **已修复 2026-02-24（暂无数据提示）** |
| ~~移动端表格溢出~~ | ~~低~~ | ~~5 个页面~~ | **已修复 2026-02-24（overflow-x-auto + 网格断点）** |
| ~~context_manager 未完全接入 chat 路由~~ | ~~中~~ | ~~chat.py~~ | **已修复 2026-02-21** |
| ~~部分 try-except 吞掉异常无日志~~ | ~~中~~ | ~~多处~~ | **已修复 2026-02-21** |
| ~~前端确认按钮无防重复点击~~ | ~~中~~ | ~~4个页面~~ | **已修复 2026-02-21** |
| ~~确认接口缺少权限检查~~ | ~~P1~~ | ~~settlement.py~~ | **已修复 2026-02-21** |
| ~~修改结算单混合支付金额计算错误~~ | ~~P0~~ | ~~settlement.py~~ | **已修复 2026-02-21** |
| ~~已取消结算单阻止重新创建~~ | ~~P1~~ | ~~settlement.py~~ | **已修复 2026-02-21** |
| ~~创建结算单时就扣金料（应确认时才扣）~~ | ~~P0~~ | ~~settlement.py~~ | **已修复 2026-02-21** |
| ~~后端接口无权限强制执行~~ | ~~P1~~ | ~~全部路由~~ | **已修复 2026-02-21** |
| ~~AI 聊天/导出接口无速率限制~~ | ~~P1~~ | ~~chat.py / export.py~~ | **已修复 2026-02-21** |
| ~~confirm_settlement_order 缺少 try-except~~ | ~~中~~ | ~~settlement.py~~ | **已修复 2026-02-21** |
| ~~chat_helpers.py is_successful 类型不匹配~~ | ~~中~~ | ~~chat_helpers.py~~ | **已修复 2026-02-22** |
| ~~DeepSeek 同步调用阻塞 SSE~~ | ~~中~~ | ~~chat.py~~ | **已修复 2026-02-22** |
| ~~@mention 弹窗点击无效~~ | ~~中~~ | ~~ChatView.jsx~~ | **已修复 2026-02-22** |
| ~~ReturnPage null toFixed 崩溃~~ | ~~中~~ | ~~ReturnPage.tsx~~ | **已修复 2026-02-22** |
| ~~收款凭证上传自动发送~~ | ~~低~~ | ~~App.jsx~~ | **已修复 2026-02-22** |
| ~~OCR 金额校验容差过大~~ | ~~P1~~ | ~~chat.py~~ | **已修复 2026-02-22（严格 1 元误差）** |
| ~~FBL ID 生成竞态条件~~ | ~~P0~~ | ~~fbl_voucher_service.py~~ | **已修复 2026-02-22（pg_advisory_xact_lock）** |
| ~~金额明细不校验 sum~~ | ~~P1~~ | ~~card_executor.py~~ | **已修复 2026-02-22（自动校正）** |
| ~~loan/inbound 并发锁缺失~~ | ~~中~~ | ~~loan.py / inbound.py~~ | **已修复 2026-02-22（with_for_update）** |
| ~~协同消息正则兜底不可靠~~ | ~~中~~ | ~~chat.py~~ | **已修复 2026-02-22（移除正则，纯 AI 解析）** |
| ~~anthropic 未使用依赖~~ | ~~低~~ | ~~requirements.txt~~ | **已修复 2026-02-22（移除）** |
| ~~CustomerPage 借/还记录 Tab 崩溃~~ | ~~中~~ | ~~CustomerPage.tsx~~ | **已修复 2026-02-22** |

---

## 对话摘要

### 第一次对话（2026-02-21）
**涉及文件：**
- `backend/app/routers/settlement.py` — 结算单金料扣减时机修复 + P0/P1 修复
- `backend/app/routers/chat_handlers.py` — receivable_no 属性错误修复
- `frontend/src/config/permissions.js` — 结算专员增加收款权限
- `backend/app/middleware/permissions.py` — 结算专员增加收款权限
- `.cursorrules` — 新建，项目宪法
- `PROGRESS.md` — 新建，进度存档

### 第二次对话（2026-02-21）
**涉及文件：**
- `backend/app/main.py` — SafeJSONResponse + slowapi Limiter 配置
- `backend/app/utils/response.py` — safe_float / sanitize_floats 工具函数
- `backend/app/schemas/__init__.py` — 多字段改 Optional 兼容迁移数据
- `backend/app/routers/settlement.py` — NULL 防护 + 分页 + 行级锁
- `backend/app/routers/sales.py` — 分页 + 行级锁
- `backend/app/routers/customers.py` — recalculate-stats / merge-duplicates API + 备注过滤
- `backend/app/routers/suppliers.py` — 分页
- `backend/app/routers/analytics.py` — 除零防护
- `backend/app/routers/chat.py` — SSE sanitize + slowapi 限速
- `frontend/src/components/SettlementPage.tsx` — 分页控件
- `frontend/src/components/SalesOrdersPage.tsx` — 分页控件
- `frontend/src/components/SupplierPage.jsx` — 分页控件

### 第三次对话（2026-02-21）
**涉及文件：**
- `backend/app/dependencies/auth.py` — 新建，权限依赖注入模块
- `backend/app/routers/export.py` — slowapi 限速 + require_permission
- `backend/app/routers/sales.py` — require_permission 检查
- `backend/app/routers/settlement.py` — require_permission 检查
- `backend/app/routers/inbound.py` — require_permission 检查
- `backend/app/routers/finance.py` — require_permission 检查
- `backend/app/routers/warehouse.py` — require_permission 检查
- `backend/app/routers/gold_material.py` — require_permission 检查
- `backend/app/routers/customers.py` — require_permission 检查
- `backend/app/routers/suppliers.py` — require_permission 检查
- `backend/app/routers/data_cleanup.py` — require_permission 检查
- `backend/requirements.txt` — 新增 slowapi
- `frontend/src/utils/api.ts` — 自动发送 X-User-Role Header

### 第四次对话（2026-02-21）
**涉及文件：**
- `backend/app/routers/chat.py` — context_manager 完全接入（失败操作+查询结果记录）
- `backend/app/routers/settlement.py` — bare except 修复
- `backend/app/routers/sales.py` — bare except 修复
- `backend/app/routers/inbound.py` — bare except 修复
- `backend/app/routers/customers.py` — bare except 修复
- `backend/app/routers/suppliers.py` — bare except 修复
- `backend/app/routers/export.py` — bare except 修复
- `backend/app/routers/fbl_finance.py` — bare except 修复
- `backend/app/routers/finance.py` — bare except 修复
- `backend/app/ai_analyzer.py` — bare except 修复
- `frontend/src/components/SettlementPage.tsx` — 确认按钮防重复点击
- `frontend/src/components/SalesOrdersPage.tsx` — 确认按钮防重复点击
- `frontend/src/components/InboundOrdersPage.tsx` — 确认按钮防重复点击
- `frontend/src/components/SalesReturnPage.tsx` — 确认按钮防重复点击

### 第五次对话（2026-02-22）
**涉及文件：**
- `backend/app/models/__init__.py` — ActionCard/Notification 模型 + LoanDetail 增 piece_count/piece_labor_cost
- `backend/app/routers/chat.py` — @角色协同、AI 解析、SSE interactive_card、asyncio.to_thread、try-except 兜底
- `backend/app/routers/chat_helpers.py` — is_successful bool→int 类型修复
- `backend/app/routers/loan.py` — 分页、件工费 Schema/逻辑、商品编码 ProductCode 查询
- `backend/app/routers/sales_returns.py` — 分页
- `backend/app/routers/customers.py` — customer_id 优先查询兼容迁移数据
- `backend/app/routers/export.py` — customer_id 优先查询 + SyntaxError 修复
- `backend/app/services/card_executor.py` — 新建，跨角色确认后平账逻辑
- `backend/app/database.py` — 自动迁移 piece_count/piece_labor_cost 列
- `frontend/src/App.jsx` — SSE interactive_card 处理 + 收款凭证上传优化（预览+手动发送）
- `frontend/src/pages/ChatView.jsx` — ActionCardRenderer 渲染 + MentionPopup + 附件预览条 + @mention 点击修复
- `frontend/src/components/LoanPage.tsx` — 分页 + 件工费 + 商品编码列
- `frontend/src/components/SalesReturnPage.tsx` — 分页
- `frontend/src/components/SalesOrdersPage.tsx` — FilterSearchSelect 客户下拉
- `frontend/src/components/ReturnPage.tsx` — null toFixed 崩溃修复
- `frontend/src/components/SettlementPage.tsx` — physical_gold_weight null 显示修复
- `frontend/src/components/layout/Header.jsx` — 退库管理重命名 + 铃铛待办入口
- `frontend/src/components/QuickReturnModal.tsx` — 退库管理重命名
- `frontend/src/components/chat/cards/ActionCardRenderer.jsx` — 新建，协同卡片渲染组件
- `frontend/src/locales/zh.json` — 退库管理
- `frontend/src/config.js` — 退库管理

### 第六次对话（2026-02-22 ~ 2026-02-23）
**涉及文件：**
- `backend/app/routers/chat.py` — 协同卡片扩展（settlement_confirm/withdrawal_confirm）、结算前置验证、去正则化（移除 _parse_payment_amounts/_extract_customer_name）、OCR 严格 1 元误差校验、无截图/OCR 失败阻止卡片创建
- `backend/app/routers/chat_handlers.py` — 新增 8 个聊天处理器（handle_create_settlement/query_settlement/create_loan/loan_return/query_loan/reconciliation/query_voucher/expense）
- `backend/app/routers/chat_helpers.py` — 新增 8 个动作的 dispatch 映射
- `backend/app/schemas/__init__.py` — AIResponse 扩展（settlement/loan/reconciliation/voucher/expense 字段）
- `backend/app/ai_prompts.py` — 新增销售/财务 prompt（结算/暂借/对账/凭证/报销意图识别）
- `backend/app/services/card_executor.py` — 新增 execute_settlement_confirm + execute_withdrawal_confirm、收据自动生成、FBL 凭证自动创建、金额明细校验
- `backend/app/services/fbl_voucher_service.py` — 新建，FBL 凭证系统集成（pg_advisory_xact_lock 原子 ID 生成）
- `backend/app/routers/loan.py` — 确认借出/创建还货加 with_for_update() 行级锁
- `backend/app/routers/inbound.py` — 确认入库加 with_for_update() 行级锁
- `backend/requirements.txt` — 移除 anthropic 依赖
- `frontend/src/components/chat/cards/ActionCardRenderer.jsx` — 支持 3 种卡片类型差异化渲染 + 销售单号显示
- `frontend/src/components/CustomerPage.tsx` — 借/还记录 Tab 数据解析修复
- `frontend/src/components/HelpGuide.jsx` — 新建，角色使用指南抽屉组件
- `frontend/src/components/layout/Header.jsx` — 新增 ? 帮助按钮入口
- `docs/USER_GUIDES.md` — 新建，7 角色完整使用指南独立文档

### 第七次对话（2026-02-23 ~ 2026-02-24）
**涉及文件：**
- `backend/app/query_engine.py` — 新建，AI 驱动查询引擎（JSON 查询计划 + ORM 执行 + AI 摘要）
- `backend/app/routers/chat.py` — 集成查询引擎路径 + session_id 过滤对话历史
- `backend/app/ai_prompts.py` — _fallback_classify 接收 conversation_history
- `backend/app/ai_parser.py` — parse_user_message 传递 conversation_history
- `backend/app/ai_analyzer.py` — 客户查询智能过滤 + 中文 token 估算优化
- `backend/app/routers/settlement.py` — gold_price 验证（负数/零值校验）
- `backend/app/routers/analytics.py` — dashboard-summary 新增 loan.outstanding_weight
- `backend/app/routers/loan.py` — generate_loan_no/generate_return_no 加 with_for_update
- `backend/app/routers/action_card.py` — _generate_card_id 加 with_for_update
- `backend/app/routers/finance.py` — 新增 _generate_safe_no 通用函数，替换 6 处序号生成
- `backend/app/ai_parser.py` — OpenAI client timeout=60.0
- `backend/app/services/behavior_logger.py` — DeepSeek/Embedding client timeout
- `backend/app/baidu_ocr.py` — DeepSeek client timeout=60.0
- `backend/app/services/prompt_optimizer.py` — DeepSeek client timeout=60.0
- `backend/app/models/__init__.py` — 7 个 created_at 字段加 index=True
- `backend/app/models/finance.py` — 6 个字段加 index=True
- `backend/alembic/versions/001_add_indexes_on_frequently_queried_columns.py` — 新建，Alembic 迁移
- `frontend/src/hooks/useChatStream.js` — 移除 28 处 console.log
- `frontend/src/components/chat/cards/SystemMessage.jsx` — 移除 15 处 console.log
- `frontend/src/components/SettlementPage.tsx` — 移除 console.log + confirm() 替换（6 处）+ min-w-[600px]
- `frontend/src/components/JewelryInboundCard.tsx` — 移除 12 处 console.log
- `frontend/src/components/WarehousePage.tsx` — 移除 console.error + overflow-x-auto + 网格优化
- `frontend/src/utils/api.ts` — 新增 handleApiError + 移除 console.error
- `frontend/src/components/ManagerDashboardPage.tsx` — 暂借克重卡片接入真实数据
- `frontend/src/components/ui/AsyncSearchSelect.tsx` — 新建，通用异步搜索选择组件
- `frontend/src/components/ui/ConfirmationDialog.tsx` — 已有组件，被 12 个文件引用
- `frontend/src/components/CustomerPage.tsx` — confirm() 替换
- `frontend/src/components/SupplierPage.jsx` — confirm() 替换
- `frontend/src/components/SalespersonPage.tsx` — confirm() 替换
- `frontend/src/components/ProductCodePage.tsx` — confirm() 替换（2 处）
- `frontend/src/components/VoucherManagement.jsx` — confirm() 替换（4 处）+ overflow-x-auto
- `frontend/src/components/FinanceSettings.jsx` — confirm() 替换
- `frontend/src/components/FinanceAdminManagement.jsx` — confirm() 替换
- `frontend/src/components/LabelDesignPage.tsx` — confirm() 替换（2 处）
- `frontend/src/components/design/ProjectSidebar.jsx` — confirm() 替换
- `frontend/src/components/FinanceClosing.jsx` — confirm() 替换（2 处）
- `frontend/src/components/LoanPage.tsx` — confirm() 替换 + AsyncSearchSelect 替换
- `frontend/src/components/modals/QuickWithdrawalModal.jsx` — AsyncSearchSelect 替换
- `frontend/src/components/modals/QuickReceiptModal.jsx` — AsyncSearchSelect 替换
- `frontend/src/components/FinanceReports.jsx` — 网格断点响应式优化
- `frontend/src/components/GoldMaterialPage.tsx` — 网格断点 + min-w-[600px]
- `frontend/src/components/analytics/SalesAnalysisTab.tsx` — 表格空状态
- `frontend/src/components/analytics/InventoryAnalysisTab.tsx` — 表格空状态
- `frontend/src/components/analytics/FinanceAnalysisTab.tsx` — 表格空状态

### 第八次对话（2026-02-25）
**涉及文件：**
- `backend/app/models/__init__.py` — 新增 GoldPurchaseOrder/GoldPurchasePayment 模型、移除 supplier_id ForeignKey 和 supplier relationship（修复 502/500 部署错误）
- `backend/app/schemas/__init__.py` — 新增金料采购相关 Schema、LocationInventoryResponse.last_update 改 Optional
- `backend/app/routers/gold_purchase.py` — 新建，金料采购完整 CRUD + 结价/付款/取消/汇总 API
- `backend/app/routers/warehouse.py` — 修复 inventory/summary 500 错误（null 值防护、limit 校验）
- `backend/app/routers/inventory_maintenance.py` — 新增删除库存记录 API
- `backend/app/main.py` — 注册 gold_purchase_router
- `frontend/src/components/InboundOrdersPage.tsx` — 入库单详情表格添加合计行（tfoot）
- `frontend/src/components/GoldMaterialPage.tsx` — 新增"金料采购"Tab（state/API 函数/tab 按钮/完整 UI），含汇总卡片、新建表单、采购单列表、内联结价/付款、付款记录展开

### 第九次对话完成的功能与修复（2026-02-25）

#### 数据迁移与初始数据导入
- [x] 展厅库存导入脚本 `import_showroom_inventory.py` — 直接导入到展厅 location_inventory（跳过商品部）
- [x] 供应商期初债务导入脚本 `import_initial_debt.py` — 导入欠工厂的料和工费
- [x] 供应商模型新增 `initial_gold_debt` / `initial_labor_debt` 字段
- [x] 供应商款料查询页面显示期初余额作为第一行记录
- [x] 入库明细新增 `sale_labor_cost` / `sale_piece_labor_cost` 字段（销售工费）
- [x] 入库导入脚本支持销售工费列映射

#### 后端 Bug 修复（7 项）
- [x] `ImportError: GoldPurchaseOrderCreate` — 补充 5 个缺失的 Pydantic Schema
- [x] `/api/product-codes` 500 错误 — `is_unique`/`is_used` 字段 NULL 值导致 Pydantic 验证失败，添加默认值和启动时 NULL 修复
- [x] `Decimal - float` 类型不兼容 — `sales.py`、`sales_returns.py`、`warehouse.py` 中显式 `float()` 转换（4 处）
- [x] 销售单 `product_code` 未传递 — Schema 新增字段 + 后端优先使用前端传入的 product_code
- [x] 客户搜索精确匹配被模糊匹配挤出 — `customers.py` 添加 `sqlalchemy.case` 排序优先精确匹配
- [x] `product_codes` 脏数据（空格/隐藏字符）— `main.py` 启动时 TRIM 清理 code/name/code_type 字段
- [x] **Bug #31: 重复 ID 导致 SQLAlchemy identity map 静默去重** — 导入脚本手动指定 id 与已有记录冲突，API 返回 60 条而非 69 条。修复：`setval` 重置序列 + `UPDATE SET id = nextval()` 分配新唯一 id

#### 前端修复（3 项）
- [x] `InventoryOverview.tsx` null `.toFixed()` 崩溃 — 15 处添加 `?? 0` 防护
- [x] 商品编码列显示 `-` — 改为后端 `warehouse.py` 直接嵌入 product_code，前端直接使用
- [x] `QuickOrderModal.tsx` 未发送 product_code — 修复 handleSubmit 包含 product_code

#### 数据库清理
- [x] 删除历史入库单、收料单、付款单、客户提料、旧转移单（2026-02-25 之前的数据）
- [x] 清空展厅库存并重新导入
- [x] 修复 product_codes 表重复 ID 问题（9 条记录）

#### Lessons Learned 更新
- [x] Bug #31: SQLAlchemy identity map 静默去重（导入脚本不要手动指定 id）
- [x] PowerShell 命令规则：给用户提供 psql 命令而非裸 SQL，避免特殊字符

#### 诊断工具
- [x] `backend/scripts/check_name_match.py` — 诊断脚本，用 repr() 检查字段隐藏字符、检测脏数据、对比 predefined 计数

**涉及文件：**
- `backend/app/main.py` — 启动时 TRIM 清理 product_codes + NULL→0 修复 + GoldPurchase schema 注册
- `backend/app/schemas/__init__.py` — 新增 GoldPurchase 5 个 Schema + LocationInventoryResponse.product_code + SalesDetailItem.product_code + ProductCodeResponse is_unique/is_used 默认值
- `backend/app/models/__init__.py` — Supplier 新增 initial_gold_debt/initial_labor_debt
- `backend/app/routers/sales.py` — Decimal→float 转换 + product_code 优先使用前端传入值
- `backend/app/routers/sales_returns.py` — Decimal→float 转换
- `backend/app/routers/warehouse.py` — 嵌入 product_code 到 LocationInventoryResponse + Decimal→float
- `backend/app/routers/customers.py` — 精确匹配优先排序（sqlalchemy.case）
- `backend/app/routers/product_codes.py` — is_unique/is_used or 0 防护
- `backend/app/routers/suppliers.py` — 期初债务字段集成
- `backend/app/routers/gold_material.py` — 期初余额显示
- `backend/scripts/import_showroom_inventory.py` — 新建，展厅库存导入
- `backend/scripts/import_initial_debt.py` — 新建，供应商期初债务导入
- `backend/scripts/import_inventory_xlsx.py` — 新增销售工费列映射
- `backend/scripts/check_name_match.py` — 新建，诊断脚本
- `frontend/src/components/InventoryOverview.tsx` — null 防护 + 直接使用 item.product_code
- `frontend/src/components/QuickOrderModal.tsx` — handleSubmit 包含 product_code
- `.claude/skills/jewelry-erp-lessons-learned/SKILL.md` — Bug #31 + PowerShell 命令规则

### 第十次对话完成的功能与修复（2026-02-26）

#### 库存展开行显示商品编码和明细（核心修复）
- [x] 新增 `/api/inventory/by-product-name` API — 按商品名称查询已确认入库单的逐行明细（条码、克重、工费等）
- [x] `WarehousePage.tsx` — 库存展开行改为按需加载（per-product cache + 新 API），替代原全量加载
- [x] `InventoryOverview.tsx` — 商品部仓库和展厅两个区域均增加展开行明细功能
- [x] `InboundOrder.status` 过滤修复 — 从 `== 'confirmed'` 改为 `.in_(['confirmed', 'completed'])`（导入数据 status 为 completed）
- [x] `product_codes` 表回退查询 — 当 `InboundDetail` 无数据时，从 `product_codes` 表获取编码列表（带 `source: "product_codes"` 标记）
- [x] 前端适配仅编码数据 — `source === 'product_codes'` 时克重/工费显示 "-"，编码后追加"（仅编码）"标签

#### 展厅库存明细数据补全（数据层修复）
- [x] `import_showroom_inventory.py` 增强 — 导入时同时创建 `InboundOrder` + `InboundDetail` 记录（`operator="展厅Excel导入"`），与仓库导入脚本对齐
- [x] `--clean` 模式增强 — 清理时同时删除旧展厅导入入库单
- [x] `backfill_showroom_details.py` — 新建一次性补全脚本，从原始 Excel 重新创建展厅的 InboundDetail 记录
- [x] 远程数据库直接补全 — 通过 Python + SQLAlchemy 直连远程 PostgreSQL，读取本地 Excel 写入 817 条 InboundDetail 记录（92 种商品）

#### Cursor Rules 持久化
- [x] `.cursor/rules/infra-config.mdc` — 新建，保存远程数据库连接字符串和服务器 SSH 信息（alwaysApply: true）

**涉及文件：**
- `backend/app/routers/inventory_maintenance.py` — 新增 by-product-name API + product_codes 回退查询
- `backend/scripts/import_showroom_inventory.py` — 增加 InboundOrder/InboundDetail 创建逻辑 + clean 模式增强
- `backend/scripts/backfill_showroom_details.py` — 新建，展厅明细补全脚本
- `frontend/src/components/WarehousePage.tsx` — 展开行 per-product 按需加载 + source 适配
- `frontend/src/components/InventoryOverview.tsx` — 展开行明细功能 + source 适配
- `.cursor/rules/infra-config.mdc` — 新建，基础设施配置规则
