# -*- coding: utf-8 -*-
"""
认证路由 - 登录、注册、修改密码、种子账号初始化
"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.user import User
from ..utils.jwt_utils import (
    create_access_token,
    verify_password,
    get_password_hash,
    verify_token,
)

router = APIRouter(prefix="/api/auth", tags=["authentication"])

# OAuth2 scheme for token extraction
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


# ========== Pydantic 模型 ==========

class UserRegister(BaseModel):
    username: str
    email: Optional[EmailStr] = None
    password: str
    role: str = "sales"


class UserLogin(BaseModel):
    username: str
    password: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    username: str = ""
    role: str = ""
    role_name: str = ""


class TokenData(BaseModel):
    username: Optional[str] = None
    role: Optional[str] = None


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


class ChangeUsernameRequest(BaseModel):
    new_username: str
    password: str  # 需要验证当前密码


class UserInfo(BaseModel):
    id: int
    username: str
    role: str
    role_name: str
    email: Optional[str] = None
    display_name: Optional[str] = None
    is_active: bool


# ========== 种子账号配置 ==========

SEED_ACCOUNTS = [
    {"username": "guitai", "password": "123456", "role": "counter", "role_name": "柜台"},
    {"username": "yewuyuan", "password": "123456", "role": "sales", "role_name": "业务员"},
    {"username": "shangpin", "password": "123456", "role": "product", "role_name": "商品专员"},
    {"username": "jiesuan", "password": "123456", "role": "settlement", "role_name": "结算专员"},
    {"username": "liaobu", "password": "123456", "role": "material", "role_name": "料部"},
    {"username": "caiwu", "password": "123456", "role": "finance", "role_name": "财务"},
    {"username": "guanli", "password": "123456", "role": "manager", "role_name": "管理层"},
]


def init_seed_accounts(db: Session):
    """初始化种子账号 — 逐个检查，缺失则创建，已存在则跳过"""
    created = 0
    for account in SEED_ACCOUNTS:
        existing = db.query(User).filter(User.username == account["username"]).first()
        if existing:
            continue
        user = User(
            username=account["username"],
            hashed_password=get_password_hash(account["password"]),
            role=account["role"],
            role_name=account["role_name"],
            is_active=True,
        )
        db.add(user)
        created += 1

    if created > 0:
        db.commit()
    return created


def reset_seed_accounts(db: Session):
    """强制重置所有种子账号（存在则更新密码，不存在则创建）"""
    reset = 0
    for account in SEED_ACCOUNTS:
        existing = db.query(User).filter(User.username == account["username"]).first()
        if existing:
            existing.hashed_password = get_password_hash(account["password"])
            existing.role = account["role"]
            existing.role_name = account["role_name"]
            existing.is_active = True
        else:
            user = User(
                username=account["username"],
                hashed_password=get_password_hash(account["password"]),
                role=account["role"],
                role_name=account["role_name"],
                is_active=True,
            )
            db.add(user)
        reset += 1

    db.commit()
    return reset


# ========== 路由端点 ==========

@router.post("/register", response_model=Token)
def register(user_data: UserRegister, db: Session = Depends(get_db)):
    """注册新用户"""
    # Check if user already exists
    existing_user = (
        db.query(User).filter(User.username == user_data.username).first()
    )
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered",
        )

    if user_data.email:
        existing_email = db.query(User).filter(User.email == user_data.email).first()
        if existing_email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already registered",
            )

    # 角色名映射
    role_name_map = {
        "counter": "柜台", "sales": "业务员", "product": "商品专员",
        "settlement": "结算专员", "material": "料部", "finance": "财务", "manager": "管理层",
    }

    # Create new user with hashed password
    hashed_password = get_password_hash(user_data.password)
    db_user = User(
        username=user_data.username,
        email=user_data.email,
        hashed_password=hashed_password,
        role=user_data.role,
        role_name=role_name_map.get(user_data.role, user_data.role),
        is_active=True,
    )

    try:
        db.add(db_user)
        db.commit()
        db.refresh(db_user)
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create user: {str(e)}",
        )

    # Generate access token
    access_token = create_access_token(
        data={"sub": db_user.username, "role": db_user.role}
    )
    return Token(
        access_token=access_token,
        username=db_user.username,
        role=db_user.role,
        role_name=db_user.role_name,
    )


@router.post("/seed")
def seed_accounts(db: Session = Depends(get_db)):
    """强制重置种子账号（开发调试用）"""
    try:
        count = reset_seed_accounts(db)
        return {"success": True, "message": f"已重置 {count} 个种子账号", "count": count}
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"重置种子账号失败: {str(e)}",
        )


@router.post("/login", response_model=Token)
def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    """用户登录"""
    user = db.query(User).filter(User.username == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="账号或密码错误",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="账号已被禁用",
        )

    # 更新最后登录时间
    user.last_login_at = datetime.now(timezone.utc)
    db.commit()

    # Generate access token
    access_token = create_access_token(
        data={"sub": user.username, "role": user.role}
    )
    return Token(
        access_token=access_token,
        username=user.username,
        role=user.role,
        role_name=user.role_name,
    )


@router.post("/change-password")
def change_password(
    req: ChangePasswordRequest,
    token: Optional[str] = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
):
    """修改密码"""
    user = _get_current_user(token, db)

    if not verify_password(req.old_password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="原密码错误",
        )

    if len(req.new_password) < 4:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="新密码长度至少4位",
        )

    user.hashed_password = get_password_hash(req.new_password)
    db.commit()
    return {"success": True, "message": "密码修改成功"}


@router.post("/change-username")
def change_username(
    req: ChangeUsernameRequest,
    token: Optional[str] = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
):
    """修改账号（用户名）"""
    user = _get_current_user(token, db)

    if not verify_password(req.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="密码验证失败",
        )

    # 检查新用户名是否已存在
    existing = db.query(User).filter(User.username == req.new_username).first()
    if existing and existing.id != user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="该账号已被使用",
        )

    if len(req.new_username) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="账号长度至少2位",
        )

    user.username = req.new_username
    db.commit()

    # 生成新 token（因为用户名变了）
    access_token = create_access_token(
        data={"sub": user.username, "role": user.role}
    )
    return {
        "success": True,
        "message": "账号修改成功",
        "access_token": access_token,
        "username": user.username,
    }


@router.get("/me", response_model=UserInfo)
def get_me(
    token: Optional[str] = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
):
    """获取当前登录用户信息"""
    user = _get_current_user(token, db)
    return UserInfo(
        id=user.id,
        username=user.username,
        role=user.role,
        role_name=user.role_name,
        email=user.email,
        display_name=user.display_name,
        is_active=user.is_active,
    )


# ========== 内部函数 ==========

def _get_current_user(token: Optional[str], db: Session) -> User:
    """从 token 解析当前用户"""
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="未登录",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = verify_token(token)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="登录已过期，请重新登录",
            headers={"WWW-Authenticate": "Bearer"},
        )

    username = payload.get("sub")
    if username is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="无效的令牌",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = db.query(User).filter(User.username == username).first()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户不存在",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="账号已被禁用",
        )

    return user


def get_current_user(
    token: Optional[str] = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
):
    """依赖项：从JWT token解析当前用户（可供其他路由使用）"""
    return _get_current_user(token, db)
