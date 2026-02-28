# -*- coding: utf-8 -*-
r"""Agent 解析器 mock 测试

Layer 2: mock DeepSeek API，不花钱，不需要网络。
测试 parse_with_agent 的完整流程。

运行方式:
    cd c:\Users\hlin2\AI-ERP2.0\backend
    python -m pytest tests/test_agent_parser_mock.py -v
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import json
import pytest
from unittest.mock import patch, MagicMock

from app.agents.settlement_agent import SettlementAgent
from app.agents.agent_parser import parse_with_agent
from app.schemas import AIResponse


def _mock_api_response(content: str):
    """构造一个模拟的 OpenAI API 响应对象"""
    mock_message = MagicMock()
    mock_message.content = content
    mock_choice = MagicMock()
    mock_choice.message = mock_message
    mock_response = MagicMock()
    mock_response.choices = [mock_choice]
    return mock_response


class TestParseWithAgentMock:

    @pytest.fixture
    def agent(self):
        return SettlementAgent()

    @patch("app.agents.agent_parser.get_client")
    def test_settlement_create(self, mock_get_client, agent):
        """结算专员创建结算单"""
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _mock_api_response(
            json.dumps({
                "action": "创建结算单",
                "settlement_customer_name": "张三",
                "settlement_payment_method": "结料",
                "products": None,
            })
        )
        mock_get_client.return_value = mock_client

        result = parse_with_agent(agent, "帮张三做结算 结料")
        assert isinstance(result, AIResponse)
        assert result.action == "创建结算单"

    @patch("app.agents.agent_parser.get_client")
    def test_finance_receipt(self, mock_get_client, agent):
        """结算专员收料"""
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _mock_api_response(
            json.dumps({
                "action": "收料",
                "receipt_customer_name": "张老板",
                "receipt_gold_weight": 5,
                "products": None,
            })
        )
        mock_get_client.return_value = mock_client

        result = parse_with_agent(agent, "张老板交料5克")
        assert result.action == "收料"

    @patch("app.agents.agent_parser.get_client")
    def test_query_settlement(self, mock_get_client, agent):
        """查询结算单"""
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _mock_api_response(
            json.dumps({
                "action": "查询结算单",
                "settlement_order_no": "JS20260222001",
                "products": None,
            })
        )
        mock_get_client.return_value = mock_client

        result = parse_with_agent(agent, "JS20260222001")
        assert result.action == "查询结算单"

    @patch("app.agents.agent_parser.get_client")
    def test_chat_response(self, mock_get_client, agent):
        """闲聊"""
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _mock_api_response(
            json.dumps({"action": "闲聊", "products": None})
        )
        mock_get_client.return_value = mock_client

        result = parse_with_agent(agent, "你好")
        assert result.action == "闲聊"

    @patch("app.agents.agent_parser.get_client")
    def test_json_in_markdown_block(self, mock_get_client, agent):
        """API 返回 markdown 包裹的 JSON"""
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _mock_api_response(
            '```json\n{"action": "查询库存", "products": null}\n```'
        )
        mock_get_client.return_value = mock_client

        result = parse_with_agent(agent, "查询库存")
        assert result.action == "查询库存"

    @patch("app.agents.agent_parser.get_client")
    def test_retry_on_json_error(self, mock_get_client, agent):
        """JSON 解析失败时重试"""
        mock_client = MagicMock()
        mock_client.chat.completions.create.side_effect = [
            _mock_api_response("这不是JSON"),
            _mock_api_response("还是不对"),
            _mock_api_response("第三次也不对"),
        ]
        mock_get_client.return_value = mock_client

        result = parse_with_agent(agent, "随便说点什么")
        assert isinstance(result, AIResponse)
        assert mock_client.chat.completions.create.call_count == 3

    @patch("app.agents.agent_parser.get_client")
    def test_classify_called_correctly(self, mock_get_client, agent):
        """验证 classify 被正确调用，category 传入 get_prompt"""
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _mock_api_response(
            json.dumps({"action": "收料", "products": None})
        )
        mock_get_client.return_value = mock_client

        result = parse_with_agent(agent, "张老板交料5克")

        call_args = mock_client.chat.completions.create.call_args
        prompt_content = call_args.kwargs["messages"][1]["content"]
        assert "收料" in prompt_content
        assert "提料" in prompt_content

    @patch("app.agents.agent_parser.get_client")
    def test_with_conversation_history(self, mock_get_client, agent):
        """带对话历史"""
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _mock_api_response(
            json.dumps({"action": "查询客户账务", "debt_customer_name": "张三", "products": None})
        )
        mock_get_client.return_value = mock_client

        history = [
            {"role": "user", "content": "张三的欠款"},
            {"role": "assistant", "content": "张三欠款5000元"},
        ]
        result = parse_with_agent(agent, "详细一点", history)
        assert isinstance(result, AIResponse)

    @patch("app.agents.agent_parser.get_client")
    def test_numeric_fields_fixed(self, mock_get_client, agent):
        """数值字段类型修正"""
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _mock_api_response(
            json.dumps({
                "action": "收料",
                "receipt_customer_name": "张三",
                "receipt_gold_weight": "5.5",
                "products": [{"product_name": "足金", "weight": "100", "labor_cost": "15"}],
            })
        )
        mock_get_client.return_value = mock_client

        result = parse_with_agent(agent, "张三交料5.5克")
        assert result.products[0].weight == 100.0
        assert result.products[0].labor_cost == 15.0
