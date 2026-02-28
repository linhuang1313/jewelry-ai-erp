# -*- coding: utf-8 -*-
r"""query_engine.py 纯逻辑单元测试

Layer 1: 不调 API，不需要数据库。

运行方式:
    cd c:\Users\hlin2\AI-ERP2.0\backend
    python -m pytest tests/test_query_engine_logic.py -v
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from app.query_engine import is_query_intent, format_query_result


# ============================================================
# is_query_intent 测试
# ============================================================

class TestIsQueryIntent:

    @pytest.mark.parametrize("intent", [
        "查询库存", "查询入库单", "查询销售单", "销售数据查询",
        "查询客户", "查询供应商", "查询转移单", "查询暂借单",
        "查询对账单", "查询凭证", "查询结算单", "供应商分析",
        "统计分析", "查询金料记录",
    ])
    def test_query_intents_return_true(self, intent):
        assert is_query_intent(intent) is True

    @pytest.mark.parametrize("intent", [
        "入库", "创建销售单", "退货", "销退", "收料", "提料",
        "登记收款", "供应商付款", "创建结算单", "确认单据",
        "反确认单据", "闲聊", "系统帮助", "创建客户",
        "批量转移", "存料结价", "",
    ])
    def test_non_query_intents_return_false(self, intent):
        assert is_query_intent(intent) is False


# ============================================================
# format_query_result 测试
# ============================================================

class TestFormatQueryResult:

    def test_success_with_data(self):
        plan = {"table": "customers"}
        result = {
            "success": True,
            "count": 2,
            "data": [
                {"name": "张三", "phone": "13800138000"},
                {"name": "李四", "phone": "13900139000"},
            ],
        }
        text = format_query_result(plan, result)
        assert "2 条结果" in text
        assert "张三" in text
        assert "李四" in text

    def test_success_empty_data(self):
        plan = {"table": "customers"}
        result = {"success": True, "count": 0, "data": []}
        text = format_query_result(plan, result)
        assert "为空" in text or "没有找到" in text

    def test_failure(self):
        plan = {"table": "customers"}
        result = {"success": False, "error": "未知的表"}
        text = format_query_result(plan, result)
        assert "失败" in text
        assert "未知的表" in text

    def test_none_values_filtered(self):
        plan = {"table": "inventory"}
        result = {
            "success": True,
            "count": 1,
            "data": [{"product_name": "足金手镯", "weight": 100, "note": None}],
        }
        text = format_query_result(plan, result)
        assert "足金手镯" in text
        assert "note" not in text
