import urllib.request
import json
import socket

def test_api():
    try:
        req = urllib.request.Request("http://localhost:9000/api/fbl-finance/accounts")
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode())
            accounts = data.get("data", [])
            print("Total accounts:", len(accounts))
            for a in accounts:
                if '400' in str(a.get('code', '')):
                    print("Found code 400-like:", a)
            for a in accounts:
                if '400' in str(a.get('name', '')):
                    print("Found name 400-like:", a)
    except Exception as e:
        print("Error:", e)
        
if __name__ == "__main__":
    test_api()
