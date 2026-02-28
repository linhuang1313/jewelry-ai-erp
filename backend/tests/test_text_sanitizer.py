from backend.app.utils.text_sanitizer import sanitize_text


def test_sanitize_text_removes_mojibake_chars() -> None:
    assert sanitize_text("小林�") == "小林"
    assert sanitize_text("客Ã户") == "客户"
    assert sanitize_text("С小林") == "小林"


def test_sanitize_text_keeps_normal_text() -> None:
    assert sanitize_text("深圳客户A-01") == "深圳客户A-01"
