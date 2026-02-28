import logging
from typing import Iterable, Set

from sqlalchemy import String, Text, Unicode, UnicodeText


logger = logging.getLogger(__name__)

# Obvious mojibake glyphs from UTF-8 mis-decoding or replacement char
OBVIOUS_BAD_CHARS: Set[str] = {
    "\ufffd",  # replacement char
    "Ã",
    "Â",
    "Ð",
    "Ñ",
    "Ø",
    "Ù",
    "â",
    "€",
    "™",
    "œ",
    "š",
    "ž",
    "©",
    "¤",
}


def _is_cyrillic(ch: str) -> bool:
    return "\u0400" <= ch <= "\u04FF"


def sanitize_text(value: str) -> str:
    if value is None or not isinstance(value, str) or value == "":
        return value
    cleaned = "".join(
        ch for ch in value if ch not in OBVIOUS_BAD_CHARS and not _is_cyrillic(ch)
    )
    return cleaned


def sanitize_instance_text_fields(instance, excluded_tables: Iterable[str]) -> None:
    table_name = getattr(instance, "__tablename__", None)
    if not table_name or table_name in excluded_tables:
        return

    for column in instance.__table__.columns:
        if not isinstance(column.type, (String, Text, Unicode, UnicodeText)):
            continue
        attr_name = column.key
        raw_value = getattr(instance, attr_name, None)
        if raw_value is None or not isinstance(raw_value, str):
            continue
        cleaned = sanitize_text(raw_value)
        if cleaned != raw_value:
            setattr(instance, attr_name, cleaned)
            logger.warning(
                "Sanitized mojibake text",
                extra={
                    "table": table_name,
                    "column": attr_name,
                },
            )


def sanitize_session_instances(session) -> None:
    excluded_tables = {
        "chat_logs",
        "chat_session_meta",
        "audit_logs",
        "balance_change_logs",
        "behavior_decision_logs",
    }
    for instance in list(session.new) + list(session.dirty):
        sanitize_instance_text_fields(instance, excluded_tables)
