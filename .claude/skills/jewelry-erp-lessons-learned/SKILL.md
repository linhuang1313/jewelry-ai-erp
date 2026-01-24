---
name: jewelry-erp-lessons-learned
description: Use when writing or modifying code for the jewelry ERP project - contains project-specific bug patterns and validation rules learned from 26 historical bugs to prevent recurring issues
---

# Jewelry ERP Lessons Learned

Project-specific bug patterns and validation rules from 26 historical bugs. Use alongside generic skills (verification-before-completion, systematic-debugging, code-reviewer).

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

## Frontend TypeScript/React Checklist

| Check | Rule | Bug Reference |
|-------|------|---------------|
| Array safety | Check `array && Array.isArray(array)` before `.filter()`/`.map()` | Bug #16 |
| API response | Use `response.data` not `response` directly for customer/list APIs | Bug #15 |
| Click handlers | All clickable UI elements MUST have onClick | Bug #13 |
| API URL | Use `API_ENDPOINTS.API_BASE_URL` from config.js, never hardcode | Bug #20 |
| List display | Process both summary AND detail arrays in response | Bug #14 |

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

## Business Logic Rules

| Rule | Description | Bug Reference |
|------|-------------|---------------|
| Validate before create | Check all preconditions before creating any records | Bug #5 |
| Reserve inventory | Include pending sales in available inventory calculation | Bug #6 |
| Single supplier per order | Batch inbound must have exactly one supplier | Bug #3 |
| AI context | Include context rules for follow-up questions like "which 7?" | Bug #11 |

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

## Configuration Rules

| Rule | Description | Bug Reference |
|------|-------------|---------------|
| CORS origins | Use environment variable, not hardcoded `["*"]` | Bug #19 |
| Unicode in tests | Use ASCII characters in test output for PowerShell compatibility | Bug #18 |
| Environment variables | Store API keys, URLs in .env, use config module | Bug #20 |

## Quick Reference

**Before writing backend code, ask:**
1. Is `db.commit()` outside all loops?
2. Is there try-except with rollback?
3. Are all numeric inputs validated for type AND range?
4. Are business validations done before any creates?

**Before writing frontend code, ask:**
1. Is array checked before filter/map?
2. Is API response correctly parsed (response.data)?
3. Do all clickable elements have onClick?
4. Is API_BASE_URL from config, not hardcoded?

## Related Skills

- `jewelry-erp` - Development standards (data models, API conventions)
- `verification-before-completion` - Run tests before claiming done
- `systematic-debugging` - Debug process when issues occur
- `code-reviewer` - General code review checklist
