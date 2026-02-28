# 外部API - 填制凭证接口文档

## 概述

本文档描述了梵贝琳财务系统提供的外部API接口，用于外部系统通过HTTP请求的方式创建和查询财务凭证。

所有API请求都需要通过 **API Key** 进行身份验证，确保只有授权的调用方才能访问。

---

## 快速开始

### 1. 获取 API Key

联系系统管理员获取 API Key。API Key 格式为：
```
fbl_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 2. 配置环境变量

在服务器的 `.env` 文件中配置允许的 API Key（支持多个，逗号分隔）：

```bash
# .env 文件
FBL_EXTERNAL_API_KEYS=fbl_key1_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx,fbl_key2_yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy
```

### 3. 发送请求

所有请求都需要在请求头中提供 API Key：

```bash
curl -X POST http://localhost:8000/api/external/vouchers \
  -H "X-API-Key: fbl_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "voucher_date": "2026-01-30",
    "voucher_type_id": 1,
    "entry_rows": [...]
  }'
```

---

## API 端点

### 1. 创建凭证

**端点**: `POST /api/external/vouchers`

**身份验证**: 必需 (X-API-Key)

**功能**: 创建一张新的财务凭证

#### 请求体参数

| 参数名 | 类型 | 必需 | 说明 |
|--------|------|------|------|
| `voucher_date` | string | ✓ | 凭证日期，格式: YYYY-MM-DD |
| `voucher_type_id` | integer | ✓ | 凭证类别ID（如1=记账凭证） |
| `entry_rows` | array | ✓ | 凭证分录列表，至少包含1条分录 |
| `maker` | string | ✗ | 制单人，默认为 "External API" |
| `remark` | string | ✗ | 备注，最多500字符 |

#### 分录参数 (entry_rows 中的每一项)

| 参数名 | 类型 | 必需 | 说明 |
|--------|------|------|------|
| `summary` | string | ✓ | 摘要，1-200字符 |
| `account_id` | integer | ✓ | 科目ID（末级科目） |
| `debit` | number | ✗ | 借方金额，默认0，≥0 |
| `credit` | number | ✗ | 贷方金额，默认0，≥0 |
| `unit` | string | ✗ | 计量单位，默认"克"，最多20字符 |
| `quantity` | number | ✗ | 数量，默认0，≥0 |
| `price` | number | ✗ | 单价，默认0，≥0 |
| `direction` | string | ✗ | 方向: "debit"(借) 或 "credit"(贷)，默认"debit" |
| `currency_id` | integer | ✗ | 外币币种ID，不填则为本币(4) |
| `exchange_rate` | number | ✗ | 汇率，外币时必填，>0 |
| `orig_amount` | number | ✗ | 原币金额，外币时必填，>0 |
| `partner_id` | integer | ✗ | 往来单位ID |

#### 业务规则

1. **借贷平衡**: 所有分录的借方合计必须等于贷方合计
2. **分录金额**: 每条分录的借贷不能同时有值，至少有一个有值
3. **外币处理**: 如果指定了 `currency_id` 且不为4，则必须提供 `exchange_rate` 和 `orig_amount`
4. **分录数量**: 至少需要1条分录

#### 请求示例

```json
{
  "voucher_date": "2026-01-30",
  "voucher_type_id": 1,
  "maker": "外部系统",
  "remark": "销售���入凭证",
  "entry_rows": [
    {
      "summary": "销售收入",
      "account_id": 10,
      "debit": 1000.00,
      "credit": 0,
      "direction": "debit"
    },
    {
      "summary": "应收账款",
      "account_id": 20,
      "debit": 0,
      "credit": 1000.00,
      "direction": "credit"
    }
  ]
}
```

#### 响应示例 (成功 - 200)

```json
{
  "success": true,
  "message": "凭证创建成功",
  "data": {
    "id": 12345,
    "code": "0001",
    "voucher_date": "2026-01-30",
    "entry_count": 2,
    "total_amount": 1000.00
  }
}
```

#### 响应示例 (失败 - 400)

```json
{
  "success": false,
  "message": "参数验证失败",
  "error_details": {
    "code": "UNBALANCED_ENTRIES",
    "message": "借贷不平衡: 借方合计 1000.00，贷方合计 900.00"
  }
}
```

#### 错误码

| 错误码 | HTTP状态 | 说明 |
|--------|---------|------|
| `MISSING_API_KEY` | 401 | 缺少 X-API-Key 请求头 |
| `INVALID_API_KEY` | 403 | API Key 无效或已过期 |
| `API_KEY_NOT_CONFIGURED` | 503 | 服务端未配置API Key |
| `INVALID_DATE` | 400 | 日期格式错误 |
| `EMPTY_ENTRIES` | 400 | 分录列表为空 |
| `INVALID_ENTRY` | 400 | 单条分录验证失败 |
| `UNBALANCED_ENTRIES` | 400 | 借贷不平衡 |
| `DATABASE_ERROR` | 500 | 数据库操作失败 |
| `INTERNAL_ERROR` | 500 | 服务器内部错误 |

---

### 2. 查询凭证

**端点**: `GET /api/external/vouchers/{voucher_id}`

**身份验证**: 必需 (X-API-Key)

**功能**: 查询已创建的凭证详情

#### 路径参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| `voucher_id` | integer | 凭证ID |

#### 响应示例 (成功 - 200)

```json
{
  "success": true,
  "message": "查询成功",
  "data": {
    "id": 12345,
    "code": "0001",
    "voucher_date": "2026-01-30",
    "voucher_type": "记账凭证",
    "maker": "外部系统",
    "entries": [
      {
        "summary": "销售收入",
        "account_code": "6001",
        "account_name": "主营业务收入",
        "debit": 1000.00,
        "credit": 0
      },
      {
        "summary": "应收账款",
        "account_code": "1122",
        "account_name": "应收账款",
        "debit": 0,
        "credit": 1000.00
      }
    ]
  }
}
```

#### 响应示例 (失败 - 404)

```json
{
  "success": false,
  "message": "凭证不存在"
}
```

---

### 3. 健康检查

**端点**: `GET /api/external/health`

**身份验证**: 必需 (X-API-Key)

**功能**: 验证API连接和认证状态

#### 响应示例 (成功 - 200)

```json
{
  "success": true,
  "message": "API 服务正常",
  "status": "healthy",
  "timestamp": "2026-01-30T10:30:45.123456"
}
```

---

## 使用示例

### Python 示例

```python
import requests
import json

# 配置
API_BASE_URL = "http://localhost:8000"
API_KEY = "fbl_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

# 请求头
headers = {
    "X-API-Key": API_KEY,
    "Content-Type": "application/json"
}

# 创建凭证
voucher_data = {
    "voucher_date": "2026-01-30",
    "voucher_type_id": 1,
    "maker": "Python客户端",
    "entry_rows": [
        {
            "summary": "销售收入",
            "account_id": 10,
            "debit": 5000.00,
            "credit": 0
        },
        {
            "summary": "应收账款",
            "account_id": 20,
            "debit": 0,
            "credit": 5000.00
        }
    ]
}

response = requests.post(
    f"{API_BASE_URL}/api/external/vouchers",
    headers=headers,
    json=voucher_data
)

result = response.json()
if result["success"]:
    voucher_id = result["data"]["id"]
    print(f"凭证创建成功，ID: {voucher_id}")
    
    # 查询凭证
    query_response = requests.get(
        f"{API_BASE_URL}/api/external/vouchers/{voucher_id}",
        headers=headers
    )
    print(json.dumps(query_response.json(), indent=2, ensure_ascii=False))
else:
    print(f"创建失败: {result['message']}")
    print(f"错误详情: {result.get('error_details')}")
```

### JavaScript/Node.js 示例

```javascript
const axios = require('axios');

const API_BASE_URL = 'http://localhost:8000';
const API_KEY = 'fbl_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

const headers = {
  'X-API-Key': API_KEY,
  'Content-Type': 'application/json'
};

const voucherData = {
  voucher_date: '2026-01-30',
  voucher_type_id: 1,
  maker: 'Node.js客户端',
  entry_rows: [
    {
      summary: '销售收入',
      account_id: 10,
      debit: 5000.00,
      credit: 0
    },
    {
      summary: '应收账款',
      account_id: 20,
      debit: 0,
      credit: 5000.00
    }
  ]
};

async function createVoucher() {
  try {
    const response = await axios.post(
      `${API_BASE_URL}/api/external/vouchers`,
      voucherData,
      { headers }
    );
    
    if (response.data.success) {
      const voucherId = response.data.data.id;
      console.log(`凭证创建成功，ID: ${voucherId}`);
      
      // 查询凭证
      const queryResponse = await axios.get(
        `${API_BASE_URL}/api/external/vouchers/${voucherId}`,
        { headers }
      );
      console.log(JSON.stringify(queryResponse.data, null, 2));
    } else {
      console.log(`创建失败: ${response.data.message}`);
    }
  } catch (error) {
    console.error('请求失败:', error.message);
  }
}

createVoucher();
```

### cURL 示例

```bash
# 创建凭证
curl -X POST http://localhost:8000/api/external/vouchers \
  -H "X-API-Key: fbl_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "voucher_date": "2026-01-30",
    "voucher_type_id": 1,
    "maker": "cURL客户端",
    "entry_rows": [
      {
        "summary": "销售收入",
        "account_id": 10,
        "debit": 5000.00,
        "credit": 0
      },
      {
        "summary": "应收账款",
        "account_id": 20,
        "debit": 0,
        "credit": 5000.00
      }
    ]
  }'

# 查询凭证
curl -X GET http://localhost:8000/api/external/vouchers/12345 \
  -H "X-API-Key: fbl_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

# 健康检查
curl -X GET http://localhost:8000/api/external/health \
  -H "X-API-Key: fbl_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

---

## 常见问题

### Q1: 如何生成新的 API Key？

使用以下Python命令生成安全的API Key：

```python
from backend.app.core.api_key_auth import generate_api_key

# 生成新的API Key
new_key = generate_api_key(prefix="fbl")
print(new_key)  # 输出: fbl_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

然后将生成的Key添加到 `.env` 文件的 `FBL_EXTERNAL_API_KEYS` 中。

### Q2: 如何处理外币凭证？

对于外币分录，需要提供以下参数：
- `currency_id`: 外币币种ID（例如1=美元）
- `exchange_rate`: 汇率（例如7.2）
- `orig_amount`: 原币金额（例如1000美元）

系统会自动计算本币金额 = 原币金额 × 汇率

### Q3: 凭证号是如何生成的？

凭证号由系统自动生成，格式为：`0001`, `0002`, ...

按凭证类别和会计期间分别计数。

### Q4: 如何处理往来单位？

如果分录涉及往来单位（如应收账款、应付账款），可以提供 `partner_id` 参数，系统会自动创建辅助核算记录。

### Q5: API 有速率限制吗？

当前版本没有速率限制，但建议：
- 单次请求不超过100条分录
- 批量操作时间间隔不少于100ms

### Q6: 如何调试API请求？

1. 检查 API Key 是否正确
2. 验证请求头中是否包含 `X-API-Key`
3. 检查请求体JSON格式是否正确
4. 查看服务器日志获取详细错误信息

---

## 安全建议

1. **保护 API Key**: 不要在代码中硬编码API Key，使用环境变量
2. **HTTPS**: 在生产环境中使用HTTPS而不是HTTP
3. **IP白名单**: 建议在防火墙层面限制调用方IP
4. **日志审计**: 定期检查API调用日志
5. **密钥轮换**: 定期更换API Key

---

## 技术支持

如有问题，请联系系统管理员或查看服务器日志：

```bash
# 查看API日志
tail -f /var/log/jewelry-erp/api.log

# 查看应用日志
tail -f /var/log/jewelry-erp/app.log
```

---

## 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| 1.0 | 2026-01-30 | 初始版本，支持凭证创建和查询 |

---

## 许可证

本API文档和相关代码受梵贝琳财务系统许可证保护。
