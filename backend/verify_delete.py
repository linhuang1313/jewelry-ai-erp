import urllib.request
import json
from datetime import datetime
import sys
import time

# Force UTF-8 for stdout
try:
    sys.stdout.reconfigure(encoding='utf-8')
except:
    pass

BASE_URL = "http://localhost:8011/api/fbl-finance"

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

print("START_DELETE_VERIFY")

# Give server a moment to reload if it hasn't
# time.sleep(2)

# 1. Get types/accounts
resp = make_request(f"{BASE_URL}/voucher-types")
if not resp or not resp.get("success"):
    print("FAIL_GET_TYPES")
    sys.exit(1)
type_id = resp["data"][0]["id"]

resp = make_request(f"{BASE_URL}/accounts")
if not resp or not resp.get("success"):
    print("FAIL_GET_ACCOUNTS")
    sys.exit(1)
acc1 = resp["data"][0]["id"]
acc2 = resp["data"][1]["id"]

# 2. Create voucher
payload = {
    "voucher_date": datetime.now().strftime("%Y-%m-%d"),
    "voucher_type_id": type_id,
    "entry_rows": [
        { "summary": "Delete Test", "account_id": acc1, "debit": 100, "credit": 0 },
        { "summary": "Delete Test", "account_id": acc2, "debit": 0, "credit": 100 }
    ],
    "maker": "DeleteBot"
}
resp = make_request(f"{BASE_URL}/vouchers", method="POST", data=payload)
if not resp or not resp.get("success"):
    print(f"FAIL_CREATE: {resp.get('message') if resp else 'No resp'}")
    sys.exit(1)

voucher_id = resp["data"]["id"]
print(f"CREATED_ID: {voucher_id}")

# 3. Verify existence and related_units
resp = make_request(f"{BASE_URL}/vouchers?page=1&page_size=10")
found = False
if resp and resp.get("data"):
    for v in resp["data"]:
        if v["id"] == voucher_id:
            found = True
            # Verify related_units field exists (it might be empty string/None for this test voucher unless we injected AuxItems)
            # But the key must be present in response
            if "related_units" not in v:
                print("FAIL_RELATED_UNITS_MISSING_KEY")
                sys.exit(1)
            print(f"RELATED_UNITS_VAL: {v.get('related_units')}")
            break
if not found:
    print("FAIL_VERIFY_EXISTENCE")
    sys.exit(1)

# 5. Verify Filter (Optional - requires data setup)
# We can just verify the parameter is accepted without error
print("VERIFY_FILTER_PARAM")
resp = make_request(f"{BASE_URL}/vouchers?page=1&page_size=10&related_unit=Test")
if not resp or not resp.get("success"):
    print("FAIL_FILTER_REQUEST")
    sys.exit(1)
print("FILTER_REQUEST_SUCCESS")

# 6. Delete
print(f"DELETING_ID: {voucher_id}")
resp = make_request(f"{BASE_URL}/vouchers/{voucher_id}", method="DELETE")
if not resp or not resp.get("success"):
    print(f"FAIL_DELETE: {resp.get('message') if resp else 'No resp'}")
    sys.exit(1)
print("DELETE_CALLED")

# 5. Verify gone
resp = make_request(f"{BASE_URL}/vouchers?page=1&page_size=10")
found = False
if resp and resp.get("data"):
    for v in resp["data"]:
        if v["id"] == voucher_id:
            found = True
            break
if found:
    print("FAIL_STILL_EXISTS")
    sys.exit(1)

print("DELETE_VERIFY_SUCCESS")
