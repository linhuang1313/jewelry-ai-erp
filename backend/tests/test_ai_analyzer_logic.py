# -*- coding: utf-8 -*-
r"""ai_analyzer.py 纯逻辑单元测试

Layer 1: 不调 API，不需要数据库。
测试 generate_chart_data 和 format_data_for_ai。

运行方式:
    cd c:\Users\hlin2\AI-ERP2.0\backend
    python -m pytest tests/test_ai_analyzer_logic.py -v
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from app.ai_analyzer import ai_analyzer, ROLE_DATA_ACCESS


# ============================================================
# generate_chart_data 测试
# ============================================================

class TestGenerateChartData:

    def test_supplier_analysis(self):
        data = {
            "suppliers": [
                {"name": "金源珠宝", "total_cost": 50000, "total_weight": 200},
                {"name": "华鑫金行", "total_cost": 30000, "total_weight": 150},
            ]
        }
        result = ai_analyzer.generate_chart_data("供应商分析", data)
        assert "chart_data" in result
        assert "pie_data" in result
        assert result["chart_data"]["labels"] == ["金源珠宝", "华鑫金行"]
        assert len(result["chart_data"]["datasets"]) == 2

    def test_inventory_analysis(self):
        data = {
            "inventory": [
                {"product_name": "足金手镯", "total_weight": 500},
                {"product_name": "古法戒指", "total_weight": 200},
            ]
        }
        result = ai_analyzer.generate_chart_data("查询库存", data)
        assert "chart_data" in result
        assert "pie_data" in result
        assert result["chart_data"]["labels"] == ["足金手镯", "古法戒指"]

    def test_inbound_analysis(self):
        data = {
            "inbound_orders": [
                {
                    "order_no": "RK001",
                    "details": [
                        {"product_name": "足金手镯", "weight": 100, "total_cost": 5000, "supplier": "金源"},
                        {"product_name": "古法戒指", "weight": 50, "total_cost": 2000, "supplier": "金源"},
                    ],
                },
                {
                    "order_no": "RK002",
                    "details": [
                        {"product_name": "足金项链", "weight": 80, "total_cost": 4000, "supplier": "华鑫"},
                    ],
                },
            ]
        }
        result = ai_analyzer.generate_chart_data("查询入库单", data)
        assert "chart_data" in result
        assert "pie_data" in result
        labels = result["chart_data"]["labels"]
        assert "金源" in labels
        assert "华鑫" in labels

    def test_empty_data_returns_empty(self):
        result = ai_analyzer.generate_chart_data("查询库存", {})
        assert result == {}

    def test_unrelated_intent_returns_empty(self):
        data = {"inventory": [{"product_name": "test", "total_weight": 100}]}
        result = ai_analyzer.generate_chart_data("闲聊", data)
        assert result == {}

    def test_chart_intent_triggers_inventory(self):
        data = {
            "inventory": [
                {"product_name": "足金手镯", "total_weight": 500},
            ]
        }
        result = ai_analyzer.generate_chart_data("生成图表", data)
        assert "chart_data" in result


# ============================================================
# format_data_for_ai 测试
# ============================================================

class TestFormatDataForAi:

    def test_basic_statistics(self):
        data = {
            "statistics": {
                "total_products": 10,
                "total_inventory_weight": 5000,
                "total_inbound_cost": 100000,
                "total_suppliers": 5,
                "total_customers": 20,
                "total_inbound_orders": 50,
                "total_sales_orders": 30,
                "inventory_location": "全部仓位",
            }
        }
        text = ai_analyzer.format_data_for_ai(data)
        assert "10种" in text
        assert "5000" in text
        assert "5个" in text

    def test_inventory_section(self):
        data = {
            "statistics": {
                "total_products": 0, "total_inventory_weight": 0,
                "total_inbound_cost": 0, "total_suppliers": 0,
                "total_customers": 0, "total_inbound_orders": 0,
                "total_sales_orders": 0, "inventory_location": "全部",
            },
            "inventory": [
                {"product_name": "足金手镯", "total_weight": 500},
                {"product_name": "古法戒指", "total_weight": 200},
            ],
        }
        text = ai_analyzer.format_data_for_ai(data)
        assert "足金手镯" in text
        assert "500" in text

    def test_customer_debt_section(self):
        data = {
            "statistics": {
                "total_products": 0, "total_inventory_weight": 0,
                "total_inbound_cost": 0, "total_suppliers": 0,
                "total_customers": 0, "total_inbound_orders": 0,
                "total_sales_orders": 0, "inventory_location": "全部",
            },
            "customer_debt": {
                "success": True,
                "customer": {"id": 1, "name": "张三", "customer_no": "C001", "phone": "138"},
                "cash_debt": 5000,
                "net_gold": -10.5,
            },
        }
        text = ai_analyzer.format_data_for_ai(data)
        assert "张三" in text
        assert "5000" in text or "5,000" in text
        assert "10.5" in text or "存料" in text

    def test_empty_data(self):
        data = {
            "statistics": {
                "total_products": 0, "total_inventory_weight": 0,
                "total_inbound_cost": 0, "total_suppliers": 0,
                "total_customers": 0, "total_inbound_orders": 0,
                "total_sales_orders": 0, "inventory_location": "全部",
            }
        }
        text = ai_analyzer.format_data_for_ai(data)
        assert "系统数据库概览" in text


# ============================================================
# ROLE_DATA_ACCESS 测试
# ============================================================

class TestRoleDataAccess:

    def test_manager_has_full_access(self):
        access = ROLE_DATA_ACCESS["manager"]
        assert "inventory" in access
        assert "customers" in access
        assert "customer_debt" in access
        assert "suppliers" in access

    def test_settlement_has_customer_access(self):
        access = ROLE_DATA_ACCESS["settlement"]
        assert "customers" in access
        assert "customer_debt" in access
        assert "sales_orders" in access

    def test_sales_limited_access(self):
        access = ROLE_DATA_ACCESS["sales"]
        assert "customers" in access
        assert "supplier_gold" not in access

    def test_all_roles_defined(self):
        expected_roles = {"manager", "product", "counter", "settlement", "finance", "material", "sales"}
        assert set(ROLE_DATA_ACCESS.keys()) == expected_roles
