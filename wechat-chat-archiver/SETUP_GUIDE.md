# 企业微信会话内容存档 - 开通配置指南

本指南帮助您在企业微信后台开通会话内容存档功能，并配置必要的API参数。

## 一、开通会话内容存档功能

### 1.1 登录企业微信管理后台

1. 使用**超级管理员**账号登录 [企业微信管理后台](https://work.weixin.qq.com/wework_admin/frame)
2. 确保您的企业已完成认证

### 1.2 开通功能

1. 进入 **管理工具** → **会话内容存档**
2. 点击 **开通功能**
3. 下载《确认函》模板，打印后加盖企业公章
4. 上传盖章后的确认函扫描件
5. 等待审核（通常1-3个工作日）

### 1.3 付费说明

会话内容存档是付费功能，按存档员工数计费。请联系企业微信商务了解具体价格。

---

## 二、配置API安全参数

功能开通后，需要配置以下参数：

### 2.1 获取企业ID (CorpID)

1. 进入 **我的企业** → **企业信息**
2. 在页面底部找到 **企业ID**，复制保存

### 2.2 获取会话存档Secret

1. 进入 **管理工具** → **会话内容存档** → **API**
2. 点击 **查看** Secret，复制保存

### 2.3 配置可信IP

1. 在会话内容存档配置页面，找到 **可信IP**
2. 添加您服务器的公网IP地址
3. 如果是本地开发，可以先添加本机出口IP

### 2.4 生成RSA密钥对

运行以下命令生成RSA密钥对：

```bash
# 生成私钥
openssl genrsa -out private_key.pem 2048

# 从私钥导出公钥
openssl rsa -in private_key.pem -pubout -out public_key.pem
```

或者使用Python生成：

```python
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.backends import default_backend

# 生成私钥
private_key = rsa.generate_private_key(
    public_exponent=65537,
    key_size=2048,
    backend=default_backend()
)

# 保存私钥
with open("private_key.pem", "wb") as f:
    f.write(private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption()
    ))

# 保存公钥
public_key = private_key.public_key()
with open("public_key.pem", "wb") as f:
    f.write(public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo
    ))
```

### 2.5 上传公钥

1. 在会话内容存档配置页面，找到 **消息加密公钥**
2. 点击 **添加公钥**
3. 上传生成的 `public_key.pem` 文件内容
4. 记录返回的 **版本号**（用于配置文件）

### 2.6 配置存档成员范围

1. 在会话内容存档配置页面，找到 **存档成员范围**
2. 选择需要存档聊天记录的员工/部门
3. 保存配置

> ⚠️ **重要**: 只有在配置范围内的成员，其聊天记录才会被存档

---

## 三、配置智能表格（可选）

如果要将聊天记录写入智能表格，还需要以下配置：

### 3.1 创建自建应用

1. 进入 **应用管理** → **自建应用** → **创建应用**
2. 填写应用名称（如"聊天存档服务"）
3. 设置可见范围
4. 创建后获取 **AgentId** 和 **Secret**

### 3.2 配置应用权限

在应用设置页面，开启以下权限：
- 文档管理
- 智能表格

### 3.3 创建智能表格

1. 在企业微信客户端或网页版创建智能表格
2. 创建以下列：
   | 列名 | 类型 |
   |------|------|
   | 时间 | 日期时间 |
   | 发送者 | 文本 |
   | 接收者/群名 | 文本 |
   | 消息类型 | 文本 |
   | 内容 | 文本 |
   | 会话类型 | 文本 |

3. 获取表格的 **文档ID** 和 **Sheet ID**
   - 打开表格，从URL中获取docid参数

---

## 四、配置环境变量

1. 复制 `.env.example` 为 `.env`
2. 填入上述获取的所有参数：

```bash
cp config/.env.example .env
```

编辑 `.env` 文件：

```ini
WECOM_CORP_ID=your_corp_id
WECOM_CHAT_SECRET=your_chat_secret
WECOM_PRIVATE_KEY_PATH=./config/private_key.pem
WECOM_PUBLIC_KEY_VERSION=1
WECOM_AGENT_ID=your_agent_id
WECOM_APP_SECRET=your_app_secret
WECOM_SHEET_DOC_ID=your_doc_id
WECOM_SHEET_ID=your_sheet_id
```

3. 将私钥文件 `private_key.pem` 放到 `config/` 目录下

---

## 五、验证配置

配置完成后，运行以下命令验证：

```bash
python -m wechat_chat_archiver.verify_config
```

如果配置正确，将显示：
```
✓ 企业ID配置正确
✓ Secret配置正确
✓ 私钥文件存在
✓ 成功获取access_token
✓ 配置验证通过！
```

---

## 常见问题

### Q: 看不到"会话内容存档"入口？
A: 该功能可能未对您的企业开放，请联系企业微信商务咨询。

### Q: 提交确认函后多久审核通过？
A: 通常1-3个工作日，如超时请联系客服。

### Q: 可以获取历史消息吗？
A: 不能。只能获取开通存档功能后的新消息。

### Q: 外部联系人的消息可以存档吗？
A: 可以，但需要额外配置，且需要告知外部联系人。本服务目前只支持内部员工消息。

