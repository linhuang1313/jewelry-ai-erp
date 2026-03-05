# 环境变量配置说明

## 行为记录器服务相关配置

以下环境变量用于启用行为记录器服务（Behavior Logger Service）功能：

### 必需配置

```bash
# Pinecone 向量数据库
PINECONE_API_KEY=your_pinecone_api_key_here
PINECONE_INDEX_NAME=jewelry-erp-decisions  # 可选，默认值如左

# OpenAI Embedding（用于生成向量）
OPENAI_API_KEY=sk-your_openai_api_key_here
```

### 可选配置

```bash
# Pinecone 服务器区域（仅在创建索引时使用）
PINECONE_CLOUD=aws       # 云服务商：aws/gcp/azure
PINECONE_REGION=us-east-1  # 区域

# 金价配置（可手动更新）
CURRENT_GOLD_PRICE=1086   # 当前金价（元/克）
GOLD_MARKET_TREND=up      # 市场趋势：up/down/stable
```

---

## 获取 API Key

### 1. Pinecone API Key

1. 访问 [https://www.pinecone.io/](https://www.pinecone.io/)
2. 注册或登录账号（支持 Google/GitHub 登录）
3. 在控制台左侧菜单点击 "API Keys"
4. 复制 API Key

**免费额度**：
- 1 个索引
- 最多 100,000 个向量
- 对于中小企业完全够用

### 2. OpenAI API Key

1. 访问 [https://platform.openai.com/](https://platform.openai.com/)
2. 登录账号
3. 点击右上角头像 → "View API Keys"
4. 点击 "Create new secret key"

**成本说明**：
- 模型：`text-embedding-3-small`
- 价格：约 $0.02 / 百万 token
- 每条决策记录约 200-500 token
- **预估成本**：1000条记录约 $0.01

---

## 初始化步骤

1. 在 `.env` 文件中添加上述配置

2. 运行初始化脚本创建 Pinecone 索引：
```bash
cd backend
python scripts/init_pinecone.py
```

3. 重启后端服务：
```bash
uvicorn app.main:app --reload
```

---

## 功能说明

配置完成后，系统将自动：

1. **记录决策行为**
   - 结算确认后，记录结算方式选择的原因
   - 收料/付料后，记录交易时机和金价判断
   - 客户提料后，记录操作上下文

2. **增强AI建议**
   - 在生成结算建议时，自动检索 Top-3 相关历史决策
   - 格式化为 LLM 可理解的"经验参考"上下文
   - 提高建议的准确性和专业性

---

## 注意事项

- 如果未配置 Pinecone，行为记录器会跳过向量存储，但仍会记录到 PostgreSQL
- 如果未配置 OpenAI，无法生成 Embedding，历史检索功能不可用
- 建议先配置后再进行大量操作，以积累足够的历史数据

