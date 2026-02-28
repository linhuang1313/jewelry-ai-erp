# 外部API 文档

本目录包含梵贝琳财务系统外部API的完整文档。

## 文档清单

### 1. [快速参考卡](./EXTERNAL_API_QUICK_REFERENCE.md) ⭐ 从这里开始
- API端点速查表
- 请求/响应示例
- 常见错误码
- 快速代码示例
- 参数验证规则

### 2. [完整API文档](./EXTERNAL_API_DOCUMENTATION.md)
- 详细的API说明
- 所有参数解释
- 业务规则说明
- 多语言代码示例
- 常见问题解答
- 安全建议

### 3. [快速配置指南](./EXTERNAL_API_SETUP.md)
- API Key生成方法
- 环境变量配置
- 服务重启步骤
- 配置验证方法
- 故障排查指南
- 安全配置建议

### 4. [实现总结](./EXTERNAL_API_SUMMARY.md)
- 项目完成情况
- 技术特点
- 文件清单
- 使用流程
- 扩展建议
- 测试建议

---

## 快速开始（3步）

### 第1步：生成API Key
```bash
cd backend
python -c "from app.core.api_key_auth import generate_api_key; print(generate_api_key())"
```

### 第2步：配置环境变量
```bash
# 编辑 .env 文件
echo "FBL_EXTERNAL_API_KEYS=fbl_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" >> .env
```

### 第3步：重启服务并测试
```bash
# 重启服务
pkill -f uvicorn
cd backend && uvicorn app.main:app --host 0.0.0.0 --port 8000

# 测试连接
curl -X GET http://localhost:8000/api/external/health \
  -H "X-API-Key: fbl_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

---

## 核心API端点

| 方法 | 端点 | 功能 |
|------|------|------|
| POST | `/api/external/vouchers` | 创建凭证 |
| GET | `/api/external/vouchers/{id}` | 查询凭证 |
| GET | `/api/external/health` | 健康检查 |

---

## 最小请求示例

```bash
curl -X POST http://localhost:8000/api/external/vouchers \
  -H "X-API-Key: fbl_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
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
  }'
```

---

## 文档使用建议

### 对于新用户
1. 先读 [快速参考卡](./EXTERNAL_API_QUICK_REFERENCE.md)
2. 按 [快速配置指南](./EXTERNAL_API_SETUP.md) 配置
3. 运行示例代码测试

### 对于开发者
1. 阅读 [完整API文档](./EXTERNAL_API_DOCUMENTATION.md)
2. 查看 [实现总结](./EXTERNAL_API_SUMMARY.md) 了解技术细节
3. 参考代码示例进行集成

### 对于运维人员
1. 按 [快速配置指南](./EXTERNAL_API_SETUP.md) 部署
2. 查看故障排查部分解决问题
3. 定期检查日志和监控

---

## 常见问题

**Q: 从哪里开始?**
A: 从 [快速参考卡](./EXTERNAL_API_QUICK_REFERENCE.md) 开始

**Q: 如何配置?**
A: 按 [快速配置指南](./EXTERNAL_API_SETUP.md) 操作

**Q: 如何使用?**
A: 查看 [完整API文档](./EXTERNAL_API_DOCUMENTATION.md) 中的示例

**Q: 出现问题怎么办?**
A: 查看 [快速配置指南](./EXTERNAL_API_SETUP.md) 的故障排查部分

---

## 技术栈

- **框架**: FastAPI
- **认证**: API Key (X-API-Key 请求头)
- **数据库**: PostgreSQL (梵贝琳财务系统)
- **验证**: Pydantic
- **安全**: secrets.compare_digest (防时序攻击)

---

## 关键特性

✓ API Key 身份验证  
✓ 完整的参数验证  
✓ 借贷平衡检查  
✓ 外币处理支持  
✓ 往来单位辅助核算  
✓ 详细的错误提示  
✓ 脱敏日志记录  
✓ 时序攻击防护  

---

## 文件结构

```
docs/
├── README.md (本文件)
├── EXTERNAL_API_QUICK_REFERENCE.md (快速参考卡)
├── EXTERNAL_API_DOCUMENTATION.md (完整文档)
├── EXTERNAL_API_SETUP.md (配置指南)
└── EXTERNAL_API_SUMMARY.md (实现总结)

backend/
├── app/
│   ├── core/
│   │   └── api_key_auth.py (认证模块)
│   ├── routers/
│   │   └── external_api.py (API路由)
│   └── main.py (已修改，注册路由)
```

---

## 支持

- **文档**: 本目录中的各个文件
- **日志**: `/var/log/jewelry-erp/app.log`
- **管理员**: 联系系统管理员
- **开发**: 联系开发团队

---

## 版本

- **版本**: 1.0
- **发布日期**: 2026-01-30
- **状态**: 生产就绪

---

## 许可证

本文档和相关代码受梵贝琳财务系统许可证保护。

---

## 下一步

1. 选择适合你的文档开始阅读
2. 按照配置指南部署
3. 运行示例代码测试
4. 集成到你的系统

祝你使用愉快！
