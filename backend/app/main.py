# -*- coding: utf-8 -*-
"""
珠宝ERP系统 - FastAPI主入口
精简版：核心配置、异常处理、启动事件、路由注册

已拆分的模块：
- routers/chat.py - Chat/AI对话功能
- routers/inbound.py - 入库管理功能
- routers/chat_history.py - 聊天历史功能
- routers/inventory_maintenance.py - 库存维护功能
"""
from fastapi import FastAPI, Request, Depends, UploadFile, File
from fastapi.responses import StreamingResponse, FileResponse, HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
from sqlalchemy.orm import Session
from datetime import datetime, timezone, timedelta
import json
import logging

from .database import get_db, init_db
from .models import Location
from .utils.response import sanitize_floats


# ========== NaN/Infinity 安全 JSON 响应 ==========

class SafeJSONResponse(JSONResponse):
    """JSONResponse that sanitizes NaN/Infinity before serialization."""

    def render(self, content) -> bytes:
        return json.dumps(
            sanitize_floats(content),
            ensure_ascii=False,
            default=str,
        ).encode("utf-8")

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# 中国时区 UTC+8
CHINA_TZ = timezone(timedelta(hours=8))

def china_now() -> datetime:
    """获取中国时间（UTC+8）"""
    return datetime.now(CHINA_TZ)


app = FastAPI(
    title="AI-ERP珠宝入库BETA测试",
    default_response_class=SafeJSONResponse,
)

# ========== 配置CORS（必须在路由注册之前）==========
import os as _cors_os
_cors_env = _cors_os.environ.get("CORS_ORIGINS", "")
if _cors_env:
    _allowed_origins = [o.strip() for o in _cors_env.split(",") if o.strip()]
else:
    _allowed_origins = ["*"]
logger.info(f"CORS配置: allow_origins={_allowed_origins}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=bool(_cors_env),
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=3600,
)

# ========== 速率限制 ==========
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


# ========== 全局异常处理器 ==========

@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    """HTTP异常统一处理 — 500 错误不向客户端暴露内部细节"""
    if exc.status_code >= 500:
        logger.error(f"HTTP {exc.status_code} on {request.url}: {exc.detail}")
        message = "服务器内部错误，请稍后重试"
    else:
        message = str(exc.detail) if exc.detail else "请求错误"
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "success": False,
            "code": exc.status_code,
            "message": message,
            "data": None
        }
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """请求参数验证异常处理"""
    errors = []
    for error in exc.errors():
        field = ".".join(str(loc) for loc in error.get("loc", []))
        errors.append({
            "field": field,
            "message": error.get("msg", "验证失败"),
            "type": error.get("type", "unknown")
        })
    
    return JSONResponse(
        status_code=422,
        content={
            "success": False,
            "code": 422,
            "message": "请求参数验证失败",
            "data": {"errors": errors}
        }
    )


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """全局异常处理"""
    logger.error(f"Unhandled exception on {request.url}: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "code": 500,
            "message": "服务器内部错误",
            "data": None
        }
    )


# ========== 注册路由 ==========

# 导入已有路由
from .routers import finance_router
from .routers.warehouse import router as warehouse_router
from .routers.settlement import router as settlement_router
from .routers.suppliers import router as suppliers_router
from .routers.customers import router as customers_router
from .routers.returns import router as returns_router
from .routers.analytics import router as analytics_router
from .routers.gold_material import router as gold_material_router
from .routers.product_codes import router as product_codes_router
from .routers.salespersons import router as salespersons_router
from .routers.sales import router as sales_router
from .routers.export import router as export_router
from .routers.loan import router as loan_router
from .routers.reconciliation import router as reconciliation_router
from .routers.audit import router as audit_router

# 导入新拆分的路由
from .routers.chat import router as chat_router
from .routers.inbound import router as inbound_router
from .routers.chat_history import router as chat_history_router
from .routers.inventory_maintenance import router as inventory_maintenance_router
from .routers.documents import router as documents_router
from .routers.fbl_finance import router as fbl_finance_router
from .routers.sales_returns import router as sales_returns_router
from .routers.external_api import router as external_api_router
from .routers.action_card import router as action_card_router
from .routers.gold_purchase import router as gold_purchase_router

# 注册已有路由
app.include_router(finance_router)
app.include_router(warehouse_router)
app.include_router(suppliers_router)
app.include_router(customers_router)
app.include_router(returns_router)
app.include_router(settlement_router)
app.include_router(analytics_router)
app.include_router(gold_material_router)
app.include_router(product_codes_router)
app.include_router(salespersons_router)
app.include_router(sales_router)
app.include_router(export_router)
app.include_router(loan_router)
app.include_router(reconciliation_router)
app.include_router(audit_router)

# 注册新拆分的路由
app.include_router(chat_router)
app.include_router(inbound_router)
app.include_router(chat_history_router)
app.include_router(inventory_maintenance_router)
# data_cleanup 路由（所有端点已内置 manager 权限检查）
from .routers.data_cleanup import router as data_cleanup_router
app.include_router(data_cleanup_router)

app.include_router(documents_router)
app.include_router(fbl_finance_router)
app.include_router(sales_returns_router)
app.include_router(external_api_router)
app.include_router(action_card_router)
app.include_router(gold_purchase_router)


# ========== 通用操作日志查询 ==========

@app.get("/api/order-logs/{order_type}/{order_id}")
async def get_order_logs(
    order_type: str,
    order_id: int,
    db: Session = Depends(get_db)
):
    """查询单据操作日志（通用接口，支持所有单据类型）"""
    from .models import OrderStatusLog
    logs = db.query(OrderStatusLog).filter(
        OrderStatusLog.order_type == order_type,
        OrderStatusLog.order_id == order_id
    ).order_by(OrderStatusLog.operated_at.desc()).all()
    
    ACTION_MAP = {
        "confirm": "确认",
        "unconfirm": "反确认",
        "edit": "编辑",
    }
    
    return {
        "success": True,
        "logs": [
            {
                "id": log.id,
                "action": log.action,
                "action_label": ACTION_MAP.get(log.action, log.action),
                "old_status": log.old_status,
                "new_status": log.new_status,
                "operated_by": log.operated_by,
                "operated_at": log.operated_at.isoformat() if log.operated_at else None,
                "remark": log.remark,
            }
            for log in logs
        ]
    }


# ========== 数据库初始化和迁移 ==========

@app.on_event("startup")
async def startup_event():
    """应用启动事件 - 初始化数据库和迁移"""
    # pgvector 扩展必须在建表之前创建，否则 vector 类型不可用
    from .database import engine
    from sqlalchemy import text as _text
    try:
        with engine.connect() as conn:
            conn.execute(_text("CREATE EXTENSION IF NOT EXISTS vector"))
            conn.commit()
            logger.info("pgvector 扩展已就绪")
    except Exception as e:
        logger.warning(f"pgvector 扩展创建跳过（可能不支持）: {e}")

    init_db()
    logger.info("数据库初始化完成")
    
    from .database import SessionLocal, engine
    from sqlalchemy import text, inspect
    
    def _migrate_add_columns(table_name, columns, db_session, inspector):
        """使用 inspect API 检查列是否存在，避免 SQL 拼接。
        columns: list of (col_name, col_type_ddl) -- col_type_ddl 来自硬编码，非用户输入。
        """
        existing = {c["name"] for c in inspector.get_columns(table_name)}
        for col_name, col_type in columns:
            if col_name not in existing:
                db_session.execute(text(
                    f"ALTER TABLE {table_name} ADD COLUMN {col_name} {col_type}"
                ))
                db_session.commit()
                logger.info(f"已添加 {col_name} 列到 {table_name} 表")
    
    # 执行数据库迁移
    db = SessionLocal()
    try:
        _inspector = inspect(engine)
        
        _migrate_add_columns("inbound_details", [
            ("product_code", "VARCHAR(20) NULL"),
            ("piece_count", "INTEGER DEFAULT 0"),
            ("piece_labor_cost", "FLOAT DEFAULT 0.0"),
            ("fineness", "VARCHAR(50) NULL"),
            ("craft", "VARCHAR(50) NULL"),
            ("style", "VARCHAR(50) NULL"),
        ], db, _inspector)
        
        _migrate_add_columns("settlement_orders", [
            ("previous_cash_debt", "FLOAT DEFAULT 0.0"),
            ("previous_gold_debt", "FLOAT DEFAULT 0.0"),
            ("gold_deposit_balance", "FLOAT DEFAULT 0.0"),
            ("cash_deposit_balance", "FLOAT DEFAULT 0.0"),
            ("gold_payment_weight", "FLOAT NULL"),
            ("cash_payment_weight", "FLOAT NULL"),
            ("payment_difference", "FLOAT DEFAULT 0.0"),
            ("payment_status", "VARCHAR(20) DEFAULT 'full'"),
        ], db, _inspector)
        
        _migrate_add_columns("sales_details", [
            ("piece_count", "INTEGER NULL"),
            ("piece_labor_cost", "FLOAT NULL"),
            ("product_code", "VARCHAR(50) NULL"),
        ], db, _inspector)
        
        _migrate_add_columns("chat_logs", [
            ("user_id", "VARCHAR(100) NULL"),
        ], db, _inspector)
        
        _migrate_add_columns("chat_session_meta", [
            ("user_id", "VARCHAR(100) NULL"),
            ("user_role", "VARCHAR(20) NULL"),
        ], db, _inspector)
        
        _migrate_add_columns("customers", [
            ("total_purchase_weight", "FLOAT DEFAULT 0.0"),
        ], db, _inspector)
        
        _migrate_add_columns("sales_return_details", [
            ("product_code", "VARCHAR(50) NULL"),
        ], db, _inspector)
    except Exception as e:
        logger.warning(f"迁移检查: {e}")
        db.rollback()
    finally:
        db.close()
    
    # gold_receipts 表迁移
    db = SessionLocal()
    try:
        _inspector = inspect(engine)
        _migrate_add_columns("gold_receipts", [
            ("is_initial_balance", "BOOLEAN DEFAULT FALSE"),
        ], db, _inspector)
    except Exception as e:
        logger.warning(f"gold_receipts 迁移检查: {e}")
        db.rollback()
    finally:
        db.close()
    
    # return_orders 表迁移
    db = SessionLocal()
    try:
        _inspector = inspect(engine)
        _migrate_add_columns("return_orders", [
            ("total_weight", "FLOAT DEFAULT 0.0"),
            ("total_labor_cost", "FLOAT DEFAULT 0.0"),
            ("item_count", "INTEGER DEFAULT 1"),
        ], db, _inspector)
    except Exception as e:
        logger.warning(f"return_orders 迁移检查: {e}")
        db.rollback()
    finally:
        db.close()
    
    # supplier_payments 和 payment_records 表 - 添加单据生命周期字段
    db = SessionLocal()
    try:
        _inspector = inspect(engine)
        for table_name in ['supplier_payments', 'payment_records']:
            _migrate_add_columns(table_name, [
                ("status", "VARCHAR(20) DEFAULT 'confirmed'"),
                ("confirmed_by", "VARCHAR(50) NULL"),
                ("confirmed_at", "TIMESTAMP NULL"),
            ], db, _inspector)
            
            db.execute(text(
                f"UPDATE {table_name} SET status = 'confirmed' WHERE status IS NULL"
            ))
            db.commit()
    except Exception as e:
        logger.warning(f"supplier_payments/payment_records 迁移检查: {e}")
        db.rollback()
    finally:
        db.close()
    
    # suppliers 表迁移 - 期初欠款字段
    db = SessionLocal()
    try:
        _inspector = inspect(engine)
        _migrate_add_columns("suppliers", [
            ("initial_gold_debt", "NUMERIC(12,4) DEFAULT 0.0"),
            ("initial_labor_debt", "NUMERIC(14,2) DEFAULT 0.0"),
        ], db, _inspector)
    except Exception as e:
        logger.warning(f"suppliers 期初字段迁移检查: {e}")
        db.rollback()
    finally:
        db.close()

    # product_codes 表 - 修复 NULL 和空格脏数据
    db = SessionLocal()
    try:
        db.execute(text("UPDATE product_codes SET is_unique = 0 WHERE is_unique IS NULL"))
        db.execute(text("UPDATE product_codes SET is_used = 0 WHERE is_used IS NULL"))
        db.execute(text(
            "UPDATE product_codes SET code = TRIM(code), name = TRIM(name), code_type = TRIM(code_type) "
            "WHERE code != TRIM(code) OR name != TRIM(name) OR code_type != TRIM(code_type)"
        ))
        db.commit()
    except Exception as e:
        logger.warning(f"product_codes fix: {e}")
        db.rollback()
    finally:
        db.close()

    # loan_orders 表迁移 - 添加辅助列
    db = SessionLocal()
    try:
        _inspector = inspect(engine)
        _migrate_add_columns("loan_orders", [
            ("total_weight", "FLOAT DEFAULT 0.0"),
            ("cancelled_at", "TIMESTAMP NULL"),
            ("cancelled_by", "VARCHAR(50) NULL"),
            ("cancel_reason", "TEXT NULL"),
            ("printed_at", "TIMESTAMP NULL"),
            ("remark", "TEXT NULL"),
        ], db, _inspector)
        _migrate_add_columns("loan_details", [
            ("piece_count", "INTEGER NULL"),
        ], db, _inspector)
    except Exception as e:
        logger.warning(f"loan_orders/loan_details 迁移检查: {e}")
        db.rollback()
    finally:
        db.close()
    
    # 创建新表
    inspector = inspect(engine)
    
    # return_order_details 表
    from .models import ReturnOrderDetail
    if 'return_order_details' not in inspector.get_table_names():
        try:
            ReturnOrderDetail.__table__.create(bind=engine)
            logger.info("已创建 return_order_details 表")
        except Exception as e:
            logger.warning(f"创建 return_order_details 表失败: {e}")
    
    # behavior_decision_logs 表
    from .models.behavior_log import BehaviorDecisionLog
    if 'behavior_decision_logs' not in inspector.get_table_names():
        try:
            BehaviorDecisionLog.__table__.create(bind=engine)
            logger.info("已创建 behavior_decision_logs 表")
        except Exception as e:
            logger.warning(f"创建 behavior_decision_logs 表失败: {e}")
    
    # 供应商金料账户表
    from .models import SupplierGoldAccount, SupplierGoldTransaction
    if 'supplier_gold_accounts' not in inspector.get_table_names():
        try:
            SupplierGoldAccount.__table__.create(bind=engine)
            logger.info("已创建 supplier_gold_accounts 表")
        except Exception as e:
            logger.warning(f"创建 supplier_gold_accounts 表失败: {e}")
    
    if 'supplier_gold_transactions' not in inspector.get_table_names():
        try:
            SupplierGoldTransaction.__table__.create(bind=engine)
            logger.info("已创建 supplier_gold_transactions 表")
        except Exception as e:
            logger.warning(f"创建 supplier_gold_transactions 表失败: {e}")
    
    # product_codes 表
    from .models import ProductCode
    if 'product_codes' not in inspector.get_table_names():
        ProductCode.__table__.create(bind=engine)
        logger.info("已创建 product_codes 表")
    
    # loan_details 表
    from .models import LoanDetail, LoanReturn, LoanReturnDetail
    for table_name, model_cls in [
        ('loan_details', LoanDetail),
        ('loan_returns', LoanReturn),
        ('loan_return_details', LoanReturnDetail),
    ]:
        if table_name not in inspector.get_table_names():
            try:
                model_cls.__table__.create(bind=engine)
                logger.info(f"已创建 {table_name} 表")
            except Exception as e:
                logger.warning(f"创建 {table_name} 表失败: {e}")
    
    # 旧暂借单数据迁移已完成（product_name/weight/labor_cost 字段已移除）
    
    # action_cards 和 notifications 表
    from .models.action_card import ActionCard as _ActionCard, Notification as _Notification
    for _tbl_name, _model_cls in [
        ('action_cards', _ActionCard),
        ('notifications', _Notification),
    ]:
        if _tbl_name not in inspector.get_table_names():
            try:
                _model_cls.__table__.create(bind=engine)
                logger.info(f"已创建 {_tbl_name} 表")
            except Exception as e:
                logger.warning(f"创建 {_tbl_name} 表失败: {e}")

    # 初始化预定义商品编码
    from .init_product_codes import init_product_codes
    db = SessionLocal()
    try:
        count = init_product_codes(db)
        if count > 0:
            logger.info(f"已初始化 {count} 个预定义商品编码")
    except Exception as e:
        logger.error(f"初始化商品编码失败: {e}")
    finally:
        db.close()
    
    # 初始化默认位置
    db = SessionLocal()
    try:
        existing = db.query(Location).first()
        if not existing:
            default_locations = [
                Location(code="warehouse", name="商品部仓库", location_type="warehouse", description="总仓库"),
                Location(code="showroom", name="展厅", location_type="showroom", description="销售展厅"),
            ]
            for loc in default_locations:
                db.add(loc)
            db.commit()
            logger.info("默认位置初始化完成")
    except Exception as e:
        logger.error(f"初始化默认位置失败: {e}")
    finally:
        db.close()

    # ========== Agent 注册 ==========
    from .agents.registry import registry as agent_registry
    from .agents import ALL_AGENTS
    for agent_cls in ALL_AGENTS:
        agent_registry.register(agent_cls())
    logger.info(f"已注册 Agent: {agent_registry.list_agents()}")


# ========== 根路由 ==========

@app.get("/")
async def root():
    """系统状态检查"""
    import sys
    try:
        import paddle
        paddle_available = True
        paddle_path = paddle.__file__
    except ImportError:
        paddle_available = False
        paddle_path = None
    
    return {
        "message": "珠宝ERP系统API", 
        "status": "running",
        "code_version": "2026-01-30-v3-refactored",
        "python_version": sys.version,
        "python_executable": sys.executable,
        "paddle_available": paddle_available,
        "paddle_path": paddle_path
    }


# ========== OCR图片识别API ==========

from .ocr_parser import OCR_AVAILABLE
from .baidu_ocr import is_ocr_configured as is_baidu_ocr_configured, extract_text_from_image as baidu_extract_text, parse_payment_proof

BAIDU_OCR_ENABLED = is_baidu_ocr_configured()
LOCAL_OCR_ENABLED = OCR_AVAILABLE

if LOCAL_OCR_ENABLED:
    from .ocr_parser import extract_text_from_image as local_extract_text
else:
    local_extract_text = None


@app.post("/api/recognize-inbound-sheet")
async def recognize_inbound_sheet(file: UploadFile = File(...)):
    """识别入库单图片，提取文字内容"""
    if not BAIDU_OCR_ENABLED and not LOCAL_OCR_ENABLED:
        return {
            "success": False,
            "message": "OCR 功能未配置",
            "recognized_text": "",
            "thinking_steps": ["OCR 功能未配置"]
        }
    
    try:
        logger.info(f"收到图片上传请求：{file.filename}, 类型：{file.content_type}")
        
        if not file.content_type or not file.content_type.startswith('image/'):
            return {
                "success": False,
                "message": "请上传图片文件",
                "recognized_text": ""
            }
        
        content = await file.read()
        
        ocr_method = "百度云 OCR" if BAIDU_OCR_ENABLED else "本地 PaddleOCR"
        logger.info(f"使用 {ocr_method} 进行识别")
        
        try:
            if BAIDU_OCR_ENABLED:
                recognized_text = baidu_extract_text(image_bytes=content)
            else:
                return {
                    "success": False,
                    "message": "OCR 功能未配置",
                    "recognized_text": ""
                }
            
            logger.info(f"OCR识别完成，识别到 {len(recognized_text)} 个字符")
            
            if not recognized_text or len(recognized_text.strip()) == 0:
                return {
                    "success": False,
                    "message": "未能识别出文字内容",
                    "recognized_text": "",
                    "thinking_steps": ["OCR识别完成，但未识别到任何文字"]
                }
            
            return {
                "success": True,
                "message": f"图片识别成功（{ocr_method}）",
                "recognized_text": recognized_text,
                "thinking_steps": [
                    f"已识别图片：{file.filename}",
                    f"使用：{ocr_method}",
                    f"识别出 {len(recognized_text.split(chr(10)))} 行文字",
                    "请检查识别内容是否正确"
                ]
            }
        
        except Exception as ocr_error:
            logger.error(f"OCR识别失败：{ocr_error}", exc_info=True)
            return {
                "success": False,
                "message": f"OCR识别失败：{str(ocr_error)}",
                "recognized_text": "",
                "thinking_steps": [f"OCR识别过程出错：{str(ocr_error)}"]
            }
    
    except Exception as e:
        logger.error(f"处理图片上传时出错：{e}", exc_info=True)
        return {
            "success": False,
            "message": f"处理图片时出错：{str(e)}",
            "recognized_text": "",
            "thinking_steps": [f"处理过程出错：{str(e)}"]
        }


@app.post("/api/recognize-payment-proof")
async def recognize_payment_proof(file: UploadFile = File(...)):
    """识别转账截图，提取收款信息（付款人、金额、银行、流水号）"""
    if not BAIDU_OCR_ENABLED:
        return {
            "success": False,
            "message": "OCR 功能未配置，请设置百度云 OCR API Key"
        }
    
    try:
        if not file.content_type or not file.content_type.startswith('image/'):
            return {"success": False, "message": "请上传图片文件"}
        
        content = await file.read()
        logger.info(f"收到转账截图上传：{file.filename}, 大小：{len(content)} bytes")
        
        result = parse_payment_proof(image_bytes=content)
        
        if not result.get("success"):
            return {
                "success": False,
                "message": result.get("message", "识别失败"),
                "recognized_text": result.get("recognized_text", "")
            }
        
        parsed = result.get("parsed_data")
        recognized_text = result.get("recognized_text", "")
        
        import base64
        image_base64 = base64.b64encode(content).decode("utf-8")
        image_data_url = f"data:{file.content_type};base64,{image_base64}"
        
        return {
            "success": True,
            "message": "转账截图识别成功",
            "recognized_text": recognized_text,
            "parsed_data": parsed,
            "image_data_url": image_data_url
        }
    
    except Exception as e:
        logger.error(f"识别转账截图失败：{e}", exc_info=True)
        return {"success": False, "message": f"识别失败：{str(e)}"}


@app.post("/api/register-payment-from-proof")
async def register_payment_from_proof(request: Request, db: Session = Depends(get_db)):
    """根据转账截图识别结果登记收款（前端确认后调用）"""
    from .models import Customer
    from .models.finance import PaymentRecord, AccountReceivable
    from datetime import date, timedelta
    
    try:
        data = await request.json()
        customer_name = data.get("customer_name")
        amount = data.get("amount")
        payment_method = data.get("payment_method", "bank_transfer")
        bank_name = data.get("bank_name")
        transfer_no = data.get("transfer_no")
        remark = data.get("remark", "")
        voucher_image = data.get("voucher_image")  # base64 data URL
        
        if not customer_name:
            return {"success": False, "message": "请填写客户名称"}
        if not amount or float(amount) <= 0:
            return {"success": False, "message": "请填写有效的收款金额"}
        
        amount = round(float(amount), 2)
        
        customer = db.query(Customer).filter(Customer.name == customer_name).first()
        if not customer:
            candidates = db.query(Customer).filter(Customer.name.contains(customer_name)).all()
            if len(candidates) == 1:
                customer = candidates[0]
            elif len(candidates) > 1:
                names = '、'.join([c.name for c in candidates[:5]])
                return {"success": False, "message": f"找到多个匹配客户：{names}，请选择正确的客户"}
        
        if not customer:
            return {"success": False, "message": f"未找到客户「{customer_name}」"}
        
        now = datetime.now()
        payment_no = f"SK{now.strftime('%Y%m%d%H%M%S')}"
        
        payment = PaymentRecord(
            payment_no=payment_no,
            customer_id=customer.id,
            payment_date=date.today(),
            amount=amount,
            payment_method=payment_method,
            remark=remark or "转账截图收款",
            operator="AI助手",
            voucher_images=voucher_image,
            bank_name=bank_name,
            transfer_no=transfer_no
        )
        db.add(payment)
        db.flush()
        
        # FIFO 冲抵应收账款
        unpaid = db.query(AccountReceivable).filter(
            AccountReceivable.customer_id == customer.id,
            AccountReceivable.status.in_(["unpaid", "overdue"]),
            AccountReceivable.unpaid_amount > 0
        ).order_by(AccountReceivable.credit_start_date.asc()).all()
        
        remaining = amount
        offset_details = []
        for recv in unpaid:
            if remaining <= 0:
                break
            offset = min(remaining, recv.unpaid_amount)
            recv.received_amount += offset
            recv.unpaid_amount = recv.total_amount - recv.received_amount
            if recv.unpaid_amount <= 0:
                recv.status = "paid"
            offset_details.append({"receivable_id": recv.id, "amount": round(offset, 2)})
            remaining -= offset
        
        db.commit()
        
        return {
            "success": True,
            "message": f"收款 ¥{amount:.2f} 登记成功",
            "data": {
                "payment_id": payment.id,
                "payment_no": payment_no,
                "customer_name": customer.name,
                "amount": amount,
                "offset_details": offset_details,
                "remaining": round(remaining, 2)
            }
        }
    except Exception as e:
        db.rollback()
        logger.error(f"转账截图收款登记失败: {e}", exc_info=True)
        return {"success": False, "message": f"登记失败：{str(e)}"}


# ========== 生产环境：serve 前端静态文件（必须放在所有路由之后）==========
from pathlib import Path as _Path

_frontend_dist = _Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if _frontend_dist.is_dir():
    from fastapi.staticfiles import StaticFiles

    _assets_dir = _frontend_dist / "assets"
    if _assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=str(_assets_dir)), name="frontend-assets")

    @app.get("/{full_path:path}")
    async def serve_spa(request: Request, full_path: str):
        """SPA fallback: 非 /api 路径都返回 index.html"""
        file_path = _frontend_dist / full_path
        if full_path and file_path.is_file():
            return FileResponse(str(file_path))
        return FileResponse(str(_frontend_dist / "index.html"))

    logger.info(f"生产模式：已挂载前端静态文件 ({_frontend_dist})")
else:
    logger.info("未检测到 frontend/dist 目录，跳过静态文件挂载")
