# 中文字体说明

此目录用于存放PDF生成所需的中文字体文件。

## 推荐字体

为了确保PDF中的中文正常显示，请将以下任一字体文件放入此目录：

### 选项1：SimHei（黑体）
- 文件名：`simhei.ttf`
- 来源：Windows系统字体（C:/Windows/Fonts/simhei.ttf）
- 优点：清晰易读

### 选项2：SimSun（宋体）
- 文件名：`simsun.ttc`
- 来源：Windows系统字体（C:/Windows/Fonts/simsun.ttc）
- 优点：传统美观

### 选项3：Noto Sans CJK（开源）
- 文件名：`NotoSansCJK-Regular.ttf`
- 来源：https://www.google.com/get/noto/
- 优点：开源免费，跨平台

## 使用方法

1. 将字体文件复制到此目录（`backend/app/fonts/`）
2. 重启应用
3. PDF生成时会自动使用该字体

## 注意事项

- 如果没有字体文件，PDF仍会生成，但中文内容可能显示为方块或乱码
- 标签文字会始终使用中文，即使没有中文字体
- 系统会自动尝试多个字体路径，包括项目内字体和系统字体


