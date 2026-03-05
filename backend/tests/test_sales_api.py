"""测试销售单API功能"""
import requests
import json
from datetime import datetime

BASE_URL = "http://localhost:8000"

def test_create_customer():
    """测试创建客户"""
    print("=" * 60)
    print("测试创建客户")
    print("=" * 60)
    
    url = f"{BASE_URL}/api/customers"
    data = {
        "name": "张三",
        "phone": "13800138000",
        "customer_type": "个人"
    }
    
    try:
        response = requests.post(url, json=data)
        result = response.json()
        print(f"状态码: {response.status_code}")
        print(f"响应: {json.dumps(result, ensure_ascii=False, indent=2)}")
        return result.get("customer", {}).get("id") if result.get("success") else None
    except Exception as e:
        print(f"错误: {e}")
        return None

def test_create_sales_order():
    """测试创建销售单"""
    print("\n" + "=" * 60)
    print("测试创建销售单")
    print("=" * 60)
    
    url = f"{BASE_URL}/api/sales/orders"
    data = {
        "order_date": datetime.now().isoformat(),
        "customer_name": "张三",
        "salesperson": "李四",
        "store_code": "001",
        "remark": "门店代码001",
        "items": [
            {
                "product_name": "古法戒指",
                "weight": 50.0,
                "labor_cost": 10.0
            },
            {
                "product_name": "黄金手链",
                "weight": 30.0,
                "labor_cost": 8.0
            }
        ]
    }
    
    try:
        response = requests.post(url, json=data)
        result = response.json()
        print(f"状态码: {response.status_code}")
        print(f"响应: {json.dumps(result, ensure_ascii=False, indent=2)}")
        return result.get("order", {}).get("id") if result.get("success") else None
    except Exception as e:
        print(f"错误: {e}")
        return None

def test_query_sales_orders():
    """测试查询销售单"""
    print("\n" + "=" * 60)
    print("测试查询销售单")
    print("=" * 60)
    
    url = f"{BASE_URL}/api/sales/orders"
    params = {
        "customer_name": "张三"
    }
    
    try:
        response = requests.get(url, params=params)
        result = response.json()
        print(f"状态码: {response.status_code}")
        print(f"响应: {json.dumps(result, ensure_ascii=False, indent=2)}")
    except Exception as e:
        print(f"错误: {e}")

def test_ai_chat_create_sales():
    """测试AI对话创建销售单"""
    print("\n" + "=" * 60)
    print("测试AI对话创建销售单")
    print("=" * 60)
    
    url = f"{BASE_URL}/api/chat"
    data = {
        "message": "开销售单：今天，客户张三，古法戒指 50克 工费10元/克，业务员李四，门店代码001"
    }
    
    try:
        response = requests.post(url, json=data)
        result = response.json()
        print(f"状态码: {response.status_code}")
        print(f"响应: {json.dumps(result, ensure_ascii=False, indent=2)}")
    except Exception as e:
        print(f"错误: {e}")

if __name__ == "__main__":
    print("开始测试销售单功能...\n")
    
    # 测试创建客户
    customer_id = test_create_customer()
    
    # 测试创建销售单
    order_id = test_create_sales_order()
    
    # 测试查询销售单
    test_query_sales_orders()
    
    # 测试AI对话
    test_ai_chat_create_sales()
    
    print("\n" + "=" * 60)
    print("测试完成")
    print("=" * 60)

