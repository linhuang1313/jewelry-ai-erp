import sys
import os
import time
import uuid
from datetime import datetime
import pandas as pd
import concurrent.futures

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal
from app.models import (
    Supplier, InboundOrder, InboundDetail, ProductCode
)
from app.init_product_codes import get_next_f_code

IMPORT_OPERATOR = "Excel批量导入"


def parse_inventory_file(file_path):
    print(f"正在读取文件: {file_path} ...", flush=True)
    try:
        df = pd.read_excel(file_path, engine='openpyxl')
        df = df.where(pd.notnull(df), None)
        records = df.to_dict('records')
        print(f"[{os.path.basename(file_path)}] 解析出 {len(records)} 行", flush=True)
        return records
    except Exception as e:
        print(f"读取 {file_path} 出错: {e}", flush=True)
        return []


def _safe_float(val):
    try:
        f = float(val) if val is not None else 0.0
        import math
        return 0.0 if math.isnan(f) or math.isinf(f) else f
    except (ValueError, TypeError):
        return 0.0


def _safe_int(val):
    try:
        s = str(val).lower().strip()
        if s in ("nan", "none", ""):
            return None
        return int(float(val))
    except (ValueError, TypeError):
        return None


def bulk_insert_inventory(all_records, clean_first=False):
    """
    Import Excel records into InboundOrder + InboundDetail.
    If clean_first=True, delete all previously imported orders (operator=IMPORT_OPERATOR) first,
    making the import idempotent.
    """
    print(f"\n开始导入 {len(all_records)} 条入库数据...", flush=True)
    db = SessionLocal()

    try:
        if clean_first:
            old_orders = db.query(InboundOrder).filter(
                InboundOrder.operator == IMPORT_OPERATOR
            ).all()
            if old_orders:
                old_ids = [o.id for o in old_orders]
                del_details = db.query(InboundDetail).filter(
                    InboundDetail.order_id.in_(old_ids)
                ).delete(synchronize_session=False)
                del_orders = db.query(InboundOrder).filter(
                    InboundOrder.id.in_(old_ids)
                ).delete(synchronize_session=False)
                db.commit()
                print(f"清理旧导入数据: 删除 {del_orders} 张入库单, {del_details} 条明细", flush=True)

        # --- Build supplier cache ---
        unique_suppliers = set()
        for r in all_records:
            sn = r.get("供应商")
            if sn:
                unique_suppliers.add(str(sn).strip())

        supplier_cache = {}
        all_suppliers = db.query(Supplier).all()
        for s in all_suppliers:
            supplier_cache[s.name] = s.id

        missing_names = unique_suppliers - set(supplier_cache.keys())
        if missing_names:
            print(f"新建 {len(missing_names)} 个供应商...", flush=True)
            for m_name in missing_names:
                new_s = Supplier(
                    supplier_no="SUP" + datetime.now().strftime("%y%m%d") + uuid.uuid4().hex[:10].upper(),
                    name=m_name
                )
                db.add(new_s)
            db.commit()
            for s in db.query(Supplier).filter(Supplier.name.in_(list(missing_names))).all():
                supplier_cache[s.name] = s.id

        print(f"供应商缓存: {len(supplier_cache)} 个。开始聚合...", flush=True)

        # --- Aggregate by order_no ---
        inbound_orders_dict = {}
        for idx, row in enumerate(all_records, start=1):
            if idx % 50000 == 0:
                print(f"  已聚合 {idx} 行...", flush=True)

            order_no = row.get("入库单号")
            if not order_no:
                continue
            order_no = str(order_no).strip()

            supplier_name = row.get("供应商")
            if supplier_name:
                supplier_name = str(supplier_name).strip()

            supplier_id = supplier_cache.get(supplier_name) if supplier_name else None

            if order_no not in inbound_orders_dict:
                order_date = row.get("入库日期")
                if isinstance(order_date, str):
                    try:
                        order_date = datetime.strptime(order_date, "%Y-%m-%d %H:%M:%S")
                    except ValueError:
                        pass

                inbound_orders_dict[order_no] = {
                    "create_time": order_date if isinstance(order_date, datetime) else datetime.now(),
                    "details": []
                }

            name_mapped = str(row.get("饰品名称", row.get("商品名称", ""))).strip()
            if not name_mapped or name_mapped in ("nan", "None"):
                name_mapped = "未知导入商品"

            inbound_orders_dict[order_no]["details"].append({
                "product_code": str(row.get("条码号") or "").strip(),
                "product_name": name_mapped,
                "weight": _safe_float(row.get("重量")),
                "labor_cost": _safe_float(row.get("进货工费")),
                "piece_count": _safe_int(row.get("数量")),
                "piece_labor_cost": _safe_float(row.get("进货其他费")),
                "total_cost": _safe_float(row.get("进货成本合计")),
                "sale_labor_cost": _safe_float(row.get("销售克工费")) or None,
                "sale_piece_labor_cost": _safe_float(row.get("销售件工费")) or None,
                "supplier_name": supplier_name,
                "supplier_id": supplier_id
            })

        print(f"聚合完成: {len(inbound_orders_dict)} 张入库单", flush=True)

        # --- Skip existing (non-imported) orders ---
        existing_order_nos = set(
            r[0] for r in db.query(InboundOrder.order_no).filter(
                InboundOrder.operator != IMPORT_OPERATOR
            ).all()
        )

        insert_count = 0
        detail_count = 0
        total_weight = 0.0

        for order_no, data in inbound_orders_dict.items():
            if order_no in existing_order_nos:
                continue

            io = InboundOrder(
                order_no=order_no,
                create_time=data["create_time"],
                operator=IMPORT_OPERATOR,
                status="completed",
                is_audited=True
            )
            db.add(io)

            for d in data["details"]:
                pc = d["product_code"]
                pn = d["product_name"]

                if not pc:
                    predefined = db.query(ProductCode).filter(
                        ProductCode.name == pn,
                        ProductCode.code_type == 'predefined'
                    ).first()
                    if predefined:
                        pc = predefined.code
                    else:
                        pc = get_next_f_code(db)
                        db.add(ProductCode(
                            code=pc, name=pn, code_type="f_single",
                            is_unique=1, is_used=1, created_by="Excel导入"
                        ))
                        db.flush()

                det = InboundDetail(
                    product_code=pc,
                    product_name=pn,
                    weight=d["weight"],
                    labor_cost=d["labor_cost"],
                    piece_count=d["piece_count"],
                    piece_labor_cost=d["piece_labor_cost"],
                    total_cost=d["total_cost"],
                    sale_labor_cost=d.get("sale_labor_cost"),
                    sale_piece_labor_cost=d.get("sale_piece_labor_cost"),
                    supplier=d["supplier_name"],
                    supplier_id=d["supplier_id"]
                )
                io.details.append(det)
                detail_count += 1
                total_weight += d["weight"]

            insert_count += 1
            if insert_count % 500 == 0:
                print(f"  已落库: {insert_count} 张入库单, {detail_count} 条明细", flush=True)
                try:
                    db.commit()
                except Exception as ex:
                    db.rollback()
                    print(f"Commit batch error: {ex}")

        db.commit()
        print(f"\n导入完成! 入库单 {insert_count} 张, 明细 {detail_count} 条, 总重量 {total_weight:.2f}g ({total_weight/1000:.2f}kg)", flush=True)

    except Exception as e:
        db.rollback()
        print(f"导入出错回滚: {e}", flush=True)
        import traceback
        traceback.print_exc()
    finally:
        db.close()


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="导入入库Excel数据")
    parser.add_argument("path", help="Excel文件路径或文件夹路径")
    parser.add_argument("--clean", action="store_true", help="先清除旧导入数据再重新导入（幂等模式）")
    args = parser.parse_args()

    if not os.path.exists(args.path):
        print(f"找不到路径: {args.path}")
        sys.exit(1)

    files_to_process = []
    if os.path.isdir(args.path):
        for filename in os.listdir(args.path):
            if filename.endswith(".xlsx") and not filename.startswith("~"):
                files_to_process.append(os.path.join(args.path, filename))
    elif args.path.endswith(".xlsx"):
        files_to_process.append(args.path)
    else:
        print(f"不支持的文件格式: {args.path}")
        sys.exit(1)

    all_records = []
    start_time = time.time()

    print(f"扫描 {len(files_to_process)} 个 Excel 文件...", flush=True)
    with concurrent.futures.ProcessPoolExecutor() as executor:
        results = list(executor.map(parse_inventory_file, files_to_process))
        for res in results:
            all_records.extend(res)

    print(f"读取完毕: {len(all_records)} 行, 耗时 {time.time()-start_time:.2f}s", flush=True)

    if all_records:
        bulk_insert_inventory(all_records, clean_first=args.clean)
    else:
        print("没有有效数据。")
