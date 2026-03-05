#!/usr/bin/env python3
"""临时脚本：检查数据库中的金料账户数据"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, text
from app.database import DATABASE_URL

engine = create_engine(DATABASE_URL)

with engine.connect() as conn:
    print("=" * 60)
    print("检查数据库中的金料账户数据")
    print("=" * 60)
    
    # 1. 检查 customer_gold_deposits 表
    print("\n=== customer_gold_deposits 表 ===")
    deposits = conn.execute(text(
        "SELECT id, customer_id, customer_name, current_balance, total_deposited, total_used FROM customer_gold_deposits"
    )).fetchall()
    
    if deposits:
        for d in deposits:
            print(f"ID:{d[0]}, CustomerID:{d[1]}, Name:{d[2]}, Balance:{d[3]:.2f}克, Deposited:{d[4]:.2f}克, Used:{d[5]:.2f}克")
    else:
        print("表为空！")
    
    # 2. 检查 customer_transactions 表
    print("\n=== customer_transactions 表 (最近10条) ===")
    txs = conn.execute(text("""
        SELECT ct.id, ct.customer_id, c.name, ct.gold_due_after, ct.transaction_type, ct.created_at
        FROM customer_transactions ct
        LEFT JOIN customers c ON c.id = ct.customer_id
        WHERE ct.status = 'active'
        ORDER BY ct.created_at DESC
        LIMIT 10
    """)).fetchall()
    
    if txs:
        for t in txs:
            print(f"ID:{t[0]}, CustomerID:{t[1]}, Name:{t[2]}, GoldDue:{t[3]:.2f}克, Type:{t[4]}, Date:{t[5]}")
    else:
        print("表为空！")
    
    # 3. 检查每个客户的最新欠料
    print("\n=== 每个客户的最新欠料状态 ===")
    customers = conn.execute(text("SELECT id, name FROM customers WHERE status = 'active'")).fetchall()
    
    for customer in customers:
        customer_id = customer[0]
        customer_name = customer[1]
        
        # 最新交易记录的欠料
        tx_result = conn.execute(text("""
            SELECT gold_due_after FROM customer_transactions 
            WHERE customer_id = :cid AND status = 'active'
            ORDER BY created_at DESC LIMIT 1
        """), {"cid": customer_id}).fetchone()
        gold_debt = float(tx_result[0] or 0) if tx_result else 0.0
        
        # 存料记录
        deposit_result = conn.execute(text(
            "SELECT current_balance FROM customer_gold_deposits WHERE customer_id = :cid"
        ), {"cid": customer_id}).fetchone()
        gold_deposit = float(deposit_result[0] or 0) if deposit_result else 0.0
        
        print(f"客户 {customer_name}(ID:{customer_id}): 欠料={gold_debt:.2f}克, 存料记录={gold_deposit:.2f}克, 净值应为={gold_deposit - gold_debt:.2f}克")

