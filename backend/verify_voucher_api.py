import urllib.request
import json
from datetime import datetime
import sys

# Force UTF-8 for stdout if possible
try:
    sys.stdout.reconfigure(encoding='utf-8')
except:
    pass

BASE_URL = "http://localhost:8004/api/fbl-finance"

def make_request(url, method="GET", data=None):
    try:
        req = urllib.request.Request(url, method=method)
        if data:
            json_data = json.dumps(data).encode("utf-8")
            req.add_header("Content-Type", "application/json")
            req.data = json_data
        
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode("utf-8"))
    except Exception as e:
        print(f"Request failed: {url} {method} - {e}")
        return None

print("START_VERIFY")
# 1. Get types
resp = make_request(f"{BASE_URL}/voucher-types")
if not resp or not resp.get("success"):
    print("FAIL_GET_TYPES")
    sys.exit(1)
type_id = resp["data"][0]["id"]

# 2. Get accounts
resp = make_request(f"{BASE_URL}/accounts")
if not resp or not resp.get("success"):
    print("FAIL_GET_ACCOUNTS")
    sys.exit(1)
acc1 = resp["data"][0]["id"]
acc2 = resp["data"][1]["id"]

# 3. Create voucher
payload = {
    "voucher_date": datetime.now().strftime("%Y-%m-%d"),
    "voucher_type_id": type_id,
    "entry_rows": [
        { "summary": "Test", "account_id": acc1, "debit": 100, "credit": 0 },
        { "summary": "Test", "account_id": acc2, "debit": 0, "credit": 100 }
    ],
    "maker": "TestBot"
}
resp = make_request(f"{BASE_URL}/vouchers", method="POST", data=payload)
if not resp or not resp.get("success"):
    print(f"FAIL_CREATE: {resp.get('message') if resp else 'No response'}")
    sys.exit(1)

# 4. Verify
resp = make_request(f"{BASE_URL}/vouchers?page=1&page_size=1")
if not resp or not resp.get("success"):
    print("FAIL_GET_VOUCHERS")
    sys.exit(1)

voucher = resp["data"][0]
if "attached_voucher_num" in voucher:
    print("FAIL_FIELD_PRESENT")
    sys.exit(1)

print("VERIFY_SUCCESS")
