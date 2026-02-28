"""
时区工具模块 - 统一使用中国时间 (UTC+8)
"""
from datetime import datetime, timezone, timedelta

# 中国时区 UTC+8
CHINA_TZ = timezone(timedelta(hours=8))


def china_now() -> datetime:
    """获取中国当前时间（UTC+8）"""
    return datetime.now(CHINA_TZ)


def to_china_time(dt: datetime) -> datetime:
    """将任意datetime转换为中国时间"""
    if dt is None:
        return None
    if dt.tzinfo is None:
        # 假设无时区的时间已经是中国时间（因为我们使用 china_now() 存储）
        # 直接返回，不做转换
        return dt.replace(tzinfo=CHINA_TZ)
    return dt.astimezone(CHINA_TZ)


def format_china_time(dt: datetime, fmt: str = "%Y-%m-%d %H:%M:%S") -> str:
    """格式化为中国时间字符串"""
    if dt is None:
        return ""
    china_dt = to_china_time(dt)
    return china_dt.strftime(fmt)

