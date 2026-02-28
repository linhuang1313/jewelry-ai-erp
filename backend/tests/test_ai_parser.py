"""
AI 解析器意图识别测试
测试所有场景的 action 是否被正确识别

用法：
    cd backend
    python tests/test_ai_parser.py
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

from app.ai_parser import parse_user_message
from app.ai_prompts import pre_classify

# Windows 控制台编码修复
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

# ============= 测试用例 =============
# 格式：(用户输入, 期望的 action, 描述)

TEST_CASES = [
    # --- 入库类 ---
    ("查询单号RK202602083368", "查询入库单", "RK单号查询"),
    ("RK202602083368", "查询入库单", "纯RK单号"),
    ("查询入库单", "查询入库单", "查询入库单-无单号"),
    ("查询今天的入库单", "查询入库单", "查询入库单-按日期"),
    ("足金手镯 10g 工费15 供应商测试珠宝", "入库", "入库-单商品"),
    ("查询库存", "查询库存", "查询库存"),
    ("把入库单RK123的商品转到展厅", "批量转移", "批量转移"),
    
    # --- 销售类 ---
    ("卖给张三 足金手镯 10g 工费15", "创建销售单", "创建销售单"),
    ("查询销售单XS20260206001", "查询销售单", "查询销售单-带单号"),
    ("XS20260206001", "查询销售单", "纯XS单号"),
    ("今天卖了多少钱", "销售数据查询", "销售数据查询-今天"),
    ("这个月销售额", "销售数据查询", "销售数据查询-本月"),
    
    # --- 退货类 ---
    ("退货 足金手镯 10g 退给XX珠宝 质量问题", "退货", "退货给供应商"),
    ("退给商品部 古法戒指 5g", "退货", "退货给商品部"),
    ("张三要退货 足金手镯 10g", "销退", "销退-客户退货"),
    ("客户退货 古法戒指 5g", "销退", "销退-客户退货2"),
    
    # --- 金料/财务类 ---
    ("张三来料100克", "收料", "收料"),
    ("付20克给金源珠宝", "付料", "付料"),
    ("张三提料5克", "提料", "提料"),
    ("张三打款5000元", "登记收款", "登记收款"),
    ("付款给XX珠宝5000元", "供应商付款", "供应商付款"),
    ("张三的欠款情况", "查询客户账务", "查询客户账务"),
    
    # --- 查询类 ---
    ("查询客户张三", "查询客户", "查询客户"),
    ("有几个供应商", "查询供应商", "查询供应商"),
    ("谁是最重要的供应商", "供应商分析", "供应商分析"),
    ("查询转移单TR20260127001", "查询转移单", "查询转移单"),
    
    # --- 系统类 ---
    ("确认入库单RK20260206069900", "确认单据", "确认单据"),
    ("反确认销售单XS20260206001", "反确认单据", "反确认单据"),
    ("怎么入库", "系统帮助", "系统帮助"),
    ("系统有什么功能", "系统帮助", "系统帮助2"),
    ("你好", "闲聊", "闲聊-问候"),
    ("谢谢", "闲聊", "闲聊-感谢"),
    ("新建客户 张三", "创建客户", "创建客户"),
    ("新建供应商 XX珠宝", "创建供应商", "创建供应商"),
]

# 角色推断测试用例：同一输入，不同角色应有不同结果
# 格式：(用户输入, 角色, 期望action, 描述)
ROLE_TEST_CASES = [
    ("足金手镯 10g 工费15 供应商测试珠宝", "product", "入库", "商品专员输入商品信息→入库"),
    ("足金手镯 10g 工费15 客户张三", "counter", "创建销售单", "柜台输入商品+客户→销售"),
]


def test_pre_classify():
    """测试预分类（不调用 AI API，瞬间完成）"""
    print("=" * 60)
    print("第一阶段：预分类测试（不调用 API）")
    print("=" * 60)
    
    CATEGORY_MAP = {
        "查询入库单": "inbound", "入库": "inbound", "查询库存": "inbound", "批量转移": "inbound",
        "创建销售单": "sales", "查询销售单": "sales", "销售数据查询": "sales",
        "退货": "return", "销退": "return",
        "收料": "finance", "付料": "finance", "提料": "finance", 
        "登记收款": "finance", "供应商付款": "finance", "查询客户账务": "finance",
        "查询客户": "query", "查询供应商": "query", "供应商分析": "query", "查询转移单": "query",
        "确认单据": "system", "反确认单据": "system", "系统帮助": "system",
        "闲聊": "system", "创建客户": "system", "创建供应商": "system",
    }
    
    passed = 0
    failed = 0
    
    for msg, expected_action, desc in TEST_CASES:
        expected_category = CATEGORY_MAP.get(expected_action, "system")
        actual_category = pre_classify(msg)
        ok = actual_category == expected_category
        
        if ok:
            passed += 1
            print(f"  ✓ [{desc}] \"{msg[:25]}...\" → {actual_category}")
        else:
            failed += 1
            print(f"  ✗ [{desc}] \"{msg[:25]}...\" → {actual_category} (期望: {expected_category})")
    
    print(f"\n预分类结果：{passed} 通过 / {failed} 失败 / {len(TEST_CASES)} 总计")
    return failed == 0


def test_ai_parser():
    """测试 AI 意图识别（调用 DeepSeek API，较慢）"""
    print("\n" + "=" * 60)
    print("第二阶段：AI 意图识别测试（调用 DeepSeek API）")
    print("=" * 60)
    
    api_key = os.getenv("DEEPSEEK_API_KEY")
    if not api_key:
        print("  ⚠ 未设置 DEEPSEEK_API_KEY，跳过 AI 测试")
        return True
    
    passed = 0
    failed = 0
    errors = []
    
    for msg, expected_action, desc in TEST_CASES:
        try:
            result = parse_user_message(msg)
            actual_action = result.action
            ok = actual_action == expected_action
            
            if ok:
                passed += 1
                print(f"  ✓ [{desc}] \"{msg[:25]}...\" → {actual_action}")
            else:
                failed += 1
                errors.append((desc, msg, expected_action, actual_action))
                print(f"  ✗ [{desc}] \"{msg[:25]}...\" → {actual_action} (期望: {expected_action})")
        except Exception as e:
            failed += 1
            errors.append((desc, msg, expected_action, f"ERROR: {e}"))
            print(f"  ✗ [{desc}] \"{msg[:25]}...\" → ERROR: {e}")
    
    print(f"\nAI 识别结果：{passed} 通过 / {failed} 失败 / {len(TEST_CASES)} 总计")
    
    if errors:
        print("\n失败详情：")
        for desc, msg, expected, actual in errors:
            print(f"  [{desc}] 输入: \"{msg}\"")
            print(f"    期望: {expected}, 实际: {actual}")
    
    return failed == 0


def test_role_inference():
    """测试角色推断（不同角色对同一输入的识别差异）"""
    print("\n" + "=" * 60)
    print("第三阶段：角色推断测试（调用 DeepSeek API）")
    print("=" * 60)
    
    api_key = os.getenv("DEEPSEEK_API_KEY")
    if not api_key:
        print("  ⚠ 未设置 DEEPSEEK_API_KEY，跳过角色测试")
        return True
    
    if not ROLE_TEST_CASES:
        print("  无角色测试用例")
        return True
    
    passed = 0
    failed = 0
    
    for msg, role, expected_action, desc in ROLE_TEST_CASES:
        try:
            result = parse_user_message(msg, user_role=role)
            actual_action = result.action
            ok = actual_action == expected_action
            
            if ok:
                passed += 1
                print(f"  ✓ [{desc}] role={role}, \"{msg[:30]}...\" → {actual_action}")
            else:
                failed += 1
                print(f"  ✗ [{desc}] role={role}, \"{msg[:30]}...\" → {actual_action} (期望: {expected_action})")
        except Exception as e:
            failed += 1
            print(f"  ✗ [{desc}] role={role} → ERROR: {e}")
    
    print(f"\n角色推断结果：{passed} 通过 / {failed} 失败 / {len(ROLE_TEST_CASES)} 总计")
    return failed == 0


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="AI 解析器测试")
    parser.add_argument("--quick", action="store_true", help="只测试预分类（不调用 API）")
    args = parser.parse_args()
    
    # 始终测试预分类
    pre_ok = test_pre_classify()
    
    if not args.quick:
        ai_ok = test_ai_parser()
        role_ok = test_role_inference()
        print("\n" + "=" * 60)
        if pre_ok and ai_ok and role_ok:
            print("全部测试通过！")
        else:
            print("有测试失败，请检查上面的详情。")
    else:
        print("\n（--quick 模式，跳过 AI API 测试）")
