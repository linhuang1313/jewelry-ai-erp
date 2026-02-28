# Bug 报告和修复状态

> 最后更新: 2026-01-24

## 修复状态总览

| 问题 | 优先级 | 状态 | 修复位置 |
|------|--------|------|----------|
| 1. 数据库事务问题 | 🔴 严重 | ✅ 已修复 | `main.py:2385-2392`, `main.py:2909-2914` |
| 2. 多商品入库独立入库单 | 🔴 严重 | ✅ 已修复 | `main.py:2733-2736` |
| 3. JSON 变量作用域问题 | 🔴 严重 | ✅ 已修复 | `ai_parser.py:1031` |
| 4. 工费未验证负数 | 🟡 中等 | ✅ 已修复 | `main.py:2016-2022` |
| 5. 缺少 try-except 块 | 🟡 中等 | ✅ 已修复 | 入库函数已添加完整错误处理 |
| 6. 类型转换错误处理 | 🟡 中等 | ✅ 已修复 | `main.py:1996-2005` |
| 7. OCR 图片预处理 | 🟡 中等 | ✅ 已废弃 | 改用百度云 OCR |
| 8. CORS 配置 | 🟢 轻微 | ✅ 已修复 | `main.py:123-132` 使用环境变量 |
| 9. 日志级别不一致 | 🟢 轻微 | ⚪ 低优先级 | 不影响功能 |
| 10. 前端错误处理 | 🟢 轻微 | ✅ 已改进 | 已有超时和网络错误处理 |
| 11. 代码重复 | 🟢 轻微 | ⚪ 低优先级 | 不影响功能 |
| 12. 硬编码 API URL | 🟢 轻微 | ✅ 已修复 | `config.js` 使用环境变量 |

---

## ✅ 已修复问题详情

### 1. 数据库事务问题 - `已修复`

**原问题**：在入库操作中，每个商品都在循环内部调用 `db.commit()`，导致数据不一致。

**修复方案**：
- `execute_inbound` 函数（第2385-2392行）添加了 try-except 块和 `db.rollback()`
- `create_batch_inbound_orders` 函数（第2909-2914行）添加了 try-except 块和 `db.rollback()`
- 所有操作在同一事务中完成，异常时回滚整个事务

---

### 2. 多商品入库逻辑问题 - `已修复`

**原问题**：每个商品都创建一个新的入库单号。

**修复方案**：
- `create_batch_inbound_orders` 函数在循环前创建一个入库单（第2733-2736行）
- 所有商品共享同一个入库单 ID（`order_id=order.id`）

---

### 3. 变量作用域问题 - `已修复`

**原问题**：在 JSON 解析错误处理中，`content` 变量可能未定义。

**修复方案**：
- `ai_parser.py` 第1031行添加了变量初始化：`content = ""  # 初始化变量，避免作用域问题`

---

### 4. 工费验证不完整 - `已修复`

**原问题**：验证逻辑没有检查工费是否为负数。

**修复方案**：
- `handle_inbound` 函数第2016-2022行添加了负数验证：
```python
if labor_cost < 0:
    validation_errors.append({
        "index": idx + 1,
        "message": f"工费不能为负数: {labor_cost}",
        "product": product.model_dump()
    })
```

---

### 5. 错误处理不完整 - `已修复`

**原问题**：入库函数没有 try-except 块。

**修复方案**：
- `execute_inbound` 和 `create_batch_inbound_orders` 都有完整的 try-except 块
- 异常时调用 `db.rollback()` 并返回友好错误消息

---

### 6. 类型转换错误处理 - `已修复`

**原问题**：`float()` 转换没有 try-except。

**修复方案**：
- `handle_inbound` 函数第1996-2005行添加了 try-except 处理 ValueError/TypeError

---

### 7. OCR 图片预处理 - `已废弃`

**原问题**：图片读取失败时错误处理不够详细。

**当前状态**：
- `ocr_parser.py` 已废弃本地 OCR 功能
- 改用百度云 OCR（`baidu_ocr.py`）
- 问题不再适用

---

### 8. CORS 配置 - `已修复`

**原问题**：`allow_origins=["*"]` 硬编码。

**修复方案**：
- `main.py` 第123-132行使用环境变量控制：
  - `CORS_ALLOW_ALL` 环境变量控制是否允许所有域名
  - `CORS_ALLOWED_ORIGINS` 可配置具体域名列表

---

### 12. 硬编码 API URL - `已修复`

**原问题**：API URL 硬编码为 `http://localhost:8000`。

**修复方案**：
- `frontend/src/config.js` 使用环境变量：
```javascript
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
```
- 所有组件使用 `API_ENDPOINTS.API_BASE_URL` 引用

---

## ⚪ 低优先级问题

### 9. 日志级别不一致

**问题**：使用 `logger.debug()` 但日志级别设置为 INFO。

**状态**：低优先级，不影响功能。debug 日志在开发调试时可以通过调整日志级别启用。

---

### 10. 前端错误处理 - `已改进`

**问题**：某些 API 调用没有处理网络错误或超时。

**当前状态**：
- `App.jsx` 已有超时检测（AbortError 处理）
- 已有网络错误检测（TypeError + fetch 检查）
- 返回友好错误消息

---

### 11. 代码重复

**问题**：消息处理逻辑在多处重复。

**状态**：低优先级，代码可读性优先。可在未来重构时提取公共函数。

---

## 📋 维护建议

1. **定期运行数据库检查脚本**：`python check_database.py`
2. **生产环境配置**：确保设置 `CORS_ALLOWED_ORIGINS` 为具体域名
3. **前端部署**：确保设置 `VITE_API_BASE_URL` 环境变量
