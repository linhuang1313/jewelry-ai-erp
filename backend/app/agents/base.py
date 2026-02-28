"""BaseAgent — 所有角色 Agent 的抽象基类

每个角色 Agent 必须实现：
  - role_id: 角色标识（如 "settlement"）
  - role_name: 角色中文名（如 "结算专员"）
  - system_prompt: 角色专属的系统 Prompt
  - skill_names: 该角色拥有的 Skill 名称列表
  - classify(): 对用户输入进行意图分类
  - get_allowed_actions(): 返回该角色可执行的动作列表
  - get_data_access(): 返回该角色可访问的数据类型列表

BaseAgent 提供默认实现：
  - skills: 从 SkillRegistry 获取 Skill 实例
  - get_prompt(): 根据分类结果委托给对应 Skill
  - _fallback_classify(): AI 兜底分类（基于 skills 列表自动生成 prompt）
"""

from abc import ABC, abstractmethod
from typing import Dict, List, Optional, Any
import logging

logger = logging.getLogger(__name__)


class BaseAgent(ABC):
    """角色 Agent 抽象基类"""

    skill_names: List[str] = []

    @property
    @abstractmethod
    def role_id(self) -> str:
        """角色标识，如 'settlement'"""
        ...

    @property
    @abstractmethod
    def role_name(self) -> str:
        """角色中文名，如 '结算专员'"""
        ...

    @property
    @abstractmethod
    def system_prompt(self) -> str:
        """角色专属系统 Prompt（注入 LLM 的 system message）"""
        ...

    @property
    def skills(self):
        """从 SkillRegistry 获取该 Agent 的 Skill 实例列表"""
        from .skills.skill_registry import skill_registry
        return skill_registry.get_by_names(self.skill_names)

    @abstractmethod
    def classify(self, message: str, conversation_history: Optional[List[dict]] = None) -> str:
        """对用户输入进行意图分类，返回 category 字符串。"""
        ...

    def get_prompt(self, category: str, message: str, context: str) -> str:
        """根据分类结果委托给对应 Skill 生成 Prompt。

        子类可以 override 来处理特殊情况（如 SettlementAgent 的 sales 只读 prompt）。
        """
        for skill in self.skills:
            if skill.name == category:
                return skill.get_prompt(message, context, self.role_name, self.system_prompt)
        if self.skills:
            return self.skills[0].get_prompt(message, context, self.role_name, self.system_prompt)
        return f"{self.system_prompt}\n用户输入：{message}"

    @abstractmethod
    def get_allowed_actions(self) -> List[str]:
        """返回该角色可执行的动作列表。"""
        ...

    @abstractmethod
    def get_data_access(self) -> List[str]:
        """返回该角色可访问的数据类型列表。"""
        ...

    def can_handle(self, action: str) -> bool:
        """判断该 Agent 是否能处理某个 action"""
        return action in self.get_allowed_actions()

    def _fallback_classify(self, message: str, conversation_history: Optional[List[dict]] = None) -> str:
        """AI 兜底分类 — 基于 skills 列表自动生成分类 prompt。

        当关键词/正则匹配都无法确定意图时，调用 LLM 做轻量级分类。
        子类可以 override 来自定义 fallback 提示语。
        """
        context_str = ""
        if conversation_history:
            context_str = "最近对话：\n"
            for h in conversation_history[-4:]:
                role = "用户" if h.get("role") == "user" else "系统"
                context_str += f"  {role}: {h.get('content', '')[:150]}\n"
            context_str += "\n"

        skill_list = "\n".join(f"- {s.name}（{s.display_name}）" for s in self.skills)
        prompt = f"""用户是珠宝ERP系统的**{self.role_name}**，请判断这句话属于以下哪个类别：
{skill_list}

{context_str}用户消息：「{message}」

只返回类别名称，不要解释。"""

        try:
            from ..ai_parser import get_client
            response = get_client().chat.completions.create(
                model="deepseek-chat",
                max_tokens=20,
                temperature=0.0,
                messages=[{"role": "user", "content": prompt}]
            )
            result = response.choices[0].message.content.strip().lower()
            valid = {s.name for s in self.skills}
            if result in valid:
                logger.info(f"[{self.__class__.__name__}] AI 兜底分类: '{message[:30]}...' → {result}")
                return result
            return "system"
        except Exception as e:
            logger.warning(f"[{self.__class__.__name__}] AI 兜底分类失败: {e}")
            return "system"

    def __repr__(self) -> str:
        return f"<{self.__class__.__name__} role={self.role_id}>"
