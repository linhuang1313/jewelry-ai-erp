#!/usr/bin/env python3
"""
历史数据修复脚本：将存料和欠料合并为单一账户净值

运行方式：
cd backend
python scripts/fix_gold_account_data.py

此脚本会：
1. 查询所有客户的金料欠款（从 CustomerTransaction 表）
2. 查询所有客户的存料余额（从 CustomerGoldDeposit 表）
3. 计算净值并更新 CustomerGoldDeposit.current_balance
"""

import sys
import os

# 添加项目根目录到路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, desc, func, and_
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text
from app.database import DATABASE_URL
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def fix_gold_account_data():
    """修复历史数据：将存料和欠料合并为单一账户净值"""
    
    engine = create_engine(DATABASE_URL)
    
    with engine.connect() as conn:
        logger.info("=" * 60)
        logger.info("开始修复金料账户数据（单一账户模式）")
        logger.info("=" * 60)
        
        # 获取所有客户
        customers = conn.execute(text("SELECT id, name FROM customers WHERE status = 'active'")).fetchall()
        logger.info(f"共找到 {len(customers)} 个活跃客户")
        
        fixed_count = 0
        
        for customer in customers:
            customer_id = customer[0]
            customer_name = customer[1]
            
            # 获取当前存料余额
            deposit_result = conn.execute(text(
                "SELECT id, current_balance FROM customer_gold_deposits WHERE customer_id = :cid"
            ), {"cid": customer_id}).fetchone()
            
            old_balance = float(deposit_result[1] or 0) if deposit_result else 0.0
            deposit_id = deposit_result[0] if deposit_result else None
            
            # 获取当前金料欠款（从最新的交易记录）
            tx_result = conn.execute(text("""
                SELECT gold_due_after FROM customer_transactions 
                WHERE customer_id = :cid AND status = 'active'
                ORDER BY created_at DESC LIMIT 1
            """), {"cid": customer_id}).fetchone()
            
            gold_debt = float(tx_result[0] or 0) if tx_result else 0.0
            
            # 计算净值：正数=存料，负数=欠料
            if deposit_id:
                if old_balance > 0 and gold_debt > 0:
                    # 有存料也有欠料，需要合并
                    new_balance = old_balance - gold_debt
                    conn.execute(text(
                        "UPDATE customer_gold_deposits SET current_balance = :bal WHERE id = :did"
                    ), {"bal": new_balance, "did": deposit_id})
                    
                    logger.info(f"客户 {customer_name}(ID:{customer_id}): "
                               f"存料={old_balance:.2f}克, 欠料={gold_debt:.2f}克 -> 净值={new_balance:.2f}克")
                    fixed_count += 1
                elif old_balance == 0 and gold_debt > 0:
                    # 只有欠料，没有存料，需要创建负余额
                    conn.execute(text(
                        "UPDATE customer_gold_deposits SET current_balance = :bal WHERE id = :did"
                    ), {"bal": -gold_debt, "did": deposit_id})
                    
                    logger.info(f"客户 {customer_name}(ID:{customer_id}): "
                               f"无存料, 欠料={gold_debt:.2f}克 -> 净值={-gold_debt:.2f}克")
                    fixed_count += 1
                else:
                    logger.debug(f"客户 {customer_name}(ID:{customer_id}): 无需修复")
            elif gold_debt > 0:
                # 没有存料记录，但有欠料，需要创建负余额记录
                conn.execute(text("""
                    INSERT INTO customer_gold_deposits 
                    (customer_id, customer_name, current_balance, total_deposited, total_used)
                    VALUES (:cid, :name, :bal, 0.0, :used)
                """), {"cid": customer_id, "name": customer_name, "bal": -gold_debt, "used": gold_debt})
                
                logger.info(f"客户 {customer_name}(ID:{customer_id}): "
                           f"创建新记录, 欠料={gold_debt:.2f}克 -> 净值={-gold_debt:.2f}克")
                fixed_count += 1
        
        # 提交更改
        conn.commit()
        
        logger.info("=" * 60)
        logger.info(f"修复完成！共修复 {fixed_count} 个客户的金料账户数据")
        logger.info("=" * 60)
        
        # 验证结果
        logger.info("\n验证结果：")
        deposits = conn.execute(text("SELECT current_balance FROM customer_gold_deposits")).fetchall()
        positive_count = sum(1 for d in deposits if d[0] > 0)
        negative_count = sum(1 for d in deposits if d[0] < 0)
        zero_count = sum(1 for d in deposits if d[0] == 0)
        
        logger.info(f"存料账户（正值）: {positive_count} 个")
        logger.info(f"欠料账户（负值）: {negative_count} 个")
        logger.info(f"已结清账户（零）: {zero_count} 个")


if __name__ == "__main__":
    fix_gold_account_data()

