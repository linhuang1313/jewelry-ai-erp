import sys
import os
import time
import uuid
from datetime import datetime
import pandas as pd
import concurrent.futures

# 将项目目录加入环境变量，以便导入app模块
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal
from app.models import (
    Customer, SalesReturnOrder, SalesReturnDetail, SalesReturnSettlement
)

def parse_excel_file(file_path):
    print(f"正在使用 Pandas 读取文件: {file_path} ...", flush=True)
    try:
        df = pd.read_excel(file_path, engine='openpyxl')
        # 填充 NaN 为 None 方便后续处理
        df = df.where(pd.notnull(df), None)
        records = df.to_dict('records')
        print(f"[{os.path.basename(file_path)}] 解析提取出 {len(records)} 行数据", flush=True)
        return records
    except Exception as e:
        print(f"读取 {file_path} 时出错: {e}", flush=True)
        return []

def bulk_insert_returns(all_records):
    print(f"\n开始对 {len(all_records)} 条数据进行分类聚合与入库...", flush=True)
    db = SessionLocal()
    
    return_orders_dict = {}
    return_settlements = {}
    customer_cache = {}
    
    try:
        print("\n提速优化: 正在对所有客户信息进行预处理和全量加载...", flush=True)
        unique_customers = set()
        for r in all_records:
            cn = r.get("销售客户")
            if cn: unique_customers.add(str(cn).strip())
            
        unique_list = list(unique_customers)
        batch_size = 1000
        for i in range(0, len(unique_list), batch_size):
            batch = unique_list[i:i+batch_size]
            existing_customers = db.query(Customer).filter(Customer.name.in_(batch)).all()
            for c in existing_customers:
                customer_cache[c.name] = c.id
                
        missing_names = unique_customers - set(customer_cache.keys())
        if missing_names:
            print(f"发现 {len(missing_names)} 名全新客户，开始批量自动开户...", flush=True)
            for m_name in missing_names:
                new_c = Customer(
                    customer_no="CUST" + datetime.now().strftime("%y%m%d") + uuid.uuid4().hex[:10].upper(),
                    name=m_name
                )
                db.add(new_c)
            db.commit() # 集中持久化并拿到 ID
            
            for i in range(0, len(list(missing_names)), batch_size):
                batch = list(missing_names)[i:i+batch_size]
                recently_added = db.query(Customer).filter(Customer.name.in_(batch)).all()
                for c in recently_added:
                    customer_cache[c.name] = c.id

        print(f"客户预处理完成，缓存了 {len(customer_cache)} 名客户。开始纯内存极速聚合...", flush=True)

        for idx, row in enumerate(all_records, start=1):
            if idx % 50000 == 0:
                 print(f"  已聚合 {idx} 行...", flush=True)
                 
            order_no = row.get("销售单号")
            if not order_no:
                continue
            order_no = str(order_no).strip()

            # 只处理销退单
            if not order_no.upper().startswith("PXT"):
                continue
            
            customer_name = row.get("销售客户")
            if customer_name:
                customer_name = str(customer_name).strip()
            
            customer_id = None
            if customer_name:
                customer_id = customer_cache.get(customer_name)

            if order_no not in return_orders_dict:
                order_date = row.get("销售日期")
                if isinstance(order_date, str):
                    try: order_date = datetime.strptime(order_date, "%Y-%m-%d %H:%M:%S")
                    except: pass

                return_orders_dict[order_no] = {
                    "order_date": order_date if isinstance(order_date, datetime) else datetime.now(),
                    "customer_id": customer_id,
                    "customer_name": customer_name,
                    "salesperson": str(row.get("业务员") or "").strip(),
                    "remark": str(row.get("单据备注") or ""),
                    "details": []
                }
            
            weight_val = row.get("合计重量")
            labor_val = row.get("销售工费")
            pl_val = row.get("销售其他工费")
            tl_val = row.get("工费小计")
            pc_val = row.get("数量")
            
            try: weight = float(weight_val) if weight_val is not None else 0.0
            except: weight = 0.0
            try: labor = float(labor_val) if labor_val is not None else 0.0
            except: labor = 0.0
            try: piece_labor = float(pl_val) if pl_val is not None else 0.0
            except: piece_labor = 0.0
            try: total_labor = float(tl_val) if tl_val is not None else 0.0
            except: total_labor = 0.0
            
            try:
                pc_str = str(pc_val).lower()
                piece_count = None if pc_str == "nan" or pc_str == "none" or pc_str == "" else int(float(pc_val))
            except: piece_count = None
            
            p_code = str(row.get("条码号") or "").strip()
            p_name = str(row.get("饰品名称", row.get("商品名称", ""))).strip()
            if not p_name or p_name == "nan" or p_name == "None":
                p_name = "未知直接导入商品"

            return_orders_dict[order_no]["details"].append({
                "product_code": p_code,
                "product_name": p_name,
                "weight": weight,
                "labor_cost": labor,
                "piece_labor_cost": piece_labor,
                "total_labor_cost": total_labor,
                "piece_count": piece_count,
                "supplier_name": str(row.get("供应商") or "").strip()
            })
            
            sett_no = row.get("结算单号")
            if sett_no:
                sett_no = str(sett_no).strip()
                if sett_no not in return_settlements:
                    sett_date = row.get("结算日期")
                    if isinstance(sett_date, str):
                        try: sett_date = datetime.strptime(sett_date, "%Y-%m-%d %H:%M:%S")
                        except: pass
                    
                    s_amount = row.get("销售金额小计")
                    try: amount = float(s_amount) if s_amount is not None else 0.0
                    except: amount = 0.0

                    g_price = row.get("销售金价")
                    try: gp = float(g_price) if g_price is not None else 0.0
                    except: gp = 0.0

                    return_settlements[sett_no] = {
                        "sales_order_no": order_no,
                        "gold_price": gp,
                        "created_at": sett_date if isinstance(sett_date, datetime) else datetime.now(),
                        "total_amount": amount
                    }

        print(f"\n聚合探测完成：{len(return_orders_dict)} 张退单，{len(return_settlements)} 张退货结算单。", flush=True)
        print("执行高并发入库批处理...", flush=True)

        existing_return_nos = set([i[0] for i in db.query(SalesReturnOrder.return_no).all()])
        existing_ret_sett_nos = set([i[0] for i in db.query(SalesReturnSettlement.settlement_no).all()])

        # 1. 插入销退单
        returns_to_insert = [o for o in return_orders_dict if o not in existing_return_nos]
        total_returns_to_insert = len(returns_to_insert)
        print(f"检测到 {total_returns_to_insert} 张全新销退单需要入库。", flush=True)

        return_count = 0
        for order_no, data in return_orders_dict.items():
            if order_no not in existing_return_nos:
                ro = SalesReturnOrder(
                    return_no=order_no,
                    order_date=data["order_date"],
                    customer_id=data["customer_id"],
                    customer_name=data["customer_name"],
                    salesperson=data["salesperson"],
                    total_weight=sum(d["weight"] for d in data["details"]),
                    total_labor_cost=sum(d["total_labor_cost"] for d in data["details"]),
                    remark=data["remark"],
                    return_reason="系统导入退货",
                    status="completed",
                    operator="系统并发导入",
                    return_to="showroom"
                )
                db.add(ro)
                
                for d in data["details"]:
                    rd = SalesReturnDetail(
                        product_code=d["product_code"],
                        weight=d["weight"],
                        labor_cost=d["labor_cost"],
                        piece_labor_cost=d["piece_labor_cost"],
                        total_labor_cost=d["total_labor_cost"],
                        piece_count=d["piece_count"],
                        product_name=d["product_name"] 
                    )
                    ro.details.append(rd)

                return_count += 1
                if return_count % 500 == 0:
                     print(f"  --> 已入库销退主单: {return_count} / {total_returns_to_insert}", flush=True)
                     try: db.commit()
                     except Exception as ex:
                         db.rollback()
                         print(f"Commit batch error, skipped batch. Error: {ex}")

        db.flush()
        print(f"销退单据批量入库完毕。准备处理结算单...", flush=True)
        
        # 2. 处理退单结算单
        rel_returns_map = dict(db.query(SalesReturnOrder.return_no, SalesReturnOrder.id).all())
        
        ret_setts_to_insert = [s for s in return_settlements if s not in existing_ret_sett_nos]
        total_ret_setts_to_insert = len(ret_setts_to_insert)
        inserted_ret_sett = 0
        for sett_no, s_data in return_settlements.items():
            if sett_no not in existing_ret_sett_nos:
                so_no = s_data["sales_order_no"]
                rel_id = rel_returns_map.get(so_no)
                
                total_weight = 0.0
                labor_amount = 0.0
                if so_no in return_orders_dict:
                    total_weight = sum(d["weight"] for d in return_orders_dict[so_no]["details"])
                    labor_amount = sum(d["total_labor_cost"] for d in return_orders_dict[so_no]["details"])
                    
                material_amount = s_data["gold_price"] * total_weight
                total_amount = material_amount + labor_amount
                payment_method = 'cash_price' if material_amount == 0 else 'physical_gold'
                
                if rel_id:
                    sett = SalesReturnSettlement(
                        settlement_no=sett_no,
                        sales_return_order_id=rel_id,
                        gold_price=s_data["gold_price"],
                        total_amount=total_amount,
                        total_weight=total_weight,
                        material_amount=material_amount,
                        labor_amount=labor_amount,
                        status="confirmed",
                        payment_method=payment_method,
                        created_by="系统并发导入",
                        created_at=s_data["created_at"],
                        confirmed_at=s_data["created_at"]
                    )
                    db.add(sett)
                    inserted_ret_sett += 1
                    if inserted_ret_sett % 500 == 0:
                         print(f"  --> 已入库退款结算单: {inserted_ret_sett} / {total_ret_setts_to_insert}", flush=True)
                         try: db.commit()
                         except Exception: db.rollback()

        db.commit()
        print(f"🎉 全部导入完成！销退单{return_count} 张, 退款单{inserted_ret_sett}张。", flush=True)
        
    except Exception as e:
        db.rollback()
        print(f"导入由于出错回滚: {e}", flush=True)
        import traceback
        err_msg = traceback.format_exc()
        with open("error_return_summary.txt", "w", encoding="utf-8") as f:
            f.write(err_msg)
        print("错误栈已被写入 error_return_summary.txt", flush=True)
    finally:
        db.close()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python import_sales_return_xlsx.py <对应excel文件路径或文件夹路径>")
        sys.exit(1)
    
    path = sys.argv[1]
    if not os.path.exists(path):
        print(f"找不到路径: {path}")
        sys.exit(1)
        
    files_to_process = []
    if os.path.isdir(path):
        for filename in os.listdir(path):
            if filename.endswith(".xlsx") and not filename.startswith("~"):
                files_to_process.append(os.path.join(path, filename))
    else:
        if path.endswith(".xlsx"):
            files_to_process.append(path)
        else:
            print(f"不支持的文件格式: {path}，请提供 .xlsx 文件或包含 .xlsx 的文件夹。")
            sys.exit(1)

    all_records = []
    start_time = time.time()
    
    # 使用多核并发读取 Excel 文件为列表字典形式
    print(f"启用多核并发引擎开始扫描 {len(files_to_process)} 个 Excel 文件...", flush=True)
    with concurrent.futures.ProcessPoolExecutor() as executor:
        results = list(executor.map(parse_excel_file, files_to_process))
        for res in results:
            all_records.extend(res)
            
    print(f"所有文件读取解析完毕，共 {len(all_records)} 行完整数据体，耗时 {time.time()-start_time:.2f} 秒", flush=True)
    
    # 统一将完整数据交给数据库上下文处理插入操作
    if all_records:
        bulk_insert_returns(all_records)
    else:
        print("没有提取到任何有效数据。")
