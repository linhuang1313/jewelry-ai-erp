# -*- coding: utf-8 -*-
"""共享 pytest fixtures 和 markers"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from app.agents.settlement_agent import SettlementAgent
from app.agents.registry import AgentRegistry


@pytest.fixture
def agent():
    return SettlementAgent()


@pytest.fixture
def fresh_registry():
    AgentRegistry._instance = None
    reg = AgentRegistry()
    yield reg
    AgentRegistry._instance = None


SKIP_NO_API_KEY = pytest.mark.skipif(
    not os.getenv("DEEPSEEK_API_KEY"),
    reason="DEEPSEEK_API_KEY not set",
)
