# 珠宝 AI-ERP 智能管理系统

基于自然语言对话驱动的珠宝行业全流程 ERP 系统，覆盖入库、销售、结算、金料、财务、仓库等核心业务，支持多角色协同与 AI 智能辅助。

## 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                    前端 (React + Vite)                    │
│   40+ 页面组件 · 响应式设计 · 中英文国际化 · Tailwind CSS  │
└────────────────────────┬────────────────────────────────┘
                         │ REST API / SSE
┌────────────────────────┴────────────────────────────────┐
│                  后端 (FastAPI + SQLAlchemy)              │
│   业务路由 · 权限系统 · AI 解析引擎 · 查询引擎 · OCR      │
└──┬──────────────┬──────────────┬───────────────────┬────┘
   │              │              │                   │
┌──┴───┐   ┌─────┴─────┐  ┌────┴────┐      ┌───────┴──────┐
│ PG + │   │ DeepSeek  │  │ 百度OCR │      │ 阿里云百炼    │
│pgvec │   │ (LLM)     │  │ (图片)  │      │ (Embedding)  │
└──────┘   └───────────┘  └─────────┘      └──────────────┘
```

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18 + TypeScript + Vite + Tailwind CSS + i18next |
| 后端 | Python + FastAPI + SQLAlchemy ORM + Alembic |
| 数据库 | PostgreSQL + pgvector (HNSW 索引, 余弦相似度) |
| AI/LLM | DeepSeek (deepseek-chat, OpenAI SDK 兼容) |
| OCR | 百度云 OCR API (高精度/表格/表单识别) |
| Embedding | 阿里云百炼 text-embedding-v3 (1024 维) |
| 部署 | 阿里云服务器 (uvicorn + Vite) / Railway |

## 核心功能

### 业务模块

| 模块 | 功能 |
|------|------|
| **入库管理** | 单品入库、批量入库、Excel/CSV 导入、镶嵌类入库、确认/反确认 |
| **销售管理** | 创建销售单、确认/反确认、库存自动扣减 |
| **结算管理** | 结价 / 结料 / 混合支付三种模式，创建→确认→打印完整流程 |
| **金料管理** | 收料(客户来料)、付料(给供应商)、提料(客户取料)、转料、金料采购 |
| **退库管理** | 退给供应商、退给商品部、退货确认、库存回滚 |
| **销退管理** | 销售退货、库存恢复 |
| **仓库管理** | 多位置库存(商品部/展厅)、库存转移、转移确认 |
| **暂借管理** | 创建暂借单、确认借出、归还、件工费 |

### 财务模块

| 模块 | 功能 |
|------|------|
| **应收账款** | 结算确认时自动生成、状态追踪 |
| **收款登记** | 手动登记、AI 对话登记、收款凭证 OCR 识别 |
| **应付账款** | 供应商付款管理 |
| **对账单** | PDF 导出 |
| **FBL 凭证** | 自动对接外部财务数据库 (gl_doc / gl_entry) |
| **催款管理** | 催款记录追踪 |

### AI 能力

- **自然语言操作**：通过对话完成入库、销售、退货、查询、收款、金料、结算、暂借、对账、凭证、报销等全部业务操作
- **AI 驱动查询引擎**：自然语言 → JSON 查询计划 → ORM 安全执行 → AI 结果摘要
- **流式响应 (SSE)**：实时流式输出 AI 回复
- **OCR 识别**：入库单图片识别、收款凭证识别（严格 1 元误差校验）
- **行为决策日志**：pgvector 向量存储 + 相似决策检索
- **跨角色协同**：@角色检测 + AI 解析 + ActionCard (payment / settlement / withdrawal) + 多角色确认 + 自动平账

### 人员管理

- **客户管理**：CRUD、往来账目、金料存料余额、模糊搜索
- **供应商管理**：CRUD、供货统计、金料账户、期初债务
- **业务员管理**：CRUD
- **商品编码管理**：预定义编码、F/FL 编码

### 权限与安全

- 6 种角色权限体系（经理、结算专员、销售、仓库、财务、管理员）
- 后端 42 个写入端点全部强制权限检查 (`require_permission`)
- AI 聊天 / 导出接口速率限制 (slowapi)
- 关键操作行级锁 (`SELECT ... FOR UPDATE`)
- 审计日志

### 前端特性

- 40+ 页面组件，覆盖全部业务模块
- 响应式设计（桌面 / 移动端）
- 中英文国际化 (i18next)
- Excel 导入/导出、PDF 导出（对账单、标签）
- @角色 MentionPopup + ActionCard 交互卡片
- 系统内嵌帮助指南（按角色显示操作指南）
- 异步搜索选择器、确认弹窗、防重复点击等 UX 优化

## 珠宝行业业务规则

### 计量精度
- 金重/克重：精度 0.001g，显示保留 2 位
- 金额：精度 0.01 元
- 金价：单位 元/克

### 工费计算
```
总工费 = 克工费 × 克重 + 件工费 × 件数
总成本 = 金价 × 克重 + 总工费（结价模式）
```

### 金料账户
```
净存料 = 来料 + 销退退料 - 结算用料 - 提料 - 已确认存料结价
正数 = 客户存料（我们欠客户金料）
负数 = 客户欠料（客户欠我们金料）
```

### 单据流程
所有单据遵循两步流程：**创建 (draft)** → **确认 (confirmed)**
- draft：不影响库存/账户，可修改、可取消
- confirmed：影响库存/账户，需先撤销才能修改

## 快速开始

### 环境要求
- Python 3.10+
- Node.js 18+
- PostgreSQL 14+ (含 pgvector 扩展)

### 后端

```bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # Linux/Mac

pip install -r requirements.txt

# 配置 .env（参考 .env.example）
uvicorn app.main:app --reload --port 8000
```

### 前端

```bash
cd frontend
npm install
npm run dev
# 浏览器访问 http://localhost:5173
```

## 项目结构

```
jewelry-ai-erp/
├── backend/
│   ├── app/
│   │   ├── main.py                 # 应用入口
│   │   ├── database.py             # 数据库配置
│   │   ├── models/                 # SQLAlchemy 数据模型
│   │   ├── schemas/                # Pydantic Schema
│   │   ├── routers/                # API 路由 (15+ 模块)
│   │   ├── services/               # 业务服务层
│   │   ├── dependencies/           # 依赖注入 (权限等)
│   │   ├── middleware/             # 中间件
│   │   ├── utils/                  # 工具函数
│   │   ├── ai_parser.py            # AI 意图解析
│   │   ├── ai_analyzer.py          # AI 数据分析
│   │   ├── ai_prompts.py           # Prompt 模板
│   │   ├── query_engine.py         # AI 查询引擎
│   │   ├── baidu_ocr.py            # 百度 OCR 集成
│   │   ├── context_manager.py      # 会话上下文管理
│   │   └── knowledge_base.md       # 业务知识库
│   ├── scripts/                    # 数据导入/迁移脚本
│   ├── tests/                      # 测试用例
│   ├── alembic/                    # 数据库迁移
│   └── requirements.txt
├── frontend/
│   └── src/
│       ├── App.jsx                 # 主应用
│       ├── components/             # 40+ 业务组件
│       │   ├── analytics/          # 分析报表
│       │   ├── chat/               # AI 对话
│       │   ├── finance/            # 财务模块
│       │   ├── layout/             # 布局组件
│       │   ├── modals/             # 弹窗组件
│       │   └── ui/                 # 通用 UI 组件
│       ├── hooks/                  # React Hooks
│       ├── locales/                # 国际化 (zh/en)
│       ├── utils/                  # 工具函数
│       └── config/                 # 权限配置
├── docs/                           # 文档
│   ├── USER_GUIDES.md              # 用户操作指南
│   └── database-schema.md          # 数据库设计
└── PROGRESS.md                     # 项目进度存档
```

## 使用示例

### AI 对话操作

```
# 入库
古法黄金戒指 100克 工费6元 供应商是金源珠宝，帮我做个入库

# 销售
帮我开一张销售单，客户张三，古法黄金手镯 50克

# 结算
帮张三做个结算，结价方式，金价520

# 查询
查一下这个月的销售情况
张三的金料余额是多少

# 收款（支持 OCR 凭证识别）
张三付了5000元货款 [附带转账截图]

# 跨角色协同
@结算专员 帮张三做个结算确认
@仓库 帮客户李四提料50克
```

## 单据编号规则

| 类型 | 前缀 | 示例 |
|------|------|------|
| 入库单 | RK | RK20260206001 |
| 销售单 | XS | XS20260206001 |
| 退货单 | TH | TH20260206001 |
| 结算单 | JS | JS20260206001 |
| 收料单 | SL | SL20260206001 |
| 付料单 | FL | FL20260206001 |
| 转移单 | TR | TR20260206001 |

## 部署

项目支持两种部署方式：

- **阿里云服务器**：前端 Vite build + 后端 uvicorn，Nginx 反向代理
- **Railway**：通过 `nixpacks.toml` + `Procfile` 自动构建部署

## License

Private - All Rights Reserved
