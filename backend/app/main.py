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
import logging

from .database import get_db, init_db
from .models import Location

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# 中国时区 UTC+8
CHINA_TZ = timezone(timedelta(hours=8))

def china_now() -> datetime:
    """获取中国时间（UTC+8）"""
    return datetime.now(CHINA_TZ)


app = FastAPI(title="AI-ERP珠宝入库BETA测试")

# ========== 配置CORS（必须在路由注册之前）==========
logger.info("CORS配置: 允许所有来源")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=3600,
)


# ========== 全局异常处理器 ==========

@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    """HTTP异常统一处理"""
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "success": False,
            "code": exc.status_code,
            "message": str(exc.detail) if exc.detail else "请求错误",
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


# ========== 数据库初始化和迁移 ==========

@app.on_event("startup")
async def startup_event():
    """应用启动事件 - 初始化数据库和迁移"""
    init_db()
    logger.info("数据库初始化完成")
    
    from .database import SessionLocal, engine
    from sqlalchemy import text, inspect
    
    # 执行数据库迁移
    db = SessionLocal()
    try:
        # inbound_details 表的列
        inbound_columns = [
            ("product_code", "VARCHAR(20) NULL"),
            ("piece_count", "INTEGER DEFAULT 0"),
            ("piece_labor_cost", "FLOAT DEFAULT 0.0"),
            ("fineness", "VARCHAR(50) NULL"),
            ("craft", "VARCHAR(50) NULL"),
            ("style", "VARCHAR(50) NULL"),
        ]
        
        for col_name, col_type in inbound_columns:
            result = db.execute(text(f"""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'inbound_details' AND column_name = '{col_name}'
            """))
            if not result.fetchone():
                db.execute(text(f"""
                    ALTER TABLE inbound_details 
                    ADD COLUMN {col_name} {col_type}
                """))
                db.commit()
                logger.info(f"已添加 {col_name} 列到 inbound_details 表")
        
        # settlement_orders 表
        settlement_columns = [
            ("previous_cash_debt", "FLOAT DEFAULT 0.0"),
            ("previous_gold_debt", "FLOAT DEFAULT 0.0"),
            ("gold_deposit_balance", "FLOAT DEFAULT 0.0"),
            ("cash_deposit_balance", "FLOAT DEFAULT 0.0"),
            ("gold_payment_weight", "FLOAT NULL"),
            ("cash_payment_weight", "FLOAT NULL"),
            ("payment_difference", "FLOAT DEFAULT 0.0"),
            ("payment_status", "VARCHAR(20) DEFAULT 'full'"),
        ]
        
        for col_name, col_type in settlement_columns:
            result = db.execute(text(f"""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'settlement_orders' AND column_name = '{col_name}'
            """))
            if not result.fetchone():
                db.execute(text(f"""
                    ALTER TABLE settlement_orders 
                    ADD COLUMN {col_name} {col_type}
                """))
                db.commit()
                logger.info(f"已添加 {col_name} 列到 settlement_orders 表")
        
        # sales_details 表
        sales_detail_columns = [
            ("piece_count", "INTEGER NULL"),
            ("piece_labor_cost", "FLOAT NULL"),
        ]
        
        for col_name, col_type in sales_detail_columns:
            result = db.execute(text(f"""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'sales_details' AND column_name = '{col_name}'
            """))
            if not result.fetchone():
                db.execute(text(f"""
                    ALTER TABLE sales_details 
                    ADD COLUMN {col_name} {col_type}
                """))
                db.commit()
                logger.info(f"已添加 {col_name} 列到 sales_details 表")
        
        # chat_logs 表
        chat_log_columns = [("user_id", "VARCHAR(100) NULL")]
        
        for col_name, col_type in chat_log_columns:
            result = db.execute(text(f"""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'chat_logs' AND column_name = '{col_name}'
            """))
            if not result.fetchone():
                db.execute(text(f"""
                    ALTER TABLE chat_logs 
                    ADD COLUMN {col_name} {col_type}
                """))
                db.commit()
                logger.info(f"已添加 {col_name} 列到 chat_logs 表")
        
        # chat_session_meta 表
        chat_session_meta_columns = [
            ("user_id", "VARCHAR(100) NULL"),
            ("user_role", "VARCHAR(20) NULL"),
        ]
        
        for col_name, col_type in chat_session_meta_columns:
            result = db.execute(text(f"""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'chat_session_meta' AND column_name = '{col_name}'
            """))
            if not result.fetchone():
                db.execute(text(f"""
                    ALTER TABLE chat_session_meta 
                    ADD COLUMN {col_name} {col_type}
                """))
                db.commit()
                logger.info(f"已添加 {col_name} 列到 chat_session_meta 表")
        
        # customers 表
        customer_columns = [("total_purchase_weight", "FLOAT DEFAULT 0.0")]
        
        for col_name, col_type in customer_columns:
            result = db.execute(text(f"""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'customers' AND column_name = '{col_name}'
            """))
            if not result.fetchone():
                db.execute(text(f"""
                    ALTER TABLE customers 
                    ADD COLUMN {col_name} {col_type}
                """))
                db.commit()
                logger.info(f"已添加 {col_name} 列到 customers 表")
    except Exception as e:
        logger.warning(f"迁移检查: {e}")
        db.rollback()
    finally:
        db.close()
    
    # gold_receipts 表迁移
    db = SessionLocal()
    try:
        gold_receipt_columns = [("is_initial_balance", "BOOLEAN DEFAULT FALSE")]
        
        for col_name, col_type in gold_receipt_columns:
            result = db.execute(text(f"""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'gold_receipts' AND column_name = '{col_name}'
            """))
            if not result.fetchone():
                db.execute(text(f"""
                    ALTER TABLE gold_receipts 
                    ADD COLUMN {col_name} {col_type}
                """))
                db.commit()
                logger.info(f"已添加 {col_name} 列到 gold_receipts 表")
    except Exception as e:
        logger.warning(f"gold_receipts 迁移检查: {e}")
        db.rollback()
    finally:
        db.close()
    
    # return_orders 表迁移
    db = SessionLocal()
    try:
        return_order_columns = [
            ("total_weight", "FLOAT DEFAULT 0.0"),
            ("total_labor_cost", "FLOAT DEFAULT 0.0"),
            ("item_count", "INTEGER DEFAULT 1"),
        ]
        
        for col_name, col_type in return_order_columns:
            result = db.execute(text(f"""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'return_orders' AND column_name = '{col_name}'
            """))
            if not result.fetchone():
                db.execute(text(f"""
                    ALTER TABLE return_orders 
                    ADD COLUMN {col_name} {col_type}
                """))
                db.commit()
                logger.info(f"已添加 {col_name} 列到 return_orders 表")
    except Exception as e:
        logger.warning(f"return_orders 迁移检查: {e}")
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
from .baidu_ocr import is_ocr_configured as is_baidu_ocr_configured, extract_text_from_image as baidu_extract_text

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
