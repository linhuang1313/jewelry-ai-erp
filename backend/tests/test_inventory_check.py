"""测试库存检查功能"""
import requests
import json
from datetime import datetime

BASE_URL = "http://127.0.0.1:8000"

def test_inventory_sufficient():
    """测试库存充足的情况"""
    print("=" * 60)
    print("测试1: 库存充足 - 应该成功创建销售单")
    print("=" * 60)
    
    # 先确保有库存（通过入库）
    print("\n步骤1: 先入库商品...")
    inbound_data = {
        "message": "入库：古法戒指 100克 工费10元 供应商是测试供应商"
    }
    try:
        response = requests.post(f"{BASE_URL}/api/chat", json=inbound_data)
        print(f"入库结果: {response.json().get('message')}")
    except Exception as e:
        print(f"入库失败: {e}")
        return
    
    # 创建销售单（库存充足）
    print("\n步骤2: 创建销售单（50克，库存100克，应该成功）...")
    sales_data = {
        "customer_name": "测试客户",
        "salesperson": "测试业务员",
        "store_code": "001",
        "items": [
            {
                "product_name": "古法戒指",
                "weight": 50.0,
                "labor_cost": 10.0
            }
        ]
    }
    
    try:
        response = requests.post(f"{BASE_URL}/api/sales/orders", json=sales_data)
        result = response.json()
        print(f"状态码: {response.status_code}")
        if result.get("success"):
            print(f"✓ 成功: {result.get('message')}")
            print(f"  销售单号: {result.get('order', {}).get('order_no')}")
        else:
            print(f"✗ 失败: {result.get('message')}")
            if result.get("inventory_errors"):
                print(f"  库存错误: {json.dumps(result['inventory_errors'], ensure_ascii=False, indent=2)}")
    except Exception as e:
        print(f"错误: {e}")

def test_inventory_insufficient():
    """测试库存不足的情况"""
    print("\n" + "=" * 60)
    print("测试2: 库存不足 - 应该拒绝创建销售单")
    print("=" * 60)
    
    # 创建销售单（库存不足：需要200克，但只有100克）
    print("\n创建销售单（需要200克，但库存只有100克，应该失败）...")
    sales_data = {
        "customer_name": "测试客户",
        "salesperson": "测试业务员",
        "store_code": "001",
        "items": [
            {
                "product_name": "古法戒指",
                "weight": 200.0,  # 超过库存
                "labor_cost": 10.0
            }
        ]
    }
    
    try:
        response = requests.post(f"{BASE_URL}/api/sales/orders", json=sales_data)
        result = response.json()
        print(f"状态码: {response.status_code}")
        if result.get("success"):
            print(f"✗ 不应该成功: {result.get('message')}")
        else:
            print(f"✓ 正确拒绝: {result.get('message')}")
            if result.get("inventory_errors"):
                print(f"  库存错误详情:")
                for error in result["inventory_errors"]:
                    print(f"    - 商品: {error['product_name']}")
                    print(f"      错误: {error['error']}")
                    print(f"      需要: {error['required_weight']}克")
                    print(f"      可用: {error['available_weight']}克")
    except Exception as e:
        print(f"错误: {e}")

def test_product_not_exist():
    """测试商品不存在的情况"""
    print("\n" + "=" * 60)
    print("测试3: 商品不存在 - 应该拒绝创建销售单")
    print("=" * 60)
    
    # 创建销售单（商品不存在）
    print("\n创建销售单（商品'不存在的商品'不在库存中，应该失败）...")
    sales_data = {
        "customer_name": "测试客户",
        "salesperson": "测试业务员",
        "store_code": "001",
        "items": [
            {
                "product_name": "不存在的商品",
                "weight": 50.0,
                "labor_cost": 10.0
            }
        ]
    }
    
    try:
        response = requests.post(f"{BASE_URL}/api/sales/orders", json=sales_data)
        result = response.json()
        print(f"状态码: {response.status_code}")
        if result.get("success"):
            print(f"✗ 不应该成功: {result.get('message')}")
        else:
            print(f"✓ 正确拒绝: {result.get('message')}")
            if result.get("inventory_errors"):
                print(f"  库存错误详情:")
                for error in result["inventory_errors"]:
                    print(f"    - 商品: {error['product_name']}")
                    print(f"      错误: {error['error']}")
                    print(f"      需要: {error['required_weight']}克")
                    print(f"      可用: {error['available_weight']}克")
    except Exception as e:
        print(f"错误: {e}")

def test_partial_insufficient():
    """测试部分商品库存不足的情况"""
    print("\n" + "=" * 60)
    print("测试4: 部分商品库存不足 - 应该拒绝整个销售单")
    print("=" * 60)
    
    # 先入库第二个商品
    print("\n步骤1: 先入库第二个商品...")
    inbound_data = {
        "message": "入库：黄金手链 50克 工费8元 供应商是测试供应商"
    }
    try:
        response = requests.post(f"{BASE_URL}/api/chat", json=inbound_data)
        print(f"入库结果: {response.json().get('message')}")
    except Exception as e:
        print(f"入库失败: {e}")
    
    # 创建销售单（第一个商品库存不足，第二个充足）
    print("\n步骤2: 创建销售单（古法戒指需要200克但只有100克，黄金手链50克充足）...")
    sales_data = {
        "customer_name": "测试客户",
        "salesperson": "测试业务员",
        "store_code": "001",
        "items": [
            {
                "product_name": "古法戒指",
                "weight": 200.0,  # 库存不足
                "labor_cost": 10.0
            },
            {
                "product_name": "黄金手链",
                "weight": 50.0,  # 库存充足
                "labor_cost": 8.0
            }
        ]
    }
    
    try:
        response = requests.post(f"{BASE_URL}/api/sales/orders", json=sales_data)
        result = response.json()
        print(f"状态码: {response.status_code}")
        if result.get("success"):
            print(f"✗ 不应该成功: {result.get('message')}")
        else:
            print(f"✓ 正确拒绝: {result.get('message')}")
            if result.get("inventory_errors"):
                print(f"  库存错误详情:")
                for error in result["inventory_errors"]:
                    print(f"    - 商品: {error['product_name']}")
                    print(f"      错误: {error['error']}")
                    print(f"      需要: {error['required_weight']}克")
                    print(f"      可用: {error['available_weight']}克")
    except Exception as e:
        print(f"错误: {e}")

if __name__ == "__main__":
    print("开始测试库存检查功能...\n")
    
    # 测试1: 库存充足
    test_inventory_sufficient()
    
    # 测试2: 库存不足
    test_inventory_insufficient()
    
    # 测试3: 商品不存在
    test_product_not_exist()
    
    # 测试4: 部分商品库存不足
    test_partial_insufficient()
    
    print("\n" + "=" * 60)
    print("测试完成")
    print("=" * 60)

