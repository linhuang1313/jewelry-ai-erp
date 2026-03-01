"""AI-driven query engine: lets AI generate structured query plans, executes them safely via ORM."""
import json
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime
from decimal import Decimal

from sqlalchemy.orm import Session
from sqlalchemy import func, desc, asc, and_, cast, Date

from .ai_parser import get_client
from .utils.decimal_utils import safe_json_value
from .models import (
    InboundOrder, InboundDetail, Inventory,
    Customer, SalesOrder, SalesDetail, Supplier,
    Location, LocationInventory,
    InventoryTransferOrder, InventoryTransferItem,
    SettlementOrder, LoanOrder, LoanDetail,
    ReturnOrder, SalesReturnOrder,
    GoldMaterialTransaction, CustomerWithdrawal,
)
from .models.finance import (
    AccountReceivable, PaymentRecord,
    AccountPayable, SupplierPayment,
)

logger = logging.getLogger(__name__)

# ── Table registry: whitelist of queryable tables and their ORM columns ──

_TABLE_REGISTRY: Dict[str, Dict[str, Any]] = {
    "sales_orders": {
        "model": SalesOrder,
        "columns": {
            "order_no": SalesOrder.order_no,
            "order_date": SalesOrder.order_date,
            "customer_name": SalesOrder.customer_name,
            "salesperson": SalesOrder.salesperson,
            "store_code": SalesOrder.store_code,
            "total_labor_cost": SalesOrder.total_labor_cost,
            "total_weight": SalesOrder.total_weight,
            "status": SalesOrder.status,
        },
        "description": "销售单主表，每条记录是一笔销售订单",
    },
    "sales_details": {
        "model": SalesDetail,
        "columns": {
            "order_id": SalesDetail.order_id,
            "product_name": SalesDetail.product_name,
            "weight": SalesDetail.weight,
            "labor_cost": SalesDetail.labor_cost,
            "total_labor_cost": SalesDetail.total_labor_cost,
        },
        "description": "销售单明细，每条记录是一个销售商品",
    },
    "customers": {
        "model": Customer,
        "columns": {
            "name": Customer.name,
            "phone": Customer.phone,
            "customer_type": Customer.customer_type,
            "total_purchase_amount": Customer.total_purchase_amount,
            "total_purchase_weight": Customer.total_purchase_weight,
            "total_purchase_count": Customer.total_purchase_count,
            "last_purchase_time": Customer.last_purchase_time,
            "status": Customer.status,
        },
        "description": "客户表，total_purchase_weight/amount/count 是全量累计值（不分年份）",
    },
    "suppliers": {
        "model": Supplier,
        "columns": {
            "name": Supplier.name,
            "phone": Supplier.phone,
            "supplier_type": Supplier.supplier_type,
            "total_supply_amount": Supplier.total_supply_amount,
            "total_supply_weight": Supplier.total_supply_weight,
            "total_supply_count": Supplier.total_supply_count,
            "last_supply_time": Supplier.last_supply_time,
            "status": Supplier.status,
        },
        "description": "供应商表",
    },
    "inbound_orders": {
        "model": InboundOrder,
        "columns": {
            "order_no": InboundOrder.order_no,
            "create_time": InboundOrder.create_time,
            "operator": InboundOrder.operator,
            "status": InboundOrder.status,
        },
        "description": "入库单主表",
    },
    "inbound_details": {
        "model": InboundDetail,
        "columns": {
            "order_id": InboundDetail.order_id,
            "product_name": InboundDetail.product_name,
            "weight": InboundDetail.weight,
            "labor_cost": InboundDetail.labor_cost,
            "supplier": InboundDetail.supplier,
            "total_cost": InboundDetail.total_cost,
            "total_amount": InboundDetail.total_amount,
        },
        "description": "入库单明细",
    },
    "inventory": {
        "model": Inventory,
        "columns": {
            "product_name": Inventory.product_name,
            "total_weight": Inventory.total_weight,
        },
        "description": "库存汇总表（按商品名汇总的总克重）",
    },
    "location_inventory": {
        "model": LocationInventory,
        "columns": {
            "product_name": LocationInventory.product_name,
            "location_id": LocationInventory.location_id,
            "weight": LocationInventory.weight,
        },
        "description": "仓位库存表（按商品+仓位的库存明细）",
    },
    "settlement_orders": {
        "model": SettlementOrder,
        "columns": {
            "settlement_no": SettlementOrder.settlement_no,
            "sales_order_id": SettlementOrder.sales_order_id,
            "payment_method": SettlementOrder.payment_method,
            "gold_price": SettlementOrder.gold_price,
            "total_weight": SettlementOrder.total_weight,
            "total_amount": SettlementOrder.total_amount,
            "labor_amount": SettlementOrder.labor_amount,
            "material_amount": SettlementOrder.material_amount,
            "status": SettlementOrder.status,
            "created_at": SettlementOrder.created_at,
            "confirmed_at": SettlementOrder.confirmed_at,
        },
        "description": "结算单表",
    },
    "transfer_orders": {
        "model": InventoryTransferOrder,
        "columns": {
            "transfer_no": InventoryTransferOrder.transfer_no,
            "from_location_id": InventoryTransferOrder.from_location_id,
            "to_location_id": InventoryTransferOrder.to_location_id,
            "status": InventoryTransferOrder.status,
            "created_by": InventoryTransferOrder.created_by,
            "created_at": InventoryTransferOrder.created_at,
        },
        "description": "转移单主表",
    },
    "loan_orders": {
        "model": LoanOrder,
        "columns": {
            "loan_no": LoanOrder.loan_no,
            "customer_name": LoanOrder.customer_name,
            "total_weight": LoanOrder.total_weight,
            "salesperson": LoanOrder.salesperson,
            "loan_date": LoanOrder.loan_date,
            "status": LoanOrder.status,
        },
        "description": "暂借单主表",
    },
    "payment_records": {
        "model": PaymentRecord,
        "columns": {
            "payment_no": PaymentRecord.payment_no,
            "payment_date": PaymentRecord.payment_date,
            "amount": PaymentRecord.amount,
            "payment_method": PaymentRecord.payment_method,
            "status": PaymentRecord.status,
        },
        "description": "收款记录表",
    },
    "gold_material_transactions": {
        "model": GoldMaterialTransaction,
        "columns": {
            "transaction_no": GoldMaterialTransaction.transaction_no,
            "transaction_type": GoldMaterialTransaction.transaction_type,
            "customer_name": GoldMaterialTransaction.customer_name,
            "supplier_name": GoldMaterialTransaction.supplier_name,
            "gold_weight": GoldMaterialTransaction.gold_weight,
            "status": GoldMaterialTransaction.status,
            "created_at": GoldMaterialTransaction.created_at,
        },
        "description": "金料流转记录表（收料SL/付料FL），transaction_type: income=收料, expense=付料",
    },
    "customer_withdrawals": {
        "model": CustomerWithdrawal,
        "columns": {
            "withdrawal_no": CustomerWithdrawal.withdrawal_no,
            "customer_name": CustomerWithdrawal.customer_name,
            "gold_weight": CustomerWithdrawal.gold_weight,
            "withdrawal_type": CustomerWithdrawal.withdrawal_type,
            "status": CustomerWithdrawal.status,
            "created_at": CustomerWithdrawal.created_at,
        },
        "description": "客户提料/取料记录表，status: pending/completed/cancelled",
    },
}

# ── Schema description for AI prompt ──

def _build_schema_description() -> str:
    lines = []
    for tbl_name, tbl_info in _TABLE_REGISTRY.items():
        cols = ", ".join(tbl_info["columns"].keys())
        lines.append(f"- {tbl_name}（{tbl_info['description']}）: {cols}")
    return "\n".join(lines)

SCHEMA_DESC = _build_schema_description()

# Joins the AI can use
ALLOWED_JOINS = {
    ("sales_orders", "sales_details"): ("sales_orders.id", "sales_details.order_id"),
    ("sales_orders", "settlement_orders"): ("sales_orders.id", "settlement_orders.sales_order_id"),
    ("inbound_orders", "inbound_details"): ("inbound_orders.id", "inbound_details.order_id"),
    ("customers", "sales_orders"): ("customers.name", "sales_orders.customer_name"),
}

QUERY_PLAN_PROMPT = """你是数据查询助手。根据用户问题，生成一个 JSON 查询计划。

## 可用表和字段
{schema}

## 可用关联
- sales_orders + sales_details（通过 sales_orders.id = sales_details.order_id）
- sales_orders + settlement_orders（通过 sales_orders.id = settlement_orders.sales_order_id）
- inbound_orders + inbound_details（通过 inbound_orders.id = inbound_details.order_id）
- customers + sales_orders（通过 customers.name = sales_orders.customer_name）

## 查询计划 JSON 格式
{{
  "table": "主表名",
  "join": "关联表名（可选，不需要关联时省略）",
  "filters": {{
    "字段名": "精确匹配值",
    "字段名__gte": "大于等于",
    "字段名__lte": "小于等于",
    "字段名__contains": "模糊匹配"
  }},
  "group_by": "分组字段（可选）",
  "aggregates": {{
    "别名": {{"func": "sum/count/avg/max/min", "field": "字段名"}}
  }},
  "select": ["需要返回的字段列表（可选，默认返回主要字段）"],
  "order_by": "字段名 ASC/DESC（可选）",
  "limit": 50
}}

## 重要规则
1. 只使用上面列出的表和字段，不要编造
2. 日期过滤用 __gte 和 __lte，格式 YYYY-MM-DD
3. 需要跨表统计时用 join + group_by + aggregates
4. 今天是 {today}
5. 如果用户问"最大/最多/排名"，用 group_by + aggregates + order_by DESC + limit
6. 如果用户没指定时间范围，不要加日期过滤
7. limit 默认 50，用户要求"全部"时设为 500

## 对话上下文
{context}

## 用户问题
{question}

只返回 JSON，不要解释。"""


def generate_query_plan(
    question: str,
    context: str = "",
    today: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Call AI to generate a structured query plan from a natural language question."""
    if not today:
        today = datetime.now().strftime("%Y-%m-%d")

    prompt = QUERY_PLAN_PROMPT.format(
        schema=SCHEMA_DESC,
        today=today,
        context=context,
        question=question,
    )

    try:
        resp = get_client().chat.completions.create(
            model="deepseek-chat",
            max_tokens=600,
            temperature=0.0,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": "你是数据查询助手，只输出JSON查询计划。"},
                {"role": "user", "content": prompt},
            ],
        )
        content = resp.choices[0].message.content.strip()
        plan = json.loads(content)
        logger.info(f"[QueryEngine] AI query plan: {json.dumps(plan, ensure_ascii=False)}")
        return plan
    except Exception as e:
        logger.error(f"[QueryEngine] Failed to generate query plan: {e}")
        return None


def _safe_value(val):
    """Convert Decimal/datetime to JSON-friendly types."""
    return safe_json_value(val)


def execute_query_plan(plan: Dict[str, Any], db: Session) -> Dict[str, Any]:
    """Execute a validated query plan against the database using ORM. Returns results dict."""
    table_name = plan.get("table")
    if table_name not in _TABLE_REGISTRY:
        return {"success": False, "error": f"未知的表: {table_name}"}

    tbl = _TABLE_REGISTRY[table_name]
    model = tbl["model"]
    columns = tbl["columns"]

    join_table_name = plan.get("join")
    join_model = None
    join_columns = {}
    if join_table_name:
        if join_table_name not in _TABLE_REGISTRY:
            return {"success": False, "error": f"未知的关联表: {join_table_name}"}
        pair = (table_name, join_table_name)
        reverse_pair = (join_table_name, table_name)
        if pair not in ALLOWED_JOINS and reverse_pair not in ALLOWED_JOINS:
            return {"success": False, "error": f"不支持的关联: {table_name} + {join_table_name}"}
        join_model = _TABLE_REGISTRY[join_table_name]["model"]
        join_columns = _TABLE_REGISTRY[join_table_name]["columns"]

    # ── Build query ──
    group_by_field = plan.get("group_by")
    aggregates = plan.get("aggregates", {})

    if group_by_field and aggregates:
        # Aggregation query
        all_cols = {**columns, **join_columns}
        if group_by_field not in all_cols:
            return {"success": False, "error": f"未知的分组字段: {group_by_field}"}

        select_exprs = [all_cols[group_by_field].label(group_by_field)]
        agg_labels = []
        for alias, agg_def in aggregates.items():
            agg_func_name = agg_def.get("func", "sum")
            agg_field = agg_def.get("field")
            if agg_field not in all_cols:
                return {"success": False, "error": f"未知的聚合字段: {agg_field}"}
            col = all_cols[agg_field]
            if agg_func_name == "sum":
                select_exprs.append(func.sum(col).label(alias))
            elif agg_func_name == "count":
                select_exprs.append(func.count(col).label(alias))
            elif agg_func_name == "avg":
                select_exprs.append(func.avg(col).label(alias))
            elif agg_func_name == "max":
                select_exprs.append(func.max(col).label(alias))
            elif agg_func_name == "min":
                select_exprs.append(func.min(col).label(alias))
            else:
                return {"success": False, "error": f"未知的聚合函数: {agg_func_name}"}
            agg_labels.append(alias)

        query = db.query(*select_exprs)
        if join_model:
            query = _apply_join(query, model, join_model, table_name, join_table_name)
        query = _apply_filters(query, plan.get("filters", {}), columns, join_columns)
        query = query.group_by(all_cols[group_by_field])

        # Order by aggregate
        order_by_str = plan.get("order_by", "")
        if order_by_str:
            parts = order_by_str.strip().split()
            ob_field = parts[0]
            ob_dir = parts[1].upper() if len(parts) > 1 else "DESC"
            if ob_field in all_cols:
                query = query.order_by(desc(all_cols[ob_field]) if ob_dir == "DESC" else asc(all_cols[ob_field]))
            elif ob_field in [a for a in aggregates]:
                # order by aggregate alias — use the expression
                for expr in select_exprs:
                    if hasattr(expr, 'key') and expr.key == ob_field:
                        query = query.order_by(desc(expr) if ob_dir == "DESC" else asc(expr))
                        break

        limit = min(int(plan.get("limit", 50)), 500)
        query = query.limit(limit)

        rows = query.all()
        results = []
        for row in rows:
            r = {group_by_field: _safe_value(getattr(row, group_by_field, None))}
            for alias in agg_labels:
                r[alias] = _safe_value(getattr(row, alias, None))
            results.append(r)

        return {"success": True, "count": len(results), "data": results}

    else:
        # Simple select query
        select_fields = plan.get("select", list(columns.keys())[:8])
        valid_cols = {**columns, **join_columns}
        select_exprs = []
        selected_names = []
        for f in select_fields:
            if f in valid_cols:
                select_exprs.append(valid_cols[f].label(f))
                selected_names.append(f)

        if not select_exprs:
            select_exprs = [columns[k].label(k) for k in list(columns.keys())[:6]]
            selected_names = list(columns.keys())[:6]

        query = db.query(*select_exprs)
        if join_model:
            query = _apply_join(query, model, join_model, table_name, join_table_name)
        query = _apply_filters(query, plan.get("filters", {}), columns, join_columns)

        order_by_str = plan.get("order_by", "")
        if order_by_str:
            parts = order_by_str.strip().split()
            ob_field = parts[0]
            ob_dir = parts[1].upper() if len(parts) > 1 else "DESC"
            if ob_field in valid_cols:
                query = query.order_by(desc(valid_cols[ob_field]) if ob_dir == "DESC" else asc(valid_cols[ob_field]))

        limit = min(int(plan.get("limit", 50)), 500)
        query = query.limit(limit)

        rows = query.all()
        results = []
        for row in rows:
            r = {}
            for name in selected_names:
                r[name] = _safe_value(getattr(row, name, None))
            results.append(r)

        return {"success": True, "count": len(results), "data": results}


def _apply_join(query, model, join_model, table_name, join_table_name):
    """Apply a join based on ALLOWED_JOINS registry."""
    pair = (table_name, join_table_name)
    reverse_pair = (join_table_name, table_name)

    if pair in ALLOWED_JOINS:
        left_str, right_str = ALLOWED_JOINS[pair]
    else:
        left_str, right_str = ALLOWED_JOINS[reverse_pair]

    left_tbl, left_col = left_str.split(".")
    right_tbl, right_col = right_str.split(".")

    left_model = _TABLE_REGISTRY[left_tbl]["model"]
    right_model = _TABLE_REGISTRY[right_tbl]["model"]

    return query.join(right_model, getattr(left_model, left_col) == getattr(right_model, right_col))


def _apply_filters(query, filters: Dict, columns: Dict, join_columns: Dict = None):
    """Apply filter conditions from the plan to the query."""
    all_cols = {**columns}
    if join_columns:
        all_cols.update(join_columns)

    for key, value in filters.items():
        if "__gte" in key:
            field_name = key.replace("__gte", "")
            if field_name in all_cols:
                col = all_cols[field_name]
                if "date" in field_name.lower() or "time" in field_name.lower() or "created_at" in field_name:
                    query = query.filter(cast(col, Date) >= value)
                else:
                    query = query.filter(col >= value)
        elif "__lte" in key:
            field_name = key.replace("__lte", "")
            if field_name in all_cols:
                col = all_cols[field_name]
                if "date" in field_name.lower() or "time" in field_name.lower() or "created_at" in field_name:
                    query = query.filter(cast(col, Date) <= value)
                else:
                    query = query.filter(col <= value)
        elif "__contains" in key:
            field_name = key.replace("__contains", "")
            if field_name in all_cols:
                query = query.filter(all_cols[field_name].contains(str(value)))
        else:
            if key in all_cols:
                query = query.filter(all_cols[key] == value)

    return query


def format_query_result(plan: Dict, result: Dict) -> str:
    """Format query results into a concise text for AI summarization."""
    if not result.get("success"):
        return f"查询失败: {result.get('error', '未知错误')}"

    data = result.get("data", [])
    if not data:
        return "查询结果为空，没有找到匹配的数据。"

    lines = [f"查询到 {result['count']} 条结果：\n"]
    for i, row in enumerate(data[:100], 1):
        parts = [f"{k}={v}" for k, v in row.items() if v is not None]
        lines.append(f"{i}. {', '.join(parts)}")

    return "\n".join(lines)


SUMMARIZE_PROMPT = """你是珠宝ERP系统AI助手。根据查询结果回答用户问题。

用户问题：{question}

查询结果：
{result_text}

要求：
1. 直接回答用户问题，简洁明了
2. 如果有数字，保留合理精度（克重保留2位小数，金额保留整数）
3. 如果结果为空，直接说没有找到相关数据
4. 不要编造数据，严格基于查询结果回答
5. 适当使用 markdown 格式（加粗关键数字）"""


def summarize_result(question: str, result_text: str) -> str:
    """Call AI to summarize query results into a natural language answer."""
    prompt = SUMMARIZE_PROMPT.format(question=question, result_text=result_text)
    try:
        resp = get_client().chat.completions.create(
            model="deepseek-chat",
            max_tokens=1000,
            temperature=0.3,
            messages=[
                {"role": "system", "content": "你是珠宝ERP系统AI助手，回答简洁专业。"},
                {"role": "user", "content": prompt},
            ],
        )
        return resp.choices[0].message.content.strip()
    except Exception as e:
        logger.error(f"[QueryEngine] Summarize failed: {e}")
        return f"查询结果：\n{result_text}"


def summarize_result_stream(question: str, result_text: str):
    """Stream AI summary of query results, yielding chunks."""
    prompt = SUMMARIZE_PROMPT.format(question=question, result_text=result_text)
    try:
        stream = get_client().chat.completions.create(
            model="deepseek-chat",
            max_tokens=1000,
            temperature=0.3,
            stream=True,
            messages=[
                {"role": "system", "content": "你是珠宝ERP系统AI助手，回答简洁专业。"},
                {"role": "user", "content": prompt},
            ],
        )
        for chunk in stream:
            if chunk.choices and chunk.choices[0].delta and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content
    except Exception as e:
        logger.error(f"[QueryEngine] Stream summarize failed: {e}")
        yield f"查询结果：\n{result_text}"


# ── Query-type intents that should use the new engine ──

QUERY_INTENTS = {
    "查询库存", "查询入库单", "查询销售单", "销售数据查询",
    "查询客户", "查询供应商", "查询转移单", "查询暂借单",
    "查询对账单", "查询凭证", "查询结算单", "供应商分析", "统计分析",
    "查询金料记录",
}


def is_query_intent(intent: str) -> bool:
    return intent in QUERY_INTENTS
