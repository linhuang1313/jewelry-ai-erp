# -*- coding: utf-8 -*-
"""
One-time backfill script: create InboundOrder + InboundDetail records
for showroom inventory that was previously imported without them.

This script re-reads the original showroom Excel file and creates
InboundDetail records so the inventory detail expand view shows
per-barcode weight, labor cost, etc.

It will NOT touch location_inventory or inventory tables — only creates
the missing inbound_orders + inbound_details rows.

If a showroom import order already exists (operator="展厅Excel导入"),
the script will skip creation to avoid duplicates. Use --force to
delete existing showroom import orders and re-create them.

Usage:
    cd backend
    python scripts/backfill_showroom_details.py "C:\\path\\to\\showroom_inventory.xlsx"
    python scripts/backfill_showroom_details.py --force "C:\\path\\to\\showroom_inventory.xlsx"
"""
import sys
import os
import glob
import argparse
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

SHOWROOM_IMPORT_OPERATOR = "展厅Excel导入"


def find_excel_file(path_hint: str) -> str:
    if os.path.isfile(path_hint):
        return path_hint
    candidates = glob.glob(path_hint)
    if candidates:
        return candidates[0]
    pattern = os.path.join(os.path.expanduser("~"), "Desktop", "*.xlsx")
    for f in sorted(glob.glob(pattern)):
        if "~$" not in f and "库存" in os.path.basename(f):
            return f
    raise FileNotFoundError(f"Excel not found: {path_hint}")


def main():
    parser = argparse.ArgumentParser(description="Backfill showroom InboundDetail records")
    parser.add_argument("excel_path", nargs="?", default="库存表.xlsx",
                        help="Original showroom Excel file path")
    parser.add_argument("--force", action="store_true",
                        help="Delete existing showroom import orders and re-create")
    args = parser.parse_args()

    excel_path = find_excel_file(args.excel_path)
    print(f"读取文件: {excel_path}")

    import pandas as pd
    df = pd.read_excel(excel_path, sheet_name="Sheet1", engine="openpyxl", skiprows=1)
    df.columns = ["idx", "barcode", "product_name", "piece_count", "weight",
                   "sale_labor_cost", "sale_piece_labor_cost"]
    df["weight"] = pd.to_numeric(df["weight"], errors="coerce").fillna(0)
    df["piece_count"] = pd.to_numeric(df["piece_count"], errors="coerce").fillna(0).astype(int)

    print(f"Excel: {len(df)} rows, {df['product_name'].nunique()} names, "
          f"weight {df['weight'].sum():.3f}g")

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("ERROR: DATABASE_URL not set")
        sys.exit(1)

    engine = create_engine(db_url)
    Session = sessionmaker(bind=engine)
    session = Session()

    try:
        # Check for existing showroom import orders
        existing = session.execute(
            text("SELECT id, order_no FROM inbound_orders WHERE operator = :op"),
            {"op": SHOWROOM_IMPORT_OPERATOR}
        ).fetchall()

        if existing and not args.force:
            print(f"\n已存在 {len(existing)} 个展厅导入入库单:")
            for r in existing:
                print(f"  id={r[0]} order_no={r[1]}")
            print("\n跳过创建。如需重新创建，请使用 --force 参数。")
            return

        if existing and args.force:
            print(f"--force: 删除 {len(existing)} 个旧展厅导入入库单...")
            for r in existing:
                session.execute(text("DELETE FROM inbound_details WHERE order_id = :oid"), {"oid": r[0]})
                session.execute(text("DELETE FROM inbound_orders WHERE id = :oid"), {"oid": r[0]})
            session.flush()
            print("  已清理。")

        # Build name mapping from product_codes (same logic as import script)
        existing_codes = {}
        for row in session.execute(text("SELECT code, name FROM product_codes")):
            existing_codes[row[0]] = row[1]

        excel_name_to_standard = {}
        for excel_name in df["product_name"].unique():
            excel_name = str(excel_name).strip()
            barcodes_for_name = df[df["product_name"] == excel_name]["barcode"].unique()

            predefined_name = None
            any_name = None
            for bc in barcodes_for_name:
                bc = str(bc).strip()
                std_name = existing_codes.get(bc)
                if std_name:
                    any_name = std_name
                    row = session.execute(
                        text("SELECT code_type FROM product_codes WHERE code = :c"),
                        {"c": bc}
                    ).fetchone()
                    if row and row[0] == "predefined":
                        predefined_name = std_name
                        break

            standard_name = predefined_name or any_name or excel_name
            if standard_name != excel_name:
                excel_name_to_standard[excel_name] = standard_name

        df["standard_name"] = df["product_name"].apply(
            lambda x: excel_name_to_standard.get(str(x).strip(), str(x).strip())
        )

        # Create InboundOrder
        order_no = f"SHOWROOM-BACKFILL-{datetime.now().strftime('%Y%m%d%H%M%S')}"
        session.execute(
            text("INSERT INTO inbound_orders (order_no, create_time, operator, status, is_audited) "
                 "VALUES (:order_no, :ct, :op, 'completed', true)"),
            {"order_no": order_no, "ct": datetime.now(), "op": SHOWROOM_IMPORT_OPERATOR}
        )
        session.flush()
        inbound_order_row = session.execute(
            text("SELECT id FROM inbound_orders WHERE order_no = :on"),
            {"on": order_no}
        ).fetchone()
        inbound_order_id = inbound_order_row[0]

        # Create InboundDetail for each Excel row
        detail_count = 0
        for _, erow in df.iterrows():
            barcode = str(erow["barcode"]).strip()
            std_name = str(erow["standard_name"]).strip()
            w = float(erow["weight"]) if erow["weight"] else 0.0
            pc = int(erow["piece_count"]) if erow["piece_count"] else None
            slc = float(erow["sale_labor_cost"]) if pd.notna(erow.get("sale_labor_cost")) else 0.0
            splc = float(erow["sale_piece_labor_cost"]) if pd.notna(erow.get("sale_piece_labor_cost")) else None
            tc = round(w * slc + (pc or 0) * (splc or 0), 2)

            session.execute(
                text("INSERT INTO inbound_details "
                     "(order_id, product_code, product_name, weight, labor_cost, "
                     " piece_count, piece_labor_cost, total_cost, sale_labor_cost, sale_piece_labor_cost) "
                     "VALUES (:oid, :pc, :pn, :w, :lc, :cnt, :plc, :tc, :slc, :splc)"),
                {
                    "oid": inbound_order_id,
                    "pc": barcode,
                    "pn": std_name,
                    "w": round(w, 4),
                    "lc": slc,
                    "cnt": pc,
                    "plc": splc,
                    "tc": tc,
                    "slc": slc,
                    "splc": splc,
                }
            )
            detail_count += 1

        session.commit()

        print(f"\n--- backfill done ---")
        print(f"  order: {order_no} (id={inbound_order_id})")
        print(f"  inbound_details: {detail_count} rows")
        print(f"  name mappings: {len(excel_name_to_standard)}")

        # Verify
        verify = session.execute(
            text("SELECT count(*) FROM inbound_details WHERE order_id = :oid"),
            {"oid": inbound_order_id}
        ).fetchone()
        print(f"  verify: {verify[0]} details in DB")

    except Exception as e:
        session.rollback()
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        session.close()


if __name__ == "__main__":
    main()
