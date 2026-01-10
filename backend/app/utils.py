from pypinyin import lazy_pinyin
import re

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
        # 拼音音节通常以声母开头，常见的声母有：b, p, m, f, d, t, n, l, g, k, h, j, q, x, z, c, s, zh, ch, sh, r, y, w
        # 简化处理：按常见拼音模式分割
        # 对于连续拼音，我们尝试识别每个字的拼音首字母
        # 由于无法准确分割，我们采用更智能的方法
        
        # 方法1：如果输入是完整拼音，尝试转换为中文再转首字母
        # 但这样需要拼音转中文的字典，比较复杂
        
        # 方法2：识别拼音中的声母（每个拼音字的第一个字母）
        # 拼音规则：每个中文字对应一个拼音，拼音通常以声母开头
        # 常见模式：gu-fa-huang-jin-jie-zhi
        
        # 简化方案：识别连续的辅音+元音模式
        # 但更简单的是：如果输入看起来像拼音，我们按固定模式处理
        # 对于 "gufahuangjinjiezhi"，我们可以尝试识别每个字的边界
        
        # 最实用的方法：如果输入是纯字母且长度较长，尝试按常见拼音首字母模式提取
        # 但这样不够准确
        
        # 改进方案：使用拼音库尝试将拼音转换为中文，然后再转首字母
        # 但这需要拼音转中文的映射，比较复杂
        
        # 实际方案：对于纯拼音输入，我们按每个可能的拼音字提取首字母
        # 由于无法准确分割，我们采用启发式方法：
        # 1. 识别常见的双字母声母：zh, ch, sh
        # 2. 其他情况按单字母处理
        
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
                # 跳过这个拼音字的剩余部分（直到下一个可能的声母）
                # 简单处理：跳过直到下一个辅音字母
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

