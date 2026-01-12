"""
通用文档生成工具
- PDF生成
- HTML生成
- 统一样式和格式
"""
import io
import logging
from typing import Optional, Dict, List, Any, Tuple
from datetime import datetime

logger = logging.getLogger(__name__)


# ==================== 常量定义 ====================

STATUS_MAP = {
    "pending": "待确认",
    "confirmed": "已确认", 
    "cancelled": "已取消",
    "completed": "已完成",
    "paid": "已支付",
    "partial": "部分支付",
}

# HTML 通用样式
HTML_BASE_STYLE = """
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Microsoft YaHei', Arial, sans-serif; padding: 20px; background: #f5f5f5; }
.container { max-width: 800px; margin: 0 auto; background: white; padding: 40px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
.header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #333; padding-bottom: 20px; }
.header h1 { font-size: 28px; color: #333; margin-bottom: 10px; }
.info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; }
.info-item { margin-bottom: 15px; }
.info-label { font-weight: bold; color: #666; margin-bottom: 5px; font-size: 14px; }
.info-value { color: #333; font-size: 16px; }
.full-width { grid-column: 1 / -1; }
.footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; text-align: center; color: #999; font-size: 12px; }
@media print { body { background: white; padding: 0; } .container { box-shadow: none; } }
"""


# ==================== 时间格式化辅助函数 ====================

def format_datetime(dt: Optional[datetime], format_str: str = '%Y-%m-%d %H:%M:%S') -> str:
    """格式化时间"""
    if not dt:
        return "未知"
    try:
        from ..timezone_utils import to_china_time, format_china_time
        china_time = to_china_time(dt)
        return format_china_time(china_time, format_str)
    except Exception:
        return dt.strftime(format_str) if dt else "未知"


def get_current_time_str(format_str: str = '%Y-%m-%d %H:%M:%S') -> str:
    """获取当前中国时间字符串"""
    try:
        from ..timezone_utils import china_now, format_china_time
        return format_china_time(china_now(), format_str)
    except Exception:
        return datetime.now().strftime(format_str)


def get_status_label(status: str) -> str:
    """获取状态标签"""
    return STATUS_MAP.get(status, status)


# ==================== PDF 生成器 ====================

class PDFGenerator:
    """PDF 文档生成器"""
    
    def __init__(self, title: str):
        self.title = title
        self.chinese_font = None
        self._init_pdf()
    
    def _init_pdf(self):
        """初始化 PDF"""
        from reportlab.lib.pagesizes import A4
        from reportlab.pdfgen import canvas
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.cidfonts import UnicodeCIDFont
        
        self.buffer = io.BytesIO()
        self.canvas = canvas.Canvas(self.buffer, pagesize=A4)
        self.width, self.height = A4
        self.y = self.height - 100
        
        # 注册中文字体
        try:
            pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
            self.chinese_font = 'STSong-Light'
        except Exception as e:
            logger.warning(f"注册CID字体失败: {e}")
            self.chinese_font = None
    
    def _set_font(self, size: int = 12, bold: bool = False):
        """设置字体"""
        if self.chinese_font:
            self.canvas.setFont(self.chinese_font, size)
        else:
            font = "Helvetica-Bold" if bold else "Helvetica"
            self.canvas.setFont(font, size)
    
    def add_title(self):
        """添加标题"""
        self._set_font(18, bold=True)
        self.canvas.drawString(50, self.height - 50, self.title)
        self._set_font(12)
    
    def add_field(self, label: str, value: str):
        """添加字段"""
        self.canvas.drawString(50, self.y, f"{label}：{value}")
        self.y -= 25
    
    def add_field_if(self, label: str, value: Optional[str], condition: bool = True):
        """条件添加字段"""
        if condition and value:
            self.add_field(label, value)
    
    def add_footer(self, text: str = None):
        """添加页脚"""
        footer_text = text or f"打印时间：{get_current_time_str()}"
        self.canvas.drawString(50, 50, footer_text)
    
    def generate(self) -> io.BytesIO:
        """生成 PDF 并返回 buffer"""
        self.canvas.save()
        self.buffer.seek(0)
        return self.buffer


# ==================== HTML 生成器 ====================

class HTMLGenerator:
    """HTML 文档生成器"""
    
    def __init__(self, title: str, document_no: str = ""):
        self.title = title
        self.document_no = document_no
        self.fields: List[Dict[str, Any]] = []
    
    def add_field(self, label: str, value: str, full_width: bool = False):
        """添加字段"""
        self.fields.append({
            "label": label,
            "value": value,
            "full_width": full_width
        })
    
    def add_field_if(self, label: str, value: Optional[str], full_width: bool = False, condition: bool = True):
        """条件添加字段"""
        if condition and value:
            self.add_field(label, value, full_width)
    
    def generate(self) -> str:
        """生成 HTML"""
        fields_html = ""
        for field in self.fields:
            class_name = "info-item full-width" if field.get("full_width") else "info-item"
            fields_html += f'''
            <div class="{class_name}">
                <div class="info-label">{field["label"]}</div>
                <div class="info-value">{field["value"] or "-"}</div>
            </div>'''
        
        html = f"""
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{self.title}{' - ' + self.document_no if self.document_no else ''}</title>
    <style>{HTML_BASE_STYLE}</style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>{self.title}</h1>
        </div>
        
        <div class="info-grid">
            {fields_html}
        </div>
        
        <div class="footer">
            <p>打印时间：{get_current_time_str()}</p>
        </div>
    </div>
</body>
</html>
"""
        return html


# ==================== 便捷函数 ====================

def generate_document(
    title: str,
    document_no: str,
    fields: List[Tuple[str, str, bool]],  # (label, value, full_width)
    format: str = "html"
) -> Tuple[Any, str]:
    """
    生成文档（PDF 或 HTML）
    
    Args:
        title: 文档标题
        document_no: 文档编号
        fields: 字段列表，每个元素为 (标签, 值, 是否全宽)
        format: 输出格式，'pdf' 或 'html'
    
    Returns:
        (buffer/content, filename/None)
    """
    if format == "pdf":
        generator = PDFGenerator(title)
        generator.add_title()
        for label, value, _ in fields:
            if value:
                generator.add_field(label, value)
        generator.add_footer()
        return generator.generate(), f"{title}_{document_no}.pdf"
    
    else:  # html
        generator = HTMLGenerator(title, document_no)
        for label, value, full_width in fields:
            generator.add_field_if(label, value, full_width, bool(value))
        return generator.generate(), None


def build_gold_transaction_fields(
    transaction: Any,
    transaction_type: str,  # 'receipt' 或 'payment'
    related_info: Dict[str, Any] = None
) -> List[Tuple[str, str, bool]]:
    """
    构建金料流转记录的字段列表
    
    Args:
        transaction: 金料流转记录对象
        transaction_type: 类型 ('receipt' 收料单 / 'payment' 付料单)
        related_info: 关联信息字典 (settlement_no, inbound_order_no 等)
    
    Returns:
        字段列表
    """
    related_info = related_info or {}
    fields = []
    
    if transaction_type == 'receipt':
        fields.append(("收料单号", transaction.transaction_no, False))
        if related_info.get("settlement_no"):
            fields.append(("结算单号", related_info["settlement_no"], False))
        if transaction.customer_name:
            fields.append(("客户名称", transaction.customer_name, False))
    else:
        fields.append(("付料单号", transaction.transaction_no, False))
        if transaction.supplier_name:
            fields.append(("供应商", transaction.supplier_name, False))
        if related_info.get("inbound_order_no"):
            fields.append(("入库单号", related_info["inbound_order_no"], False))
    
    fields.append(("金料重量", f"{transaction.gold_weight:.2f} 克", False))
    fields.append(("状态", get_status_label(transaction.status), False))
    fields.append(("创建时间", format_datetime(transaction.created_at), False))
    
    if transaction.created_by:
        fields.append(("创建人", transaction.created_by, False))
    if transaction.confirmed_by:
        fields.append(("确认人", transaction.confirmed_by, False))
    if transaction.confirmed_at:
        fields.append(("确认时间", format_datetime(transaction.confirmed_at), False))
    if transaction.remark:
        fields.append(("备注", transaction.remark, True))
    
    return fields

