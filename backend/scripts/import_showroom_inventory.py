# -*- coding: utf-8 -*-
"""
Showroom inventory import script.
Reads Excel, resolves standard product names via product_codes,
writes to showroom location_inventory AND creates InboundOrder/InboundDetail
records so that per-barcode detail (weight, labor cost) is queryable.

Usage:
    cd backend
    python scripts/import_showroom_inventory.py "C:\\Users\\Administrator\\Desktop\\inventory.xlsx"
    python scripts/import_showroom_inventory.py --clean "C:\\Users\\Administrator\\Desktop\\inventory.xlsx"
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
        if "~$" not in f and "\u5e93\u5b58" in os.path.basename(f):
            return f
    raise FileNotFoundError(f"Excel not found: {path_hint}")


def main():
    parser = argparse.ArgumentParser(description="Import showroom inventory")
    parser.add_argument("excel_path", nargs="?", default="\u5e93\u5b58\u8868.xlsx",
                        help="Excel file path")
    parser.add_argument("--clean", action="store_true",
                        help="Clear all inventory before import")
    args = parser.parse_args()

    excel_path = find_excel_file(args.excel_path)
    print(f"\u8bfb\u53d6\u6587\u4ef6: {excel_path}")

    import pandas as pd
    df = pd.read_excel(excel_path, sheet_name="Sheet1", engine="openpyxl", skiprows=1)
    df.columns = ["idx", "barcode", "product_name", "piece_count", "weight",
                   "sale_labor_cost", "sale_piece_labor_cost"]
    df["weight"] = pd.to_numeric(df["weight"], errors="coerce").fillna(0)
    df["piece_count"] = pd.to_numeric(df["piece_count"], errors="coerce").fillna(0).astype(int)

    print(f"Excel: {len(df)} rows, {df['product_name'].nunique()} names, "
          f"weight {df['weight'].sum():.3f}g, pieces {int(df['piece_count'].sum())}")

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("ERROR: DATABASE_URL not set")
        sys.exit(1)

    engine = create_engine(db_url)
    Session = sessionmaker(bind=engine)
    session = Session()

    try:
        # --- 1. Ensure showroom location exists ---
        showroom = session.execute(
            text("SELECT id FROM locations WHERE code = 'showroom'")
        ).fetchone()
        if not showroom:
            session.execute(text(
                "INSERT INTO locations (code, name, location_type, is_active) "
                "VALUES ('showroom', '\u5c55\u5385', 'showroom', 1)"
            ))
            session.flush()
            showroom = session.execute(
                text("SELECT id FROM locations WHERE code = 'showroom'")
            ).fetchone()
            print("\u81ea\u52a8\u521b\u5efa\u5c55\u5385\u4f4d\u7f6e\u8bb0\u5f55")
        showroom_id = showroom[0]
        print(f"\u5c55\u5385 location_id = {showroom_id}")

        # --- 2. Sync product_codes (insert missing barcodes) ---
        existing_codes = {}
        for row in session.execute(text("SELECT code, name FROM product_codes")):
            existing_codes[row[0]] = row[1]

        unique_barcodes = df[["barcode", "product_name"]].drop_duplicates(subset=["barcode"])
        codes_inserted = 0
        for _, brow in unique_barcodes.iterrows():
            code = str(brow["barcode"]).strip()
            name = str(brow["product_name"]).strip()
            if code in existing_codes or not code:
                continue
            if code.startswith("FL"):
                ct = "fl_batch"
            elif code.startswith("F") and len(code) > 1 and code[1:].isdigit():
                ct = "f_single"
            else:
                ct = "predefined"
            session.execute(
                text("INSERT INTO product_codes (code, name, code_type, is_unique, is_used) "
                     "VALUES (:code, :name, :ct, 0, 0)"),
                {"code": code, "name": name, "ct": ct}
            )
            existing_codes[code] = name
            codes_inserted += 1

        # Fix any NULL is_unique/is_used from previous imports
        session.execute(text(
            "UPDATE product_codes SET is_unique = 0 WHERE is_unique IS NULL"
        ))
        session.execute(text(
            "UPDATE product_codes SET is_used = 0 WHERE is_used IS NULL"
        ))
        session.flush()

        # --- 3. Build name mapping: excel_name -> standard_name ---
        # For each excel product_name, find all its barcodes,
        # look up the standard name in product_codes (prefer predefined),
        # and decide the canonical name.
        excel_name_to_standard = {}
        name_rename_log = []

        for excel_name in df["product_name"].unique():
            excel_name = str(excel_name).strip()
            barcodes_for_name = df[df["product_name"] == excel_name]["barcode"].unique()

            # Collect standard names from product_codes for these barcodes
            # Prefer predefined codes for the canonical name
            predefined_name = None
            any_name = None
            for bc in barcodes_for_name:
                bc = str(bc).strip()
                std_name = existing_codes.get(bc)
                if std_name:
                    any_name = std_name
                    # Check if this barcode is predefined type
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
                name_rename_log.append((excel_name, standard_name))

        if name_rename_log:
            print(f"\n\u540d\u79f0\u4fee\u6b63 ({len(name_rename_log)} items):")
            for old, new in name_rename_log[:20]:
                print(f"  {old} -> {new}")
            if len(name_rename_log) > 20:
                print(f"  ... +{len(name_rename_log) - 20} more")

        # --- 4. Clean if requested ---
        if args.clean:
            r1 = session.execute(text("DELETE FROM location_inventory"))
            r2 = session.execute(text("DELETE FROM inventory"))
            # Also clean old showroom inbound orders
            old_orders = session.execute(
                text("SELECT id FROM inbound_orders WHERE operator = :op"),
                {"op": SHOWROOM_IMPORT_OPERATOR}
            ).fetchall()
            if old_orders:
                old_ids = [r[0] for r in old_orders]
                for oid in old_ids:
                    session.execute(text("DELETE FROM inbound_details WHERE order_id = :oid"), {"oid": oid})
                    session.execute(text("DELETE FROM inbound_orders WHERE id = :oid"), {"oid": oid})
            print(f"清空库存: location_inventory={r1.rowcount}, inventory={r2.rowcount}, "
                  f"展厅入库单={len(old_orders) if old_orders else 0}")

        # --- 5. Import inventory using standard names ---
        # Re-group by standard name
        df["standard_name"] = df["product_name"].apply(
            lambda x: excel_name_to_standard.get(str(x).strip(), str(x).strip())
        )

        summary = df.groupby("standard_name").agg(
            total_weight=("weight", "sum"),
            total_pieces=("piece_count", "sum"),
            record_count=("barcode", "count"),
        ).reset_index()

        inserted = 0
        updated = 0
        total_weight = 0.0

        for _, row in summary.iterrows():
            pname = str(row["standard_name"]).strip()
            weight = round(float(row["total_weight"]), 4)
            if not pname or weight <= 0:
                continue

            existing_inv = session.execute(
                text("SELECT id, total_weight FROM inventory WHERE product_name = :pn"),
                {"pn": pname}
            ).fetchone()

            if existing_inv:
                session.execute(
                    text("UPDATE inventory SET total_weight = total_weight + :w WHERE id = :id"),
                    {"w": weight, "id": existing_inv[0]}
                )
            else:
                session.execute(
                    text("INSERT INTO inventory (product_name, total_weight) VALUES (:pn, :w)"),
                    {"pn": pname, "w": weight}
                )

            existing_loc = session.execute(
                text("SELECT id, weight FROM location_inventory "
                     "WHERE product_name = :pn AND location_id = :lid"),
                {"pn": pname, "lid": showroom_id}
            ).fetchone()

            if existing_loc:
                session.execute(
                    text("UPDATE location_inventory SET weight = weight + :w WHERE id = :id"),
                    {"w": weight, "id": existing_loc[0]}
                )
                updated += 1
            else:
                session.execute(
                    text("INSERT INTO location_inventory (product_name, location_id, weight) "
                         "VALUES (:pn, :lid, :w)"),
                    {"pn": pname, "lid": showroom_id, "w": weight}
                )
                inserted += 1

            total_weight += weight

        # --- 5b. Create InboundOrder + InboundDetail for per-barcode detail ---
        order_no = f"SHOWROOM-IMPORT-{datetime.now().strftime('%Y%m%d%H%M%S')}"
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

        print(f"  inbound_details: {detail_count} rows (order {order_no})")

        # --- 6. Also fix any existing location_inventory with old names ---
        renamed_inv = 0
        for old_name, new_name in excel_name_to_standard.items():
            # Check if old name exists in location_inventory
            old_rec = session.execute(
                text("SELECT id, weight FROM location_inventory "
                     "WHERE product_name = :old AND location_id = :lid"),
                {"old": old_name, "lid": showroom_id}
            ).fetchone()
            if old_rec:
                # Merge into new name record
                new_rec = session.execute(
                    text("SELECT id, weight FROM location_inventory "
                         "WHERE product_name = :new AND location_id = :lid"),
                    {"new": new_name, "lid": showroom_id}
                ).fetchone()
                if new_rec:
                    session.execute(
                        text("UPDATE location_inventory SET weight = weight + :w WHERE id = :id"),
                        {"w": float(old_rec[1]), "id": new_rec[0]}
                    )
                    session.execute(
                        text("DELETE FROM location_inventory WHERE id = :id"),
                        {"id": old_rec[0]}
                    )
                else:
                    session.execute(
                        text("UPDATE location_inventory SET product_name = :new WHERE id = :id"),
                        {"new": new_name, "id": old_rec[0]}
                    )
                renamed_inv += 1

            # Same for inventory table
            old_inv = session.execute(
                text("SELECT id, total_weight FROM inventory WHERE product_name = :old"),
                {"old": old_name}
            ).fetchone()
            if old_inv:
                new_inv = session.execute(
                    text("SELECT id, total_weight FROM inventory WHERE product_name = :new"),
                    {"new": new_name}
                ).fetchone()
                if new_inv:
                    session.execute(
                        text("UPDATE inventory SET total_weight = total_weight + :w WHERE id = :id"),
                        {"w": float(old_inv[1]), "id": new_inv[0]}
                    )
                    session.execute(
                        text("DELETE FROM inventory WHERE id = :id"),
                        {"id": old_inv[0]}
                    )
                else:
                    session.execute(
                        text("UPDATE inventory SET product_name = :new WHERE id = :id"),
                        {"new": new_name, "id": old_inv[0]}
                    )

        session.commit()

        print(f"\n--- import done ---")
        print(f"  inventory: {inserted} new, {updated} updated")
        print(f"  showroom weight: {total_weight:.3f}g")
        print(f"  product_codes: {codes_inserted} new (total {len(existing_codes)})")
        print(f"  inbound_details: {detail_count} rows (order {order_no})")
        print(f"  names renamed: {renamed_inv}")

        verify = session.execute(
            text("SELECT count(*), round(coalesce(sum(weight),0)::numeric, 2) "
                 "FROM location_inventory WHERE location_id = :lid AND weight > 0"),
            {"lid": showroom_id}
        ).fetchone()
        print(f"\n  verify showroom: {verify[0]} products, {verify[1]}g")

        # Verify name matching
        unmatched = session.execute(text(
            "SELECT li.product_name FROM location_inventory li "
            "WHERE li.weight > 0 AND NOT EXISTS "
            "(SELECT 1 FROM product_codes pc WHERE pc.name = li.product_name)"
        )).fetchall()
        if unmatched:
            print(f"\n  WARNING: {len(unmatched)} products without matching product_code:")
            for r in unmatched[:10]:
                print(f"    [{r[0]}]")
        else:
            print(f"\n  ALL products matched with product_codes!")

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
