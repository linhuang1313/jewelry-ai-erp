"""
诊断 chat-debt-query API 数据不一致问题

问题现象：
- 对账单显示：金料 8.500 克欠料，现金 ¥75897 预收款
- AI 查询显示：金料已结清，现金已结清

运行方式：
    python backend/tests/test_debt_query_debug.py
"""

import requests
import json

# Railway 生产环境 API URL
API_BASE = "https://jewelry-ai-erp-production.up.railway.app"

# 本地测试 URL（如需本地测试，取消下面的注释）
# API_BASE = "http://localhost:8000"


def test_chat_debt_query(customer_name: str = "测试客户1"):
    """测试 chat-debt-query API 返回数据"""
    print(f"\n{'='*60}")
    print(f"测试 chat-debt-query API")
    print(f"客户名称: {customer_name}")
    print(f"API URL: {API_BASE}/api/customers/chat-debt-query")
    print(f"{'='*60}\n")
    
    try:
        response = requests.get(
            f"{API_BASE}/api/customers/chat-debt-query",
            params={"customer_name": customer_name},
            timeout=30
        )
        
        print(f"HTTP 状态码: {response.status_code}")
        
        if response.status_code != 200:
            print(f"错误响应: {response.text}")
            return
        
        data = response.json()
        
        print("\n--- API 返回的原始数据 ---")
        print(json.dumps(data, indent=2, ensure_ascii=False, default=str))
        
        print("\n--- 关键字段分析 ---")
        print(f"success: {data.get('success')}")
        
        if data.get('customer'):
            customer = data['customer']
            print(f"客户ID: {customer.get('id')}")
            print(f"客户名称: {customer.get('name')}")
        
        # 现金账户数据
        cash_debt = data.get('cash_debt', 'N/A')
        print(f"\n现金账户 (cash_debt): {cash_debt}")
        if isinstance(cash_debt, (int, float)):
            if cash_debt > 0:
                print(f"  -> 客户欠款: ¥{cash_debt:.2f}")
            elif cash_debt < 0:
                print(f"  -> 预收款（客户余额）: ¥{abs(cash_debt):.2f}")
            else:
                print(f"  -> 已结清")
        
        # 金料账户数据
        net_gold = data.get('net_gold', 'N/A')
        gold_debt = data.get('gold_debt', 'N/A')
        gold_deposit = data.get('gold_deposit', 'N/A')
        
        print(f"\n金料账户:")
        print(f"  net_gold: {net_gold}")
        print(f"  gold_debt: {gold_debt}")
        print(f"  gold_deposit: {gold_deposit}")
        
        if isinstance(net_gold, (int, float)):
            if net_gold > 0:
                print(f"  -> 客户欠料: {net_gold:.3f}克")
            elif net_gold < 0:
                print(f"  -> 客户存料: {abs(net_gold):.3f}克")
            else:
                print(f"  -> 已结清")
        
        # 交易记录数量
        cash_txs = data.get('cash_transactions', [])
        gold_txs = data.get('gold_transactions', [])
        deposit_txs = data.get('deposit_transactions', [])
        
        print(f"\n交易记录数量:")
        print(f"  现金交易: {len(cash_txs)} 条")
        print(f"  金料交易: {len(gold_txs)} 条")
        print(f"  存料交易: {len(deposit_txs)} 条")
        
        # 期望值对比
        print(f"\n{'='*60}")
        print("期望值（根据对账单）:")
        print("  金料账户: 8.500 克欠料 (net_gold 应为 +8.5)")
        print("  现金账户: ¥75897.00 预收款 (cash_debt 应为 -75897)")
        print(f"{'='*60}")
        
        # 判断数据是否正确
        print("\n诊断结果:")
        if cash_debt == 0 and net_gold == 0:
            print("  ❌ 数据全部为 0，可能是查询逻辑有问题或数据库没有对应记录")
        else:
            expected_net_gold = 8.5
            expected_cash_debt = -75897
            
            gold_match = abs(net_gold - expected_net_gold) < 0.01 if isinstance(net_gold, (int, float)) else False
            cash_match = abs(cash_debt - expected_cash_debt) < 1 if isinstance(cash_debt, (int, float)) else False
            
            if gold_match and cash_match:
                print("  ✓ 数据与对账单一致")
            else:
                print(f"  ❌ 数据与对账单不一致")
                if not gold_match:
                    print(f"     金料: 返回 {net_gold}，期望 {expected_net_gold}")
                if not cash_match:
                    print(f"     现金: 返回 {cash_debt}，期望 {expected_cash_debt}")
        
    except requests.exceptions.RequestException as e:
        print(f"请求失败: {e}")
    except json.JSONDecodeError as e:
        print(f"JSON 解析失败: {e}")
        print(f"响应内容: {response.text[:500]}")


def test_customer_balance(customer_name: str = "测试客户1"):
    """测试获取客户余额 API（对比用）"""
    print(f"\n{'='*60}")
    print(f"测试 customer balance API（对比用）")
    print(f"{'='*60}\n")
    
    try:
        # 先获取客户ID
        response = requests.get(
            f"{API_BASE}/api/customers",
            params={"search": customer_name},
            timeout=30
        )
        
        if response.status_code != 200:
            print(f"获取客户列表失败: {response.status_code}")
            return
        
        customers_data = response.json()
        customers = customers_data.get('data', [])
        
        if not customers:
            print(f"未找到客户: {customer_name}")
            return
        
        customer = customers[0]
        customer_id = customer.get('id')
        print(f"客户ID: {customer_id}, 名称: {customer.get('name')}")
        
        # 获取客户详情（包含余额）
        response = requests.get(
            f"{API_BASE}/api/customers/{customer_id}",
            timeout=30
        )
        
        if response.status_code == 200:
            detail = response.json()
            print("\n客户详情中的余额信息:")
            print(json.dumps(detail.get('data', {}).get('balance', {}), indent=2, ensure_ascii=False))
        
    except Exception as e:
        print(f"测试失败: {e}")


if __name__ == "__main__":
    # 运行诊断测试
    test_chat_debt_query("测试客户1")
    
    # 对比测试
    test_customer_balance("测试客户1")
    
    print("\n\n如果数据不一致，请检查:")
    print("1. 结算单状态是否为 'confirmed' 或 'printed'")
    print("2. 来料记录状态是否为 'received'")
    print("3. 数据库中是否有对应的 PaymentRecord 记录")
    print("4. 查看 Railway 后端日志是否有错误信息")
