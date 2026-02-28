# -*- coding: utf-8 -*-
r"""旧架构 ai_prompts.py 单元测试

Layer 1: 纯逻辑测试，不调 API，不需要数据库。

运行方式:
    cd c:\Users\hlin2\AI-ERP2.0\backend
    python -m pytest tests/test_ai_prompts.py -v
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from app.ai_prompts import (
    pre_classify, build_context, get_category_prompt,
    get_inbound_prompt, get_sales_prompt, get_return_prompt,
    get_finance_prompt, get_query_prompt, get_system_prompt,
)


# ============================================================
# 1. pre_classify 参数化测试
# ============================================================

PRE_CLASSIFY_CASES = [
    # (message, expected_category, description)
    # --- 入库类 ---
    ("查询单号RK202602083368", "inbound", "RK单号查询"),
    ("RK202602083368", "inbound", "纯RK单号"),
    ("查询入库单", "inbound", "查询入库单"),
    ("查询今天的入库单", "inbound", "查询入库单-按日期"),
    ("足金手镯 10g 工费15 供应商测试珠宝", "query", "入库-含供应商词归query"),
    ("查询库存", "inbound", "查询库存"),
    # --- 销售类 ---
    ("卖给张三 足金手镯 10g 工费15", "sales", "创建销售单"),
    ("查询销售单XS20260206001", "sales", "查询销售单-带单号"),
    ("XS20260206001", "sales", "纯XS单号"),
    ("今天卖了多少钱", "sales", "销售数据查询-今天"),
    ("这个月销售额", "sales", "销售数据查询-本月"),
    ("帮张三做结算 结料", "sales", "结算-旧架构归sales"),
    ("JS20260222001", "sales", "JS单号-旧架构归sales"),
    # --- 退货类 ---
    ("退货 足金手镯 10g 退给XX珠宝 质量问题", "return", "退货给供应商"),
    ("退给商品部 古法戒指 5g", "return", "退货给商品部"),
    ("张三要退货 足金手镯 10g", "return", "销退-客户退货"),
    ("客户退货 古法戒指 5g", "return", "销退-客户退货2"),
    ("把入库单RK123的商品转到展厅", "return", "转移-转到优先于RK"),
    # --- 财务类 ---
    ("张三来料100克", "finance", "收料"),
    ("付20克给金源珠宝", "finance", "付料"),
    ("张三提料5克", "finance", "提料"),
    ("张三打款5000元", "finance", "登记收款"),
    ("付款给XX珠宝5000元", "finance", "供应商付款"),
    ("张三的欠款情况", "finance", "查询客户账务"),
    ("暂借足金手镯", "finance", "暂借"),
    ("归还暂借", "finance", "归还暂借"),
    ("ZJ20260222001", "finance", "ZJ单号"),
    ("对账单", "finance", "对账单"),
    ("凭证查询", "finance", "凭证"),
    # --- 查询类 ---
    ("查询客户张三", "query", "查询客户"),
    ("有几个供应商", "query", "查询供应商"),
    ("谁是最重要的供应商", "query", "供应商分析"),
    ("查询转移单TR20260127001", "query", "查询转移单"),
    ("TR20260127001", "query", "纯TR单号"),
    # --- 系统类 ---
    ("确认入库单RK20260206069900", "system", "确认单据"),
    ("反确认销售单XS20260206001", "system", "反确认单据"),
    ("怎么入库", "system", "系统帮助"),
    ("系统有什么功能", "system", "系统帮助2"),
    ("你好", "system", "闲聊-问候"),
    ("新建客户 张三", "system", "创建客户"),
    ("新建供应商 XX珠宝", "system", "创建供应商"),
]


@pytest.mark.parametrize(
    "message,expected,desc",
    PRE_CLASSIFY_CASES,
    ids=[c[2] for c in PRE_CLASSIFY_CASES],
)
def test_pre_classify(message, expected, desc):
    assert pre_classify(message) == expected


# ============================================================
# 2. build_context 测试
# ============================================================

class TestBuildContext:

    def test_empty_input(self):
        ctx = build_context(None, None)
        assert ctx == ""

    def test_with_history(self):
        history = [
            {"role": "user", "content": "查询库存"},
            {"role": "assistant", "content": "当前库存共100克"},
        ]
        ctx = build_context(history)
        assert "用户" in ctx
        assert "查询库存" in ctx
        assert "系统" in ctx or "当前库存" in ctx

    def test_with_entities(self):
        entities = {
            "last_action": "入库",
            "last_order_no": "RK20260222001",
            "last_product_name": "足金手镯",
        }
        ctx = build_context(None, session_entities=entities)
        assert "入库" in ctx
        assert "RK20260222001" in ctx
        assert "足金手镯" in ctx

    def test_with_both(self):
        history = [{"role": "user", "content": "你好"}]
        entities = {"last_action": "入库"}
        ctx = build_context(history, session_entities=entities)
        assert "你好" in ctx
        assert "入库" in ctx


# ============================================================
# 3. Prompt 生成测试
# ============================================================

class TestPromptGeneration:

    def test_inbound_prompt_contains_actions(self):
        prompt = get_inbound_prompt("入库 足金手镯", "")
        assert "入库" in prompt
        assert "查询入库单" in prompt

    def test_inbound_prompt_excludes_unrelated(self):
        prompt = get_inbound_prompt("入库", "")
        assert "销退" not in prompt

    def test_sales_prompt_contains_actions(self):
        prompt = get_sales_prompt("卖给张三", "")
        assert "创建销售单" in prompt
        assert "查询销售单" in prompt

    def test_return_prompt_contains_actions(self):
        prompt = get_return_prompt("退货", "")
        assert "退货" in prompt

    def test_finance_prompt_contains_actions(self):
        prompt = get_finance_prompt("张三交料5克", "")
        assert "收料" in prompt
        assert "提料" in prompt
        assert "登记收款" in prompt

    def test_query_prompt_contains_actions(self):
        prompt = get_query_prompt("查询客户", "")
        assert "查询客户" in prompt
        assert "查询供应商" in prompt

    def test_system_prompt_contains_actions(self):
        prompt = get_system_prompt("你好", "")
        assert "闲聊" in prompt
        assert "确认单据" in prompt

    def test_prompt_includes_user_message(self):
        prompt = get_inbound_prompt("入库 古法戒指 100克", "")
        assert "古法戒指" in prompt

    def test_prompt_includes_context(self):
        ctx = "【最近操作结果】\n- 操作类型：入库"
        prompt = get_inbound_prompt("再来一个", ctx)
        assert "最近操作结果" in prompt


# ============================================================
# 4. get_category_prompt 分发测试
# ============================================================

class TestCategoryPromptDispatch:

    def test_dispatch_inbound(self):
        prompt = get_category_prompt("inbound", "入库", "")
        assert "入库" in prompt

    def test_dispatch_sales(self):
        prompt = get_category_prompt("sales", "卖给张三", "")
        assert "销售" in prompt

    def test_dispatch_return(self):
        prompt = get_category_prompt("return", "退货", "")
        assert "退货" in prompt

    def test_dispatch_finance(self):
        prompt = get_category_prompt("finance", "交料", "")
        assert "收料" in prompt

    def test_dispatch_query(self):
        prompt = get_category_prompt("query", "查询客户", "")
        assert "查询客户" in prompt

    def test_dispatch_system(self):
        prompt = get_category_prompt("system", "你好", "")
        assert "闲聊" in prompt
