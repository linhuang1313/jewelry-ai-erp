"""
客户管理路由
"""
from fastapi import APIRouter, Depends, Query, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from sqlalchemy import desc, func
from datetime import datetime
from ..timezone_utils import china_now
from typing import Optional, List, Dict, Any
import logging
import io
import csv
import time

from ..database import get_db
from ..models import (
    Customer, SalesOrder, SalesDetail, ReturnOrder,
    AccountReceivable, CustomerTransaction, CustomerGoldDeposit,
    CustomerGoldDepositTransaction
)
from ..schemas import CustomerCreate, CustomerResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/customers", tags=["客户管理"])


@router.post("")
async def create_customer(
    customer_data: CustomerCreate,
    user_role: str = Query(default="manager", description="用户角色"),
    db: Session = Depends(get_db)
):
    """创建客户"""
    # 权限检查 - 需要 can_manage_customers 权限
    from ..middleware.permissions import has_permission
    if not has_permission(user_role, 'can_manage_customers'):
        raise HTTPException(status_code=403, detail="权限不足：您没有【客户管理】的权限（创建/编辑/删除）")
    
    try:
        # 检查客户是否已存在
        existing = db.query(Customer).filter(
            Customer.name == customer_data.name,
            Customer.status == "active"
        ).first()
        
        if existing:
            return {
                "success": False,
                "message": f"客户 {customer_data.name} 已存在",
                "customer": CustomerResponse.model_validate(existing).model_dump(mode='json')
            }
        
        # 生成客户编号
        customer_no = f"KH{china_now().strftime('%Y%m%d%H%M%S')}"
        
        customer = Customer(
            customer_no=customer_no,
            **customer_data.model_dump()
        )
        db.add(customer)
        db.commit()
        db.refresh(customer)
        
        return {
            "success": True,
            "message": f"客户创建成功：{customer.name}",
            "customer": CustomerResponse.model_validate(customer).model_dump(mode='json')
        }
    except Exception as e:
        db.rollback()
        logger.error(f"创建客户失败: {e}", exc_info=True)
        return {
            "success": False,
            "message": f"创建客户失败: {str(e)}"
        }


@router.get("")
async def get_customers(
    name: Optional[str] = None,
    user_role: str = Query(default="manager", description="用户角色"),
    db: Session = Depends(get_db)
):
    """获取客户列表"""
    # 权限检查 - 需要 can_view_customers 或 can_manage_customers 权限
    from ..middleware.permissions import has_permission
    if not has_permission(user_role, 'can_view_customers') and not has_permission(user_role, 'can_manage_customers'):
        raise HTTPException(status_code=403, detail="权限不足：您没有【查看客户】的权限")
    
    try:
        query = db.query(Customer).filter(Customer.status == "active")
        
        if name:
            query = query.filter(Customer.name.contains(name))
        
        customers = query.order_by(desc(Customer.create_time)).all()
        
        return {
            "success": True,
            "customers": [CustomerResponse.model_validate(c).model_dump(mode='json') for c in customers]
        }
    except Exception as e:
        logger.error(f"查询客户失败: {e}", exc_info=True)
        return {
            "success": False,
            "message": f"查询客户失败: {str(e)}"
        }


@router.get("/suggest-salesperson")
async def suggest_salesperson(customer_name: str, db: Session = Depends(get_db)):
    """根据客户名智能推荐业务员（基于历史销售记录）"""
    try:
        if not customer_name or not customer_name.strip():
            return {"success": True, "salesperson": None, "hint": "请输入客户名"}
        
        customer_name = customer_name.strip()
        
        # 查找该客户最近一次的销售单
        latest_order = db.query(SalesOrder).filter(
            SalesOrder.customer_name == customer_name,
            SalesOrder.status != "已取消"
        ).order_by(SalesOrder.create_time.desc()).first()
        
        if latest_order and latest_order.salesperson:
            last_date = latest_order.create_time.strftime('%Y-%m-%d') if latest_order.create_time else "未知"
            return {
                "success": True,
                "salesperson": latest_order.salesperson,
                "hint": f"已自动匹配业务员（上次服务：{last_date}）",
                "is_new_customer": False
            }
        
        # 如果没有历史记录，返回空
        return {
            "success": True,
            "salesperson": None,
            "hint": "新客户，请手动输入业务员",
            "is_new_customer": True
        }
    
    except Exception as e:
        logger.error(f"查询业务员推荐失败: {e}", exc_info=True)
        return {"success": False, "salesperson": None, "error": str(e)}


@router.get("/{customer_id}")
async def get_customer(
    customer_id: int,
    user_role: str = Query(default="manager", description="用户角色"),
    db: Session = Depends(get_db)
):
    """获取客户详情"""
    # 权限检查 - 需要 can_view_customers 或 can_manage_customers 权限
    from ..middleware.permissions import has_permission
    if not has_permission(user_role, 'can_view_customers') and not has_permission(user_role, 'can_manage_customers'):
        raise HTTPException(status_code=403, detail="权限不足：您没有【查看客户】的权限")
    
    try:
        customer = db.query(Customer).filter(Customer.id == customer_id).first()
        
        if not customer:
            return {
                "success": False,
                "message": "客户不存在"
            }
        
        return {
            "success": True,
            "customer": CustomerResponse.model_validate(customer).model_dump(mode='json')
        }
    except Exception as e:
        logger.error(f"查询客户详情失败: {e}", exc_info=True)
        return {
            "success": False,
            "message": f"查询客户详情失败: {str(e)}"
        }


@router.put("/{customer_id}")
async def update_customer(
    customer_id: int,
    data: CustomerCreate,
    user_role: str = Query(default="manager", description="用户角色"),
    db: Session = Depends(get_db)
):
    """更新客户信息"""
    # 权限检查 - 需要 can_manage_customers 权限
    from ..middleware.permissions import has_permission
    if not has_permission(user_role, 'can_manage_customers'):
        raise HTTPException(status_code=403, detail="权限不足：您没有【客户管理】的权限（创建/编辑/删除）")
    
    try:
        customer = db.query(Customer).filter(Customer.id == customer_id).first()
        if not customer:
            return {"success": False, "message": "客户不存在"}
        
        # 更新字段
        if data.name:
            customer.name = data.name
        if data.phone is not None:
            customer.phone = data.phone
        if data.wechat is not None:
            customer.wechat = data.wechat
        if data.address is not None:
            customer.address = data.address
        if data.remark is not None:
            customer.remark = data.remark
        
        db.commit()
        db.refresh(customer)
        
        return {
            "success": True,
            "message": f"客户【{customer.name}】信息已更新",
            "customer": CustomerResponse.model_validate(customer).model_dump(mode='json')
        }
    except Exception as e:
        db.rollback()
        logger.error(f"更新客户失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


@router.delete("/{customer_id}")
async def delete_customer(
    customer_id: int,
    user_role: str = Query(default="manager", description="用户角色"),
    db: Session = Depends(get_db)
):
    """删除客户（软删除）"""
    # 权限检查 - 只有管理层可以删除
    from ..middleware.permissions import has_permission
    if not has_permission(user_role, 'can_delete'):
        raise HTTPException(status_code=403, detail="权限不足：您没有【删除数据】的权限")
    
    try:
        customer = db.query(Customer).filter(Customer.id == customer_id).first()
        if not customer:
            return {"success": False, "message": "客户不存在"}
        
        customer.status = "inactive"
        db.commit()
        
        return {
            "success": True,
            "message": f"客户【{customer.name}】已删除"
        }
    except Exception as e:
        db.rollback()
        logger.error(f"删除客户失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


@router.get("/{customer_id}/detail")
async def get_customer_detail(
    customer_id: int,
    user_role: str = Query(default="manager", description="用户角色"),
    db: Session = Depends(get_db)
):
    """
    获取客户详情（销售记录、退货记录、欠款/存料余额、往来账目）
    业务员角色可以查看客户的完整往来信息
    """
    # 权限检查 - 需要查看客户或查询客户销售权限
    from ..middleware.permissions import has_permission
    can_view = (
        has_permission(user_role, 'can_view_customers') or 
        has_permission(user_role, 'can_manage_customers') or
        has_permission(user_role, 'can_query_customer_sales')
    )
    if not can_view:
        raise HTTPException(status_code=403, detail="权限不足：您没有查看客户详情的权限")
    
    try:
        # 获取客户基本信息
        customer = db.query(Customer).filter(Customer.id == customer_id).first()
        if not customer:
            return {"success": False, "message": "客户不存在"}
        
        # 获取销售记录
        sales_orders = db.query(SalesOrder).filter(
            SalesOrder.customer_name == customer.name,
            SalesOrder.status != "已取消"
        ).order_by(desc(SalesOrder.create_time)).limit(50).all()
        
        sales_list = []
        for order in sales_orders:
            # 获取销售单明细
            details = db.query(SalesDetail).filter(
                SalesDetail.order_id == order.id
            ).all()
            
            for detail in details:
                sales_list.append({
                    "id": detail.id,
                    "order_no": order.order_no,
                    "product_name": detail.product_name,
                    "weight": detail.weight,
                    "labor_cost": detail.labor_cost,
                    "total_amount": detail.total_labor_cost,  # 使用 total_labor_cost 字段
                    "status": order.status,
                    "created_at": order.create_time.isoformat() if order.create_time else None
                })
        
        # 获取退货记录（客户相关的退货，通常是从展厅退回的）
        # 注意：这里假设有客户相关的退货逻辑，如果没有则返回空列表
        returns_list = []
        try:
            # 查询与客户关联的销售单的退货
            for order in sales_orders:
                related_returns = db.query(ReturnOrder).filter(
                    ReturnOrder.remark.contains(order.order_no) if hasattr(ReturnOrder, 'remark') else False
                ).all()
                for ret in related_returns:
                    returns_list.append({
                        "id": ret.id,
                        "return_no": ret.return_no,
                        "product_name": ret.product_name,
                        "return_weight": ret.return_weight,
                        "return_reason": ret.return_reason or "未知",
                        "status": ret.status,
                        "created_at": ret.created_at.isoformat() if ret.created_at else None
                    })
        except Exception as e:
            logger.warning(f"查询客户退货记录时出错: {e}")
            returns_list = []
        
        # 获取欠款/存料余额
        # 现金欠款 - 从应收账款表获取
        cash_debt = 0.0
        try:
            latest_receivable = db.query(AccountReceivable).filter(
                AccountReceivable.customer_id == customer_id
            ).order_by(desc(AccountReceivable.created_at)).first()
            if latest_receivable:
                cash_debt = latest_receivable.closing_balance or 0.0
        except Exception as e:
            logger.warning(f"查询现金欠款时出错: {e}")
        
        # 金料欠款 - 从客户交易记录获取
        gold_debt = 0.0
        try:
            latest_transaction = db.query(CustomerTransaction).filter(
                CustomerTransaction.customer_id == customer_id
            ).order_by(desc(CustomerTransaction.created_at)).first()
            if latest_transaction:
                gold_debt = latest_transaction.gold_due_after or 0.0
        except Exception as e:
            logger.warning(f"查询金料欠款时出错: {e}")
        
        # 存料余额
        gold_deposit = 0.0
        try:
            deposit_record = db.query(CustomerGoldDeposit).filter(
                CustomerGoldDeposit.customer_id == customer_id
            ).first()
            if deposit_record:
                gold_deposit = deposit_record.current_balance or 0.0
        except Exception as e:
            logger.warning(f"查询存料余额时出错: {e}")
        
        balance = {
            "cash_debt": cash_debt,
            "gold_debt": gold_debt,
            "gold_deposit": gold_deposit
        }
        
        # 获取往来账目
        transactions_list = []
        
        # 销售交易
        for order in sales_orders[:20]:  # 限制数量
            transactions_list.append({
                "id": order.id,
                "type": "sale",
                "description": f"销售：{order.order_no}",
                "amount": order.total_amount,
                "gold_weight": None,
                "created_at": order.create_time.isoformat() if order.create_time else None
            })
        
        # 金料存取记录
        try:
            deposit_transactions = db.query(CustomerGoldDepositTransaction).filter(
                CustomerGoldDepositTransaction.customer_id == customer_id
            ).order_by(desc(CustomerGoldDepositTransaction.created_at)).limit(20).all()
            
            for tx in deposit_transactions:
                tx_type = "gold_receipt" if tx.transaction_type == "deposit" else "gold_receipt"
                amount_sign = 1 if tx.transaction_type == "deposit" else -1
                transactions_list.append({
                    "id": tx.id,
                    "type": tx_type,
                    "description": tx.remark or f"金料{tx.transaction_type}",
                    "amount": None,
                    "gold_weight": tx.amount * amount_sign if tx.amount else 0,
                    "created_at": tx.created_at.isoformat() if tx.created_at else None
                })
        except Exception as e:
            logger.warning(f"查询金料交易记录时出错: {e}")
        
        # 按时间排序
        transactions_list.sort(key=lambda x: x["created_at"] or "", reverse=True)
        
        return {
            "success": True,
            "detail": {
                "customer": CustomerResponse.model_validate(customer).model_dump(mode='json'),
                "sales": sales_list,
                "returns": returns_list,
                "balance": balance,
                "transactions": transactions_list[:30]  # 限制返回数量
            }
        }
    except Exception as e:
        logger.error(f"查询客户详情失败: {e}", exc_info=True)
        return {
            "success": False,
            "message": f"查询客户详情失败: {str(e)}"
        }


@router.post("/batch-import")
async def batch_import_customers(
    file: UploadFile = File(...),
    user_role: str = Query(default="manager", description="用户角色"),
    db: Session = Depends(get_db)
):
    """
    批量导入客户（支持2000+条数据）
    支持格式：
    1. Excel (.xlsx, .xls) - 第一列必须是姓名，其他列可选（电话、微信、地址、类型、备注）
    2. CSV (.csv) - 第一列必须是姓名，其他列可选
    3. 纯文本 (.txt) - 每行一个姓名
    """
    from ..middleware.permissions import has_permission
    if not has_permission(user_role, 'can_manage_customers'):
        raise HTTPException(status_code=403, detail="权限不足：您没有【客户管理】的权限")
    
    results = {
        "success": True,
        "total": 0,
        "created": 0,
        "skipped": 0,
        "errors": [],
        "details": []
    }
    
    try:
        # 读取文件内容
        content = await file.read()
        file_extension = file.filename.split('.')[-1].lower() if '.' in file.filename else ''
        
        customers_data = []
        
        if file_extension in ['xlsx', 'xls']:
            # Excel 文件处理
            try:
                from openpyxl import load_workbook
                wb = load_workbook(io.BytesIO(content), read_only=True)
                ws = wb.active
                
                # 跳过表头（第一行）
                for row_idx, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
                    if row and row[0]:
                        name = str(row[0]).strip()
                        if name:
                            customers_data.append({
                                "name": name,
                                "phone": str(row[1]).strip() if len(row) > 1 and row[1] else None,
                                "wechat": str(row[2]).strip() if len(row) > 2 and row[2] else None,
                                "address": str(row[3]).strip() if len(row) > 3 and row[3] else None,
                                "customer_type": str(row[4]).strip() if len(row) > 4 and row[4] else "个人",
                                "remark": str(row[5]).strip() if len(row) > 5 and row[5] else None,
                            })
                wb.close()
            except Exception as e:
                error_msg = str(e).lower()
                # 检测是否是 .xls 格式导致的错误
                if "zip file" in error_msg or "not a zip file" in error_msg or file_extension == 'xls':
                    return {
                        "success": False,
                        "message": "❌ 文件格式不支持：检测到旧版 Excel 格式 (.xls)\n\n" +
                                  "💡 解决方案：\n" +
                                  "1. 打开您的 Excel 文件\n" +
                                  "2. 点击"文件" -> "另存为"\n" +
                                  "3. 在"保存类型"中选择"Excel 工作簿 (*.xlsx)" 或 "CSV UTF-8 (逗号分隔) (*.csv)"\n" +
                                  "4. 保存后重新上传\n\n" +
                                  "或者直接使用 CSV 格式，更简单快捷！"
                    }
                else:
                    return {
                        "success": False,
                        "message": f"Excel 文件解析失败: {str(e)[:200]}\n\n提示：请确保文件格式正确，或尝试转换为 CSV 格式上传"
                    }
        
        elif file_extension == 'csv':
            # CSV 文件处理
            try:
                content_str = content.decode('utf-8-sig')  # 处理 BOM
            except:
                try:
                    content_str = content.decode('gbk')  # 尝试 GBK 编码
                except:
                    content_str = content.decode('utf-8', errors='ignore')
            
            csv_reader = csv.reader(io.StringIO(content_str))
            
            # 跳过表头
            next(csv_reader, None)
            
            for row in csv_reader:
                if row and row[0]:
                    name = str(row[0]).strip()
                    if name:
                        customers_data.append({
                            "name": name,
                            "phone": row[1].strip() if len(row) > 1 and row[1] else None,
                            "wechat": row[2].strip() if len(row) > 2 and row[2] else None,
                            "address": row[3].strip() if len(row) > 3 and row[3] else None,
                            "customer_type": row[4].strip() if len(row) > 4 and row[4] else "个人",
                            "remark": row[5].strip() if len(row) > 5 and row[5] else None,
                        })
        
        elif file_extension == 'txt':
            # 纯文本文件（每行一个姓名）
            try:
                content_str = content.decode('utf-8')
            except:
                try:
                    content_str = content.decode('gbk')
                except:
                    content_str = content.decode('utf-8', errors='ignore')
            
            for line in content_str.split('\n'):
                name = line.strip()
                if name:
                    customers_data.append({
                        "name": name,
                        "phone": None,
                        "wechat": None,
                        "address": None,
                        "customer_type": "个人",
                        "remark": None,
                    })
        else:
            return {
                "success": False,
                "message": f"不支持的文件格式：{file_extension}。支持格式：.xlsx, .xls, .csv, .txt"
            }
        
        results["total"] = len(customers_data)
        
        if results["total"] == 0:
            return {
                "success": False,
                "message": "文件中没有找到有效的客户数据"
            }
        
        # 批量创建客户（性能优化：批量提交）
        start_time = time.time()
        batch_size = 100  # 每100条提交一次
        
        # 先批量查询已存在的客户（避免重复查询）
        existing_names = set()
        existing_customers = db.query(Customer.name).filter(
            Customer.status == "active"
        ).all()
        existing_names = {c[0] for c in existing_customers}
        
        for idx, customer_data in enumerate(customers_data, 1):
            try:
                # 检查是否已存在
                if customer_data["name"] in existing_names:
                    results["skipped"] += 1
                    if idx <= 10:  # 只记录前10个跳过的详情
                        results["details"].append({
                            "row": idx,
                            "name": customer_data["name"],
                            "status": "skipped",
                            "message": "客户已存在"
                        })
                    continue
                
                # 生成客户编号（使用时间戳+序号，确保唯一）
                timestamp = china_now().strftime('%Y%m%d%H%M%S')
                customer_no = f"KH{timestamp}{idx:06d}"
                
                # 创建客户对象
                customer = Customer(
                    customer_no=customer_no,
                    name=customer_data["name"],
                    phone=customer_data.get("phone"),
                    wechat=customer_data.get("wechat"),
                    address=customer_data.get("address"),
                    customer_type=customer_data.get("customer_type", "个人"),
                    remark=customer_data.get("remark"),
                    status="active"
                )
                db.add(customer)
                existing_names.add(customer_data["name"])  # 添加到已存在集合
                results["created"] += 1
                
                # 每 batch_size 条提交一次（提高性能）
                if idx % batch_size == 0:
                    db.commit()
                    logger.info(f"已导入 {idx}/{results['total']} 条客户数据")
                
                # 只记录前10个成功的详情
                if results["created"] <= 10:
                    results["details"].append({
                        "row": idx,
                        "name": customer_data["name"],
                        "status": "created",
                        "customer_no": customer_no
                    })
                    
            except Exception as e:
                results["errors"].append({
                    "row": idx,
                    "name": customer_data.get("name", "未知"),
                    "error": str(e)[:100]  # 限制错误信息长度
                })
                logger.error(f"导入第 {idx} 行失败: {e}")
                # 如果错误太多，停止导入
                if len(results["errors"]) > 100:
                    db.rollback()
                    return {
                        "success": False,
                        "message": f"导入过程中错误过多（超过100个），已停止导入。已成功导入 {results['created']} 条",
                        "results": results
                    }
        
        # 最终提交
        db.commit()
        
        elapsed_time = time.time() - start_time
        results["message"] = f"导入完成！成功创建 {results['created']} 个客户，跳过 {results['skipped']} 个已存在客户"
        if results["errors"]:
            results["message"] += f"，失败 {len(results['errors'])} 个"
        results["message"] += f"。耗时 {elapsed_time:.2f} 秒"
        results["elapsed_time"] = elapsed_time
        
        return results
        
    except Exception as e:
        db.rollback()
        logger.error(f"批量导入客户失败: {e}", exc_info=True)
        return {
            "success": False,
            "message": f"批量导入失败: {str(e)}",
            "results": results
        }
