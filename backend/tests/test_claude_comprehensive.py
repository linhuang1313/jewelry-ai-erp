"""全面的Claude API测试脚本"""
import os
import sys
import json
from dotenv import load_dotenv
from anthropic import Anthropic

# 添加当前目录到路径，以便导入app模块
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

load_dotenv()

# 测试统计
test_results = {
    "total": 0,
    "passed": 0,
    "failed": 0,
    "errors": []
}

def print_header(title):
    """打印测试标题"""
    print("\n" + "=" * 70)
    print(f"  {title}")
    print("=" * 70)

def print_test(name, passed=True, message=""):
    """打印单个测试结果"""
    test_results["total"] += 1
    if passed:
        test_results["passed"] += 1
        status = "[PASS]"
    else:
        test_results["failed"] += 1
        test_results["errors"].append(f"{name}: {message}")
        status = "[FAIL]"
    print(f"{status} - {name}")
    if message and not passed:
        print(f"    错误: {message}")

def test_api_key():
    """测试1: API Key配置和有效性"""
    print_header("测试1: API Key配置和有效性")
    
    api_key = os.getenv("ANTHROPIC_API_KEY")
    
    if not api_key:
        print_test("API Key存在", False, "未找到ANTHROPIC_API_KEY环境变量")
        return None
    
    if len(api_key) < 20:
        print_test("API Key长度", False, f"API Key长度异常: {len(api_key)}")
        return None
    
    print_test("API Key存在", True)
    print_test("API Key长度", True, f"长度: {len(api_key)}")
    print(f"    API Key前10位: {api_key[:10]}...")
    
    return api_key

def test_model_availability(api_key):
    """测试2: 模型可用性"""
    print_header("测试2: 模型可用性测试")
    
    if not api_key:
        print_test("模型可用性", False, "API Key未配置")
        return False
    
    client = Anthropic(api_key=api_key)
    model_name = "claude-sonnet-4-5-20250929"
    
    try:
        response = client.messages.create(
            model=model_name,
            max_tokens=100,
            messages=[{
                "role": "user",
                "content": "你好"
            }]
        )
        
        if response and response.content:
            print_test(f"模型 {model_name} 可用", True)
            print(f"    响应预览: {response.content[0].text[:50]}...")
            return True
        else:
            print_test(f"模型 {model_name} 可用", False, "响应为空")
            return False
            
    except Exception as e:
        error_msg = str(e)
        if "not_found" in error_msg.lower() or "404" in error_msg:
            print_test(f"模型 {model_name} 可用", False, "模型不存在")
        elif "401" in error_msg or "unauthorized" in error_msg.lower():
            print_test(f"模型 {model_name} 可用", False, "API Key无效或无权访问")
        elif "429" in error_msg or "rate limit" in error_msg.lower():
            print_test(f"模型 {model_name} 可用", False, "请求频率限制")
        else:
            print_test(f"模型 {model_name} 可用", False, error_msg[:100])
        return False

def test_intent_recognition(api_key):
    """测试3: 意图识别准确性"""
    print_header("测试3: 意图识别测试")
    
    if not api_key:
        print_test("意图识别", False, "API Key未配置")
        return
    
    try:
        from app.ai_parser import parse_user_message
    except ImportError:
        print_test("导入ai_parser", False, "无法导入app.ai_parser模块")
        return
    
    test_cases = [
        {
            "message": "古法戒指 100克 工费8元 供应商是金源珠宝，帮我做个入库",
            "expected_action": "入库",
            "name": "入库操作识别"
        },
        {
            "message": "查询库存",
            "expected_action": "查询库存",
            "name": "查询库存识别"
        },
        {
            "message": "帮我查一下我目前的库存",
            "expected_action": "查询库存",
            "name": "查询库存（口语化）"
        },
        {
            "message": "开销售单：客户张三，古法戒指 50克 工费10元/克，业务员李四",
            "expected_action": "创建销售单",
            "name": "创建销售单识别"
        },
        {
            "message": "客户有哪些",
            "expected_action": "查询客户",
            "name": "查询客户识别"
        },
        {
            "message": "我现在有几个供应商",
            "expected_action": "查询供应商",
            "name": "查询供应商识别"
        },
        {
            "message": "谁是我最重要的供应商",
            "expected_action": "供应商分析",
            "name": "供应商分析识别"
        }
    ]
    
    for test_case in test_cases:
        try:
            result = parse_user_message(test_case["message"])
            actual_action = result.action
            
            if actual_action == test_case["expected_action"]:
                print_test(test_case["name"], True, f"识别为: {actual_action}")
            else:
                print_test(test_case["name"], False, 
                          f"期望: {test_case['expected_action']}, 实际: {actual_action}")
        except Exception as e:
            print_test(test_case["name"], False, str(e)[:100])

def test_context_questions(api_key):
    """测试4: 上下文追问识别"""
    print_header("测试4: 上下文追问识别测试")
    
    if not api_key:
        print_test("上下文追问", False, "API Key未配置")
        return
    
    try:
        from app.ai_parser import parse_user_message
    except ImportError:
        print_test("导入ai_parser", False, "无法导入app.ai_parser模块")
        return
    
    test_cases = [
        {
            "message": "哪七种",
            "expected_action": "查询库存",
            "name": "上下文追问-哪七种"
        },
        {
            "message": "具体是哪些",
            "expected_action": "查询库存",
            "name": "上下文追问-具体是哪些"
        },
        {
            "message": "有哪些商品",
            "expected_action": "查询库存",
            "name": "上下文追问-有哪些商品"
        },
        {
            "message": "哪几个供应商",
            "expected_action": "查询供应商",
            "name": "上下文追问-哪几个供应商"
        },
        {
            "message": "客户有哪些",
            "expected_action": "查询客户",
            "name": "上下文追问-客户有哪些"
        }
    ]
    
    for test_case in test_cases:
        try:
            result = parse_user_message(test_case["message"])
            actual_action = result.action
            
            if actual_action == test_case["expected_action"]:
                print_test(test_case["name"], True, f"识别为: {actual_action}")
            else:
                print_test(test_case["name"], False, 
                          f"期望: {test_case['expected_action']}, 实际: {actual_action}")
        except Exception as e:
            print_test(test_case["name"], False, str(e)[:100])

def test_data_extraction(api_key):
    """测试5: 数据提取准确性"""
    print_header("测试5: 数据提取准确性测试")
    
    if not api_key:
        print_test("数据提取", False, "API Key未配置")
        return
    
    try:
        from app.ai_parser import parse_user_message
    except ImportError:
        print_test("导入ai_parser", False, "无法导入app.ai_parser模块")
        return
    
    test_cases = [
        {
            "message": "古法戒指 100克 工费8元 供应商是金源珠宝，帮我做个入库",
            "name": "单商品数据提取",
            "checks": {
                "has_products": True,
                "product_name": "古法戒指",
                "weight": 100.0,
                "labor_cost": 8.0,
                "supplier": "金源珠宝"
            }
        },
        {
            "message": "开销售单：客户张三，古法戒指 50克 工费10元/克，业务员李四，门店代码001",
            "name": "销售单数据提取",
            "checks": {
                "has_customer_name": "张三",
                "has_salesperson": "李四",
                "has_store_code": "001",
                "has_items": True
            }
        }
    ]
    
    for test_case in test_cases:
        try:
            result = parse_user_message(test_case["message"])
            checks = test_case["checks"]
            all_passed = True
            error_msg = ""
            
            # 检查入库数据
            if "has_products" in checks:
                if checks["has_products"]:
                    if not result.products or len(result.products) == 0:
                        all_passed = False
                        error_msg += "缺少products; "
                    else:
                        product = result.products[0]
                        if "product_name" in checks:
                            if product.product_name != checks["product_name"]:
                                all_passed = False
                                error_msg += f"商品名称不匹配: {product.product_name}; "
                        if "weight" in checks:
                            if product.weight != checks["weight"]:
                                all_passed = False
                                error_msg += f"重量不匹配: {product.weight}; "
                        if "labor_cost" in checks:
                            if product.labor_cost != checks["labor_cost"]:
                                all_passed = False
                                error_msg += f"工费不匹配: {product.labor_cost}; "
                        if "supplier" in checks:
                            if product.supplier != checks["supplier"]:
                                all_passed = False
                                error_msg += f"供应商不匹配: {product.supplier}; "
            
            # 检查销售单数据
            if "has_customer_name" in checks:
                if result.customer_name != checks["has_customer_name"]:
                    all_passed = False
                    error_msg += f"客户名称不匹配: {result.customer_name}; "
            if "has_salesperson" in checks:
                if result.salesperson != checks["has_salesperson"]:
                    all_passed = False
                    error_msg += f"业务员不匹配: {result.salesperson}; "
            if "has_store_code" in checks:
                if result.store_code != checks["has_store_code"]:
                    all_passed = False
                    error_msg += f"门店代码不匹配: {result.store_code}; "
            if "has_items" in checks:
                if not result.items or len(result.items) == 0:
                    all_passed = False
                    error_msg += "缺少items; "
            
            if all_passed:
                print_test(test_case["name"], True)
            else:
                print_test(test_case["name"], False, error_msg)
                
        except Exception as e:
            print_test(test_case["name"], False, str(e)[:100])

def test_multiple_products(api_key):
    """测试6: 多商品场景"""
    print_header("测试6: 多商品场景测试")
    
    if not api_key:
        print_test("多商品场景", False, "API Key未配置")
        return
    
    try:
        from app.ai_parser import parse_user_message
    except ImportError:
        print_test("导入ai_parser", False, "无法导入app.ai_parser模块")
        return
    
    test_message = "帮我入库：第一行是古法戒指 100克 工费8元，第二行是黄金手链 200克 工费10元，供应商都是金源珠宝"
    
    try:
        result = parse_user_message(test_message)
        
        if result.action != "入库":
            print_test("多商品-意图识别", False, f"期望: 入库, 实际: {result.action}")
            return
        
        print_test("多商品-意图识别", True)
        
        if not result.products or len(result.products) < 2:
            print_test("多商品-商品数量", False, f"期望至少2个商品，实际: {len(result.products) if result.products else 0}")
            return
        
        print_test("多商品-商品数量", True, f"共{len(result.products)}个商品")
        
        # 检查第一个商品
        product1 = result.products[0]
        if product1.product_name and product1.weight and product1.labor_cost:
            print_test("多商品-第一个商品数据", True)
        else:
            print_test("多商品-第一个商品数据", False, "缺少必要字段")
        
        # 检查第二个商品
        product2 = result.products[1]
        if product2.product_name and product2.weight and product2.labor_cost:
            print_test("多商品-第二个商品数据", True)
        else:
            print_test("多商品-第二个商品数据", False, "缺少必要字段")
            
    except Exception as e:
        print_test("多商品场景", False, str(e)[:100])

def test_ai_parser_integration(api_key):
    """测试7: AI Parser集成测试"""
    print_header("测试7: AI Parser集成测试")
    
    if not api_key:
        print_test("集成测试", False, "API Key未配置")
        return
    
    try:
        from app.ai_parser import parse_user_message
        from app.schemas import AIResponse
    except ImportError as e:
        print_test("导入模块", False, f"无法导入模块: {e}")
        return
    
    print_test("导入模块", True)
    
    # 测试返回类型
    try:
        result = parse_user_message("查询库存")
        if isinstance(result, AIResponse):
            print_test("返回类型", True)
        else:
            print_test("返回类型", False, f"期望AIResponse，实际: {type(result)}")
    except Exception as e:
        print_test("返回类型", False, str(e)[:100])
    
    # 测试基本字段
    try:
        result = parse_user_message("查询库存")
        if hasattr(result, 'action'):
            print_test("基本字段-action", True)
        else:
            print_test("基本字段-action", False, "缺少action字段")
    except Exception as e:
        print_test("基本字段-action", False, str(e)[:100])

def test_error_handling(api_key):
    """测试8: 错误处理机制"""
    print_header("测试8: 错误处理机制测试")
    
    if not api_key:
        print_test("错误处理", False, "API Key未配置")
        return
    
    try:
        from app.ai_parser import parse_user_message, fallback_parser
    except ImportError:
        print_test("导入ai_parser", False, "无法导入app.ai_parser模块")
        return
    
    # 测试空消息
    try:
        result = parse_user_message("")
        print_test("空消息处理", True, f"返回action: {result.action}")
    except Exception as e:
        print_test("空消息处理", False, str(e)[:100])
    
    # 测试非常长的消息
    try:
        long_message = "查询库存" * 1000
        result = parse_user_message(long_message)
        print_test("长消息处理", True)
    except Exception as e:
        print_test("长消息处理", False, str(e)[:100])
    
    # 测试备用解析器
    try:
        result = fallback_parser("古法戒指 100克 工费8元 供应商是金源珠宝，帮我做个入库")
        if result and hasattr(result, 'action'):
            print_test("备用解析器", True, f"返回action: {result.action}")
        else:
            print_test("备用解析器", False, "备用解析器返回无效结果")
    except Exception as e:
        print_test("备用解析器", False, str(e)[:100])

def print_summary():
    """打印测试总结"""
    print_header("测试总结")
    
    total = test_results["total"]
    passed = test_results["passed"]
    failed = test_results["failed"]
    pass_rate = (passed / total * 100) if total > 0 else 0
    
    print(f"总测试数: {total}")
    print(f"通过: {passed}")
    print(f"失败: {failed}")
    print(f"通过率: {pass_rate:.1f}%")
    
    if failed > 0:
        print("\n失败的测试:")
        for error in test_results["errors"]:
            print(f"  - {error}")
    
    print("\n" + "=" * 70)

def main():
    """主测试函数"""
    print_header("Claude API 全面测试")
    print("开始测试 Claude API 的各项功能...")
    
    # 测试1: API Key
    api_key = test_api_key()
    
    # 测试2: 模型可用性
    if api_key:
        test_model_availability(api_key)
    
    # 测试3-8: 功能测试
    if api_key:
        test_intent_recognition(api_key)
        test_context_questions(api_key)
        test_data_extraction(api_key)
        test_multiple_products(api_key)
        test_ai_parser_integration(api_key)
        test_error_handling(api_key)
    
    # 打印总结
    print_summary()

if __name__ == "__main__":
    main()

