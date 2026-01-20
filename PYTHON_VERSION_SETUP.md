# Python 版本配置说明

## 已完成的配置

### 1. Python Launcher 配置
- ✅ 已创建 `py.ini` 配置文件，将 `py` 命令的默认版本设置为 Python 3.10
- 位置：`C:\Users\hlin2\AppData\Local\py.ini`
- 验证：运行 `py --version` 应显示 Python 3.10.11

### 2. 项目配置
- ✅ 已创建 `.python-version` 文件，指定项目使用 Python 3.10
- 位置：项目根目录

### 3. PowerShell 配置文件
- ✅ 已创建 PowerShell 配置文件，每次打开 PowerShell 时自动将 Python 3.10 设为默认
- 位置：`C:\Users\hlin2\Documents\WindowsPowerShell\Microsoft.PowerShell_profile.ps1`
- 效果：在 PowerShell 中，`python` 命令会优先使用 Python 3.10

### 4. 用户 PATH 环境变量
- ✅ 已优化用户 PATH，将 Python 3.10 路径放在最前面

## 当前状态

- ✅ `py` 命令 → Python 3.10.11（默认）
- ✅ `py -3.10` → Python 3.10.11
- ✅ PowerShell 中的 `python` 命令 → Python 3.10.11
- ⚠️ 系统 PATH 中的 Python 3.14 仍然存在（需要管理员权限才能移除）

## 永久性系统级更改（可选）

如果需要永久性地从系统 PATH 中移除 Python 3.14，需要以**管理员身份**运行：

```powershell
# 方法1：以管理员身份运行 PowerShell，然后执行
PowerShell -ExecutionPolicy Bypass -File set_python310_default.ps1

# 方法2：手动修改系统环境变量
# 1. 右键"此电脑" → 属性 → 高级系统设置 → 环境变量
# 2. 在"系统变量"中找到 Path，编辑
# 3. 删除包含 Python314 的路径
# 4. 确保 Python 3.10 路径在用户 PATH 的最前面
```

## 验证配置

运行以下命令验证：

```powershell
# 检查 Python 版本
python --version    # 应显示 Python 3.10.11
py --version        # 应显示 Python 3.10.11

# 检查 Python 路径
where.exe python    # 应指向 Python 3.10 的路径

# 检查 py launcher 配置
py -0               # 查看所有已安装的 Python 版本
```

## 注意事项

1. **PowerShell 配置文件**：每次打开新的 PowerShell 窗口时，会自动设置 Python 3.10 为默认
2. **CMD 命令提示符**：CMD 中可能仍会使用系统 PATH 中的 Python 3.14，因为 CMD 不会加载 PowerShell 配置文件
3. **项目启动脚本**：`backend/start_server.bat` 和 `backend/start_server.ps1` 已明确指定使用 `py -3.10`，确保项目使用正确的版本

## 临时设置（当前会话）

如果需要临时设置当前会话的 Python 版本，可以运行：

```powershell
. .\set_python310.ps1
```








