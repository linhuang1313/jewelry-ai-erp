import urllib.request
import json
import sys

try:
    req = urllib.request.Request("http://localhost:8000/api/fbl-finance/accounts")
    with urllib.request.urlopen(req) as response:
        data = json.loads(response.read().decode())
        if data.get("data") and len(data["data"]) > 0:
            print("Keys of first item:", data["data"][0].keys())
            print("First item:", data["data"][0])
        else:
            print("No data or empty array")
except Exception as e:
    print(f"Error: {e}")
