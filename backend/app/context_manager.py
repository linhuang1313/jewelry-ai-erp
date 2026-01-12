"""
上下文工程管理器 - 轻量级实现
基于 Manus 的 Context Engineering 原则

核心功能：
1. 会话状态持久化 (File as Memory)
2. 决策前读取 (Read-Before-Decide)
3. 错误痕迹保留 (Failure Traces)
4. 业务规则外置 (Knowledge Offloading)
"""

import json
import os
from datetime import datetime
from typing import Optional, Dict, List, Any
import logging

logger = logging.getLogger(__name__)

# 上下文文件存储目录
CONTEXT_DIR = os.path.join(os.path.dirname(__file__), "context_files")
KNOWLEDGE_FILE = os.path.join(os.path.dirname(__file__), "knowledge_base.md")


def ensure_context_dir():
    """确保上下文目录存在"""
    if not os.path.exists(CONTEXT_DIR):
        os.makedirs(CONTEXT_DIR)


def get_session_file_path(session_id: str) -> str:
    """获取会话文件路径"""
    ensure_context_dir()
    return os.path.join(CONTEXT_DIR, f"session_{session_id}.json")


# ============= 会话上下文管理 =============

def load_session_context(session_id: str) -> Dict[str, Any]:
    """
    加载会话上下文（Read-Before-Decide）
    每次AI决策前都应该调用此函数
    """
    file_path = get_session_file_path(session_id)
    
    if os.path.exists(file_path):
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                context = json.load(f)
                logger.info(f"[Context] 加载会话上下文: {session_id}")
                return context
        except Exception as e:
            logger.error(f"[Context] 加载上下文失败: {e}")
    
    # 返回空的初始上下文
    return {
        "session_id": session_id,
        "created_at": datetime.now().isoformat(),
        "last_updated": datetime.now().isoformat(),
        "goal": None,  # 当前目标
        "current_task": None,  # 当前任务
        "task_phases": [],  # 任务阶段
        "current_phase": 0,  # 当前阶段索引
        "completed_actions": [],  # 已完成的操作（追加模式）
        "errors": [],  # 错误记录（保留失败痕迹）
        "notes": [],  # 会话笔记
        "entities": {}  # 提取的实体（商品名、客户名等）
    }


def save_session_context(session_id: str, context: Dict[str, Any]):
    """保存会话上下文"""
    file_path = get_session_file_path(session_id)
    context["last_updated"] = datetime.now().isoformat()
    
    try:
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(context, f, ensure_ascii=False, indent=2)
        logger.info(f"[Context] 保存会话上下文: {session_id}")
    except Exception as e:
        logger.error(f"[Context] 保存上下文失败: {e}")


def update_session_goal(session_id: str, goal: str, phases: List[str] = None):
    """更新会话目标和阶段"""
    context = load_session_context(session_id)
    context["goal"] = goal
    if phases:
        context["task_phases"] = [{"name": p, "status": "pending"} for p in phases]
        context["current_phase"] = 0
    save_session_context(session_id, context)
    return context


def complete_phase(session_id: str, phase_index: int = None):
    """完成当前阶段，进入下一阶段"""
    context = load_session_context(session_id)
    
    idx = phase_index if phase_index is not None else context.get("current_phase", 0)
    
    if context["task_phases"] and idx < len(context["task_phases"]):
        context["task_phases"][idx]["status"] = "completed"
        context["task_phases"][idx]["completed_at"] = datetime.now().isoformat()
        context["current_phase"] = idx + 1
    
    save_session_context(session_id, context)
    return context


def append_action(session_id: str, action: str, result: str = None, success: bool = True):
    """
    追加操作记录（Append-Only Context）
    保持上下文的连贯性
    """
    context = load_session_context(session_id)
    
    action_record = {
        "action": action,
        "result": result,
        "success": success,
        "timestamp": datetime.now().isoformat()
    }
    
    context["completed_actions"].append(action_record)
    
    # 如果失败，同时记录到错误列表
    if not success:
        context["errors"].append({
            "action": action,
            "error": result,
            "timestamp": datetime.now().isoformat()
        })
    
    save_session_context(session_id, context)
    return context


def record_error(session_id: str, error_type: str, error_detail: str, context_info: str = None):
    """
    记录错误（Failure Traces）
    显式保留失败痕迹，避免重复犯错
    """
    context = load_session_context(session_id)
    
    error_record = {
        "type": error_type,
        "detail": error_detail,
        "context": context_info,
        "timestamp": datetime.now().isoformat(),
        "resolved": False
    }
    
    context["errors"].append(error_record)
    save_session_context(session_id, context)
    
    logger.warning(f"[Context] 记录错误: {error_type} - {error_detail}")
    return context


def add_note(session_id: str, note: str, category: str = "general"):
    """添加会话笔记（Knowledge Offloading）"""
    context = load_session_context(session_id)
    
    context["notes"].append({
        "content": note,
        "category": category,
        "timestamp": datetime.now().isoformat()
    })
    
    save_session_context(session_id, context)
    return context


def update_entities(session_id: str, entities: Dict[str, Any]):
    """更新提取的实体信息"""
    context = load_session_context(session_id)
    context["entities"].update(entities)
    save_session_context(session_id, context)
    return context


# ============= 业务知识库 =============

def load_knowledge_base() -> str:
    """
    加载业务规则知识库
    这些规则会在AI决策时被注入到prompt中
    """
    if os.path.exists(KNOWLEDGE_FILE):
        try:
            with open(KNOWLEDGE_FILE, 'r', encoding='utf-8') as f:
                return f.read()
        except Exception as e:
            logger.error(f"[Context] 加载知识库失败: {e}")
    
    return ""


# ============= 上下文摘要生成 =============

def generate_context_summary(session_id: str) -> str:
    """
    生成上下文摘要，用于注入AI prompt
    这是 Read-Before-Decide 的核心实现
    """
    context = load_session_context(session_id)
    
    summary_parts = []
    
    # 1. 当前目标
    if context.get("goal"):
        summary_parts.append(f"【当前目标】{context['goal']}")
    
    # 2. 任务进度
    if context.get("task_phases"):
        phases_status = []
        for i, phase in enumerate(context["task_phases"]):
            status_icon = "✅" if phase["status"] == "completed" else ("🔄" if i == context.get("current_phase", 0) else "⏳")
            phases_status.append(f"{status_icon} {phase['name']}")
        summary_parts.append(f"【任务进度】\n" + "\n".join(phases_status))
    
    # 3. 最近操作（只取最近5条）
    recent_actions = context.get("completed_actions", [])[-5:]
    if recent_actions:
        actions_text = []
        for a in recent_actions:
            icon = "✓" if a.get("success", True) else "✗"
            actions_text.append(f"{icon} {a['action']}")
        summary_parts.append(f"【最近操作】\n" + "\n".join(actions_text))
    
    # 4. 错误记录（重要！避免重复错误）
    unresolved_errors = [e for e in context.get("errors", []) if not e.get("resolved")]
    if unresolved_errors:
        errors_text = [f"⚠️ {e['type']}: {e['detail']}" for e in unresolved_errors[-3:]]
        summary_parts.append(f"【注意！历史错误】\n" + "\n".join(errors_text))
    
    # 5. 记住的实体
    entities = context.get("entities", {})
    if entities:
        entities_text = [f"- {k}: {v}" for k, v in entities.items() if v]
        if entities_text:
            summary_parts.append(f"【记住的信息】\n" + "\n".join(entities_text))
    
    if not summary_parts:
        return ""
    
    return "\n\n".join(summary_parts)


def build_enhanced_prompt(session_id: str, user_message: str) -> str:
    """
    构建增强的prompt，包含上下文和知识库
    这是整个上下文工程的核心输出
    """
    # 加载会话上下文摘要
    context_summary = generate_context_summary(session_id)
    
    # 加载业务规则
    knowledge = load_knowledge_base()
    
    # 构建增强prompt
    enhanced_parts = []
    
    if knowledge:
        enhanced_parts.append(f"## 业务规则（必须遵守）\n{knowledge}")
    
    if context_summary:
        enhanced_parts.append(f"## 会话上下文\n{context_summary}")
    
    enhanced_parts.append(f"## 用户请求\n{user_message}")
    
    return "\n\n".join(enhanced_parts)


# ============= 清理工具 =============

def clear_session(session_id: str):
    """清除会话上下文"""
    file_path = get_session_file_path(session_id)
    if os.path.exists(file_path):
        os.remove(file_path)
        logger.info(f"[Context] 清除会话: {session_id}")


def list_sessions() -> List[str]:
    """列出所有会话"""
    ensure_context_dir()
    sessions = []
    for f in os.listdir(CONTEXT_DIR):
        if f.startswith("session_") and f.endswith(".json"):
            sessions.append(f[8:-5])  # 提取session_id
    return sessions

