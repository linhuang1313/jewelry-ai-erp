import json
import urllib.request
url = 'http://localhost:9000/api/fbl-finance/vouchers?page=1&page_size=2000'
req = urllib.request.Request(url)
res = urllib.request.urlopen(req)
raw = res.read().decode('utf-8')
data = json.loads(raw)
for v in data.get('data', []):
    if v.get('maker') == '谢佛娇' and '1700' in v.get('code', ''):
        print(f"Doc {v['id']}: DR {v.get('total_dr')} CR {v.get('total_cr')}")
        for e in v.get('entries', []):
            print(f"  Entry: DR {e.get('debit')} CR {e.get('credit')} | {e.get('summary')} | {e.get('account_code')} - {e.get('account_name')}")
