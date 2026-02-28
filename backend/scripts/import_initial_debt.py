"""
导入供应商期初欠款数据（从旧系统 Excel 迁移）

用法:
  python backend/scripts/import_initial_debt.py [excel_path]

如果不指定路径，会自动在桌面查找包含"欠工厂"的 .xls 文件。
"""
import sys
import os
import glob
import math

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal
from app.models import Supplier


def safe_float(val):
    try:
        f = float(val) if val is not None else 0.0
        return 0.0 if math.isnan(f) or math.isinf(f) else f
    except (ValueError, TypeError):
        return 0.0


def find_excel_file():
    """在桌面自动查找目标文件"""
    desktop = os.path.expanduser("~/Desktop")
    for f in glob.glob(os.path.join(desktop, "*.xls*")):
        if "~$" not in f:
            try:
                df = pd.read_excel(f, engine="xlrd", nrows=5)
                cols_str = " ".join(str(c) for c in df.columns)
                if "采购" in cols_str or "梵贝琳" in cols_str:
                    return f
            except Exception:
                continue
    return None


def main(excel_path=None):
    if not excel_path:
        excel_path = find_excel_file()
    if not excel_path or not os.path.exists(excel_path):
        print("未找到 Excel 文件，请指定路径作为参数")
        sys.exit(1)

    print(f"读取文件: {excel_path}")
    df = pd.read_excel(excel_path, engine="xlrd")

    # 数据从第 4 行开始（索引 4-61），第 3 行是表头（序号/供应商/结算点/00-人民币/00-足金）
    # 最后一行是合计
    data_rows = df.iloc[4:]

    db = SessionLocal()
    try:
        updated = 0
        created = 0
        skipped = 0

        for _, row in data_rows.iterrows():
            supplier_name = str(row.iloc[1]).strip() if pd.notna(row.iloc[1]) else ""
            if not supplier_name or supplier_name == "合计":
                continue

            labor_debt = safe_float(row.iloc[3])   # 00-人民币
            gold_debt = safe_float(row.iloc[4])     # 00-足金

            if labor_debt == 0 and gold_debt == 0:
                skipped += 1
                continue

            supplier = db.query(Supplier).filter(Supplier.name == supplier_name).first()
            if not supplier:
                max_no = db.query(Supplier).count() + 1
                supplier = Supplier(
                    supplier_no=f"S{max_no:04d}",
                    name=supplier_name,
                    supplier_type="公司",
                    status="active",
                )
                db.add(supplier)
                db.flush()
                created += 1
                print(f"  新建供应商: {supplier_name} ({supplier.supplier_no})")

            supplier.initial_labor_debt = labor_debt
            supplier.initial_gold_debt = gold_debt
            updated += 1
            print(f"  {supplier_name}: 工费欠款={labor_debt:,.2f}元, 欠料={gold_debt:,.4f}克")

        db.commit()
        print(f"\n导入完成: 更新 {updated} 家, 新建 {created} 家, 跳过 {skipped} 家")

        # 验证汇总
        total_labor = sum(safe_float(s.initial_labor_debt) for s in db.query(Supplier).all())
        total_gold = sum(safe_float(s.initial_gold_debt) for s in db.query(Supplier).all())
        print(f"数据库期初汇总: 工费欠款={total_labor:,.2f}元, 欠料={total_gold:,.4f}克")

    except Exception as e:
        db.rollback()
        print(f"导入失败: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else None
    main(path)
