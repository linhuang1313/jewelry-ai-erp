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
from app.models import (
    CustomerGoldDeposit, 
    CustomerTransaction,
    Customer
)
from app.database import SQLALCHEMY_DATABASE_URL
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def get_customer_gold_debt(db, customer_id: int) -> float:
    """
    从 CustomerTransaction 获取客户最新的金料欠款
    返回正数表示客户欠料
    """
    # 获取该客户最新的交易记录
    latest_tx = db.query(CustomerTransaction).filter(
        CustomerTransaction.customer_id == customer_id,
        CustomerTransaction.status == "active"
    ).order_by(desc(CustomerTransaction.created_at)).first()
    
    if latest_tx:
        return float(latest_tx.gold_due_after or 0)
    return 0.0


def fix_gold_account_data():
    """修复历史数据：将存料和欠料合并为单一账户净值"""
    
    engine = create_engine(SQLALCHEMY_DATABASE_URL)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = SessionLocal()
    
    try:
        logger.info("=" * 60)
        logger.info("开始修复金料账户数据（单一账户模式）")
        logger.info("=" * 60)
        
        # 获取所有客户
        customers = db.query(Customer).filter(Customer.status == "active").all()
        logger.info(f"共找到 {len(customers)} 个活跃客户")
        
        fixed_count = 0
        
        for customer in customers:
            # 获取当前存料余额
            deposit = db.query(CustomerGoldDeposit).filter(
                CustomerGoldDeposit.customer_id == customer.id
            ).first()
            
            old_balance = deposit.current_balance if deposit else 0.0
            
            # 获取当前金料欠款
            gold_debt = get_customer_gold_debt(db, customer.id)
            
            # 计算净值：正数=存料，负数=欠料
            # 如果有存料也有欠料，合并为净值
            if deposit:
                # 当前余额已经包含存料，需要减去欠料
                # 但如果已经是负数了（之前改过的），不用再处理
                if old_balance > 0 and gold_debt > 0:
                    # 有存料也有欠料，需要合并
                    new_balance = old_balance - gold_debt
                    deposit.current_balance = new_balance
                    
                    logger.info(f"客户 {customer.name}(ID:{customer.id}): "
                               f"存料={old_balance:.2f}克, 欠料={gold_debt:.2f}克 -> 净值={new_balance:.2f}克")
                    fixed_count += 1
                elif old_balance == 0 and gold_debt > 0:
                    # 只有欠料，没有存料，需要创建负余额
                    deposit.current_balance = -gold_debt
                    
                    logger.info(f"客户 {customer.name}(ID:{customer.id}): "
                               f"无存料, 欠料={gold_debt:.2f}克 -> 净值={-gold_debt:.2f}克")
                    fixed_count += 1
                else:
                    logger.debug(f"客户 {customer.name}(ID:{customer.id}): 无需修复 "
                                f"(存料={old_balance:.2f}克, 欠料={gold_debt:.2f}克)")
            elif gold_debt > 0:
                # 没有存料记录，但有欠料，需要创建负余额记录
                new_deposit = CustomerGoldDeposit(
                    customer_id=customer.id,
                    customer_name=customer.name,
                    current_balance=-gold_debt,
                    total_deposited=0.0,
                    total_used=gold_debt
                )
                db.add(new_deposit)
                
                logger.info(f"客户 {customer.name}(ID:{customer.id}): "
                           f"创建新记录, 欠料={gold_debt:.2f}克 -> 净值={-gold_debt:.2f}克")
                fixed_count += 1
        
        # 提交更改
        db.commit()
        
        logger.info("=" * 60)
        logger.info(f"修复完成！共修复 {fixed_count} 个客户的金料账户数据")
        logger.info("=" * 60)
        
        # 验证结果
        logger.info("\n验证结果：")
        deposits = db.query(CustomerGoldDeposit).all()
        positive_count = sum(1 for d in deposits if d.current_balance > 0)
        negative_count = sum(1 for d in deposits if d.current_balance < 0)
        zero_count = sum(1 for d in deposits if d.current_balance == 0)
        
        logger.info(f"存料账户（正值）: {positive_count} 个")
        logger.info(f"欠料账户（负值）: {negative_count} 个")
        logger.info(f"已结清账户（零）: {zero_count} 个")
        
    except Exception as e:
        db.rollback()
        logger.error(f"修复失败: {e}", exc_info=True)
        raise
    finally:
        db.close()


if __name__ == "__main__":
    fix_gold_account_data()

