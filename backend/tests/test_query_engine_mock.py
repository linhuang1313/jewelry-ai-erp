# -*- coding: utf-8 -*-
r"""query_engine.py mock 测试

Layer 2: mock DeepSeek API，不花钱。
测试 generate_query_plan 的 AI 调用和 JSON 解析。

运行方式:
    cd c:\Users\hlin2\AI-ERP2.0\backend
    python -m pytest tests/test_query_engine_mock.py -v
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import json
import pytest
from unittest.mock import patch, MagicMock

from app.query_engine import generate_query_plan


def _mock_api_response(content: str):
    mock_message = MagicMock()
    mock_message.content = content
    mock_choice = MagicMock()
    mock_choice.message = mock_message
    mock_response = MagicMock()
    mock_response.choices = [mock_choice]
    return mock_response


class TestGenerateQueryPlanMock:

    @patch("app.query_engine.get_client")
    def test_valid_plan(self, mock_get_client):
        """正常返回查询计划"""
        plan_json = {
            "table": "customers",
            "filters": [{"column": "name", "op": "contains", "value": "张三"}],
            "select": ["name", "phone"],
            "order_by": None,
            "limit": 10,
        }
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _mock_api_response(
            json.dumps(plan_json)
        )
        mock_get_client.return_value = mock_client

        result = generate_query_plan("查询客户张三")
        assert result is not None
        assert result["table"] == "customers"

    @patch("app.query_engine.get_client")
    def test_plan_with_filters_and_order(self, mock_get_client):
        """带 filters 和 order_by 的查询计划"""
        plan_json = {
            "table": "inventory",
            "filters": [],
            "select": ["product_name", "total_weight"],
            "order_by": [{"column": "total_weight", "direction": "desc"}],
            "limit": 20,
        }
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _mock_api_response(
            json.dumps(plan_json)
        )
        mock_get_client.return_value = mock_client

        result = generate_query_plan("查询库存")
        assert result is not None
        assert result["table"] == "inventory"
        assert result["limit"] == 20

    @patch("app.query_engine.get_client")
    def test_invalid_json_returns_none(self, mock_get_client):
        """无效 JSON 返回 None"""
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _mock_api_response(
            "这不是有效的JSON"
        )
        mock_get_client.return_value = mock_client

        result = generate_query_plan("随便问个问题")
        assert result is None

    @patch("app.query_engine.get_client")
    def test_api_exception_returns_none(self, mock_get_client):
        """API 异常返回 None"""
        mock_client = MagicMock()
        mock_client.chat.completions.create.side_effect = Exception("API timeout")
        mock_get_client.return_value = mock_client

        result = generate_query_plan("查询库存")
        assert result is None

    @patch("app.query_engine.get_client")
    def test_plan_with_join(self, mock_get_client):
        """带 join 的查询计划"""
        plan_json = {
            "table": "sales_orders",
            "join": "sales_details",
            "filters": [{"column": "customer_name", "op": "eq", "value": "张三"}],
            "select": ["order_no", "customer_name", "total_weight"],
            "group_by": None,
            "aggregates": None,
            "order_by": [{"column": "create_time", "direction": "desc"}],
            "limit": 10,
        }
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _mock_api_response(
            json.dumps(plan_json)
        )
        mock_get_client.return_value = mock_client

        result = generate_query_plan("查询张三的销售单")
        assert result is not None
        assert result["join"] == "sales_details"
