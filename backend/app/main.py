from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Query
from fastapi.responses import StreamingResponse, FileResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from datetime import datetime, timezone, timedelta
import logging

# 中国时区 UTC+8
CHINA_TZ = timezone(timedelta(hours=8))

def china_now() -> datetime:
    """获取中国时间（UTC+8）"""
    return datetime.now(CHINA_TZ)

def to_china_time(dt: datetime) -> datetime:
    """将任意datetime转换为中国时间"""
    if dt is None:
        return None
    if dt.tzinfo is None:
        # 假设无时区的时间是UTC
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(CHINA_TZ)
import tempfile
import os
import json
import asyncio
from typing import List, Dict, Any, Optional

from .database import get_db, init_db
from .schemas import (
    AIRequest, InboundOrderCreate,
    InboundOrderResponse, InboundDetailResponse, InventoryResponse,
    CustomerCreate, CustomerResponse,
    SupplierCreate, SupplierResponse,
    SalesOrderCreate, SalesOrderResponse, SalesDetailResponse, SalesDetailItem,
    SalespersonCreate, SalespersonResponse
)
from .models import InboundOrder, InboundDetail, Inventory, Customer, SalesOrder, SalesDetail, Supplier, ChatLog, Location, LocationInventory, Salesperson
from .ai_parser import parse_user_message
from .utils import to_pinyin_initials
from . import context_manager as ctx
from .routers import finance_router
from .routers.warehouse import router as warehouse_router
from .routers.settlement import router as settlement_router
from .routers.suppliers import router as suppliers_router
from .routers.customers import router as customers_router
from .routers.returns import router as returns_router
from .routers.analytics import router as analytics_router
from .routers.gold_material import router as gold_material_router
from .routers.product_codes import router as product_codes_router
from .ocr_parser import OCR_AVAILABLE

# 百度云 OCR（云端可用）
from .baidu_ocr import is_ocr_configured as is_baidu_ocr_configured, extract_text_from_image as baidu_extract_text

# OCR 功能状态：优先使用百度云 OCR，其次使用本地 PaddleOCR
BAIDU_OCR_ENABLED = is_baidu_ocr_configured()
LOCAL_OCR_ENABLED = OCR_AVAILABLE

if LOCAL_OCR_ENABLED:
    from .ocr_parser import extract_text_from_image as local_extract_text
else:
    local_extract_text = None

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="AI-ERP珠宝入库BETA测试")

# 注册财务对账路由
app.include_router(finance_router)

# 注册仓库管理路由
app.include_router(warehouse_router)

# 注册供应商管理路由
app.include_router(suppliers_router)

# 注册客户管理路由
app.include_router(customers_router)

# 注册退货管理路由
app.include_router(returns_router)

# 注册结算管理路由
app.include_router(settlement_router)

# 注册数据分析路由
app.include_router(analytics_router)

# 注册金料管理路由
app.include_router(gold_material_router)

# 注册商品编码管理路由
app.include_router(product_codes_router)

# 配置CORS - 支持本地开发和云端部署
# 允许的前端域名列表
ALLOWED_ORIGINS = [
    "http://localhost:5173",           # 本地开发
    "http://localhost:3000",           # 备用本地端口
    "https://*.vercel.app",            # Vercel 部署
    "https://*.railway.app",           # Railway 部署
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 允许所有域名（适用于演示项目）
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# 初始化数据库
@app.on_event("startup")
async def startup_event():
    init_db()
    logger.info("数据库初始化完成")
    
    # 初始化预定义商品编码
    from .init_product_codes import init_product_codes
    from .database import SessionLocal
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
    from .database import SessionLocal
    db = SessionLocal()
    try:
        existing = db.query(Location).first()
        if not existing:
            default_locations = [
                Location(code="warehouse", name="商品部仓库", location_type="warehouse", description="总仓库，入库货品存放处"),
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

@app.get("/")
async def root():
    import sys
    import os
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
        "python_version": sys.version,
        "python_executable": sys.executable,
        "paddle_available": paddle_available,
        "paddle_path": paddle_path
    }

# ============= 对话日志辅助函数 =============

def log_chat_message(
    db: Session,
    session_id: str,
    user_role: str,
    message_type: str,
    content: str,
    intent: str = None,
    entities: dict = None,
    response_time_ms: int = None,
    is_successful: bool = True,
    error_message: str = None
):
    """记录对话日志到数据库"""
    try:
        chat_log = ChatLog(
            session_id=session_id or f"session_{datetime.now().strftime('%Y%m%d%H%M%S')}",
            user_role=user_role or "sales",
            message_type=message_type,
            content=content[:10000] if content else "",  # 限制内容长度
            intent=intent,
            entities=json.dumps(entities, ensure_ascii=False) if entities else None,
            response_time_ms=response_time_ms,
            is_successful=1 if is_successful else 0,
            error_message=error_message
        )
        db.add(chat_log)
        db.commit()
        logger.info(f"[对话日志] 已记录: role={user_role}, type={message_type}, intent={intent}")
    except Exception as e:
        logger.error(f"[对话日志] 记录失败: {e}")
        db.rollback()


@app.post("/api/recognize-inbound-sheet")
async def recognize_inbound_sheet(file: UploadFile = File(...)):
    """
    识别入库单图片，提取文字内容
    优先使用百度云 OCR，其次使用本地 PaddleOCR
    """
    # 检查 OCR 功能是否可用
    if not BAIDU_OCR_ENABLED and not LOCAL_OCR_ENABLED:
        return {
            "success": False,
            "message": "OCR 功能未配置。请设置百度云 OCR 密钥（BAIDU_OCR_API_KEY 和 BAIDU_OCR_SECRET_KEY）或在本地安装 PaddleOCR。",
            "recognized_text": "",
            "thinking_steps": ["OCR 功能未配置"]
        }
    
    try:
        logger.info(f"收到图片上传请求：{file.filename}, 类型：{file.content_type}")
        
        # 验证文件类型
        if not file.content_type or not file.content_type.startswith('image/'):
            return {
                "success": False,
                "message": "请上传图片文件（jpg、png等格式）",
                "recognized_text": ""
            }
        
        # 读取上传的文件内容
        content = await file.read()
        
        # 确定使用哪种 OCR
        ocr_method = "百度云 OCR" if BAIDU_OCR_ENABLED else "本地 PaddleOCR"
        logger.info(f"使用 {ocr_method} 进行识别")
        
        try:
            if BAIDU_OCR_ENABLED:
                # 使用百度云 OCR（直接传入图片字节）
                recognized_text = baidu_extract_text(image_bytes=content)
            else:
                # 使用本地 PaddleOCR（需要临时文件）
                with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(file.filename)[1] if file.filename else '.jpg') as tmp_file:
                    tmp_file.write(content)
                    tmp_file_path = tmp_file.name
                
                try:
                    recognized_text = local_extract_text(tmp_file_path)
                finally:
                    # 清理临时文件
                    if os.path.exists(tmp_file_path):
                        os.unlink(tmp_file_path)
            
            logger.info(f"OCR识别完成，识别到 {len(recognized_text)} 个字符")
            
            if not recognized_text or len(recognized_text.strip()) == 0:
                return {
                    "success": False,
                    "message": "未能识别出文字内容，请检查图片是否清晰",
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

@app.post("/api/chat")
async def chat(request: AIRequest, db: Session = Depends(get_db)):
    """处理用户聊天消息 - AI驱动架构"""
    try:
        logger.info(f"收到用户消息: {request.message}")
        
        # 使用AI解析用户消息
        ai_response = parse_user_message(request.message)
        logger.info(f"AI解析结果: action={ai_response.action}, products={ai_response.products}")
        
        # ========== 写操作：先检查权限，再执行 ==========
        from .middleware.permissions import check_action_permission
        
        if ai_response.action == "入库":
            has_perm, perm_error = check_action_permission(request.user_role or 'sales', ai_response.action)
            if not has_perm:
                return {"success": False, "message": perm_error}
            return await handle_inbound(ai_response, db)
        elif ai_response.action == "创建客户":
            has_perm, perm_error = check_action_permission(request.user_role or 'sales', ai_response.action)
            if not has_perm:
                return {"success": False, "message": perm_error}
            return await handle_create_customer(ai_response, db)
        elif ai_response.action == "创建供应商":
            has_perm, perm_error = check_action_permission(request.user_role or 'sales', ai_response.action)
            if not has_perm:
                return {"success": False, "message": perm_error}
            return await handle_create_supplier(ai_response, db)
        elif ai_response.action == "创建销售单":
            has_perm, perm_error = check_action_permission(request.user_role or 'sales', ai_response.action)
            if not has_perm:
                return {"success": False, "message": perm_error}
            return await handle_create_sales_order(ai_response, db)
        elif ai_response.action == "创建转移单":
            has_perm, perm_error = check_action_permission(request.user_role or 'sales', ai_response.action)
            if not has_perm:
                return {"success": False, "message": perm_error}
            return await handle_create_transfer(ai_response, db)
        
        # ========== 查询和分析操作：使用AI分析引擎 ==========
        else:
            from .ai_analyzer import ai_analyzer
            
            # 收集所有相关数据（传入入库单号和销售单号）
            data = ai_analyzer.collect_all_data(
                ai_response.action,
                request.message,
                db,
                order_no=ai_response.order_no,  # RK开头的入库单号
                sales_order_no=ai_response.sales_order_no  # XS开头的销售单号
            )
            
            # 使用AI进行分析
            analysis_result = ai_analyzer.analyze(
                request.message,
                ai_response.action,
                data
            )
            
            # 检测图表需求并生成图表数据
            chart_keywords = ["图表", "chart", "可视化", "用图表", "画图", "画个图", "生成图表", "给我看图表", "用图标", "饼图", "柱状图", "折线图", "趋势图", "分布图", "占比"]
            needs_chart = (
                ai_response.action == "生成图表" or 
                any(keyword in request.message for keyword in chart_keywords)
            )
            
            chart_data_result = {}
            if needs_chart:
                logger.info("[普通] 检测到图表需求，生成图表数据")
                chart_data_result = ai_analyzer.generate_chart_data(ai_response.action, data)
                if chart_data_result:
                    logger.info(f"[普通] 已生成图表数据：柱状图={bool(chart_data_result.get('chart_data'))}, 饼图={bool(chart_data_result.get('pie_data'))}")
            
            # 返回结果（同时返回原始数据，供前端需要时使用）
            return {
                "success": True,
                "message": analysis_result,
                "raw_data": data,  # 可选：前端可以用于图表等
                "action": ai_response.action,
                "chart_data": chart_data_result.get('chart_data'),
                "pie_data": chart_data_result.get('pie_data')
            }
    
    except Exception as e:
        logger.error(f"处理消息时出错: {e}", exc_info=True)
        return {
            "success": False,
            "message": f"处理消息时出错: {str(e)}"
        }

@app.options("/api/chat-stream")
async def chat_stream_options():
    """处理CORS预检请求"""
    from fastapi.responses import Response
    logger.info("[流式] 收到OPTIONS预检请求")
    return Response(
        status_code=200,
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Max-Age": "3600",
        }
    )

@app.post("/api/chat-stream")
async def chat_stream(request: AIRequest, db: Session = Depends(get_db)):
    """流式响应聊天接口 - 显示思考过程和内容逐字生成"""
    
    logger.info(f"[流式] 收到请求: {request.message}, 角色: {request.user_role}")
    
    # 记录用户消息到日志
    start_time = datetime.now()
    session_id = request.session_id or f"session_{start_time.strftime('%Y%m%d%H%M%S%f')}"
    
    log_chat_message(
        db=db,
        session_id=session_id,
        user_role=request.user_role,
        message_type="user",
        content=request.message
    )
    
    # ========== 上下文工程：Read-Before-Decide ==========
    # 加载会话上下文（文件系统作为外部记忆）
    session_context = ctx.load_session_context(session_id)
    context_summary = ctx.generate_context_summary(session_id)
    knowledge_base = ctx.load_knowledge_base()
    
    if context_summary:
        logger.info(f"[Context] 已加载会话上下文，当前目标: {session_context.get('goal', '无')}")
    
    # ========== 查询最近的对话历史（用于上下文理解）==========
    conversation_history = []
    try:
        # 查询最近的5条对话记录（按时间倒序，然后反转）
        recent_logs = db.query(ChatLog).filter(
            ChatLog.user_role == request.user_role
        ).order_by(desc(ChatLog.created_at)).limit(10).all()
        
        # 反转顺序（从旧到新）并格式化
        for log in reversed(recent_logs):
            if log.content:
                conversation_history.append({
                    "role": "user" if log.message_type == "user" else "assistant",
                    "content": log.content
                })
        logger.info(f"[流式] 加载了 {len(conversation_history)} 条历史对话作为上下文")
    except Exception as e:
        logger.warning(f"[流式] 加载对话历史失败: {e}")
    
    async def generate():
        try:
            logger.info("[流式] 开始生成响应")
            
            # ========== 初始填充数据（强制代理开始转发）==========
            # 发送约2KB的初始填充，某些代理需要接收到一定量数据才会开始转发
            initial_padding = ": " + "." * 2048 + "\n\n"
            yield initial_padding
            logger.info("[流式] 已发送初始填充数据")
            
            # ========== 阶段1: 意图解析（立即开始）==========
            first_chunk = f"data: {json.dumps({'type': 'thinking', 'step': '意图解析', 'message': '正在理解您的问题...', 'progress': 10}, ensure_ascii=False)}\n\n"
            logger.info(f"[流式] 发送第一个数据块: {len(first_chunk)} 字节")
            yield first_chunk
            await asyncio.sleep(0.05)
            
            # 构建增强的消息（包含上下文和知识库）
            enhanced_message = request.message
            if context_summary or knowledge_base:
                context_parts = []
                if knowledge_base:
                    context_parts.append(f"【业务规则参考】\n{knowledge_base[:1000]}...")  # 截取前1000字符
                if context_summary:
                    context_parts.append(f"【会话上下文】\n{context_summary}")
                context_parts.append(f"【用户请求】\n{request.message}")
                enhanced_message = "\n\n".join(context_parts)
            
            # 传递对话历史给 AI 解析器
            ai_response = parse_user_message(enhanced_message, conversation_history)
            logger.info(f"[流式] 识别到意图: {ai_response.action}")
            
            # 更新上下文中的实体信息
            entities_to_save = {}
            if ai_response.product_name:
                entities_to_save["last_product"] = ai_response.product_name
            if ai_response.customer_name:
                entities_to_save["last_customer"] = ai_response.customer_name
            if ai_response.supplier_name or ai_response.supplier:
                entities_to_save["last_supplier"] = ai_response.supplier_name or ai_response.supplier
            if entities_to_save:
                ctx.update_entities(session_id, entities_to_save)
            
            yield f"data: {json.dumps({'type': 'thinking', 'step': '意图解析', 'message': f'已识别意图：{ai_response.action}', 'progress': 20, 'status': 'complete'}, ensure_ascii=False)}\n\n"
            await asyncio.sleep(0.05)
            
            # ========== 写操作：先检查权限，再执行 ==========
            if ai_response.action in ["入库", "创建客户", "创建供应商", "创建销售单", "创建转移单"]:
                # 导入权限检查模块
                from .middleware.permissions import check_action_permission, get_permission_denied_message
                
                # 检查操作权限
                user_role = request.user_role or 'sales'
                has_perm, perm_error = check_action_permission(user_role, ai_response.action)
                
                if not has_perm:
                    logger.warning(f"[流式] 权限不足: 角色={user_role}, 操作={ai_response.action}")
                    yield f"data: {json.dumps({'type': 'thinking', 'step': '权限检查', 'message': '权限验证失败', 'progress': 25, 'status': 'error'}, ensure_ascii=False)}\n\n"
                    await asyncio.sleep(0.1)
                    yield f"data: {json.dumps({'type': 'complete', 'data': {'success': False, 'message': perm_error}}, ensure_ascii=False)}\n\n"
                    return
                
                yield f"data: {json.dumps({'type': 'thinking', 'step': '执行操作', 'message': f'正在执行{ai_response.action}操作...', 'progress': 30}, ensure_ascii=False)}\n\n"
                await asyncio.sleep(0.05)
                
                try:
                    if ai_response.action == "入库":
                        result = await handle_inbound(ai_response, db)
                    elif ai_response.action == "创建客户":
                        result = await handle_create_customer(ai_response, db)
                    elif ai_response.action == "创建供应商":
                        result = await handle_create_supplier(ai_response, db)
                    elif ai_response.action == "创建销售单":
                        result = await handle_create_sales_order(ai_response, db)
                    elif ai_response.action == "创建转移单":
                        result = await handle_create_transfer(ai_response, db)
                    
                    # 【上下文工程】记录成功操作（Append-Only）
                    action_desc = f"{ai_response.action}"
                    if ai_response.product_name:
                        action_desc += f" - {ai_response.product_name}"
                    if ai_response.weight:
                        action_desc += f" {ai_response.weight}g"
                    ctx.append_action(session_id, action_desc, result.get("message", "成功"), success=True)
                    
                    logger.info(f"[流式] {ai_response.action}操作完成，准备返回结果")
                    logger.info(f"[流式] result 包含的字段: {list(result.keys()) if isinstance(result, dict) else type(result)}")
                    
                    # 详细日志：检查 all_products
                    if isinstance(result, dict):
                        has_all_products = 'all_products' in result
                        logger.info(f"[流式][重要] result 是否包含 all_products: {has_all_products}")
                        if has_all_products:
                            logger.info(f"[流式][重要] all_products 数量: {len(result['all_products'])}")
                            for i, p in enumerate(result['all_products']):
                                logger.info(f"[流式][重要] 商品{i+1}: {p}")
                        else:
                            logger.warning(f"[流式][警告] result 中没有 all_products 字段！")
                            logger.warning(f"[流式][警告] result 完整内容: {result}")
                    
                    # 确保 result 可以被 JSON 序列化
                    result_json = json.dumps({'type': 'complete', 'data': result}, ensure_ascii=False, default=str)
                    logger.info(f"[流式] 序列化后的JSON长度: {len(result_json)} 字符")
                    yield f"data: {result_json}\n\n"
                    logger.info("[流式] 已发送完成事件")
                    return
                except Exception as op_error:
                    logger.error(f"[流式] 执行{ai_response.action}操作时出错: {op_error}", exc_info=True)
                    error_msg = f"执行{ai_response.action}操作失败: {str(op_error)}"
                    
                    # 【上下文工程】记录错误（Failure Traces）
                    ctx.record_error(
                        session_id, 
                        error_type=f"{ai_response.action}失败",
                        error_detail=str(op_error),
                        context_info=request.message
                    )
                    
                    yield f"data: {json.dumps({'type': 'error', 'message': error_msg}, ensure_ascii=False)}\n\n"
                    return
            
            # ========== 阶段2: 数据收集（分步骤发送）==========
            yield f"data: {json.dumps({'type': 'thinking', 'step': '数据收集', 'message': '正在从数据库收集相关数据...', 'progress': 30}, ensure_ascii=False)}\n\n"
            await asyncio.sleep(0.05)
            
            from .ai_analyzer import ai_analyzer
            
            # 分步骤收集数据，每完成一部分就发送更新
            yield f"data: {json.dumps({'type': 'thinking', 'step': '数据收集', 'message': '正在收集库存数据...', 'progress': 35}, ensure_ascii=False)}\n\n"
            await asyncio.sleep(0.05)
            
            # 开始收集数据
            data = {}
            data['context'] = {
                'intent': ai_response.action,
                'user_message': request.message,
                'timestamp': datetime.now().isoformat(),
                'order_no': ai_response.order_no if hasattr(ai_response, 'order_no') else None,  # 添加入库单号（RK开头）
                'sales_order_no': ai_response.sales_order_no if hasattr(ai_response, 'sales_order_no') else None  # 添加销售单号（XS开头）
            }
            
            # 收集库存数据
            inventories = db.query(Inventory).all()
            data['inventory'] = [
                {
                    'product_name': inv.product_name,
                    'total_weight': inv.total_weight,
                    'last_update': str(inv.last_update) if inv.last_update else None
                }
                for inv in inventories
            ]
            
            yield f"data: {json.dumps({'type': 'thinking', 'step': '数据收集', 'message': '正在收集供应商数据...', 'progress': 45}, ensure_ascii=False)}\n\n"
            await asyncio.sleep(0.05)
            
            # 收集供应商数据
            suppliers = db.query(Supplier).filter(Supplier.status == "active").all()
            data['suppliers'] = []
            for s in suppliers:
                supplier_name = s.name
                product_count = db.query(func.count(func.distinct(InboundDetail.product_name))).filter(
                    InboundDetail.supplier == supplier_name
                ).scalar() or 0
                data['suppliers'].append({
                    'name': s.name,
                    'supplier_no': s.supplier_no,
                    'phone': s.phone,
                    'address': s.address,
                    'contact_person': s.contact_person,
                    'total_cost': float(s.total_supply_amount) if s.total_supply_amount else 0,
                    'total_weight': float(s.total_supply_weight) if s.total_supply_weight else 0,
                    'supply_count': s.total_supply_count,
                    'last_supply_time': str(s.last_supply_time) if s.last_supply_time else None,
                    'product_count': product_count
                })
            
            yield f"data: {json.dumps({'type': 'thinking', 'step': '数据收集', 'message': '正在收集客户数据...', 'progress': 55}, ensure_ascii=False)}\n\n"
            await asyncio.sleep(0.05)
            
            # 收集客户数据
            customers = db.query(Customer).filter(Customer.status == "active").all()
            data['customers'] = [
                {
                    'name': c.name,
                    'phone': c.phone,
                    'total_purchase_amount': c.total_purchase_amount,
                    'total_purchase_count': c.total_purchase_count,
                    'last_purchase_time': str(c.last_purchase_time) if c.last_purchase_time else None,
                    'customer_type': c.customer_type
                }
                for c in customers
            ]
            
            yield f"data: {json.dumps({'type': 'thinking', 'step': '数据收集', 'message': '正在收集订单数据...', 'progress': 65}, ensure_ascii=False)}\n\n"
            await asyncio.sleep(0.05)
            
            # 收集入库单数据（如果指定了入库单号，只查询该入库单）
            order_no = ai_response.order_no if hasattr(ai_response, 'order_no') else None
            if order_no:
                # 精确查询指定入库单
                order = db.query(InboundOrder).filter(InboundOrder.order_no == order_no).first()
                if order:
                    details = db.query(InboundDetail).filter(InboundDetail.order_id == order.id).all()
                    data['inbound_orders'] = [{
                        'order_no': order.order_no,
                        'create_time': str(order.create_time) if order.create_time else None,
                        'status': order.status,
                        'details': [
                            {
                                'product_name': d.product_name,
                                'weight': d.weight,
                                'labor_cost': d.labor_cost,
                                'supplier': d.supplier,
                                'total_cost': d.total_cost
                            }
                            for d in details
                        ]
                    }]
                else:
                    # 入库单不存在
                    data['inbound_orders'] = []
            else:
                # 查询最近的入库单（最多50个）
                inbound_orders = db.query(InboundOrder).order_by(desc(InboundOrder.create_time)).limit(50).all()
                data['inbound_orders'] = []
                for order in inbound_orders:
                    details = db.query(InboundDetail).filter(InboundDetail.order_id == order.id).all()
                    data['inbound_orders'].append({
                        'order_no': order.order_no,
                        'create_time': str(order.create_time) if order.create_time else None,
                        'status': order.status,
                        'details': [
                            {
                                'product_name': d.product_name,
                                'weight': d.weight,
                                'labor_cost': d.labor_cost,
                                'supplier': d.supplier,
                                'total_cost': d.total_cost
                            }
                            for d in details
                        ]
                    })
            
            # 收集销售单数据（如果指定了销售单号，只查询该销售单）
            sales_order_no = ai_response.sales_order_no if hasattr(ai_response, 'sales_order_no') else None
            if sales_order_no:
                # 精确查询指定销售单
                so = db.query(SalesOrder).filter(SalesOrder.order_no == sales_order_no).first()
                if so:
                    details = db.query(SalesDetail).filter(SalesDetail.order_id == so.id).all()
                    data['sales_orders'] = [{
                        'order_no': so.order_no,
                        'customer_name': so.customer_name,
                        'salesperson': so.salesperson,
                        'store_code': so.store_code,
                        'total_labor_cost': so.total_labor_cost,
                        'total_weight': so.total_weight,
                        'status': so.status,
                        'order_date': str(so.order_date) if so.order_date else None,
                        'details': [
                            {
                                'product_name': d.product_name,
                                'weight': d.weight,
                                'labor_cost': d.labor_cost,
                                'total_labor_cost': d.total_labor_cost
                            }
                            for d in details
                        ]
                    }]
                else:
                    # 销售单不存在
                    data['sales_orders'] = []
            else:
                # 查询最近的销售单（最多50个）
                sales_orders = db.query(SalesOrder).order_by(desc(SalesOrder.order_date)).limit(50).all()
                data['sales_orders'] = []
                for so in sales_orders:
                    details = db.query(SalesDetail).filter(SalesDetail.order_id == so.id).all()
                    data['sales_orders'].append({
                        'order_no': so.order_no,
                        'customer_name': so.customer_name,
                        'salesperson': so.salesperson,
                        'store_code': so.store_code,
                        'total_labor_cost': so.total_labor_cost,
                        'total_weight': so.total_weight,
                        'status': so.status,
                        'order_date': str(so.order_date) if so.order_date else None,
                        'details': [
                            {
                                'product_name': d.product_name,
                                'weight': d.weight,
                                'labor_cost': d.labor_cost,
                                'total_labor_cost': d.total_labor_cost
                            }
                            for d in details
                        ]
                    })
            
            # 收集总体统计
            data['statistics'] = {
                'total_inventory_weight': float(db.query(func.sum(Inventory.total_weight)).scalar() or 0),
                'total_inbound_cost': float(db.query(func.sum(InboundDetail.total_cost)).scalar() or 0),
                'total_suppliers': len(data['suppliers']),
                'total_customers': len(data['customers']),
                'total_inbound_orders': db.query(func.count(InboundOrder.id)).scalar() or 0,
                'total_sales_orders': db.query(func.count(SalesOrder.id)).scalar() or 0,
                'total_products': len(data['inventory'])
            }
            
            inventory_count = len(data.get("inventory", []))
            suppliers_count = len(data.get("suppliers", []))
            customers_count = len(data.get("customers", []))
            message_text = f'数据收集完成：{inventory_count}种商品，{suppliers_count}个供应商，{customers_count}个客户'
            yield f"data: {json.dumps({'type': 'thinking', 'step': '数据收集', 'message': message_text, 'progress': 70, 'status': 'complete'}, ensure_ascii=False)}\n\n"
            await asyncio.sleep(0.05)
            
            # ========== 阶段3: AI流式生成（关键部分）==========
            yield f"data: {json.dumps({'type': 'thinking', 'step': 'AI分析', 'message': '正在使用AI进行智能分析...', 'progress': 75}, ensure_ascii=False)}\n\n"
            await asyncio.sleep(0.05)
            
            # 标记开始生成内容
            yield f"data: {json.dumps({'type': 'content_start'})}\n\n"
            
            # 使用流式AI分析
            full_response = ""
            chunk_count = 0
            try:
                for text_chunk in ai_analyzer.analyze_stream(
                    request.message,
                    ai_response.action,
                    data
                ):
                    full_response += text_chunk
                    chunk_count += 1
                    # 立即发送每个文本块
                    yield f"data: {json.dumps({'type': 'content', 'chunk': text_chunk}, ensure_ascii=False)}\n\n"
                    
                    # 每5个块发送一个心跳注释，强制刷新代理缓冲
                    if chunk_count % 5 == 0:
                        yield ": heartbeat\n\n"
            except Exception as e:
                logger.error(f"流式AI分析失败: {e}", exc_info=True)
                error_msg = f"AI分析过程中出现错误：{str(e)}。请稍后重试。"
                yield f"data: {json.dumps({'type': 'content', 'chunk': error_msg}, ensure_ascii=False)}\n\n"
                full_response = error_msg
            
            # ========== 检测图表需求并生成图表数据 ==========
            chart_keywords = ["图表", "chart", "可视化", "用图表", "画图", "画个图", "生成图表", "给我看图表", "用图标", "饼图", "柱状图", "折线图", "趋势图", "分布图", "占比"]
            needs_chart = (
                ai_response.action == "生成图表" or 
                any(keyword in request.message for keyword in chart_keywords)
            )
            
            chart_data_result = {}
            if needs_chart:
                logger.info("[流式] 检测到图表需求，生成图表数据")
                chart_data_result = ai_analyzer.generate_chart_data(ai_response.action, data)
                if chart_data_result:
                    logger.info(f"[流式] 已生成图表数据：柱状图={bool(chart_data_result.get('chart_data'))}, 饼图={bool(chart_data_result.get('pie_data'))}")
            
            # ========== 最终完成 ==========
            yield f"data: {json.dumps({'type': 'complete', 'data': {'success': True, 'message': full_response, 'raw_data': data, 'action': ai_response.action, 'chart_data': chart_data_result.get('chart_data'), 'pie_data': chart_data_result.get('pie_data')}, 'progress': 100}, ensure_ascii=False)}\n\n"
            
            # 记录 AI 回复到日志
            end_time = datetime.now()
            response_time_ms = int((end_time - start_time).total_seconds() * 1000)
            log_chat_message(
                db=db,
                session_id=session_id,
                user_role=request.user_role,
                message_type="assistant",
                content=full_response[:5000] if full_response else "",  # 限制长度
                intent=ai_response.action,
                response_time_ms=response_time_ms,
                is_successful=True
            )
            
        except Exception as e:
            logger.error(f"流式处理出错: {e}", exc_info=True)
            yield f"data: {json.dumps({'type': 'error', 'message': f'处理出错：{str(e)}'}, ensure_ascii=False)}\n\n"
            
            # 记录错误日志
            log_chat_message(
                db=db,
                session_id=session_id,
                user_role=request.user_role,
                message_type="assistant",
                content="",
                is_successful=False,
                error_message=str(e)
            )
    
    logger.info("[流式] 创建StreamingResponse")
    return StreamingResponse(
        generate(), 
        media_type="text/event-stream",
        headers={
            # 禁用所有缓存
            "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0",
            # 保持连接
            "Connection": "keep-alive",
            # 禁用各层代理缓冲
            "X-Accel-Buffering": "no",  # Nginx
            "X-Content-Type-Options": "nosniff",
            # CORS 头
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        }
    )

async def handle_inbound(ai_response, db: Session) -> Dict[str, Any]:
    """处理入库操作"""
    logger.info(f"[入库] 开始处理入库，AI解析出 {len(ai_response.products) if ai_response.products else 0} 个商品")
    if ai_response.products:
        for i, p in enumerate(ai_response.products):
            logger.info(f"[入库] AI解析商品{i+1}: name={p.product_name}, weight={p.weight}, labor_cost={p.labor_cost}, supplier={p.supplier}")
    
    if not ai_response.products:
        return {
            "success": False,
            "message": "未找到商品信息，请提供商品名称、重量、工费和供应商",
            "parsed": ai_response.model_dump()
        }
    
    # 先验证所有商品，确保数据完整性
    validated_products = []
    validation_errors = []
    
    # 提取共享的供应商（从任何一个商品中提取）
    shared_supplier = None
    for product in ai_response.products:
        if product.supplier:
            shared_supplier = product.supplier
            break
    
    for idx, product in enumerate(ai_response.products):
        # 如果当前商品没有供应商，使用共享供应商
        product_supplier = product.supplier or shared_supplier
        
        # 验证必填字段
        if not product.product_name or not product.weight or product.labor_cost is None:
            validation_errors.append({
                "index": idx + 1,
                "message": f"商品信息不完整: {product.model_dump()}",
                "product": product.model_dump()
            })
            continue
        
        if not product_supplier:
            validation_errors.append({
                "index": idx + 1,
                "message": f"缺少供应商信息: {product.model_dump()}",
                "product": product.model_dump()
            })
            continue
        
        # 更新商品的供应商字段（使用共享供应商）
        product.supplier = product_supplier
        
        # 验证并转换数值类型
        try:
            weight = float(product.weight)
            labor_cost = float(product.labor_cost)
        except (ValueError, TypeError) as e:
            validation_errors.append({
                "index": idx + 1,
                "message": f"数值格式错误: {str(e)}",
                "product": product.model_dump()
            })
            continue
        
        # 验证数值范围
        if weight <= 0:
            validation_errors.append({
                "index": idx + 1,
                "message": f"重量必须大于0: {weight}",
                "product": product.model_dump()
            })
            continue
        
        if labor_cost < 0:
            validation_errors.append({
                "index": idx + 1,
                "message": f"工费不能为负数: {labor_cost}",
                "product": product.model_dump()
            })
            continue
        
        # 处理件数和件工费（可选字段）
        piece_count = None
        piece_labor_cost = None
        if product.piece_count is not None:
            try:
                piece_count = int(product.piece_count)
                if piece_count < 0:
                    piece_count = None
            except (ValueError, TypeError):
                piece_count = None
        
        if product.piece_labor_cost is not None:
            try:
                piece_labor_cost = float(product.piece_labor_cost)
                if piece_labor_cost < 0:
                    piece_labor_cost = None
            except (ValueError, TypeError):
                piece_labor_cost = None
        
        # 计算总工费：克工费 + 件工费
        gram_cost = weight * labor_cost
        piece_cost = (piece_count or 0) * (piece_labor_cost or 0)
        total_cost = gram_cost + piece_cost
        
        validated_products.append({
            "product": product,
            "weight": weight,
            "labor_cost": labor_cost,
            "piece_count": piece_count,
            "piece_labor_cost": piece_labor_cost,
            "total_cost": total_cost
        })
        
        log_msg = f"[入库] 添加商品 {idx+1}: {product.product_name}, 重量={weight}g, 克工费={labor_cost}元/克"
        if piece_count and piece_labor_cost:
            log_msg += f", 件数={piece_count}, 件工费={piece_labor_cost}元/件"
        log_msg += f", 总工费={total_cost}元"
        logger.info(log_msg)
    
    # 如果有验证错误，返回错误信息
    if validation_errors:
        return {
            "success": False,
            "message": f"商品验证失败，共{len(validation_errors)}个商品有问题",
            "validation_errors": validation_errors,
            "parsed": ai_response.model_dump()
        }
    
    # 如果没有有效商品，返回错误
    if not validated_products:
        return {
            "success": False,
            "message": "没有有效的商品信息",
            "parsed": ai_response.model_dump()
        }
    
    # 检查所有商品是否来自同一供应商（业务规则：一个入库单只能有一个供应商）
    suppliers = set(p["product"].supplier for p in validated_products if p["product"].supplier)
    if len(suppliers) > 1:
        return {
            "success": False,
            "message": f"检测到多个供应商: {', '.join(suppliers)}。每张入库单只能对应一个供应商，请按供应商拆分后分别提交。",
            "suppliers": list(suppliers),
            "parsed": ai_response.model_dump()
        }
    
    # 方案B：返回待确认的卡片数据，不执行入库
    # 准备卡片数据供前端显示
    supplier_name = validated_products[0]["product"].supplier if validated_products else None
    
    # 如果只有一个商品，返回单个商品格式
    if len(validated_products) == 1:
        product = validated_products[0]
        card_data = {
            "product_name": product["product"].product_name,
            "weight": product["weight"],
            "labor_cost": product["labor_cost"],
            "piece_count": product.get("piece_count"),
            "piece_labor_cost": product.get("piece_labor_cost"),
            "supplier": supplier_name,
            "total_cost": product["total_cost"]
        }
        return {
            "success": True,
            "message": f"请核对入库信息: {product['product'].product_name} {product['weight']}克",
            "pending": True,  # 标记为待确认
            "card_data": card_data
        }
    else:
        # 多个商品的情况，返回所有商品
        first_product = validated_products[0]
        all_products_list = [
            {
                "product_name": p["product"].product_name,
                "weight": p["weight"],
                "labor_cost": p["labor_cost"],
                "piece_count": p.get("piece_count"),
                "piece_labor_cost": p.get("piece_labor_cost"),
                "supplier": p["product"].supplier,
                "total_cost": p["total_cost"]
            }
            for p in validated_products
        ]
        logger.info(f"[入库] 多商品入库，共{len(all_products_list)}个商品: {all_products_list}")
        return {
            "success": True,
            "message": f"请核对入库信息，共{len(validated_products)}个商品",
            "pending": True,  # 标记为待确认
            "card_data": {
                "product_name": first_product["product"].product_name,
                "weight": first_product["weight"],
                "labor_cost": first_product["labor_cost"],
                "piece_count": first_product.get("piece_count"),
                "piece_labor_cost": first_product.get("piece_labor_cost"),
                "supplier": supplier_name,
                "total_cost": first_product["total_cost"]
            },
            "all_products": all_products_list
        }

# ========== 以下查询和分析函数已被AI分析引擎替代，已删除 ==========
# handle_query_inventory - 已由AI分析引擎替代
# handle_query_suppliers - 已由AI分析引擎替代
# handle_supplier_analysis - 已由AI分析引擎替代
# handle_generate_chart - 已由AI分析引擎替代
# handle_query_orders - 已由AI分析引擎替代
# handle_statistics - 已由AI分析引擎替代

# ==================== 入库管理API ====================

async def execute_inbound(card_data: Dict[str, Any], db: Session) -> Dict[str, Any]:
    """执行实际的入库操作（从卡片数据）"""
    try:
        product_name = card_data.get("product_name")
        weight = float(card_data.get("weight", 0))
        labor_cost = float(card_data.get("labor_cost", 0))
        piece_count = card_data.get("piece_count")  # 件数（可选）
        piece_labor_cost = card_data.get("piece_labor_cost")  # 件工费（可选）
        supplier_name = card_data.get("supplier")
        
        # 转换件数和件工费
        if piece_count is not None:
            piece_count = int(piece_count)
        if piece_labor_cost is not None:
            piece_labor_cost = float(piece_labor_cost)
        
        # 验证数据
        if not product_name or weight <= 0 or labor_cost < 0:
            return {
                "success": False,
                "message": "商品信息不完整或无效",
                "error": "validation_failed"
            }
        
        # 生成入库单号（使用中国时间）
        pinyin_initials = to_pinyin_initials(product_name)
        timestamp = china_now().strftime("%Y%m%d%H%M%S")
        order_no = f"RK{pinyin_initials}{timestamp}"
        
        # 创建入库单
        order = InboundOrder(order_no=order_no, create_time=china_now())
        db.add(order)
        db.flush()
        
        # 查找或创建供应商
        supplier_id = None
        supplier_obj = None
        if supplier_name:
            supplier_obj = db.query(Supplier).filter(
                Supplier.name == supplier_name,
                Supplier.status == "active"
            ).first()
            
            if not supplier_obj:
                supplier_no = f"GYS{china_now().strftime('%Y%m%d%H%M%S')}"
                supplier_obj = Supplier(
                    supplier_no=supplier_no,
                    name=supplier_name,
                    supplier_type="个人"
                )
                db.add(supplier_obj)
                db.flush()
            
            supplier_id = supplier_obj.id
        
        # 计算总成本：克工费 + 件工费
        gram_cost = labor_cost * weight
        piece_cost = (piece_count or 0) * (piece_labor_cost or 0)
        total_cost = gram_cost + piece_cost
        
        # 创建入库明细
        detail = InboundDetail(
            order_id=order.id,
            product_name=product_name,
            product_category=card_data.get("product_category"),
            weight=weight,
            labor_cost=labor_cost,
            piece_count=piece_count,
            piece_labor_cost=piece_labor_cost,
            supplier=supplier_name,
            supplier_id=supplier_id,
            total_cost=total_cost
        )
        db.add(detail)
        
        # 更新或创建库存（总库存表）
        inventory = db.query(Inventory).filter(Inventory.product_name == product_name).first()
        if inventory:
            inventory.total_weight += weight
        else:
            inventory = Inventory(product_name=product_name, total_weight=weight)
            db.add(inventory)
        
        # 更新分仓库存（默认入库到"商品部仓库"）
        default_location = db.query(Location).filter(Location.code == "warehouse").first()
        if not default_location:
            # 如果默认位置不存在，创建它
            default_location = Location(
                code="warehouse",
                name="商品部仓库",
                location_type="warehouse",
                description="默认入库位置"
            )
            db.add(default_location)
            db.flush()
        
        # 更新或创建分仓库存记录
        location_inventory = db.query(LocationInventory).filter(
            LocationInventory.product_name == product_name,
            LocationInventory.location_id == default_location.id
        ).first()
        
        if location_inventory:
            location_inventory.weight += weight
        else:
            location_inventory = LocationInventory(
                product_name=product_name,
                location_id=default_location.id,
                weight=weight
            )
            db.add(location_inventory)
        
        # 更新供应商统计信息
        if supplier_obj:
            supplier_obj.total_supply_amount += total_cost
            supplier_obj.total_supply_weight += weight
            supplier_obj.total_supply_count += 1
            supplier_obj.last_supply_time = datetime.now()
        
        # 提交事务
        db.commit()
        
        # 刷新对象
        db.refresh(order)
        db.refresh(detail)
        db.refresh(inventory)
        
        # 构建响应
        order_response = InboundOrderResponse.model_validate(order).model_dump(mode='json')
        detail_response = InboundDetailResponse.model_validate(detail).model_dump(mode='json')
        inventory_response = InventoryResponse.model_validate(inventory).model_dump(mode='json')
        
        logger.info(f"入库成功: order_id={order.id}, order_no={order.order_no}")
        logger.info(f"返回的order响应包含字段: {list(order_response.keys())}")
        logger.info(f"返回的order.id值: {order_response.get('id')}")
        
        return {
            "success": True,
            "message": f"入库成功: {product_name} {weight}克",
            "order": order_response,
            "detail": detail_response,
            "inventory": inventory_response
        }
    
    except Exception as e:
        db.rollback()
        logger.error(f"入库操作失败: {e}", exc_info=True)
        return {
            "success": False,
            "message": f"入库操作失败: {str(e)}",
            "error": str(e)
        }

@app.post("/api/inbound-orders")
async def create_inbound_order(card_data: InboundOrderCreate, db: Session = Depends(get_db)):
    """创建入库单（从卡片数据确认入库）"""
    try:
        # 转换为字典格式
        card_dict = {
            "product_name": card_data.product_name,
            "product_category": card_data.product_category,
            "weight": card_data.weight,
            "labor_cost": card_data.labor_cost,
            "supplier": card_data.supplier
        }
        
        result = await execute_inbound(card_dict, db)
        return result
    except Exception as e:
        logger.error(f"创建入库单失败: {e}", exc_info=True)
        return {
            "success": False,
            "message": f"创建入库单失败: {str(e)}",
            "error": str(e)
        }

@app.options("/api/inbound-orders/{order_id}/download")
async def download_inbound_order_options(order_id: int):
    """处理CORS预检请求"""
    from fastapi.responses import Response
    return Response(
        status_code=200,
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "*",
        }
    )

@app.get("/api/inbound-orders/{order_id}/download")
async def download_inbound_order(
    order_id: int, 
    format: str = Query("pdf", pattern="^(pdf|html)$"),
    db: Session = Depends(get_db)
):
    """下载或打印入库单（支持PDF和HTML格式）"""
    try:
        logger.info(f"下载入库单请求: order_id={order_id}, format={format}")
        # 查询入库单和明细
        order = db.query(InboundOrder).filter(InboundOrder.id == order_id).first()
        if not order:
            logger.warning(f"入库单不存在: order_id={order_id}")
            # 尝试查询所有入库单，看看有哪些ID
            all_orders = db.query(InboundOrder).limit(10).all()
            logger.info(f"数据库中存在的入库单ID: {[o.id for o in all_orders]}")
            raise HTTPException(status_code=404, detail="入库单不存在")
        
        logger.info(f"找到入库单: order_no={order.order_no}, status={order.status}")
        
        details = db.query(InboundDetail).filter(InboundDetail.order_id == order_id).all()
        if not details:
            logger.warning(f"入库单明细不存在: order_id={order_id}")
            raise HTTPException(status_code=404, detail="入库单明细不存在")
        
        logger.info(f"找到 {len(details)} 条入库单明细")
        
        if format == "pdf":
            try:
                from reportlab.lib.pagesizes import A4
                from reportlab.pdfgen import canvas
                from reportlab.lib.units import mm
                from reportlab.pdfbase import pdfmetrics
                from reportlab.pdfbase.cidfonts import UnicodeCIDFont
                import io
                import os
                from .timezone_utils import to_china_time, format_china_time
                
                # 生成PDF
                buffer = io.BytesIO()
                p = canvas.Canvas(buffer, pagesize=A4)
                width, height = A4
                
                # 使用 CID 字体（内置支持中文，无需外部字体文件）
                try:
                    pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
                    chinese_font = 'STSong-Light'
                    logger.info("成功注册中文CID字体: STSong-Light")
                except Exception as cid_error:
                    logger.warning(f"注册CID字体失败: {cid_error}")
                    chinese_font = None
                
                # 标题
                if chinese_font:
                    p.setFont(chinese_font, 18)
                else:
                    p.setFont("Helvetica-Bold", 18)
                p.drawString(50, height - 50, "珠宝入库单")
                
                # 入库单信息
                font_size = 12
                y = height - 100
                if chinese_font:
                    p.setFont(chinese_font, font_size)
                else:
                    p.setFont("Helvetica", font_size)
                
                # 入库单号
                p.drawString(50, y, f"入库单号：{order.order_no}")
                y -= 25
                
                # 入库时间（使用时区转换）
                if order.create_time:
                    china_time = to_china_time(order.create_time)
                    create_time_str = format_china_time(china_time, '%Y-%m-%d %H:%M:%S')
                else:
                    create_time_str = "未知"
                p.drawString(50, y, f"入库时间：{create_time_str}")
                y -= 25
                
                # 操作员
                p.drawString(50, y, f"操作员：{order.operator}")
                y -= 40
                
                # 表格标题（始终使用中文）
                if chinese_font:
                    p.setFont(chinese_font, 11)
                else:
                    p.setFont("Helvetica-Bold", 11)
                p.drawString(50, y, "商品名称")
                p.drawString(200, y, "重量(克)")
                p.drawString(280, y, "工费(元/克)")
                p.drawString(360, y, "总成本(元)")
                p.drawString(450, y, "供应商")
                y -= 25
                
                # 分隔线
                p.line(50, y, width - 50, y)
                y -= 15
                
                # 商品明细
                total_cost = 0
                total_weight = 0
                page_height = 100
                
                for idx, detail in enumerate(details):
                    if y < page_height:  # 换页
                        p.showPage()
                        y = height - 50
                        # 重新绘制表头（始终使用中文）
                        if chinese_font:
                            p.setFont(chinese_font, 11)
                        else:
                            p.setFont("Helvetica-Bold", 11)
                        p.drawString(50, y, "商品名称")
                        p.drawString(200, y, "重量(克)")
                        p.drawString(280, y, "工费(元/克)")
                        p.drawString(360, y, "总成本(元)")
                        p.drawString(450, y, "供应商")
                        y -= 25
                        p.line(50, y, width - 50, y)
                        y -= 15
                    
                    # 商品信息（处理长文本）
                    product_name = detail.product_name[:20] if len(detail.product_name) > 20 else detail.product_name
                    supplier_name = (detail.supplier or "-")[:15] if detail.supplier else "-"
                    
                    # 使用中文字体绘制商品名称和供应商（如果可用）
                    if chinese_font:
                        p.setFont(chinese_font, 10)
                        p.drawString(50, y, product_name)
                        p.setFont("Helvetica", 10)  # 数字使用Helvetica
                        p.drawString(200, y, f"{detail.weight:.2f}")
                        p.drawString(280, y, f"{detail.labor_cost:.2f}")
                        p.drawString(360, y, f"{detail.total_cost:.2f}")
                        p.setFont(chinese_font, 10)
                        p.drawString(450, y, supplier_name)
                    else:
                        p.setFont("Helvetica", 10)
                        p.drawString(50, y, product_name)
                        p.drawString(200, y, f"{detail.weight:.2f}")
                        p.drawString(280, y, f"{detail.labor_cost:.2f}")
                        p.drawString(360, y, f"{detail.total_cost:.2f}")
                        p.drawString(450, y, supplier_name)
                    
                    total_cost += detail.total_cost
                    total_weight += detail.weight
                    y -= 20
                
                # 总计（始终使用中文）
                y -= 10
                p.line(50, y, width - 50, y)
                y -= 20
                if chinese_font:
                    p.setFont(chinese_font, 12)
                else:
                    p.setFont("Helvetica-Bold", 12)
                p.drawString(50, y, f"总重量：{total_weight:.2f} 克")
                y -= 25
                p.drawString(50, y, f"总成本：¥{total_cost:.2f}")
                
                p.save()
                buffer.seek(0)
                
                # 使用英文文件名避免编码问题
                filename = f"inbound_order_{order.order_no}.pdf"
                pdf_content = buffer.getvalue()
                logger.info(f"PDF生成成功，文件名: {filename}, 大小: {len(pdf_content)} 字节")
                
                # 使用 Response 直接返回字节数据（BytesIO 不兼容 FileResponse）
                from fastapi.responses import Response
                response = Response(
                    content=pdf_content,
                    media_type="application/pdf",
                    headers={
                        "Content-Disposition": f"attachment; filename={filename}",
                        "Content-Type": "application/pdf",
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Allow-Methods": "GET, OPTIONS",
                        "Access-Control-Allow-Headers": "*",
                    }
                )
                return response
            except ImportError as e:
                logger.error(f"reportlab未安装，无法生成PDF: {e}", exc_info=True)
                raise HTTPException(status_code=500, detail=f"PDF生成功能需要安装reportlab库: {str(e)}")
            except Exception as pdf_error:
                import traceback
                error_trace = traceback.format_exc()
                logger.error(f"PDF生成失败: {pdf_error}", exc_info=True)
                logger.error(f"PDF生成错误堆栈: {error_trace}")
                raise HTTPException(status_code=500, detail=f"PDF生成失败: {str(pdf_error)}")
        
        elif format == "html":
            # 生成HTML（用于打印）
            from .timezone_utils import to_china_time, format_china_time
            
            # 转换入库时间为中国时间
            if order.create_time:
                china_time = to_china_time(order.create_time)
                create_time_str = format_china_time(china_time, '%Y-%m-%d %H:%M:%S')
            else:
                create_time_str = '未知'
            
            html_content = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>入库单 - {order.order_no}</title>
    <style>
        @media print {{
            @page {{
                size: A4;
                margin: 2cm;
            }}
            body {{
                margin: 0;
                padding: 0;
            }}
        }}
        body {{
            font-family: "Microsoft YaHei", Arial, sans-serif;
            padding: 20px;
            max-width: 800px;
            margin: 0 auto;
        }}
        .header {{
            text-align: center;
            margin-bottom: 30px;
            border-bottom: 2px solid #333;
            padding-bottom: 20px;
        }}
        .header h1 {{
            margin: 0;
            font-size: 24px;
            color: #333;
        }}
        .info {{
            margin-bottom: 30px;
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 15px;
        }}
        .info-item {{
            display: flex;
        }}
        .info-label {{
            font-weight: bold;
            min-width: 80px;
        }}
        table {{
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
            margin-bottom: 30px;
        }}
        th, td {{
            border: 1px solid #ddd;
            padding: 12px;
            text-align: left;
        }}
        th {{
            background-color: #f5f5f5;
            font-weight: bold;
            text-align: center;
        }}
        td {{
            text-align: center;
        }}
        .total {{
            margin-top: 20px;
            padding-top: 20px;
            border-top: 2px solid #333;
            text-align: right;
        }}
        .total-item {{
            margin: 10px 0;
            font-size: 16px;
        }}
        .total-amount {{
            font-size: 20px;
            font-weight: bold;
            color: #d32f2f;
        }}
    </style>
</head>
<body>
    <div class="header">
        <h1>珠宝入库单</h1>
    </div>
    <div class="info">
        <div class="info-item">
            <span class="info-label">入库单号：</span>
            <span>{order.order_no}</span>
        </div>
        <div class="info-item">
            <span class="info-label">入库时间：</span>
            <span>{create_time_str}</span>
        </div>
        <div class="info-item">
            <span class="info-label">操作员：</span>
            <span>{order.operator}</span>
        </div>
        <div class="info-item">
            <span class="info-label">状态：</span>
            <span>{order.status}</span>
        </div>
    </div>
    <table>
        <thead>
            <tr>
                <th style="width: 30%;">商品名称</th>
                <th style="width: 15%;">重量(克)</th>
                <th style="width: 15%;">工费(元/克)</th>
                <th style="width: 20%;">总成本(元)</th>
                <th style="width: 20%;">供应商</th>
            </tr>
        </thead>
        <tbody>
"""
            
            total_cost = 0
            total_weight = 0
            for detail in details:
                html_content += f"""
            <tr>
                <td>{detail.product_name}</td>
                <td>{detail.weight:.2f}</td>
                <td>{detail.labor_cost:.2f}</td>
                <td>{detail.total_cost:.2f}</td>
                <td>{detail.supplier or '-'}</td>
            </tr>
"""
                total_cost += detail.total_cost
                total_weight += detail.weight
            
            html_content += f"""
        </tbody>
    </table>
    <div class="total">
        <div class="total-item">总重量：<strong>{total_weight:.2f}</strong> 克</div>
        <div class="total-item total-amount">总成本：¥<strong>{total_cost:.2f}</strong></div>
    </div>
</body>
</html>
"""
            
            # 创建HTML响应并添加CORS头
            response = HTMLResponse(content=html_content)
            response.headers["Access-Control-Allow-Origin"] = "*"
            response.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
            response.headers["Access-Control-Allow-Headers"] = "*"
            return response
        
        else:
            raise HTTPException(status_code=400, detail="不支持的格式，请使用 pdf 或 html")
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"生成入库单失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"生成入库单失败: {str(e)}")

# 客户管理API 已移至 routers/customers.py


# ==================== 业务员管理API ====================

@app.get("/api/salespersons")
async def get_salespersons(db: Session = Depends(get_db)):
    """获取所有业务员列表"""
    try:
        salespersons = db.query(Salesperson).filter(
            Salesperson.status == "active"
        ).order_by(Salesperson.id).all()
        
        return {
            "success": True,
            "salespersons": [SalespersonResponse.model_validate(s).model_dump(mode='json') for s in salespersons],
            "total": len(salespersons)
        }
    except Exception as e:
        logger.error(f"获取业务员列表失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


@app.post("/api/salespersons")
async def create_salesperson(data: SalespersonCreate, db: Session = Depends(get_db)):
    """创建业务员"""
    try:
        # 检查是否已存在
        existing = db.query(Salesperson).filter(Salesperson.name == data.name).first()
        if existing:
            if existing.status == "inactive":
                # 重新激活
                existing.status = "active"
                db.commit()
                return {
                    "success": True,
                    "message": f"业务员【{data.name}】已重新激活",
                    "salesperson": SalespersonResponse.model_validate(existing).model_dump(mode='json')
                }
            return {
                "success": False,
                "message": f"业务员【{data.name}】已存在"
            }
        
        salesperson = Salesperson(
            name=data.name,
            phone=data.phone,
            remark=data.remark
        )
        db.add(salesperson)
        db.commit()
        db.refresh(salesperson)
        
        return {
            "success": True,
            "message": f"业务员【{data.name}】创建成功",
            "salesperson": SalespersonResponse.model_validate(salesperson).model_dump(mode='json')
        }
    except Exception as e:
        db.rollback()
        logger.error(f"创建业务员失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


@app.put("/api/salespersons/{salesperson_id}")
async def update_salesperson(salesperson_id: int, data: SalespersonCreate, db: Session = Depends(get_db)):
    """更新业务员信息"""
    try:
        salesperson = db.query(Salesperson).filter(Salesperson.id == salesperson_id).first()
        if not salesperson:
            return {"success": False, "message": "业务员不存在"}
        
        # 检查新名字是否与其他业务员重复
        if data.name != salesperson.name:
            existing = db.query(Salesperson).filter(
                Salesperson.name == data.name,
                Salesperson.id != salesperson_id
            ).first()
            if existing:
                return {"success": False, "message": f"业务员【{data.name}】已存在"}
        
        salesperson.name = data.name
        if data.phone is not None:
            salesperson.phone = data.phone
        if data.remark is not None:
            salesperson.remark = data.remark
        
        db.commit()
        db.refresh(salesperson)
        
        return {
            "success": True,
            "message": f"业务员信息已更新",
            "salesperson": SalespersonResponse.model_validate(salesperson).model_dump(mode='json')
        }
    except Exception as e:
        db.rollback()
        logger.error(f"更新业务员失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


@app.delete("/api/salespersons/{salesperson_id}")
async def delete_salesperson(salesperson_id: int, db: Session = Depends(get_db)):
    """删除业务员（软删除）"""
    try:
        salesperson = db.query(Salesperson).filter(Salesperson.id == salesperson_id).first()
        if not salesperson:
            return {"success": False, "message": "业务员不存在"}
        
        salesperson.status = "inactive"
        db.commit()
        
        return {
            "success": True,
            "message": f"业务员【{salesperson.name}】已删除"
        }
    except Exception as e:
        db.rollback()
        logger.error(f"删除业务员失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


@app.post("/api/salespersons/init")
async def init_salespersons(db: Session = Depends(get_db)):
    """初始化业务员数据（清除现有数据并添加新数据）"""
    try:
        # 预定义的业务员列表
        salesperson_names = [
            "郑梅", "何云波", "姚财寿", "纪鸿杰", "郑光辉",
            "魏荔岚", "林纯洁", "赵燕珠", "步昭芬", "魏瑶峰"
        ]
        
        # 将所有现有业务员设为inactive
        db.query(Salesperson).update({"status": "inactive"})
        
        # 添加或激活新的业务员
        added = []
        for name in salesperson_names:
            existing = db.query(Salesperson).filter(Salesperson.name == name).first()
            if existing:
                existing.status = "active"
                added.append(name)
            else:
                salesperson = Salesperson(name=name, status="active")
                db.add(salesperson)
                added.append(name)
        
        db.commit()
        
        return {
            "success": True,
            "message": f"业务员数据已初始化，共{len(added)}人",
            "salespersons": added
        }
    except Exception as e:
        db.rollback()
        logger.error(f"初始化业务员失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


# 智能匹配API 已移至 routers/customers.py


# ==================== 销售单管理API ====================

@app.post("/api/sales/orders")
async def create_sales_order(order_data: SalesOrderCreate, db: Session = Depends(get_db)):
    """创建销售单"""
    try:
        # ==================== 数据验证 ====================
        # 验证商品明细数据
        for item in order_data.items:
            if item.weight <= 0:
                return {
                    "success": False,
                    "message": f"商品 {item.product_name} 的重量必须大于0",
                    "validation_error": {
                        "product_name": item.product_name,
                        "field": "weight",
                        "value": item.weight
                    }
                }
            if item.labor_cost < 0:
                return {
                    "success": False,
                    "message": f"商品 {item.product_name} 的工费不能为负数",
                    "validation_error": {
                        "product_name": item.product_name,
                        "field": "labor_cost",
                        "value": item.labor_cost
                    }
                }
        # ==================== 数据验证结束 ====================
        
        # ==================== 库存检查 ====================
        # 在创建客户之前先检查库存，避免创建了客户但销售单创建失败
        inventory_errors = []
        for item in order_data.items:
            # 查询库存（精确匹配商品名称）
            inventory = db.query(Inventory).filter(
                Inventory.product_name == item.product_name
            ).first()
            
            if not inventory:
                # 商品不存在于库存中
                inventory_errors.append({
                    "product_name": item.product_name,
                    "error": "商品不存在于库存中",
                    "required_weight": item.weight,
                    "available_weight": 0.0
                })
            else:
                # 计算可用库存：总库存 - 待结算销售单占用的库存
                # 查询该商品在待结算销售单中的总重量
                reserved_weight = db.query(func.sum(SalesDetail.weight)).join(
                    SalesOrder
                ).filter(
                    SalesDetail.product_name == item.product_name,
                    SalesOrder.status == "待结算"
                ).scalar() or 0.0
                
                available_weight = inventory.total_weight - reserved_weight
                
                if available_weight < item.weight:
                    # 库存不足（考虑待结算的销售单）
                    inventory_errors.append({
                        "product_name": item.product_name,
                        "error": "库存不足",
                        "required_weight": item.weight,
                        "available_weight": available_weight,
                        "total_weight": inventory.total_weight,
                        "reserved_weight": reserved_weight
                    })
        
        # 如果有任何商品库存不足，拒绝创建销售单
        if inventory_errors:
            return {
                "success": False,
                "message": "库存检查失败，无法创建销售单",
                "inventory_errors": inventory_errors
            }
        # ==================== 库存检查结束 ====================
        
        # 处理客户（在库存检查通过后）
        customer_id = order_data.customer_id
        customer_name = order_data.customer_name
        
        # 如果没有提供customer_id，尝试根据姓名查找
        if not customer_id:
            customer = db.query(Customer).filter(
                Customer.name == customer_name,
                Customer.status == "active"
            ).first()
            if customer:
                customer_id = customer.id
            else:
                # 客户不存在，自动创建
                customer_no = f"KH{china_now().strftime('%Y%m%d%H%M%S')}"
                customer = Customer(
                    customer_no=customer_no,
                    name=customer_name,
                    customer_type="个人"
                )
                db.add(customer)
                db.flush()
                customer_id = customer.id
        
        # 计算总工费和总克重
        total_labor_cost = sum(item.labor_cost * item.weight for item in order_data.items)
        total_weight = sum(item.weight for item in order_data.items)
        
        # 生成销售单号（使用中国时间）
        order_no = f"XS{china_now().strftime('%Y%m%d%H%M%S')}"
        
        # 创建销售单
        sales_order = SalesOrder(
            order_no=order_no,
            order_date=order_data.order_date or datetime.now(),
            customer_id=customer_id,
            customer_name=customer_name,
            salesperson=order_data.salesperson,
            store_code=order_data.store_code,
            remark=order_data.remark,
            total_labor_cost=total_labor_cost,
            total_weight=total_weight,
            status="待结算"
        )
        db.add(sales_order)
        db.flush()
        
        # 创建销售明细
        details = []
        for item in order_data.items:
            detail = SalesDetail(
                order_id=sales_order.id,
                product_name=item.product_name,
                weight=item.weight,
                labor_cost=item.labor_cost,
                total_labor_cost=item.labor_cost * item.weight
            )
            db.add(detail)
            details.append(detail)
        
        # 更新客户统计信息
        if customer_id:
            customer = db.query(Customer).filter(Customer.id == customer_id).first()
            if customer:
                customer.total_purchase_amount += total_labor_cost
                customer.total_purchase_count += 1
                customer.last_purchase_time = sales_order.order_date
        
        db.commit()
        db.refresh(sales_order)
        for detail in details:
            db.refresh(detail)
        
        # 构建响应
        order_response = SalesOrderResponse.model_validate(sales_order)
        order_response.details = [SalesDetailResponse.model_validate(d).model_dump(mode='json') for d in details]
        
        return {
            "success": True,
            "message": f"销售单创建成功：{order_no}",
            "order": order_response.model_dump(mode='json')
        }
    
    except Exception as e:
        db.rollback()
        logger.error(f"创建销售单失败: {e}", exc_info=True)
        return {
            "success": False,
            "message": f"创建销售单失败: {str(e)}"
        }

@app.get("/api/sales/orders")
async def get_sales_orders(
    customer_name: Optional[str] = None,
    salesperson: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """获取销售单列表"""
    try:
        query = db.query(SalesOrder)
        
        if customer_name:
            query = query.filter(SalesOrder.customer_name.contains(customer_name))
        if salesperson:
            query = query.filter(SalesOrder.salesperson == salesperson)
        if start_date:
            try:
                start_dt = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
                query = query.filter(SalesOrder.order_date >= start_dt)
            except:
                pass
        if end_date:
            try:
                end_dt = datetime.fromisoformat(end_date.replace('Z', '+00:00'))
                query = query.filter(SalesOrder.order_date <= end_dt)
            except:
                pass
        
        orders = query.order_by(desc(SalesOrder.order_date)).limit(100).all()
        
        # 加载明细
        result = []
        for order in orders:
            details = db.query(SalesDetail).filter(SalesDetail.order_id == order.id).all()
            order_response = SalesOrderResponse.model_validate(order)
            order_response.details = [SalesDetailResponse.model_validate(d).model_dump(mode='json') for d in details]
            result.append(order_response.model_dump(mode='json'))
        
        return {
            "success": True,
            "orders": result
        }
    except Exception as e:
        logger.error(f"查询销售单失败: {e}", exc_info=True)
        return {
            "success": False,
            "message": f"查询销售单失败: {str(e)}"
        }

@app.get("/api/sales/orders/{order_id}")
async def get_sales_order(order_id: int, db: Session = Depends(get_db)):
    """获取销售单详情"""
    try:
        order = db.query(SalesOrder).filter(SalesOrder.id == order_id).first()
        
        if not order:
            return {
                "success": False,
                "message": "销售单不存在"
            }
        
        details = db.query(SalesDetail).filter(SalesDetail.order_id == order.id).all()
        order_response = SalesOrderResponse.model_validate(order)
        order_response.details = [SalesDetailResponse.model_validate(d).model_dump(mode='json') for d in details]
        
        return {
            "success": True,
            "order": order_response.model_dump(mode='json')
        }
    except Exception as e:
        logger.error(f"查询销售单详情失败: {e}", exc_info=True)
        return {
            "success": False,
            "message": f"查询销售单详情失败: {str(e)}"
        }

# ==================== AI对话处理函数 ====================

async def handle_create_supplier(ai_response, db: Session) -> Dict[str, Any]:
    """处理创建供应商操作"""
    try:
        # 从AI响应中提取供应商信息
        message = ai_response.model_dump() if hasattr(ai_response, 'model_dump') else {}
        
        # 尝试从AI响应中提取供应商名称
        supplier_name = message.get('supplier_name') or message.get('name')
        if not supplier_name:
            return {
                "success": False,
                "message": "未找到供应商名称，请提供供应商名称",
                "parsed": message
            }
        
        # 创建供应商
        supplier_data = SupplierCreate(
            name=supplier_name,
            phone=message.get('phone'),
            wechat=message.get('wechat'),
            address=message.get('address'),
            contact_person=message.get('contact_person'),
            supplier_type=message.get('supplier_type', '个人'),
            remark=message.get('remark')
        )
        
        result = await create_supplier(supplier_data, db)
        return result
    except Exception as e:
        logger.error(f"处理创建供应商失败: {e}", exc_info=True)
        return {
            "success": False,
            "message": f"处理创建供应商失败: {str(e)}"
        }

async def handle_create_customer(ai_response, db: Session) -> Dict[str, Any]:
    """处理创建客户操作"""
    try:
        # 从AI响应中提取客户信息
        # 这里需要根据AI返回的格式来解析
        # 暂时使用简单的解析逻辑
        message = ai_response.model_dump() if hasattr(ai_response, 'model_dump') else {}
        
        # 尝试从AI响应中提取客户名称
        customer_name = message.get('customer_name') or message.get('name')
        if not customer_name:
            return {
                "success": False,
                "message": "未找到客户姓名，请提供客户姓名",
                "parsed": message
            }
        
        # 创建客户
        customer_data = CustomerCreate(
            name=customer_name,
            phone=message.get('phone'),
            wechat=message.get('wechat'),
            address=message.get('address'),
            customer_type=message.get('customer_type', '个人')
        )
        
        result = await create_customer(customer_data, db)
        return result
    except Exception as e:
        logger.error(f"处理创建客户失败: {e}", exc_info=True)
        return {
            "success": False,
            "message": f"处理创建客户失败: {str(e)}"
        }

async def handle_query_customers(ai_response, db: Session) -> Dict[str, Any]:
    """处理查询客户操作"""
    try:
        # 从AI响应中提取查询条件
        message = ai_response.model_dump() if hasattr(ai_response, 'model_dump') else {}
        customer_name = message.get('customer_name') or message.get('name')
        
        result = await get_customers(name=customer_name, db=db)
        return result
    except Exception as e:
        logger.error(f"处理查询客户失败: {e}", exc_info=True)
        return {
            "success": False,
            "message": f"处理查询客户失败: {str(e)}"
        }

async def handle_create_sales_order(ai_response, db: Session) -> Dict[str, Any]:
    """处理创建销售单操作"""
    try:
        # 从AI响应中提取销售单信息
        message = ai_response.model_dump() if hasattr(ai_response, 'model_dump') else {}
        
        # 提取必填字段
        customer_name = message.get('customer_name')
        salesperson = message.get('salesperson')
        items_data = message.get('items', [])
        
        if not customer_name:
            return {
                "success": False,
                "message": "未找到客户姓名，请提供客户姓名",
                "parsed": message
            }
        
        # ========== 智能匹配业务员 ==========
        auto_matched_salesperson = False
        if not salesperson:
            # 根据客户名查找历史销售记录，自动匹配业务员
            latest_order = db.query(SalesOrder).filter(
                SalesOrder.customer_name == customer_name.strip(),
                SalesOrder.status != "已取消"
            ).order_by(SalesOrder.create_time.desc()).first()
            
            if latest_order and latest_order.salesperson:
                salesperson = latest_order.salesperson
                auto_matched_salesperson = True
                logger.info(f"自动匹配业务员: 客户={customer_name} -> 业务员={salesperson}")
            else:
                return {
                    "success": False,
                    "message": f"未找到业务员姓名。这是新客户【{customer_name}】的第一笔订单，请提供业务员姓名",
                    "parsed": message,
                    "hint": "新客户需要指定业务员"
                }
        # ========== 智能匹配结束 ==========
        
        if not items_data or len(items_data) == 0:
            return {
                "success": False,
                "message": "未找到商品信息，请提供商品明细",
                "parsed": message
            }
        
        # 转换商品明细
        items = []
        for item in items_data:
            if isinstance(item, dict):
                try:
                    weight = float(item.get('weight', 0))
                    labor_cost = float(item.get('labor_cost', 0))
                    
                    # 验证数据
                    if weight <= 0:
                        return {
                            "success": False,
                            "message": f"商品 {item.get('product_name')} 的重量必须大于0",
                            "parsed": message
                        }
                    if labor_cost < 0:
                        return {
                            "success": False,
                            "message": f"商品 {item.get('product_name')} 的工费不能为负数",
                            "parsed": message
                        }
                    
                    items.append(SalesDetailItem(
                        product_name=item.get('product_name'),
                        weight=weight,
                        labor_cost=labor_cost
                    ))
                except (ValueError, TypeError) as e:
                    return {
                        "success": False,
                        "message": f"商品信息格式错误: {str(e)}",
                        "parsed": message
                    }
        
        if not items:
            return {
                "success": False,
                "message": "商品信息格式错误，未找到有效商品",
                "parsed": message
            }
        
        # 解析日期（安全处理）
        order_date = None
        if message.get('order_date'):
            try:
                order_date = datetime.fromisoformat(message['order_date'].replace('Z', '+00:00'))
            except (ValueError, AttributeError):
                # 如果日期格式错误，使用当前时间
                logger.warning(f"日期格式错误，使用当前时间: {message.get('order_date')}")
                order_date = None
        
        # 创建销售单
        order_data = SalesOrderCreate(
            order_date=order_date,
            customer_name=customer_name,
            customer_id=message.get('customer_id'),
            salesperson=salesperson,
            store_code=message.get('store_code'),
            remark=message.get('remark'),
            items=items
        )
        
        result = await create_sales_order(order_data, db)
        
        # 如果业务员是自动匹配的，在消息中添加提示
        if result.get('success') and auto_matched_salesperson:
            result['message'] = f"✅ {result.get('message', '销售单创建成功')}（业务员【{salesperson}】已根据历史记录自动匹配）"
            result['auto_matched_salesperson'] = True
        
        return result
    except Exception as e:
        logger.error(f"处理创建销售单失败: {e}", exc_info=True)
        return {
            "success": False,
            "message": f"处理创建销售单失败: {str(e)}"
        }


async def handle_create_transfer(ai_response, db: Session) -> Dict[str, Any]:
    """处理创建库存转移单操作"""
    try:
        # 从AI响应中提取转移信息
        transfer_product_name = ai_response.transfer_product_name
        transfer_weight = ai_response.transfer_weight
        from_location_name = ai_response.from_location or "商品部仓库"  # 默认从商品部仓库发出
        to_location_name = ai_response.to_location
        
        # 验证目标位置
        if not to_location_name:
            return {
                "success": False,
                "message": "请指定目标位置（如：展厅）",
                "hint": "例如：帮我把古法戒指转移到展厅"
            }
        
        # 验证重量
        if not transfer_weight or transfer_weight <= 0:
            return {
                "success": False,
                "message": "请指定要转移的重量",
                "hint": "例如：帮我转移100克到展厅"
            }
        
        # 查找发出位置
        from_location = db.query(Location).filter(
            Location.name.contains(from_location_name)
        ).first()
        if not from_location:
            # 尝试模糊匹配
            from_location = db.query(Location).filter(
                Location.location_type == "warehouse"
            ).first()
        
        if not from_location:
            return {
                "success": False,
                "message": f"未找到发出位置：{from_location_name}",
                "hint": "请确保仓库位置已创建"
            }
        
        # 查找目标位置
        to_location = db.query(Location).filter(
            Location.name.contains(to_location_name)
        ).first()
        if not to_location:
            # 尝试模糊匹配展厅
            if "展厅" in to_location_name:
                to_location = db.query(Location).filter(
                    Location.location_type == "showroom"
                ).first()
        
        if not to_location:
            return {
                "success": False,
                "message": f"未找到目标位置：{to_location_name}",
                "hint": "可用的位置：商品部仓库、展厅"
            }
        
        # 如果没有指定商品名称，尝试从库存中查找
        if not transfer_product_name:
            # 查找该位置有库存的商品
            location_inv = db.query(LocationInventory).filter(
                LocationInventory.location_id == from_location.id,
                LocationInventory.weight >= transfer_weight
            ).first()
            
            if location_inv:
                transfer_product_name = location_inv.product_name
                logger.info(f"自动选择商品：{transfer_product_name}")
            else:
                return {
                    "success": False,
                    "message": "请指定要转移的商品名称，或确保发出位置有足够库存",
                    "hint": "例如：帮我把古法戒指 100克转移到展厅"
                }
        
        # 验证发出位置是否有足够库存
        source_inv = db.query(LocationInventory).filter(
            LocationInventory.location_id == from_location.id,
            LocationInventory.product_name == transfer_product_name
        ).first()
        
        if not source_inv or source_inv.weight < transfer_weight:
            available = source_inv.weight if source_inv else 0
            return {
                "success": False,
                "message": f"{from_location.name} 的 {transfer_product_name} 库存不足（当前：{available}克，需要：{transfer_weight}克）",
                "hint": "请先入库或减少转移数量"
            }
        
        # 生成转移单号
        now = datetime.now()
        count = db.query(InventoryTransfer).filter(
            InventoryTransfer.transfer_no.like(f"TR{now.strftime('%Y%m%d')}%")
        ).count()
        transfer_no = f"TR{now.strftime('%Y%m%d')}{count + 1:03d}"
        
        # 创建转移单
        db_transfer = InventoryTransfer(
            transfer_no=transfer_no,
            product_name=transfer_product_name,
            weight=transfer_weight,
            from_location_id=from_location.id,
            to_location_id=to_location.id,
            status="pending",
            created_by="AI助手",
            remark=f"通过AI对话创建"
        )
        db.add(db_transfer)
        
        # 扣减发出位置库存
        source_inv.weight -= transfer_weight
        
        db.commit()
        
        logger.info(f"创建转移单成功: {transfer_no}, {transfer_product_name} {transfer_weight}克, "
                   f"{from_location.name} -> {to_location.name}")
        
        return {
            "success": True,
            "message": f"✅ 转移单创建成功！\n\n"
                      f"📋 单号：{transfer_no}\n"
                      f"📦 商品：{transfer_product_name}\n"
                      f"⚖️ 重量：{transfer_weight}克\n"
                      f"📍 从：{from_location.name}\n"
                      f"📍 到：{to_location.name}\n"
                      f"⏳ 状态：待接收\n\n"
                      f"请到【分仓库存】页面查看和接收转移单。",
            "transfer_no": transfer_no,
            "action": "创建转移单"
        }
        
    except Exception as e:
        logger.error(f"处理创建转移单失败: {e}", exc_info=True)
        db.rollback()
        return {
            "success": False,
            "message": f"创建转移单失败: {str(e)}"
        }


# handle_query_sales_orders - 已由AI分析引擎替代


# ============= 统计分析 API =============

@app.get("/api/analytics/overview")
async def get_analytics_overview(db: Session = Depends(get_db)):
    """获取对话分析概览数据"""
    try:
        from sqlalchemy import func, case, distinct
        from datetime import timedelta
        
        today = datetime.now().date()
        week_ago = today - timedelta(days=7)
        month_ago = today - timedelta(days=30)
        
        # 总对话数
        total_chats = db.query(func.count(ChatLog.id)).filter(
            ChatLog.message_type == "user"
        ).scalar() or 0
        
        # 本周对话数
        week_chats = db.query(func.count(ChatLog.id)).filter(
            ChatLog.message_type == "user",
            func.date(ChatLog.created_at) >= week_ago
        ).scalar() or 0
        
        # 今日对话数
        today_chats = db.query(func.count(ChatLog.id)).filter(
            ChatLog.message_type == "user",
            func.date(ChatLog.created_at) == today
        ).scalar() or 0
        
        # 按角色统计
        role_stats = db.query(
            ChatLog.user_role,
            func.count(ChatLog.id).label("count")
        ).filter(
            ChatLog.message_type == "user"
        ).group_by(ChatLog.user_role).all()
        
        role_distribution = {stat.user_role: stat.count for stat in role_stats}
        
        # 按意图统计（Top 10）
        intent_stats = db.query(
            ChatLog.intent,
            func.count(ChatLog.id).label("count")
        ).filter(
            ChatLog.message_type == "assistant",
            ChatLog.intent.isnot(None)
        ).group_by(ChatLog.intent).order_by(
            func.count(ChatLog.id).desc()
        ).limit(10).all()
        
        intent_distribution = [{"intent": stat.intent, "count": stat.count} for stat in intent_stats]
        
        # 平均响应时间
        avg_response_time = db.query(
            func.avg(ChatLog.response_time_ms)
        ).filter(
            ChatLog.message_type == "assistant",
            ChatLog.response_time_ms.isnot(None)
        ).scalar() or 0
        
        # 成功率
        total_responses = db.query(func.count(ChatLog.id)).filter(
            ChatLog.message_type == "assistant"
        ).scalar() or 1
        successful_responses = db.query(func.count(ChatLog.id)).filter(
            ChatLog.message_type == "assistant",
            ChatLog.is_successful == 1
        ).scalar() or 0
        success_rate = (successful_responses / total_responses) * 100 if total_responses > 0 else 100
        
        return {
            "success": True,
            "data": {
                "total_chats": total_chats,
                "week_chats": week_chats,
                "today_chats": today_chats,
                "role_distribution": role_distribution,
                "intent_distribution": intent_distribution,
                "avg_response_time_ms": round(avg_response_time, 2),
                "success_rate": round(success_rate, 2)
            }
        }
    except Exception as e:
        logger.error(f"获取分析概览失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


@app.get("/api/analytics/role/{role}")
async def get_role_analytics(role: str, db: Session = Depends(get_db)):
    """获取特定角色的详细分析数据"""
    try:
        from sqlalchemy import func
        from datetime import timedelta
        
        today = datetime.now().date()
        week_ago = today - timedelta(days=7)
        
        # 该角色的总对话数
        total_chats = db.query(func.count(ChatLog.id)).filter(
            ChatLog.user_role == role,
            ChatLog.message_type == "user"
        ).scalar() or 0
        
        # 本周对话数
        week_chats = db.query(func.count(ChatLog.id)).filter(
            ChatLog.user_role == role,
            ChatLog.message_type == "user",
            func.date(ChatLog.created_at) >= week_ago
        ).scalar() or 0
        
        # 该角色最常用的意图（Top 5）
        top_intents = db.query(
            ChatLog.intent,
            func.count(ChatLog.id).label("count")
        ).filter(
            ChatLog.user_role == role,
            ChatLog.message_type == "assistant",
            ChatLog.intent.isnot(None)
        ).group_by(ChatLog.intent).order_by(
            func.count(ChatLog.id).desc()
        ).limit(5).all()
        
        # 最近的对话记录（最新10条）
        recent_chats = db.query(ChatLog).filter(
            ChatLog.user_role == role,
            ChatLog.message_type == "user"
        ).order_by(ChatLog.created_at.desc()).limit(10).all()
        
        # 热门关键词提取（简单实现：从内容中提取）
        all_contents = db.query(ChatLog.content).filter(
            ChatLog.user_role == role,
            ChatLog.message_type == "user"
        ).limit(100).all()
        
        # 简单的关键词统计
        keyword_counts = {}
        keywords_to_track = ["库存", "入库", "供应商", "客户", "销售", "订单", "对账", "收款", "图表"]
        for content_row in all_contents:
            content = content_row.content or ""
            for keyword in keywords_to_track:
                if keyword in content:
                    keyword_counts[keyword] = keyword_counts.get(keyword, 0) + 1
        
        hot_keywords = sorted(keyword_counts.items(), key=lambda x: x[1], reverse=True)[:5]
        
        return {
            "success": True,
            "data": {
                "role": role,
                "total_chats": total_chats,
                "week_chats": week_chats,
                "top_intents": [{"intent": t.intent, "count": t.count} for t in top_intents],
                "hot_keywords": [{"keyword": k, "count": c} for k, c in hot_keywords],
                "recent_chats": [
                    {
                        "content": chat.content[:100] if chat.content else "",
                        "created_at": chat.created_at.isoformat() if chat.created_at else None
                    }
                    for chat in recent_chats
                ]
            }
        }
    except Exception as e:
        logger.error(f"获取角色分析失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


@app.get("/api/analytics/daily")
async def get_daily_analytics(days: int = 7, db: Session = Depends(get_db)):
    """获取每日对话趋势数据"""
    try:
        from sqlalchemy import func
        from datetime import timedelta
        
        today = datetime.now().date()
        start_date = today - timedelta(days=days)
        
        # 按日期和角色统计
        daily_stats = db.query(
            func.date(ChatLog.created_at).label("date"),
            ChatLog.user_role,
            func.count(ChatLog.id).label("count")
        ).filter(
            ChatLog.message_type == "user",
            func.date(ChatLog.created_at) >= start_date
        ).group_by(
            func.date(ChatLog.created_at),
            ChatLog.user_role
        ).order_by(func.date(ChatLog.created_at)).all()
        
        # 整理数据
        daily_data = {}
        for stat in daily_stats:
            date_str = str(stat.date)
            if date_str not in daily_data:
                daily_data[date_str] = {"date": date_str, "total": 0, "by_role": {}}
            daily_data[date_str]["total"] += stat.count
            daily_data[date_str]["by_role"][stat.user_role] = stat.count
        
        return {
            "success": True,
            "data": list(daily_data.values())
        }
    except Exception as e:
        logger.error(f"获取每日分析失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


# ============= 数据导出 API =============

from openpyxl import Workbook
from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
from openpyxl.utils import get_column_letter
import io
import zipfile

def create_excel_response(wb: Workbook, filename: str):
    """创建 Excel 文件响应"""
    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    
    from fastapi.responses import Response
    return Response(
        content=output.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f"attachment; filename={filename}",
            "Access-Control-Allow-Origin": "*",
        }
    )

def style_header(ws, row=1):
    """为表头添加样式"""
    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="4472C4", end_color="4472C4", fill_type="solid")
    header_alignment = Alignment(horizontal="center", vertical="center")
    
    for cell in ws[row]:
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = header_alignment

def auto_column_width(ws):
    """自动调整列宽"""
    for column in ws.columns:
        max_length = 0
        column_letter = get_column_letter(column[0].column)
        for cell in column:
            try:
                if cell.value:
                    cell_length = len(str(cell.value))
                    if cell_length > max_length:
                        max_length = cell_length
            except:
                pass
        adjusted_width = min(max_length + 2, 50)
        ws.column_dimensions[column_letter].width = adjusted_width


@app.get("/api/export/chat-logs")
async def export_chat_logs(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """导出对话日志为 Excel"""
    try:
        query = db.query(ChatLog).order_by(ChatLog.created_at.desc())
        
        if start_date:
            query = query.filter(func.date(ChatLog.created_at) >= start_date)
        if end_date:
            query = query.filter(func.date(ChatLog.created_at) <= end_date)
        
        logs = query.all()
        
        wb = Workbook()
        ws = wb.active
        ws.title = "对话日志"
        
        # 表头
        headers = ["ID", "会话ID", "用户角色", "消息类型", "内容", "意图", "响应时间(ms)", "是否成功", "创建时间"]
        ws.append(headers)
        style_header(ws)
        
        # 数据
        role_names = {"sales": "业务员", "finance": "财务", "product": "商品专员", "manager": "管理层"}
        for log in logs:
            ws.append([
                log.id,
                log.session_id,
                role_names.get(log.user_role, log.user_role),
                "用户" if log.message_type == "user" else "AI助手",
                log.content[:500] if log.content else "",
                log.intent or "",
                log.response_time_ms,
                "是" if log.is_successful else "否",
                log.created_at.strftime("%Y-%m-%d %H:%M:%S") if log.created_at else ""
            ])
        
        auto_column_width(ws)
        
        filename = f"对话日志_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
        return create_excel_response(wb, filename)
        
    except Exception as e:
        logger.error(f"导出对话日志失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ============= 聊天历史回溯 API =============

@app.get("/api/chat-sessions")
async def get_chat_sessions(
    user_role: str = None,
    limit: int = 30,
    db: Session = Depends(get_db)
):
    """获取对话会话列表（按会话分组）- 用于历史回溯"""
    try:
        # 查询所有不同的会话，按最新消息时间排序
        subquery = db.query(
            ChatLog.session_id,
            func.min(ChatLog.created_at).label('start_time'),
            func.max(ChatLog.created_at).label('end_time'),
            func.count(ChatLog.id).label('message_count')
        ).group_by(ChatLog.session_id)
        
        if user_role:
            subquery = subquery.filter(ChatLog.user_role == user_role)
        
        subquery = subquery.order_by(desc(func.max(ChatLog.created_at))).limit(limit)
        sessions = subquery.all()
        
        result = []
        for session in sessions:
            # 获取该会话的第一条用户消息作为摘要
            first_msg = db.query(ChatLog).filter(
                ChatLog.session_id == session.session_id,
                ChatLog.message_type == "user"
            ).order_by(ChatLog.created_at).first()
            
            # 获取最后一条消息的意图
            last_msg = db.query(ChatLog).filter(
                ChatLog.session_id == session.session_id
            ).order_by(desc(ChatLog.created_at)).first()
            
            summary = ""
            if first_msg and first_msg.content:
                summary = first_msg.content[:60] + "..." if len(first_msg.content) > 60 else first_msg.content
            
            result.append({
                "session_id": session.session_id,
                "start_time": session.start_time.isoformat() if session.start_time else None,
                "end_time": session.end_time.isoformat() if session.end_time else None,
                "message_count": session.message_count,
                "summary": summary,
                "last_intent": last_msg.intent if last_msg else None,
                "user_role": last_msg.user_role if last_msg else None
            })
        
        return {"success": True, "sessions": result, "total": len(result)}
    except Exception as e:
        logger.error(f"获取会话列表失败: {e}", exc_info=True)
        return {"success": False, "message": str(e), "sessions": []}


@app.get("/api/chat-history/{session_id}")
async def get_chat_history(
    session_id: str,
    db: Session = Depends(get_db)
):
    """获取指定会话的完整对话历史"""
    try:
        logs = db.query(ChatLog).filter(
            ChatLog.session_id == session_id
        ).order_by(ChatLog.created_at).all()
        
        if not logs:
            return {"success": False, "message": "未找到该会话", "messages": []}
        
        messages = []
        for log in logs:
            messages.append({
                "id": log.id,
                "message_type": log.message_type,
                "content": log.content,
                "intent": log.intent,
                "user_role": log.user_role,
                "is_successful": log.is_successful,
                "response_time_ms": log.response_time_ms,
                "created_at": log.created_at.isoformat() if log.created_at else None
            })
        
        return {
            "success": True,
            "session_id": session_id,
            "messages": messages,
            "total": len(messages)
        }
    except Exception as e:
        logger.error(f"获取对话历史失败: {e}", exc_info=True)
        return {"success": False, "message": str(e), "messages": []}


@app.get("/api/chat-logs/search")
async def search_chat_logs(
    keyword: str = None,
    user_role: str = None,
    intent: str = None,
    start_date: str = None,
    end_date: str = None,
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db)
):
    """搜索聊天记录 - 支持关键词、角色、意图、日期范围筛选"""
    try:
        query = db.query(ChatLog).order_by(desc(ChatLog.created_at))
        
        if keyword:
            query = query.filter(ChatLog.content.contains(keyword))
        if user_role:
            query = query.filter(ChatLog.user_role == user_role)
        if intent:
            query = query.filter(ChatLog.intent == intent)
        if start_date:
            query = query.filter(func.date(ChatLog.created_at) >= start_date)
        if end_date:
            query = query.filter(func.date(ChatLog.created_at) <= end_date)
        
        total = query.count()
        logs = query.offset(offset).limit(limit).all()
        
        return {
            "success": True,
            "total": total,
            "logs": [
                {
                    "id": log.id,
                    "session_id": log.session_id,
                    "user_role": log.user_role,
                    "message_type": log.message_type,
                    "content": log.content[:200] + "..." if log.content and len(log.content) > 200 else log.content,
                    "intent": log.intent,
                    "created_at": log.created_at.isoformat() if log.created_at else None,
                    "is_successful": log.is_successful
                }
                for log in logs
            ]
        }
    except Exception as e:
        logger.error(f"搜索聊天记录失败: {e}", exc_info=True)
        return {"success": False, "message": str(e), "logs": [], "total": 0}


# 供应商管理 API 已移至 routers/suppliers.py


# ============= 上下文工程 API =============

@app.get("/api/context/{session_id}")
async def get_session_context(session_id: str):
    """获取会话上下文"""
    try:
        context = ctx.load_session_context(session_id)
        summary = ctx.generate_context_summary(session_id)
        return {
            "success": True,
            "context": context,
            "summary": summary
        }
    except Exception as e:
        logger.error(f"获取上下文失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


@app.post("/api/context/{session_id}/goal")
async def set_session_goal(session_id: str, goal: str, phases: List[str] = None):
    """设置会话目标和阶段"""
    try:
        context = ctx.update_session_goal(session_id, goal, phases)
        return {
            "success": True,
            "message": f"目标已设置: {goal}",
            "context": context
        }
    except Exception as e:
        logger.error(f"设置目标失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


@app.post("/api/context/{session_id}/note")
async def add_session_note(session_id: str, note: str, category: str = "general"):
    """添加会话笔记"""
    try:
        context = ctx.add_note(session_id, note, category)
        return {
            "success": True,
            "message": "笔记已添加",
            "notes_count": len(context.get("notes", []))
        }
    except Exception as e:
        logger.error(f"添加笔记失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


@app.delete("/api/context/{session_id}")
async def clear_session_context(session_id: str):
    """清除会话上下文"""
    try:
        ctx.clear_session(session_id)
        return {"success": True, "message": f"会话 {session_id} 的上下文已清除"}
    except Exception as e:
        logger.error(f"清除上下文失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


@app.get("/api/context/list/all")
async def list_all_contexts():
    """列出所有会话上下文"""
    try:
        sessions = ctx.list_sessions()
        contexts = []
        for sid in sessions:
            c = ctx.load_session_context(sid)
            contexts.append({
                "session_id": sid,
                "goal": c.get("goal"),
                "last_updated": c.get("last_updated"),
                "actions_count": len(c.get("completed_actions", [])),
                "errors_count": len(c.get("errors", []))
            })
        return {
            "success": True,
            "sessions": contexts,
            "total": len(contexts)
        }
    except Exception as e:
        logger.error(f"列出上下文失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


@app.get("/api/knowledge-base")
async def get_knowledge_base():
    """获取业务知识库内容"""
    try:
        knowledge = ctx.load_knowledge_base()
        return {
            "success": True,
            "content": knowledge,
            "length": len(knowledge)
        }
    except Exception as e:
        logger.error(f"获取知识库失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}


@app.get("/api/export/inventory")
async def export_inventory(db: Session = Depends(get_db)):
    """导出库存数据为 Excel"""
    try:
        inventories = db.query(Inventory).all()
        
        wb = Workbook()
        ws = wb.active
        ws.title = "库存数据"
        
        headers = ["ID", "商品名称", "库存重量(克)", "最后更新时间"]
        ws.append(headers)
        style_header(ws)
        
        for inv in inventories:
            ws.append([
                inv.id,
                inv.product_name,
                inv.total_weight,
                inv.last_update.strftime("%Y-%m-%d %H:%M:%S") if inv.last_update else ""
            ])
        
        auto_column_width(ws)
        
        filename = f"库存数据_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
        return create_excel_response(wb, filename)
        
    except Exception as e:
        logger.error(f"导出库存数据失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/export/inbound")
async def export_inbound(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """导出入库记录为 Excel"""
    try:
        query = db.query(InboundOrder).order_by(InboundOrder.create_time.desc())
        
        if start_date:
            query = query.filter(func.date(InboundOrder.create_time) >= start_date)
        if end_date:
            query = query.filter(func.date(InboundOrder.create_time) <= end_date)
        
        orders = query.all()
        
        wb = Workbook()
        ws = wb.active
        ws.title = "入库记录"
        
        headers = ["入库单号", "商品名称", "重量(克)", "工费(元/克)", "总成本(元)", "供应商", "入库时间", "操作员"]
        ws.append(headers)
        style_header(ws)
        
        for order in orders:
            details = db.query(InboundDetail).filter(InboundDetail.order_id == order.id).all()
            for detail in details:
                ws.append([
                    order.order_no,
                    detail.product_name,
                    detail.weight,
                    detail.labor_cost,
                    detail.total_cost,
                    detail.supplier or "",
                    order.create_time.strftime("%Y-%m-%d %H:%M:%S") if order.create_time else "",
                    order.operator or ""
                ])
        
        auto_column_width(ws)
        
        filename = f"入库记录_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
        return create_excel_response(wb, filename)
        
    except Exception as e:
        logger.error(f"导出入库记录失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/export/sales")
async def export_sales(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """导出销售订单为 Excel"""
    try:
        query = db.query(SalesOrder).order_by(SalesOrder.order_date.desc())
        
        if start_date:
            query = query.filter(func.date(SalesOrder.order_date) >= start_date)
        if end_date:
            query = query.filter(func.date(SalesOrder.order_date) <= end_date)
        
        orders = query.all()
        
        wb = Workbook()
        ws = wb.active
        ws.title = "销售订单"
        
        headers = ["订单号", "客户名称", "商品名称", "重量(克)", "工费(元/克)", "总工费(元)", "业务员", "门店代码", "订单日期"]
        ws.append(headers)
        style_header(ws)
        
        for order in orders:
            details = db.query(SalesDetail).filter(SalesDetail.order_id == order.id).all()
            customer = db.query(Customer).filter(Customer.id == order.customer_id).first()
            for detail in details:
                ws.append([
                    order.order_no,
                    customer.name if customer else "",
                    detail.product_name,
                    detail.weight,
                    detail.labor_cost,
                    detail.total_labor_cost,
                    order.salesperson or "",
                    order.store_code or "",
                    order.order_date.strftime("%Y-%m-%d") if order.order_date else ""
                ])
        
        auto_column_width(ws)
        
        filename = f"销售订单_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
        return create_excel_response(wb, filename)
        
    except Exception as e:
        logger.error(f"导出销售订单失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/export/customers")
async def export_customers(db: Session = Depends(get_db)):
    """导出客户列表为 Excel"""
    try:
        customers = db.query(Customer).all()
        
        wb = Workbook()
        ws = wb.active
        ws.title = "客户列表"
        
        headers = ["ID", "客户编号", "客户名称", "电话", "地址", "创建时间"]
        ws.append(headers)
        style_header(ws)
        
        for cust in customers:
            ws.append([
                cust.id,
                cust.customer_no,
                cust.name,
                cust.phone or "",
                cust.address or "",
                cust.create_time.strftime("%Y-%m-%d %H:%M:%S") if cust.create_time else ""
            ])
        
        auto_column_width(ws)
        
        filename = f"客户列表_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
        return create_excel_response(wb, filename)
        
    except Exception as e:
        logger.error(f"导出客户列表失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/export/suppliers")
async def export_suppliers(db: Session = Depends(get_db)):
    """导出供应商列表为 Excel"""
    try:
        suppliers = db.query(Supplier).all()
        
        wb = Workbook()
        ws = wb.active
        ws.title = "供应商列表"
        
        headers = ["ID", "供应商编号", "供应商名称", "联系人", "电话", "地址", "总供货金额(元)", "总供货重量(克)", "供货次数", "最后供货时间", "状态"]
        ws.append(headers)
        style_header(ws)
        
        for sup in suppliers:
            ws.append([
                sup.id,
                sup.supplier_no,
                sup.name,
                sup.contact_person or "",
                sup.phone or "",
                sup.address or "",
                sup.total_supply_amount or 0,
                sup.total_supply_weight or 0,
                sup.total_supply_count or 0,
                sup.last_supply_time.strftime("%Y-%m-%d %H:%M:%S") if sup.last_supply_time else "",
                "活跃" if sup.status == "active" else "停用"
            ])
        
        auto_column_width(ws)
        
        filename = f"供应商列表_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
        return create_excel_response(wb, filename)
        
    except Exception as e:
        logger.error(f"导出供应商列表失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/export/all")
async def export_all_data(db: Session = Depends(get_db)):
    """一键导出全部数据为 ZIP 包"""
    try:
        zip_buffer = io.BytesIO()
        
        with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
            # 1. 导出对话日志
            wb = Workbook()
            ws = wb.active
            ws.title = "对话日志"
            ws.append(["ID", "会话ID", "用户角色", "消息类型", "内容", "意图", "响应时间(ms)", "是否成功", "创建时间"])
            style_header(ws)
            role_names = {"sales": "业务员", "finance": "财务", "product": "商品专员", "manager": "管理层"}
            for log in db.query(ChatLog).order_by(ChatLog.created_at.desc()).all():
                ws.append([
                    log.id, log.session_id, role_names.get(log.user_role, log.user_role),
                    "用户" if log.message_type == "user" else "AI助手",
                    log.content[:500] if log.content else "", log.intent or "", log.response_time_ms,
                    "是" if log.is_successful else "否",
                    log.created_at.strftime("%Y-%m-%d %H:%M:%S") if log.created_at else ""
                ])
            auto_column_width(ws)
            excel_buffer = io.BytesIO()
            wb.save(excel_buffer)
            zip_file.writestr("对话日志.xlsx", excel_buffer.getvalue())
            
            # 2. 导出库存数据
            wb = Workbook()
            ws = wb.active
            ws.title = "库存数据"
            ws.append(["ID", "商品名称", "库存重量(克)", "最后更新时间"])
            style_header(ws)
            for inv in db.query(Inventory).all():
                ws.append([inv.id, inv.product_name, inv.total_weight,
                          inv.last_update.strftime("%Y-%m-%d %H:%M:%S") if inv.last_update else ""])
            auto_column_width(ws)
            excel_buffer = io.BytesIO()
            wb.save(excel_buffer)
            zip_file.writestr("库存数据.xlsx", excel_buffer.getvalue())
            
            # 3. 导出入库记录
            wb = Workbook()
            ws = wb.active
            ws.title = "入库记录"
            ws.append(["入库单号", "商品名称", "重量(克)", "工费(元/克)", "总成本(元)", "供应商", "入库时间", "操作员"])
            style_header(ws)
            for order in db.query(InboundOrder).all():
                for detail in db.query(InboundDetail).filter(InboundDetail.order_id == order.id).all():
                    ws.append([order.order_no, detail.product_name, detail.weight, detail.labor_cost,
                              detail.total_cost, detail.supplier or "",
                              order.create_time.strftime("%Y-%m-%d %H:%M:%S") if order.create_time else "",
                              order.operator or ""])
            auto_column_width(ws)
            excel_buffer = io.BytesIO()
            wb.save(excel_buffer)
            zip_file.writestr("入库记录.xlsx", excel_buffer.getvalue())
            
            # 4. 导出销售订单
            wb = Workbook()
            ws = wb.active
            ws.title = "销售订单"
            ws.append(["订单号", "客户名称", "商品名称", "重量(克)", "工费(元/克)", "总工费(元)", "业务员", "门店代码", "订单日期"])
            style_header(ws)
            for order in db.query(SalesOrder).all():
                customer = db.query(Customer).filter(Customer.id == order.customer_id).first()
                for detail in db.query(SalesDetail).filter(SalesDetail.order_id == order.id).all():
                    ws.append([order.order_no, customer.name if customer else "", detail.product_name,
                              detail.weight, detail.labor_cost, detail.total_labor_cost,
                              order.salesperson or "", order.store_code or "",
                              order.order_date.strftime("%Y-%m-%d") if order.order_date else ""])
            auto_column_width(ws)
            excel_buffer = io.BytesIO()
            wb.save(excel_buffer)
            zip_file.writestr("销售订单.xlsx", excel_buffer.getvalue())
            
            # 5. 导出客户列表
            wb = Workbook()
            ws = wb.active
            ws.title = "客户列表"
            ws.append(["ID", "客户编号", "客户名称", "电话", "地址", "创建时间"])
            style_header(ws)
            for cust in db.query(Customer).all():
                ws.append([cust.id, cust.customer_no, cust.name, cust.phone or "", cust.address or "",
                          cust.create_time.strftime("%Y-%m-%d %H:%M:%S") if cust.create_time else ""])
            auto_column_width(ws)
            excel_buffer = io.BytesIO()
            wb.save(excel_buffer)
            zip_file.writestr("客户列表.xlsx", excel_buffer.getvalue())
            
            # 6. 导出供应商列表
            wb = Workbook()
            ws = wb.active
            ws.title = "供应商列表"
            ws.append(["ID", "供应商编号", "供应商名称", "联系人", "电话", "地址", "总供货金额(元)", "总供货重量(克)", "供货次数", "最后供货时间", "状态"])
            style_header(ws)
            for sup in db.query(Supplier).all():
                ws.append([sup.id, sup.supplier_no, sup.name, sup.contact_person or "", sup.phone or "",
                          sup.address or "", sup.total_supply_amount or 0, sup.total_supply_weight or 0,
                          sup.total_supply_count or 0,
                          sup.last_supply_time.strftime("%Y-%m-%d %H:%M:%S") if sup.last_supply_time else "",
                          "活跃" if sup.status == "active" else "停用"])
            auto_column_width(ws)
            excel_buffer = io.BytesIO()
            wb.save(excel_buffer)
            zip_file.writestr("供应商列表.xlsx", excel_buffer.getvalue())
        
        zip_buffer.seek(0)
        
        from fastapi.responses import Response
        filename = f"珠宝ERP数据备份_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"
        return Response(
            content=zip_buffer.getvalue(),
            media_type="application/zip",
            headers={
                "Content-Disposition": f"attachment; filename={filename}",
                "Access-Control-Allow-Origin": "*",
            }
        )
        
    except Exception as e:
        logger.error(f"导出全部数据失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/export/stats")
async def get_export_stats(db: Session = Depends(get_db)):
    """获取可导出数据的统计信息"""
    try:
        return {
            "success": True,
            "data": {
                "chat_logs": db.query(func.count(ChatLog.id)).scalar() or 0,
                "inventory": db.query(func.count(Inventory.id)).scalar() or 0,
                "inbound_orders": db.query(func.count(InboundOrder.id)).scalar() or 0,
                "sales_orders": db.query(func.count(SalesOrder.id)).scalar() or 0,
                "customers": db.query(func.count(Customer.id)).scalar() or 0,
                "suppliers": db.query(func.count(Supplier.id)).scalar() or 0,
            }
        }
    except Exception as e:
        logger.error(f"获取导出统计失败: {e}", exc_info=True)
        return {"success": False, "message": str(e)}
