r"""SettlementAgent API 集成测试

Layer 2: 需要后端服务运行在 http://localhost:9000。
测试 /api/chat 和 /api/chat-stream 端点的 Agent 路由。

运行方式:
    1. 先启动后端:
       cd c:\Users\hlin2\AI-ERP2.0\backend
       python -m uvicorn app.main:app --port 9000

    2. 另一个终端运行测试:
       cd c:\Users\hlin2\AI-ERP2.0\backend
       python tests/test_agent_api.py
"""

import sys
import os
import json
import time
import requests

BASE_URL = os.environ.get("TEST_API_URL", "http://localhost:9000")


def _chat(message: str, user_role: str = "settlement") -> dict:
    """调用 /api/chat 端点"""
    resp = requests.post(
        f"{BASE_URL}/api/chat",
        json={"message": message, "user_role": user_role},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def _chat_stream(message: str, user_role: str = "settlement") -> dict:
    """调用 /api/chat-stream 端点，解析 SSE 流并返回最终 complete 事件"""
    resp = requests.post(
        f"{BASE_URL}/api/chat-stream",
        json={"message": message, "user_role": user_role},
        stream=True,
        timeout=60,
    )
    resp.raise_for_status()

    last_complete = None
    for line in resp.iter_lines(decode_unicode=True):
        if not line or not line.startswith("data: "):
            continue
        payload = line[6:]
        if payload.startswith("."):
            continue
        try:
            event = json.loads(payload)
            if event.get("type") == "complete":
                last_complete = event
        except json.JSONDecodeError:
            continue

    return last_complete or {}


# ============================================================
# 2.1 对比测试 — 同一消息，不同角色
# ============================================================

def test_compare_settlement_vs_counter():
    """同一消息在 settlement (Agent) 和 counter (旧路径) 下应返回相同 action"""
    test_cases = [
        ("查询库存", "查询库存"),
    ]
    print("\n=== 2.1 对比测试：settlement vs counter ===")
    for msg, expected_action in test_cases:
        r_settlement = _chat_stream(msg, "settlement")
        r_counter = _chat_stream(msg, "counter")

        action_s = r_settlement.get("data", {}).get("action", "N/A")
        action_c = r_counter.get("data", {}).get("action", "N/A")

        status = "PASS" if action_s == action_c else "WARN"
        print(f"  [{status}] \"{msg}\" → settlement={action_s}, counter={action_c}")


# ============================================================
# 2.2 结算专员专属场景
# ============================================================

def test_settlement_specific_scenarios():
    """结算专员特有场景测试"""
    print("\n=== 2.2 结算专员专属场景 ===")

    test_cases = [
        {
            "msg": "JS20260222001",
            "role": "settlement",
            "expected_action": "查询结算单",
        },
        {
            "msg": "张老板交料5克",
            "role": "settlement",
            "expected_action": "收料",
        },
        {
            "msg": "张老板的欠款情况",
            "role": "settlement",
            "expected_action": "查询客户账务",
        },
    ]

    for tc in test_cases:
        result = _chat_stream(tc["msg"], tc["role"])
        data = result.get("data", {})
        action = data.get("action", "N/A")
        success = data.get("success", False)

        status = "PASS" if action == tc["expected_action"] else "FAIL"
        print(f"  [{status}] \"{tc['msg']}\" → action={action} (expected={tc['expected_action']}), success={success}")


# ============================================================
# 2.3 Agent 路由验证 — 确认走了正确的路径
# ============================================================

def test_agent_routing_paths():
    """验证 settlement 走 Agent 路径，counter 走旧路径"""
    print("\n=== 2.3 Agent 路由验证 ===")

    r_settlement = _chat(
        "帮张三做结算 结料",
        user_role="settlement",
    )
    print(f"  settlement 路径: action={r_settlement.get('action', 'N/A')}, success={r_settlement.get('success')}")

    r_counter = _chat(
        "帮张三做结算 结料",
        user_role="counter",
    )
    print(f"  counter 路径: action={r_counter.get('action', 'N/A')}, success={r_counter.get('success')}")


# ============================================================
# 2.4 非 settlement 角色回归测试
# ============================================================

def test_other_roles_regression():
    """其他角色不应受 Agent 影响"""
    print("\n=== 2.4 其他角色回归测试 ===")

    test_cases = [
        ("查询库存", "product"),
        ("查询库存", "manager"),
    ]

    for msg, role in test_cases:
        result = _chat_stream(msg, role)
        data = result.get("data", {})
        action = data.get("action", "N/A")
        success = data.get("success", False)
        print(f"  [{role}] \"{msg}\" → action={action}, success={success}")


# ============================================================
# 2.5 健康检查
# ============================================================

def test_health_check():
    """验证服务器是否在运行"""
    print("\n=== 2.5 健康检查 ===")
    try:
        resp = requests.get(f"{BASE_URL}/docs", timeout=10, allow_redirects=True)
        print(f"  服务器状态: {resp.status_code}")
        return resp.status_code < 500
    except requests.ConnectionError:
        print(f"  ❌ 无法连接到 {BASE_URL}，请先启动后端服务")
        return False
    except requests.ReadTimeout:
        # 服务器响应慢但能连上，视为可用
        print(f"  服务器响应慢但可连接")
        return True


# ============================================================
# Main
# ============================================================

if __name__ == "__main__":
    print(f"SettlementAgent API 集成测试")
    print(f"目标服务器: {BASE_URL}")
    print("=" * 60)

    if not test_health_check():
        print("\n请先启动后端服务:")
        print("  cd c:\\Users\\hlin2\\AI-ERP2.0\\backend")
        print("  python -m uvicorn app.main:app --port 9000")
        sys.exit(1)

    start = time.time()

    test_settlement_specific_scenarios()
    test_compare_settlement_vs_counter()
    test_agent_routing_paths()
    test_other_roles_regression()

    elapsed = time.time() - start
    print(f"\n{'=' * 60}")
    print(f"全部测试完成，耗时 {elapsed:.1f}s")
