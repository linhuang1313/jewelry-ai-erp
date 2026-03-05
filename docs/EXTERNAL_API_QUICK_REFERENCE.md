# 外部API - 快速参考卡

## API 端点速查表

### 创建凭证
```
POST /api/external/vouchers
```

### 查询凭证
```
GET /api/external/vouchers/{voucher_id}
```

### 健康检查
```
GET /api/external/health
```

---

## 请求头

```
X-API-Key: fbl_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
Content-Type: application/json
```

---

## 最小请求示例

```json
{
  "voucher_date": "2026-01-30",
  "voucher_type_id": 1,
  "entry_rows": [
    {
      "summary": "收入",
      "account_id": 10,
      "debit": 1000,
      "credit": 0
    },
    {
      "summary": "应收",
      "account_id": 20,
      "debit": 0,
      "credit": 1000
    }
  ]
}
```

---

## 完整请求示例

```json
{
  "voucher_date": "2026-01-30",
  "voucher_type_id": 1,
  "maker": "外部系统",
  "remark": "销售收入凭证",
  "entry_rows": [
    {
      "summary": "销售收入",
      "account_id": 10,
      "debit": 5000.00,
      "credit": 0,
      "unit": "元",
      "quantity": 1,
      "price": 5000,
      "direction": "debit"
    },
    {
      "summary": "应收账款",
      "account_id": 20,
      "debit": 0,
      "credit": 5000.00,
      "direction": "credit",
      "partner_id": 1
    }
  ]
}
```

---

## 外币凭证示例

```json
{
  "voucher_date": "2026-01-30",
  "voucher_type_id": 1,
  "entry_rows": [
    {
      "summary": "美元收入",
      "account_id": 10,
      "debit": 7200,
      "credit": 0,
      "currency_id": 1,
      "exchange_rate": 7.2,
      "orig_amount": 1000
    },
    {
      "summary": "应收美元",
      "account_id": 20,
      "debit": 0,
      "credit": 7200,
      "currency_id": 1,
      "exchange_rate": 7.2,
      "orig_amount": 1000
    }
  ]
}
```

---

## 成功响应

```json
{
  "success": true,
  "message": "凭证创建成功",
  "data": {
    "id": 12345,
    "code": "0001",
    "voucher_date": "2026-01-30",
    "entry_count": 2,
    "total_amount": 5000.00
  }
}
```

---

## 错误响应

```json
{
  "success": false,
  "message": "参数验证失败",
  "error_details": {
    "code": "UNBALANCED_ENTRIES",
    "message": "借贷不平衡: 借方合计 5000.00，贷方合计 4000.00"
  }
}
```

---

## 常见错误码

| 错误码 | HTTP | 说明 |
|--------|------|------|
| MISSING_API_KEY | 401 | 缺少API Key |
| INVALID_API_KEY | 403 | API Key无效 |
| INVALID_DATE | 400 | 日期格式错误 |
| EMPTY_ENTRIES | 400 | 分录为空 |
| INVALID_ENTRY | 400 | 分录验证失败 |
| UNBALANCED_ENTRIES | 400 | 借贷不平衡 |
| DATABASE_ERROR | 500 | 数据库错误 |

---

## cURL 命令

### 创建凭证
```bash
curl -X POST http://localhost:8000/api/external/vouchers \
  -H "X-API-Key: fbl_xxx" \
  -H "Content-Type: application/json" \
  -d '{"voucher_date":"2026-01-30","voucher_type_id":1,"entry_rows":[...]}'
```

### 查询凭证
```bash
curl -X GET http://localhost:8000/api/external/vouchers/12345 \
  -H "X-API-Key: fbl_xxx"
```

### 健康检查
```bash
curl -X GET http://localhost:8000/api/external/health \
  -H "X-API-Key: fbl_xxx"
```

---

## Python 快速示例

```python
import requests

api_key = "fbl_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
headers = {"X-API-Key": api_key, "Content-Type": "application/json"}

# 创建凭证
data = {
    "voucher_date": "2026-01-30",
    "voucher_type_id": 1,
    "entry_rows": [
        {"summary": "收入", "account_id": 10, "debit": 1000, "credit": 0},
        {"summary": "应收", "account_id": 20, "debit": 0, "credit": 1000}
    ]
}

response = requests.post(
    "http://localhost:8000/api/external/vouchers",
    headers=headers,
    json=data
)

result = response.json()
if result["success"]:
    print(f"凭证ID: {result['data']['id']}")
else:
    print(f"错误: {result['message']}")
```

---

## JavaScript 快速示例

```javascript
const apiKey = "fbl_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
const headers = {
  "X-API-Key": apiKey,
  "Content-Type": "application/json"
};

const data = {
  voucher_date: "2026-01-30",
  voucher_type_id: 1,
  entry_rows: [
    { summary: "收入", account_id: 10, debit: 1000, credit: 0 },
    { summary: "应收", account_id: 20, debit: 0, credit: 1000 }
  ]
};

fetch("http://localhost:8000/api/external/vouchers", {
  method: "POST",
  headers,
  body: JSON.stringify(data)
})
.then(r => r.json())
.then(result => {
  if (result.success) {
    console.log(`凭证ID: ${result.data.id}`);
  } else {
    console.log(`错误: ${result.message}`);
  }
});
```

---

## 参数验证规则

| 参数 | 类型 | 范围 | 说明 |
|------|------|------|------|
| voucher_date | string | YYYY-MM-DD | 必填 |
| voucher_type_id | int | > 0 | 必填 |
| maker | string | 1-50字符 | 可选 |
| remark | string | 0-500字符 | 可选 |
| summary | string | 1-200字符 | 必填 |
| account_id | int | > 0 | 必填 |
| debit | number | ≥ 0 | 可选 |
| credit | number | ≥ 0 | 可选 |
| exchange_rate | number | > 0 | 外币必填 |
| orig_amount | number | > 0 | 外币必填 |

---

## 业务规则检查清单

- [ ] 借方合计 = 贷方合计
- [ ] 每条分录借贷不同时有值
- [ ] 每条分录至少有一个金额
- [ ] 至少1条分录
- [ ] 日期格式正确
- [ ] 外币提供汇率和原币金额
- [ ] 科目ID有效
- [ ] 凭证类别ID有效

---

## 配置检查清单

- [ ] API Key已生成
- [ ] .env 文件已配置 FBL_EXTERNAL_API_KEYS
- [ ] 服务已重启
- [ ] 健康检查通过
- [ ] 日志正常记录
- [ ] 防火墙允许访问
- [ ] HTTPS已配置（生产环境）

---

## 常见问题速查

**Q: 如何生成API Key?**
```bash
python -c "from app.core.api_key_auth import generate_api_key; print(generate_api_key())"
```

**Q: 如何测试连接?**
```bash
curl http://localhost:8000/api/external/health -H "X-API-Key: fbl_xxx"
```

**Q: 如何查看日志?**
```bash
tail -f /var/log/jewelry-erp/app.log | grep "外部API"
```

**Q: 如何处理外币?**
提供 `currency_id`, `exchange_rate`, `orig_amount` 参数

**Q: 如何添加往来单位?**
提供 `partner_id` 参数

---

## 文档链接

- [完整API文档](./EXTERNAL_API_DOCUMENTATION.md)
- [快速配置指南](./EXTERNAL_API_SETUP.md)
- [实现总结](./EXTERNAL_API_SUMMARY.md)

---

## 支持

- 文档: 见上方链接
- 日志: `/var/log/jewelry-erp/app.log`
- 管理员: 联系系统管理员
