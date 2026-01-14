"""
拼音处理工具函数
"""
from pypinyin import lazy_pinyin


def to_pinyin_initials(text: str) -> str:
    """
    将中文或拼音转换为拼音首字母大写
    支持：
    - 中文：古法黄金戒指 -> GFHJJZ
    - 拼音：gufahuangjinjiezhi -> GFHJJZ
    - 混合：古法huangjin戒指 -> GFHJJZ
    """
    if not text or not isinstance(text, str):
        return text
    
    # 如果全是英文字母（可能是拼音），尝试按拼音规则分割
    if text.replace(' ', '').isalpha() and not any('\u4e00' <= c <= '\u9fff' for c in text):
        # 纯拼音输入，尝试识别拼音音节
        result = []
        i = 0
        text_lower = text.lower().replace(' ', '')
        
        while i < len(text_lower):
            # 检查是否是双字母声母
            if i + 1 < len(text_lower):
                two_char = text_lower[i:i+2]
                if two_char in ['zh', 'ch', 'sh']:
                    result.append(two_char[0].upper())
                    i += 2
                    continue
            
            # 单字母声母
            if text_lower[i].isalpha():
                result.append(text_lower[i].upper())
                i += 1
                # 跳过元音部分，直到下一个可能的声母
                while i < len(text_lower) and text_lower[i] in 'aeiou':
                    i += 1
            else:
                i += 1
        
        return ''.join(result) if result else text.upper()
    
    # 处理中文或混合输入
    result = []
    i = 0
    while i < len(text):
        char = text[i]
        
        # 如果是中文字符
        if '\u4e00' <= char <= '\u9fff':
            # 获取该字的拼音首字母
            pinyin = lazy_pinyin(char)
            if pinyin and pinyin[0]:
                result.append(pinyin[0][0].upper())
            i += 1
        # 如果是英文字母
        elif char.isalpha():
            # 提取连续的字母（可能是拼音单词）
            word = ''
            while i < len(text) and text[i].isalpha():
                word += text[i]
                i += 1
            
            # 对于拼音单词，提取首字母
            if word:
                result.append(word[0].upper())
        else:
            # 跳过非字母非中文字符
            i += 1
    
    return ''.join(result)


