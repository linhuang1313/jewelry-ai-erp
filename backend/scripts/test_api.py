import urllib.request
import json

req = urllib.request.Request("http://localhost:9000/api/fbl-finance/accounts")
try:
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode())
        accounts = data.get("data", [])
        matches = [a for a in accounts if '400' in str(a.get('code','')) or '400' in str(a.get('name',''))]
        print("Total accounts:", len(accounts))
        print("Matches for '400':", len(matches))
        print(matches[:5])
except Exception as e:
    print(e)
