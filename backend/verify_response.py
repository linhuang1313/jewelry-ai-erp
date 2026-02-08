import requests
import sys

try:
    resp = requests.get("http://localhost:8011/api/fbl-finance/vouchers?page=1&page_size=1")
    data = resp.json()
    if not data.get("success"):
        print(f"FAIL: {data.get('message')}")
        sys.exit(1)
        
    vouchers = data.get("data", [])
    if not vouchers:
        print("WARNING: No vouchers found")
    else:
        v = vouchers[0]
        print(f"Voucher Date: {v.get('voucher_date')}")
        print(f"Related Units: {v.get('related_units')}")
        
    print("SUCCESS")
except Exception as e:
    print(f"ERROR: {e}")
    sys.exit(1)
