#!/usr/bin/env python3
# backend/scripts/init_pinecone.py
"""
Pinecone 索引初始化脚本

用途：
1. 创建 Pinecone 索引（仅需执行一次）
2. 验证连接是否正常

使用方法：
    cd backend
    python scripts/init_pinecone.py
    
环境变量要求：
    - PINECONE_API_KEY: Pinecone API 密钥
    - PINECONE_INDEX_NAME: 索引名称（可选，默认 jewelry-erp-decisions）
"""

import os
import sys
import time

# 添加项目根目录到路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

# 加载环境变量
load_dotenv()

# 配置
PINECONE_API_KEY = os.getenv("PINECONE_API_KEY")
PINECONE_INDEX_NAME = os.getenv("PINECONE_INDEX_NAME", "jewelry-erp-decisions")
PINECONE_CLOUD = os.getenv("PINECONE_CLOUD", "aws")
PINECONE_REGION = os.getenv("PINECONE_REGION", "us-east-1")

# Embedding 维度（text-embedding-3-small）
EMBEDDING_DIMENSION = 1536


def check_environment():
    """检查环境变量配置"""
    print("=" * 60)
    print("  Pinecone 索引初始化脚本")
    print("=" * 60)
    print()
    
    if not PINECONE_API_KEY:
        print("❌ 错误：未配置 PINECONE_API_KEY 环境变量")
        print()
        print("请在 .env 文件中添加：")
        print("  PINECONE_API_KEY=your_api_key_here")
        print()
        print("获取 API Key：")
        print("  1. 访问 https://www.pinecone.io/")
        print("  2. 注册/登录账号")
        print("  3. 在控制台获取 API Key")
        return False
    
    print(f"✓ PINECONE_API_KEY: {PINECONE_API_KEY[:8]}...{PINECONE_API_KEY[-4:]}")
    print(f"✓ PINECONE_INDEX_NAME: {PINECONE_INDEX_NAME}")
    print(f"✓ PINECONE_CLOUD: {PINECONE_CLOUD}")
    print(f"✓ PINECONE_REGION: {PINECONE_REGION}")
    print(f"✓ EMBEDDING_DIMENSION: {EMBEDDING_DIMENSION}")
    print()
    
    return True


def create_index():
    """创建 Pinecone 索引"""
    try:
        from pinecone import Pinecone, ServerlessSpec
    except ImportError:
        print("❌ 错误：未安装 pinecone-client")
        print()
        print("请运行：")
        print("  pip install pinecone-client>=3.0.0")
        return False
    
    print("正在连接 Pinecone...")
    pc = Pinecone(api_key=PINECONE_API_KEY)
    
    # 检查索引是否已存在
    existing_indexes = pc.list_indexes()
    index_names = [idx.name for idx in existing_indexes]
    
    if PINECONE_INDEX_NAME in index_names:
        print(f"✓ 索引 '{PINECONE_INDEX_NAME}' 已存在")
        
        # 获取索引信息
        index = pc.Index(PINECONE_INDEX_NAME)
        stats = index.describe_index_stats()
        
        print()
        print("索引统计信息：")
        print(f"  - 维度: {stats.get('dimension', 'N/A')}")
        print(f"  - 总向量数: {stats.get('total_vector_count', 0)}")
        print(f"  - 命名空间: {list(stats.get('namespaces', {}).keys())}")
        
        return True
    
    # 创建新索引
    print(f"正在创建索引 '{PINECONE_INDEX_NAME}'...")
    print(f"  - 维度: {EMBEDDING_DIMENSION}")
    print(f"  - 相似度: cosine")
    print(f"  - 云服务: {PINECONE_CLOUD} / {PINECONE_REGION}")
    
    try:
        pc.create_index(
            name=PINECONE_INDEX_NAME,
            dimension=EMBEDDING_DIMENSION,
            metric="cosine",
            spec=ServerlessSpec(
                cloud=PINECONE_CLOUD,
                region=PINECONE_REGION
            )
        )
        
        # 等待索引就绪
        print()
        print("正在等待索引就绪...")
        max_wait = 60  # 最多等待60秒
        for i in range(max_wait):
            try:
                index = pc.Index(PINECONE_INDEX_NAME)
                stats = index.describe_index_stats()
                print(f"✓ 索引 '{PINECONE_INDEX_NAME}' 创建成功！")
                return True
            except Exception:
                print(f"  等待中... ({i+1}/{max_wait}秒)")
                time.sleep(1)
        
        print("⚠ 索引创建中，可能需要几分钟才能完全就绪")
        return True
        
    except Exception as e:
        print(f"❌ 创建索引失败: {e}")
        return False


def test_connection():
    """测试连接"""
    try:
        from pinecone import Pinecone
    except ImportError:
        return False
    
    print()
    print("测试连接...")
    
    try:
        pc = Pinecone(api_key=PINECONE_API_KEY)
        index = pc.Index(PINECONE_INDEX_NAME)
        
        # 测试查询
        test_vector = [0.0] * EMBEDDING_DIMENSION
        results = index.query(
            vector=test_vector,
            top_k=1,
            namespace="test_connection"
        )
        
        print("✓ 连接测试成功！")
        return True
        
    except Exception as e:
        print(f"⚠ 连接测试出现问题: {e}")
        print("  （这可能是正常的，索引刚创建时需要几分钟才能完全就绪）")
        return True  # 不阻断流程


def main():
    """主函数"""
    # 检查环境
    if not check_environment():
        sys.exit(1)
    
    # 创建索引
    if not create_index():
        sys.exit(1)
    
    # 测试连接
    test_connection()
    
    print()
    print("=" * 60)
    print("  初始化完成！")
    print("=" * 60)
    print()
    print("后续步骤：")
    print("  1. 确保 .env 中配置了 OPENAI_API_KEY（用于生成 Embedding）")
    print("  2. 重启后端服务")
    print("  3. 行为记录器服务将自动工作")
    print()


if __name__ == "__main__":
    main()

