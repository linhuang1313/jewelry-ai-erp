import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../config';
import {
  Users, Plus, Trash2, Edit2, Check, X, RefreshCw, Phone, User
} from 'lucide-react';
import toast from 'react-hot-toast';

interface Salesperson {
  id: number;
  name: string;
  phone: string | null;
  status: string;
  create_time: string;
  remark: string | null;
}

export const SalespersonPage: React.FC = () => {
  const [salespersons, setSalespersons] = useState<Salesperson[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');
  const [adding, setAdding] = useState(false);

  // 获取业务员列表
  const fetchSalespersons = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/salespersons`);
      const data = await response.json();
      if (data.success) {
        setSalespersons(data.salespersons || []);
      } else {
        toast.error(data.message || '获取业务员列表失败');
      }
    } catch (error) {
      toast.error('网络错误，请检查后端服务');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSalespersons();
  }, []);

  // 添加业务员
  const handleAdd = async () => {
    if (!newName.trim()) {
      toast.error('请输入业务员姓名');
      return;
    }

    setAdding(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/salespersons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), phone: newPhone.trim() || null }),
      });
      const data = await response.json();
      if (data.success) {
        toast.success(data.message || '添加成功');
        setNewName('');
        setNewPhone('');
        fetchSalespersons();
      } else {
        toast.error(data.message || '添加失败');
      }
    } catch (error) {
      toast.error('网络错误');
    } finally {
      setAdding(false);
    }
  };

  // 删除业务员
  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`确定要删除业务员【${name}】吗？`)) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/salespersons/${id}`, {
        method: 'DELETE',
      });
      const data = await response.json();
      if (data.success) {
        toast.success(data.message || '删除成功');
        fetchSalespersons();
      } else {
        toast.error(data.message || '删除失败');
      }
    } catch (error) {
      toast.error('网络错误');
    }
  };

  // 开始编辑
  const startEdit = (sp: Salesperson) => {
    setEditingId(sp.id);
    setEditingName(sp.name);
  };

  // 保存编辑
  const saveEdit = async (id: number) => {
    if (!editingName.trim()) {
      toast.error('姓名不能为空');
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/salespersons/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editingName.trim() }),
      });
      const data = await response.json();
      if (data.success) {
        toast.success('修改成功');
        setEditingId(null);
        fetchSalespersons();
      } else {
        toast.error(data.message || '修改失败');
      }
    } catch (error) {
      toast.error('网络错误');
    }
  };

  // 取消编辑
  const cancelEdit = () => {
    setEditingId(null);
    setEditingName('');
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* 标题 */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-3">
          <div className="p-3 bg-purple-100 rounded-xl">
            <Users className="w-6 h-6 text-purple-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">业务员管理</h1>
            <p className="text-sm text-gray-500">管理系统中的业务员信息</p>
          </div>
        </div>
        <button
          onClick={fetchSalespersons}
          className="flex items-center space-x-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-xl
                     hover:bg-gray-200 transition-all"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span>刷新</span>
        </button>
      </div>

      {/* 添加新业务员 */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center">
          <Plus className="w-5 h-5 mr-2 text-green-600" />
          添加新业务员
        </h2>
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <label className="block text-sm text-gray-600 mb-1">姓名 *</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="请输入业务员姓名"
                className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-xl focus:outline-none 
                           focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                onKeyPress={(e) => e.key === 'Enter' && handleAdd()}
              />
            </div>
          </div>
          <div className="flex-1">
            <label className="block text-sm text-gray-600 mb-1">电话（可选）</label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="请输入电话号码"
                className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-xl focus:outline-none 
                           focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                onKeyPress={(e) => e.key === 'Enter' && handleAdd()}
              />
            </div>
          </div>
          <div className="flex items-end">
            <button
              onClick={handleAdd}
              disabled={adding || !newName.trim()}
              className="px-6 py-2.5 bg-purple-600 text-white rounded-xl hover:bg-purple-700 
                         transition-all disabled:bg-gray-300 disabled:cursor-not-allowed
                         flex items-center space-x-2"
            >
              <Plus className="w-4 h-4" />
              <span>{adding ? '添加中...' : '添加'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* 业务员列表 */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
          <h2 className="text-lg font-semibold text-gray-800">
            业务员列表 ({salespersons.length}人)
          </h2>
        </div>

        {loading ? (
          <div className="p-12 text-center text-gray-500">
            <RefreshCw className="w-8 h-8 mx-auto mb-3 animate-spin text-purple-500" />
            <p>加载中...</p>
          </div>
        ) : salespersons.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <Users className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p>暂无业务员数据</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {salespersons.map((sp, index) => (
              <div
                key={sp.id}
                className="px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center space-x-4">
                  <div className="w-10 h-10 bg-gradient-to-br from-purple-400 to-purple-600 
                                  rounded-full flex items-center justify-center text-white font-bold">
                    {index + 1}
                  </div>
                  <div>
                    {editingId === sp.id ? (
                      <input
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        className="px-3 py-1.5 border border-purple-300 rounded-lg focus:outline-none 
                                   focus:ring-2 focus:ring-purple-500 text-lg font-medium"
                        autoFocus
                        onKeyPress={(e) => e.key === 'Enter' && saveEdit(sp.id)}
                      />
                    ) : (
                      <div className="text-lg font-medium text-gray-900">{sp.name}</div>
                    )}
                    <div className="text-sm text-gray-500">
                      {sp.phone || '未填写电话'} · 创建于 {new Date(sp.create_time).toLocaleDateString('zh-CN')}
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  {editingId === sp.id ? (
                    <>
                      <button
                        onClick={() => saveEdit(sp.id)}
                        className="p-2 bg-green-100 text-green-600 rounded-lg hover:bg-green-200 transition-colors"
                        title="保存"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="p-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors"
                        title="取消"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => startEdit(sp)}
                        className="p-2 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 transition-colors"
                        title="编辑"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(sp.id, sp.name)}
                        className="p-2 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 transition-colors"
                        title="删除"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 提示信息 */}
      <div className="mt-6 p-4 bg-purple-50 rounded-xl border border-purple-100">
        <p className="text-sm text-purple-800">
          💡 <strong>提示：</strong>删除业务员不会影响历史销售单记录。业务员信息用于开单时自动匹配和下拉选择。
        </p>
      </div>
    </div>
  );
};

export default SalespersonPage;

