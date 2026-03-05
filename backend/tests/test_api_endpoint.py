"""测试API端点"""
import urllib.request
import urllib.parse
import json

url = "http://localhost:8000/api/chat"
test_message = "古法黄金戒指 100克 工费6元 供应商是金源珠宝，帮我做个入库"

print("=" * 60)
print("测试API端点")
print("=" * 60)
print(f"URL: {url}")
print(f"测试消息: {test_message}\n")

try:
    data = json.dumps({"message": test_message}).encode('utf-8')
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"}
    )
    
    with urllib.request.urlopen(req) as response:
        status_code = response.getcode()
        response_data = json.loads(response.read().decode('utf-8'))
    
    print(f"状态码: {status_code}")
    print("\n响应内容:")
    print("=" * 60)
    
    print(json.dumps(response_data, ensure_ascii=False, indent=2))
    
    print("=" * 60)
    
    if response_data.get("success"):
        print("\n[成功] API调用成功！")
        if "order" in response_data:
            print(f"入库单号: {response_data['order']['order_no']}")
            print(f"商品名称: {response_data['detail']['product_name']}")
            print(f"重量: {response_data['detail']['weight']}克")
            print(f"工费: {response_data['detail']['labor_cost']}元")
            print(f"供应商: {response_data['detail']['supplier']}")
            print(f"当前库存: {response_data['inventory']['total_weight']}克")
    else:
        print(f"\n[失败] {response_data.get('message', '未知错误')}")
        if "parsed" in response_data:
            print("\n解析结果:")
            print(json.dumps(response_data["parsed"], ensure_ascii=False, indent=2))
            
except urllib.error.URLError as e:
    print(f"[错误] 无法连接到服务器: {e}")
    print("请确保后端服务正在运行 (uvicorn app.main:app --reload --port 8000)")
except Exception as e:
    print(f"[错误] {type(e).__name__}: {str(e)}")
    import traceback
    traceback.print_exc()

