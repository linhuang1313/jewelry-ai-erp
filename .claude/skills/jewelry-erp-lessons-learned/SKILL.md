---
name: jewelry-erp-lessons-learned
description: Use when writing or modifying code for the jewelry ERP project - contains project-specific bug patterns and validation rules learned from 31 historical bugs to prevent recurring issues
---

# Jewelry ERP Lessons Learned

Project-specific bug patterns and validation rules from 31 historical bugs. Use alongside generic skills (verification-before-completion, systematic-debugging, code-reviewer).

## When to Use

- Writing any code involving `db.commit()` or database transactions
- Writing numeric validation logic (weight, labor_cost, amounts)
- Parsing API responses in frontend
- Implementing business logic with ordering dependencies
- Creating UI elements that should be interactive

## Backend Python Checklist

| Check | Rule | Bug Reference |
|-------|------|---------------|
| Transaction atomicity | `db.commit()` MUST be outside loops, wrap in try-except with `db.rollback()` | Bug #2 |
| Batch operations | One order per batch, all items share same order_id | Bug #3 |
| Variable scope | Initialize variables before try blocks (e.g., `content = ""`) | Bug #8 |
| Numeric validation | Check `>= 0` not just `is not None` for labor_cost | Bug #7 |
| Weight validation | Check `> 0` for weight fields | Bug #7 |
| Type conversion | Wrap `float()`/`int()` in try-except | Bug #10 |
| Date parsing | `datetime.fromisoformat()` needs try-except with default fallback | Bug #9 |
| Business order | Validate first, then create (inventory check -> customer create) | Bug #5 |
| Available inventory | Calculate: total_weight - reserved_weight (pending sales) | Bug #6 |
| f-string escaping | Use `{{var}}` for literal braces in f-strings, not `{var}` | Bug #27 |
| Route ordering | Static routes (`/chat-debt-query`) MUST be defined before dynamic routes (`/{id}`) | Bug #28 |
| 数据导入 ID 唯一性 | 导入脚本不要手动指定 id，让数据库序列自增；重复 id 会被 SQLAlchemy identity map 静默去重，导致 API 丢数据 | Bug #31 |

### Transaction Pattern

```python
# BAD - Bug #2: Partial commit on failure
for item in items:
    db.add(item)
    db.commit()  # If item 3 fails, items 1-2 already committed

# GOOD
try:
    for item in items:
        db.add(item)
    db.commit()  # All or nothing
except Exception:
    db.rollback()
    raise
```

### Validation Pattern

```python
# BAD - Bug #7: Missing negative check
if labor_cost is None:
    return error

# GOOD
if labor_cost is None or labor_cost < 0:
    return {"error": "Labor cost must be >= 0"}

if weight is None or weight <= 0:
    return {"error": "Weight must be > 0"}
```

### Type Conversion Pattern

```python
# BAD - Bug #10: No error handling
weight = float(product.weight)
labor_cost = float(product.labor_cost)

# GOOD
try:
    weight = float(product.weight)
    labor_cost = float(product.labor_cost)
except (ValueError, TypeError) as e:
    return {"error": f"Invalid numeric value: {e}"}
```

### Variable Scope Pattern

```python
# BAD - Bug #8: Variable undefined if first try fails
while retry_count < max_retries:
    try:
        content = api_call()  # If fails on first try, content undefined
        break
    except:
        retry_count += 1
# content may be undefined here

# GOOD
content = ""  # Initialize before loop
while retry_count < max_retries:
    try:
        content = api_call()
        break
    except:
        retry_count += 1
```

### f-string Escaping Pattern

```python
# BAD - Bug #27: Literal braces interpreted as variables
prompt = f"""
显示方式：
- cash_debt > 0：显示"欠款 ¥{cash_debt}"
"""  # NameError: name 'cash_debt' is not defined

# GOOD - Double braces for literal output
prompt = f"""
显示方式：
- cash_debt > 0：显示"欠款 ¥{{cash_debt}}"
"""  # Outputs: 欠款 ¥{cash_debt}
```

### FastAPI Route Ordering Pattern

```python
# BAD - Bug #28: Static route after dynamic route
@router.get("/{customer_id}")  # Line 330
async def get_customer(customer_id: int): ...

@router.get("/chat-debt-query")  # Line 1028 - NEVER REACHED!
async def chat_debt_query(): ...
# Request to /chat-debt-query returns 422: "unable to parse string as integer"

# GOOD - Static routes first
@router.get("/chat-debt-query")  # Static route FIRST
async def chat_debt_query(): ...

@router.get("/{customer_id}")  # Dynamic route AFTER
async def get_customer(customer_id: int): ...
```

### SQLAlchemy Identity Map Dedup Pattern

```python
# BAD - Bug #31: 导入脚本手动指定 id，与已有记录 id 冲突
# 数据库允许插入（无主键约束或约束被绕过），但 SQLAlchemy identity map 按主键去重
# db.query(Model).all() 静默丢弃重复 id 的第二条记录，API 不报错只是少数据
session.execute(text(
    "INSERT INTO product_codes (id, code, name, code_type) "
    "VALUES (2, 'YB046', '足金', 'predefined')"
))  # id=2 已被 JPSZ 占用 → API 返回 JPSZ，YB046 被丢弃

# GOOD: 不指定 id，让序列自增
session.execute(text(
    "INSERT INTO product_codes (code, name, code_type) "
    "VALUES ('YB046', '足金', 'predefined')"
))

# 修复已有重复 id:
# 1. 重置序列到最大值:
#    SELECT setval('product_codes_id_seq', (SELECT MAX(id) FROM product_codes));
# 2. 给重复记录分配新 id:
#    UPDATE product_codes SET id = nextval('product_codes_id_seq')
#    WHERE code IN ('YB046', 'JPJC', ...);
```

**症状**: 数据库 `SELECT count(*)` 返回 69 条，API 只返回 60 条，无报错。  
**排查**: 对比数据库完整列表与 API 返回列表，发现缺失记录与其他记录共享相同 id。  
**根因**: 导入脚本用 raw SQL 插入时手动指定了小 id 值，与系统初始化数据的 id 冲突。

## Frontend TypeScript/React Checklist

| Check | Rule | Bug Reference |
|-------|------|---------------|
| Array safety | Check `array && Array.isArray(array)` before `.filter()`/`.map()` | Bug #16 |
| API response | Use `response.data` not `response` directly for customer/list APIs | Bug #15 |
| Click handlers | All clickable UI elements MUST have onClick | Bug #13 |
| API URL | Use `API_ENDPOINTS.API_BASE_URL` from config.js, never hardcode | Bug #20 |
| List display | Process both summary AND detail arrays in response | Bug #14 |
| API endpoint | Verify endpoint exists in backend router BEFORE writing fetch call; copy URL pattern from existing code | Bug #29 |

### Array Safety Pattern

```typescript
// BAD - Bug #16: Crashes if data undefined
const filtered = customers.filter(c => c.active)

// GOOD
const filtered = customers && Array.isArray(customers) 
  ? customers.filter(c => c.active) 
  : []
```

### API Response Pattern

```typescript
// BAD - Bug #15: Wrong data path
const response = await fetch('/api/customers')
const customers = await response.json()
// customers is {success: true, data: [...]} not the array!

// GOOD
const response = await fetch('/api/customers')
const result = await response.json()
const customers = result.data || []
if (Array.isArray(customers)) {
  // Safe to use
}
```

### API URL Pattern

```typescript
// BAD - Bug #20: Hardcoded URL
fetch('http://localhost:8000/api/customers')

// GOOD
import { API_ENDPOINTS } from '../config'
fetch(`${API_ENDPOINTS.API_BASE_URL}/api/customers`)
```

### Click Handler Pattern

```tsx
// BAD - Bug #13: No click handler
<div className="cursor-pointer">
  <span>Click me</span>
</div>

// GOOD
<div 
  className="cursor-pointer"
  onClick={() => handleClick()}
>
  <span>Click me</span>
</div>
```

### API Endpoint Verification Pattern

```typescript
// BAD - Bug #29: Assumed endpoint exists without checking backend
fetch(`${API_BASE}/api/customers/search?q=${keyword}`)
// 422 error - /search matched by /{customer_id} dynamic route

// GOOD - Check backend router first, copy from existing code
// 1. grep backend router: @router.get("") with search param
// 2. find existing frontend usage: QuickOrderModal.tsx
fetch(`${API_BASE}/api/customers?search=${keyword}&page_size=50`)
```

## Business Logic Rules

| Rule | Description | Bug Reference |
|------|-------------|---------------|
| Validate before create | Check all preconditions before creating any records | Bug #5 |
| Reserve inventory | Include pending sales in available inventory calculation | Bug #6 |
| Single supplier per order | Batch inbound must have exactly one supplier | Bug #3 |
| AI context | Include context rules for follow-up questions like "which 7?" | Bug #11 |
| AI fallback classify | Rule-based 预分类的兜底路径不能直接返回固定值，必须有二次确认机制（调 AI 或提示用户重试） | Bug #30 |

### Business Order Pattern

```python
# BAD - Bug #5: Create before validate
customer = create_customer(data)  # Created!
if not check_inventory(items):    # Oops, not enough stock
    return error  # Customer record orphaned

# GOOD
if not check_inventory(items):
    return error  # Early exit, nothing created
customer = create_customer(data)  # Safe to create now
```

### AI Intent Classification Fallback Pattern

```python
# BAD - Bug #30: 兜底直接返回固定分类，口语化输入（"欠我们多少钱"）被误分为闲聊
def pre_classify(message):
    if any(kw in message for kw in finance_keywords):  # "欠款"在列表中但"欠"不在
        return "finance"
    return "system"  # 所有未匹配的都被当作 system/闲聊

# GOOD: 关键词未匹配时，调 AI 做轻量级分类兜底
def pre_classify(message):
    if any(kw in message for kw in finance_keywords):  # 包含口语化关键词
        return "finance"
    return _fallback_classify(message)  # 调 DeepSeek 分类，失败才返回 system
```

**适用场景**: 任何 rule-based 的预分类/路由系统——关键词永远无法穷举用户表达方式，兜底路径必须有智能回退机制。

## Configuration Rules

| Rule | Description | Bug Reference |
|------|-------------|---------------|
| CORS origins | Use environment variable, not hardcoded `["*"]` | Bug #19 |
| Unicode in tests | Use ASCII characters in test output for PowerShell compatibility | Bug #18 |
| Environment variables | Store API keys, URLs in .env, use config module | Bug #20 |

## 给用户提供命令的规则

用户在远程服务器上使用 **PowerShell**，不会直接使用 SQL 命令。提供数据库操作命令时必须遵守：

1. **永远给 psql 命令**，不要给裸 SQL。用户只会在 PowerShell 中输入命令。
2. **用双引号包裹 SQL**：`psql -U postgres -d railway -c "SELECT ..."`
3. **避免 PowerShell 特殊字符**：`|`、`$`、`()`、`&&` 等会被 PowerShell 解析。如果 SQL 中必须用到，改用 Python 脚本执行。
4. **链式命令用分号 `;`**，不要用 `&&`（PowerShell 旧版本不支持）。
5. **git commit 不要用 heredoc**：`$(cat <<'EOF' ... EOF)` 语法在 PowerShell 中完全不支持，会报 `MissingFileSpecification` 错误。直接用 `-m "简短描述"` 即可。
6. **git commit 不要加 `--trailer`**：Cursor 自动注入的 `--trailer "Made-with: Cursor"` 与 heredoc 组合在 PowerShell 下必然报错，使用简单的 `-m` 参数。

```powershell
# BAD: 裸 SQL，用户不知道怎么执行
SELECT code, name FROM product_codes WHERE code = 'JPJC';

# BAD: PowerShell 会把 | 解析为管道
psql -U postgres -d railway -c "SELECT code | name FROM ..."

# BAD: && 在旧版 PowerShell 不支持
git add . && git commit -m "msg"

# BAD: heredoc 在 PowerShell 中不支持，报 MissingFileSpecification
git commit -m "$(cat <<'EOF'
fix: some description
EOF
)"

# BAD: --trailer 与 heredoc 组合在 PowerShell 下报错
git commit --trailer "Made-with: Cursor" -m "$(cat <<'EOF'
fix: some description
EOF
)"

# GOOD: 完整的 psql 命令，双引号包裹，避免特殊字符
psql -U postgres -d railway -c "SELECT code, name FROM product_codes WHERE code = 'JPJC';"

# GOOD: 需要复杂查询时用 Python
python -c "import json; ..."

# GOOD: git commit 直接用 -m，不用 heredoc 和 --trailer
git commit -m "fix: null guard for supplier stats in confirm_inbound_order"
```

## Quick Reference

**Before writing backend code, ask:**
1. Is `db.commit()` outside all loops?
2. Is there try-except with rollback?
3. Are all numeric inputs validated for type AND range?
4. Are business validations done before any creates?
5. Do f-strings with literal `{var}` need `{{var}}` escaping?
6. Are static routes defined before dynamic routes (e.g., `/{id}`)?
7. Do import scripts avoid manually specifying id? (Let DB sequence auto-increment)

**Before writing frontend code, ask:**
1. Is array checked before filter/map?
2. Is API response correctly parsed (response.data)?
3. Do all clickable elements have onClick?
4. Is API_BASE_URL from config, not hardcoded?
5. Is the API endpoint verified to exist in backend? (grep router file, check existing frontend calls)

## Related Skills

- `jewelry-erp` - Development standards (data models, API conventions)
- `verification-before-completion` - Run tests before claiming done
- `systematic-debugging` - Debug process when issues occur
- `code-reviewer` - General code review checklist
