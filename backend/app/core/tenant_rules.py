# -*- coding: utf-8 -*-
"""
租户规则装饰器 — HTTP 桥接版

通过 HTTP 调用远程 jewelry-chat-config 服务的 /api/config/apply 端点，
彻底解耦，无需在同一机器上部署 jewelry-chat-config。

四层安全防护：
  1. 总开关 ENABLE_CUSTOM_RULES=False → 装饰器 = 透明代理
  2. HTTP 桥接 → httpx 异步调用，timeout=3s，不阻塞主业务
  3. 影子模式 DRY_RUN_MODE=True → 只打日志不改数据
  4. 异常兜底 → 任何异常只打 ERROR 日志，return original_result
"""
import os
import logging
import functools
from typing import Callable, Dict, Any, List, Tuple, Optional

logger = logging.getLogger("tenant_rules")

# ============================================================
# 配置读取
# ============================================================

ENABLE_CUSTOM_RULES = os.getenv("ENABLE_CUSTOM_RULES", "false").lower() == "true"
DRY_RUN_MODE = os.getenv("DRY_RUN_MODE", "true").lower() == "true"
RULE_ENGINE_BASE_URL = os.getenv("RULE_ENGINE_BASE_URL", "http://localhost:8001")

logger.info(
    f"[TenantRules] ENABLE={ENABLE_CUSTOM_RULES}, "
    f"DRY_RUN={DRY_RUN_MODE}, "
    f"ENGINE_URL={RULE_ENGINE_BASE_URL}"
)


# ============================================================
# 装饰器入口
# ============================================================

def apply_tenant_rules(trigger_point: str):
    """异步装饰器：在业务函数执行前后，通过 HTTP 调用规则引擎

    如果总开关关闭 → 完全透明代理
    如果网络不通/超时/异常 → 返回原结果，绝不崩溃
    """
    if not ENABLE_CUSTOM_RULES:
        def nop_decorator(func: Callable):
            @functools.wraps(func)
            async def wrapper(*args, **kwargs):
                return await func(*args, **kwargs)
            return wrapper
        return nop_decorator

    def decorator(func: Callable):
        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            try:
                # Step 1: 提取业务上下文
                try:
                    context, tenant_id = _extract_context(trigger_point, args, kwargs)
                except Exception as e:
                    logger.error(f"[TenantRules] 上下文提取失败 ({trigger_point}): {e}")
                    return await func(*args, **kwargs)

                # Step 2: 执行原函数
                original_result = await func(*args, **kwargs)

                # Step 3: HTTP 调用远程规则引擎
                try:
                    rule_result = await _call_rule_engine(tenant_id, trigger_point, context)
                except Exception as e:
                    logger.error(f"[TenantRules] 规则引擎调用失败 ({trigger_point}): {e}")
                    return original_result

                if rule_result is None:
                    return original_result

                # Step 4: Dry Run 判断
                if DRY_RUN_MODE:
                    _log_dry_run(trigger_point, rule_result)
                    return original_result

                # Step 5: 实际应用
                return _apply_to_result(original_result, rule_result, trigger_point)

            except Exception as e:
                logger.error(f"[TenantRules] 装饰器异常兜底 ({trigger_point}): {e}", exc_info=True)
                return await func(*args, **kwargs)

        return wrapper
    return decorator


# ============================================================
# HTTP 调用规则引擎
# ============================================================

async def _call_rule_engine(tenant_id: str, trigger_point: str, context: dict) -> Optional[dict]:
    """通过 HTTP 调用 jewelry-chat-config 的 /api/config/apply"""
    try:
        import httpx
    except ImportError:
        logger.warning("[TenantRules] httpx 未安装，跳过规则引擎调用")
        return None

    url = f"{RULE_ENGINE_BASE_URL}/api/config/apply"
    payload = {
        "tenant_id": tenant_id,
        "trigger_point": trigger_point,
        "context": context,
    }

    async with httpx.AsyncClient(timeout=3.0) as client:
        response = await client.post(url, json=payload)
        response.raise_for_status()
        data = response.json()

    if not data.get("success"):
        logger.warning(f"[TenantRules] 规则引擎返回失败: {data}")
        return None

    has_content = (
        data.get("modifications")
        or data.get("blocks")
        or data.get("approvals_required")
        or data.get("applied_rules")
    )
    if not has_content:
        return None

    logger.info(
        f"[TenantRules] 规则引擎响应 ({trigger_point}): "
        f"rules_count={data.get('rules_count', 0)}, "
        f"modifications={data.get('modifications')}"
    )
    return data


# ============================================================
# Dry Run 日志
# ============================================================

def _log_dry_run(trigger_point: str, rule_result: dict) -> None:
    """影子模式日志输出"""
    mods = rule_result.get("modifications", {})
    blocks = rule_result.get("blocks", [])
    approvals = rule_result.get("approvals_required", [])
    notifications = rule_result.get("notifications", [])
    applied = rule_result.get("applied_rules", [])

    if mods:
        logger.warning(
            f"[DryRun][{trigger_point}] 规则建议修改: {mods}, 应用的规则: {applied}"
        )
    if blocks:
        logger.warning(f"[DryRun][{trigger_point}] 规则建议阻止: {blocks}")
    if approvals:
        logger.warning(f"[DryRun][{trigger_point}] 规则建议审批: {approvals}")
    if notifications:
        logger.warning(f"[DryRun][{trigger_point}] 规则通知: {notifications}")


# ============================================================
# 结果合并
# ============================================================

def _apply_to_result(original_result, rule_result: dict, trigger_point: str) -> Any:
    """将规则引擎结果合并到原始结果"""
    blocks = rule_result.get("blocks", [])
    if blocks:
        return {
            "success": False,
            "message": f"操作被业务规则阻止: {blocks[0]}",
            "blocked_by_rules": rule_result.get("applied_rules", []),
        }

    if not isinstance(original_result, dict):
        return original_result

    merged = dict(original_result)
    mods = rule_result.get("modifications", {})

    if mods:
        merged = _merge_modifications(merged, mods, trigger_point)

    approvals = rule_result.get("approvals_required", [])
    if approvals:
        merged["needs_approval"] = True
        merged["approval_reasons"] = approvals

    applied = rule_result.get("applied_rules", [])
    if applied:
        merged["applied_rules"] = applied
        logger.info(
            f"[TenantRules][{trigger_point}] 已应用规则: {applied}, 修改: {mods}"
        )

    return merged


def _merge_modifications(result: dict, mods: dict, trigger_point: str) -> dict:
    """根据不同触发点，将修改项合并到正确的嵌套位置"""
    if trigger_point in ("before_inbound", "execute_inbound"):
        if "card_data" in result and isinstance(result["card_data"], dict):
            for key in ("labor_cost", "total_cost", "piece_labor_cost"):
                if key in mods:
                    result["card_data"][key] = mods[key]
        if "all_products" in result and isinstance(result["all_products"], list):
            for product in result["all_products"]:
                for key in ("labor_cost", "total_cost", "piece_labor_cost"):
                    if key in mods:
                        product[key] = mods[key]

    elif trigger_point in ("create_sales",):
        if "data" in result and isinstance(result["data"], dict):
            for key in ("total_labor_cost", "total_weight"):
                if key in mods:
                    result["data"][key] = mods[key]

    elif trigger_point in ("create_settlement", "confirm_settlement"):
        if "data" in result and isinstance(result["data"], dict):
            for key in ("total_amount", "material_amount", "labor_amount"):
                if key in mods:
                    result["data"][key] = mods[key]

    return result


# ============================================================
# 上下文提取器 — 适配 AI-ERP 各 handler 的函数签名
# ============================================================

def _extract_context(
    trigger_point: str, args: tuple, kwargs: dict
) -> Tuple[dict, str]:
    """从不同 handler 的参数中提取 (业务上下文, tenant_id)"""
    tenant_id = "default"

    if trigger_point == "execute_inbound":
        card_data = args[0] if args else kwargs.get("card_data", {})
        context = {
            "weight": _to_float(card_data.get("weight")),
            "labor_cost": _to_float(card_data.get("labor_cost")),
            "piece_count": _to_int(card_data.get("piece_count")),
            "piece_labor_cost": _to_float(card_data.get("piece_labor_cost")),
            "product_name": card_data.get("product_name", ""),
            "supplier_name": card_data.get("supplier", ""),
            "total_cost": _to_float(card_data.get("total_cost")),
        }
        return context, tenant_id

    elif trigger_point in ("before_inbound", "create_sales"):
        ai_resp = args[0] if args else kwargs.get("ai_response")
        context = {
            "product_name": getattr(ai_resp, "product_name", "") or "",
            "weight": _to_float(getattr(ai_resp, "weight", 0)),
            "labor_cost": _to_float(getattr(ai_resp, "labor_cost", 0)),
            "supplier_name": getattr(ai_resp, "supplier", "") or "",
            "customer_name": getattr(ai_resp, "customer_name", "") or "",
        }
        products = getattr(ai_resp, "products", None)
        if products and len(products) > 0:
            first = products[0]
            context["product_name"] = getattr(first, "product_name", context["product_name"])
            context["weight"] = _to_float(getattr(first, "weight", context["weight"]))
            context["labor_cost"] = _to_float(getattr(first, "labor_cost", context["labor_cost"]))
            context["supplier_name"] = getattr(first, "supplier", context["supplier_name"]) or context["supplier_name"]
        return context, tenant_id

    elif trigger_point == "create_settlement":
        ai_resp = args[0] if args else kwargs.get("ai_response")
        context = {
            "customer_name": getattr(ai_resp, "settlement_customer_name", "") or "",
            "gold_price": _to_float(getattr(ai_resp, "settlement_gold_price", 0)),
            "payment_method": getattr(ai_resp, "settlement_payment_method", "") or "",
        }
        return context, tenant_id

    elif trigger_point == "confirm_settlement":
        settlement_id = args[1] if len(args) > 1 else kwargs.get("settlement_id")
        context = {"settlement_id": settlement_id}
        return context, tenant_id

    raise ValueError(f"未知的 trigger_point: {trigger_point}")


# ============================================================
# 工具函数
# ============================================================

def _to_float(val, default: float = 0.0) -> float:
    if val is None:
        return default
    try:
        return float(val)
    except (ValueError, TypeError):
        return default


def _to_int(val, default: int = 0) -> int:
    if val is None:
        return default
    try:
        return int(val)
    except (ValueError, TypeError):
        return default
