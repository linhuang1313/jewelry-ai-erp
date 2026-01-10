# 珠宝行业AI-ERP入库系统 MVP

## 项目简介

这是一个基于自然语言对话的珠宝入库系统演示版本，用户可以通过自然语言输入完成入库操作。

## 技术栈

- 前端：React + Vite + Tailwind CSS
- 后端：Python + FastAPI
- AI解析：Anthropic Claude API
- 数据库：SQLite

## 快速开始

### 后端设置

1. 进入后端目录：
```bash
cd backend
```

2. 创建虚拟环境（推荐）：
```bash
python -m venv venv
venv\Scripts\activate  # Windows
```

3. 安装依赖：
```bash
pip install -r requirements.txt
```

4. 环境变量已配置在 `.env` 文件中

5. 启动后端服务：
```bash
uvicorn app.main:app --reload --port 8000
```

### 前端设置

1. 进入前端目录：
```bash
cd frontend
```

2. 安装依赖：
```bash
npm install
```

3. 启动开发服务器：
```bash
npm run dev
```

4. 浏览器访问：http://localhost:5173

## 使用示例

### 入库操作
```
古法黄金戒指 100克 工费6元 供应商是金源珠宝，帮我做个入库
```

### 查询库存
```
查询古法黄金戒指库存
```

## 项目结构

```
jewelry-ai-erp/
├── backend/          # FastAPI后端
│   ├── app/
│   │   ├── main.py   # 主应用入口
│   │   ├── database.py  # 数据库配置
│   │   ├── models.py    # 数据模型
│   │   ├── schemas.py   # Pydantic模式
│   │   └── ai_parser.py # AI解析逻辑
│   └── requirements.txt
├── frontend/         # React前端
│   └── src/
│       └── App.jsx   # 主组件
└── README.md
```

## 注意事项

1. 确保已获取 Anthropic Claude API Key（已配置在 .env 文件中）
2. 首次运行会自动创建SQLite数据库
3. MVP阶段总成本等于工费（不考虑金价）
4. 操作人固定为"系统管理员"


