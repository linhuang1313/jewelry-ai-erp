# -*- coding: utf-8 -*-
"""
用户模型 - 登录认证系统
"""
from sqlalchemy import Column, Integer, String, Boolean, DateTime
from sqlalchemy.sql import func

from ..database import Base


class User(Base):
    """用户表 - 系统登录账号"""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, nullable=False, index=True)  # 登录账号
    hashed_password = Column(String(255), nullable=False)  # 加密后的密码
    role = Column(String(30), nullable=False, index=True)  # 角色ID: counter/sales/product/settlement/material/finance/manager
    role_name = Column(String(50), nullable=False)  # 角色中文名: 柜台/业务员/商品专员/结算专员/料部/财务/管理层
    email = Column(String(100), nullable=True, unique=True, index=True)  # 邮箱（可选）
    display_name = Column(String(100), nullable=True)  # 显示名称（可选）
    is_active = Column(Boolean, default=True, index=True)  # 是否激活
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    last_login_at = Column(DateTime(timezone=True), nullable=True)  # 最后登录时间

    def __repr__(self):
        return f"<User(username={self.username}, role={self.role})>"
