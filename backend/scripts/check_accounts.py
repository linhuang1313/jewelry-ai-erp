import sqlite3
import json

db_path = r"d:\dev\jewelry-ai-erp\data\fbl_finance_data.db"
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
cursor = conn.cursor()
cursor.execute("SELECT id, code, name FROM aa_account LIMIT 5")
rows = [dict(row) for row in cursor.fetchall()]
print(json.dumps(rows, ensure_ascii=False, indent=2))
conn.close()
