# 外部API - 快速配置指南

## 概述

本指南说明如何配置和启用梵贝琳财务系统的外部API功能。

---

## 第一步：生成 API Key

### 方式1：使用Python脚本生成

```bash
cd backend
python -c "
from app.core.api_key_auth import generate_api_key
key = generate_api_key(prefix='fbl')
print(f'生成的API Key: {key}')
"
```

### 方式2：手动生成（推荐用于多个Key）

```bash
python -c "
from app.core.api_key_auth import generate_api_key
for i in range(3):
    key = generate_api_key(prefix=f'fbl_client{i+1}')
    print(f'Key {i+1}: {key}')
"
```

---

## 第二步：配置环境变量

### 编辑 `.env` 文件

在项目根目录的 `.env` 文件中添加或修改以下配置：

```bash
# 外部API密钥（支持多个，逗号分隔）
FBL_EXTERNAL_API_KEYS=fbl_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx,fbl_yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy
```

### 示例配置

```bash
# .env 文件完整示例
FBL_DATABASE_URL=postgresql://user:password@localhost/fbl_finance_data
FBL_EXTERNAL_API_KEYS=fbl_client1_abcdefghijklmnopqrstuvwxyz123456,fbl_client2_zyxwvutsrqponmlkjihgfedcba654321
```

---

## 第三步：重启服务

```bash
# 停止现有服务
pkill -f "uvicorn"

# 重启服务
cd backend
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

或使用Docker：

```bash
docker-compose restart backend
```

---

## 第四步：验证配置

### 测试健康检查

```bash
curl -X GET http://localhost:8000/api/external/health \
  -H "X-API-Key: fbl_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

预期响应：

```json
{
  "success": true,
  "message": "API 服务正常",
  "status": "healthy",
  "timestamp": "2026-01-30T10:30:45.123456"
}
```

### 测试创建凭证

```bash
curl -X POST http://localhost:8000/api/external/vouchers \
  -H "X-API-Key: fbl_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "voucher_date": "2026-01-30",
    "voucher_type_id": 1,
    "entry_rows": [
      {
        "summary": "测试分录1",
        "account_id": 10,
        "debit": 100.00,
        "credit": 0
      },
      {
        "summary": "测试分录2",
        "account_id": 20,
        "debit": 0,
        "credit": 100.00
      }
    ]
  }'
```

---

## 常见配置问题

### 问题1：API Key 未生效

**症状**: 返回 `API_KEY_NOT_CONFIGURED` 错误

**解决方案**:
1. 检查 `.env` 文件是否存在
2. 确认 `FBL_EXTERNAL_API_KEYS` 变量已设置
3. 重启应用服务
4. 查看应用日志确认Key已加载

```bash
# 查看日志
tail -f /var/log/jewelry-erp/app.log | grep "外部API认证"
```

### 问题2：API Key 验证失败

**症状**: 返回 `INVALID_API_KEY` 错误

**解决方案**:
1. 确认请求头中的Key与 `.env` 中配置的Key完全一致
2. 检查是否有多余的空格或换行符
3. 确认Key没有被截断

```bash
# 验证Key格式
echo "fbl_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" | wc -c  # 应该是 41 字符（包括换行）
```

### 问题3：缺少 X-API-Key 请求头

**症状**: 返回 `MISSING_API_KEY` 错误

**解决方案**:
1. 确认请求头中包含 `X-API-Key`
2. 检查请求头名称大小写是否正确（应为 `X-API-Key`）
3. 确认Key值不为空

```bash
# 正确的请求示例
curl -X GET http://localhost:8000/api/external/health \
  -H "X-API-Key: fbl_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

---

## 安全配置建议

### 1. 使用强密钥

系统生成的API Key已经足够强，格式为：
```
fbl_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx (40字符随机字符串)
```

### 2. 定期轮换密钥

建议每3个月更换一次API Key：

```bash
# 生成新Key
python -c "from app.core.api_key_auth import generate_api_key; print(generate_api_key())"

# 更新 .env 文件
# 重启服务
```

### 3. 限制调用方

在防火墙或反向代理中配置IP白名单：

```nginx
# Nginx 配置示例
location /api/external/ {
    allow 192.168.1.0/24;  # 允许内网
    allow 10.0.0.0/8;      # 允许VPN
    deny all;              # 拒绝其他
    
    proxy_pass http://backend:8000;
}
```

### 4. 启用HTTPS

在生产环境中必须使用HTTPS：

```bash
# 使用 Let's Encrypt 证书
certbot certonly --standalone -d api.example.com

# 配置 Nginx
server {
    listen 443 ssl;
    ssl_certificate /etc/letsencrypt/live/api.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.example.com/privkey.pem;
    
    location /api/external/ {
        proxy_pass http://backend:8000;
    }
}
```

### 5. 监控和日志

启用详细日志记录所有API调用：

```python
# 在 app/main.py 中已配置
# 日志会记录：
# - API Key（脱敏显示）
# - 请求时间
# - 操作类型
# - 结果状态
```

查看日志：

```bash
# 查看所有外部API调用
grep "外部API" /var/log/jewelry-erp/app.log

# 查看认证失败
grep "INVALID_API_KEY\|MISSING_API_KEY" /var/log/jewelry-erp/app.log
```

---

## 多环境配置

### 开发环境

```bash
# .env.development
FBL_EXTERNAL_API_KEYS=fbl_dev_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 测试环境

```bash
# .env.test
FBL_EXTERNAL_API_KEYS=fbl_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx,fbl_test2_yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy
```

### 生产环境

```bash
# .env.production
FBL_EXTERNAL_API_KEYS=fbl_prod_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# 建议使用密钥管理服务（如 AWS Secrets Manager）
```

---

## 集成示例

### 与第三方系统集成

```python
# third_party_system.py
import requests
import os

class FBLVoucherClient:
    def __init__(self):
        self.api_base = os.getenv('FBL_API_BASE', 'http://localhost:8000')
        self.api_key = os.getenv('FBL_API_KEY')
        self.headers = {
            'X-API-Key': self.api_key,
            'Content-Type': 'application/json'
        }
    
    def create_voucher(self, voucher_data):
        """创建凭证"""
        response = requests.post(
            f'{self.api_base}/api/external/vouchers',
            headers=self.headers,
            json=voucher_data
        )
        return response.json()
    
    def get_voucher(self, voucher_id):
        """查询凭证"""
        response = requests.get(
            f'{self.api_base}/api/external/vouchers/{voucher_id}',
            headers=self.headers
        )
        return response.json()
    
    def health_check(self):
        """健康检查"""
        response = requests.get(
            f'{self.api_base}/api/external/health',
            headers=self.headers
        )
        return response.json()

# 使用示例
if __name__ == '__main__':
    client = FBLVoucherClient()
    
    # 检查连接
    health = client.health_check()
    print(f"API状态: {health['status']}")
    
    # 创建凭证
    voucher = {
        'voucher_date': '2026-01-30',
        'voucher_type_id': 1,
        'entry_rows': [
            {'summary': '收入', 'account_id': 10, 'debit': 1000, 'credit': 0},
            {'summary': '应收', 'account_id': 20, 'debit': 0, 'credit': 1000}
        ]
    }
    result = client.create_voucher(voucher)
    print(f"凭证ID: {result['data']['id']}")
```

---

## 故障排查

### 查看完整日志

```bash
# 实时查看日志
tail -f /var/log/jewelry-erp/app.log

# 搜索特定错误
grep "ERROR" /var/log/jewelry-erp/app.log | tail -20

# 查看特定时间段的日志
grep "2026-01-30 10:" /var/log/jewelry-erp/app.log
```

### 测试数据库连接

```bash
# 测试梵贝琳财务数据库连接
python -c "
from app.fbl_database import get_fbl_db
try:
    db = next(get_fbl_db())
    print('数据库连接成功')
except Exception as e:
    print(f'数据库连接失败: {e}')
"
```

### 验证API端点

```bash
# 列出所有API端点
curl http://localhost:8000/openapi.json | python -m json.tool | grep "path"

# 查看特定端点的文档
curl http://localhost:8000/docs
```

---

## 下一步

1. 阅读 [完整API文档](./EXTERNAL_API_DOCUMENTATION.md)
2. 查看 [使用示例](./EXTERNAL_API_DOCUMENTATION.md#使用示例)
3. 集成到你的系统中
4. 定期检查日志和监控

---

## 支持

如有问题，请：
1. 检查本指南的故障排查部分
2. 查看应用日志
3. 联系系统管理员
