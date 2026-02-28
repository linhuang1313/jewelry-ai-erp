import React, { useState, useEffect, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import ConfirmationDialog from './ui/ConfirmationDialog';


// ==================== Types ====================

interface LabelElement {
  id: string;
  type: 'barcode' | 'text';
  name: string;
  contentTemplate: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  bold: boolean;
  visible: boolean;
  angle: number;
}

interface LabelTemplate {
  id: string;
  name: string;
  paperWidth: number;
  paperHeight: number;
  elements: LabelElement[];
  updatedAt: string;
}

interface LabelDesignPageProps {
  userRole: string;
  onBack: () => void;
}

// ==================== Constants ====================

const SCALE = 12; // 1mm = 12px on screen
const STORAGE_KEY = 'jewelry_label_templates';
const ACTIVE_TEMPLATE_KEY = 'jewelry_active_template_id';

const SAMPLE_DATA = {
  barcode: 'F00147550',
  productName: '足金5D钻石挂坠',
  goldWeight: 2.59,
  laborCost: 35.0,
  pieceLaborCost: 830.0,
  mainStone: '0.01/1p',
  sideStone: '0.13/43p',
};

function createDefaultTemplate(): LabelTemplate {
  return {
    id: 'default',
    name: '珠宝吊牌标签',
    paperWidth: 75,
    paperHeight: 30,
    updatedAt: new Date().toISOString(),
    elements: [
      {
        id: 'barcode',
        type: 'barcode',
        name: '条形码',
        contentTemplate: '{barcode}',
        x: 2, y: 21,
        width: 6, height: 26,
        fontSize: 0,
        bold: false,
        visible: true,
        angle: 270,
      },
      {
        id: 'mainStone',
        type: 'text',
        name: '主石信息',
        contentTemplate: '主石:{mainStone}',
        x: 2, y: 20,
        width: 26, height: 3,
        fontSize: 6,
        bold: false,
        visible: true,
        angle: 270,
      },
      {
        id: 'sideStone',
        type: 'text',
        name: '副石信息',
        contentTemplate: '副石:{sideStone}',
        x: 2, y: 17,
        width: 26, height: 3,
        fontSize: 6,
        bold: false,
        visible: true,
        angle: 270,
      },
      {
        id: 'productName',
        type: 'text',
        name: '商品名称',
        contentTemplate: '{productName}',
        x: 2, y: 12,
        width: 26, height: 3,
        fontSize: 9,
        bold: true,
        visible: true,
        angle: 270,
      },
      {
        id: 'laborCost',
        type: 'text',
        name: '克工费',
        contentTemplate: '工费: {laborCost}/克',
        x: 2, y: 8,
        width: 26, height: 2,
        fontSize: 6,
        bold: false,
        visible: true,
        angle: 270,
      },
      {
        id: 'pieceLaborCost',
        type: 'text',
        name: '件工费',
        contentTemplate: '其他工费: {pieceLaborCost}/件',
        x: 2, y: 6,
        width: 26, height: 2,
        fontSize: 6,
        bold: false,
        visible: true,
        angle: 270,
      },
      {
        id: 'goldWeight',
        type: 'text',
        name: '金重',
        contentTemplate: '金重: {goldWeight}g',
        x: 2, y: 4,
        width: 26, height: 5,
        fontSize: 9,
        bold: true,
        visible: true,
        angle: 270,
      },
    ],
  };
}

function resolveTemplate(template: string, data: Record<string, any>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const val = data[key];
    if (val === undefined || val === null || val === '') return '';
    if (typeof val === 'number') {
      if (key === 'goldWeight') return val < 10 ? val.toFixed(2) : val.toFixed(3);
      if (key === 'laborCost' || key === 'pieceLaborCost') return val.toFixed(2);
    }
    return String(val);
  });
}

// ==================== Component ====================

const LabelDesignPage: React.FC<LabelDesignPageProps> = ({ userRole, onBack }) => {
  const [templates, setTemplates] = useState<LabelTemplate[]>([]);
  const [activeTemplate, setActiveTemplate] = useState<LabelTemplate>(createDefaultTemplate());
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [showTemplateList, setShowTemplateList] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDialog, setConfirmDialog] = useState<{isOpen: boolean, title: string, message: string, onConfirm: () => void, isDestructive?: boolean}>({isOpen: false, title: '', message: '', onConfirm: () => {}});
  const canvasRef = useRef<HTMLDivElement>(null);

  // Load templates from localStorage; ensure default template always exists
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      let list: LabelTemplate[] = stored ? JSON.parse(stored) : [];
      if (!list.find(t => t.id === 'default')) {
        list = [createDefaultTemplate(), ...list];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
      }
      setTemplates(list);
      const activeId = localStorage.getItem(ACTIVE_TEMPLATE_KEY);
      const found = list.find(t => t.id === activeId);
      setActiveTemplate(found || list[0]);
    } catch (e) {
      console.error('Failed to load templates:', e);
    }
  }, []);

  const saveTemplates = useCallback((updatedTemplates: LabelTemplate[]) => {
    setTemplates(updatedTemplates);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedTemplates));
  }, []);

  const saveCurrentTemplate = useCallback(() => {
    const updated = { ...activeTemplate, updatedAt: new Date().toISOString() };
    const existing = templates.findIndex(t => t.id === updated.id);
    let newList: LabelTemplate[];
    if (existing >= 0) {
      newList = [...templates];
      newList[existing] = updated;
    } else {
      newList = [...templates, updated];
    }
    saveTemplates(newList);
    setActiveTemplate(updated);
    localStorage.setItem(ACTIVE_TEMPLATE_KEY, updated.id);
    toast.success('模板已保存');
  }, [activeTemplate, templates, saveTemplates]);

  const createNewTemplate = useCallback(() => {
    const name = newTemplateName.trim() || `模板 ${templates.length + 1}`;
    const template: LabelTemplate = {
      ...createDefaultTemplate(),
      id: `template_${Date.now()}`,
      name,
    };
    const newList = [...templates, template];
    saveTemplates(newList);
    setActiveTemplate(template);
    localStorage.setItem(ACTIVE_TEMPLATE_KEY, template.id);
    setNewTemplateName('');
    setShowTemplateList(false);
    toast.success(`已创建模板: ${name}`);
  }, [newTemplateName, templates, saveTemplates]);

  const deleteTemplate = useCallback((id: string) => {
    setConfirmDialog({
      isOpen: true,
      title: '删除模板',
      message: '确定要删除此模板吗？',
      isDestructive: true,
      onConfirm: () => {
        setConfirmDialog(prev => ({...prev, isOpen: false}));
        const newList = templates.filter(t => t.id !== id);
        saveTemplates(newList);
        if (activeTemplate.id === id) {
          setActiveTemplate(newList[0] || createDefaultTemplate());
        }
        toast.success('模板已删除');
      }
    });
  }, [templates, activeTemplate, saveTemplates]);

  const commitRename = useCallback((id: string) => {
    const trimmed = renameValue.trim();
    if (!trimmed) { setRenamingId(null); return; }
    const newList = templates.map(t => t.id === id ? { ...t, name: trimmed } : t);
    saveTemplates(newList);
    if (activeTemplate.id === id) {
      setActiveTemplate(prev => ({ ...prev, name: trimmed }));
    }
    setRenamingId(null);
    toast.success('已重命名');
  }, [renameValue, templates, activeTemplate, saveTemplates]);

  const updateElement = useCallback((elementId: string, updates: Partial<LabelElement>) => {
    setActiveTemplate(prev => ({
      ...prev,
      elements: prev.elements.map(el =>
        el.id === elementId ? { ...el, ...updates } : el
      ),
    }));
  }, []);

  const addElement = useCallback((type: 'text' | 'barcode') => {
    const id = `el_${Date.now()}`;
    const newEl: LabelElement = {
      id,
      type,
      name: type === 'barcode' ? '新条码' : '新文本',
      contentTemplate: type === 'barcode' ? '{barcode}' : '',
      x: 5,
      y: 5,
      width: type === 'barcode' ? 30 : 20,
      height: type === 'barcode' ? 8 : 4,
      fontSize: 7,
      bold: false,
      visible: true,
      angle: 0,
    };
    setActiveTemplate(prev => ({ ...prev, elements: [...prev.elements, newEl] }));
    setSelectedElementId(id);
  }, []);

  const deleteElement = useCallback((elementId: string) => {
    setActiveTemplate(prev => ({
      ...prev,
      elements: prev.elements.filter(el => el.id !== elementId),
    }));
    if (selectedElementId === elementId) setSelectedElementId(null);
  }, [selectedElementId]);

  const selectedElement = activeTemplate.elements.find(el => el.id === selectedElementId) || null;

  // ==================== Drag Handling ====================

  const handleCanvasMouseDown = useCallback((e: React.MouseEvent, elementId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedElementId(elementId);
    setIsDragging(true);

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const el = activeTemplate.elements.find(el => el.id === elementId);
    if (!el) return;

    // el.y = Lodop "left" → horizontal position, el.x = Lodop "top" → vertical position
    setDragOffset({
      x: e.clientX - rect.left - el.y * SCALE,
      y: e.clientY - rect.top - el.x * SCALE,
    });
  }, [activeTemplate.elements]);

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging || !selectedElementId) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();

    // horizontal → el.y (Lodop "left"), max = paperWidth (75mm)
    const newY = Math.max(0, Math.min(activeTemplate.paperWidth, (e.clientX - rect.left - dragOffset.x) / SCALE));
    // vertical → el.x (Lodop "top"), max = paperHeight (30mm)
    const newX = Math.max(0, Math.min(activeTemplate.paperHeight, (e.clientY - rect.top - dragOffset.y) / SCALE));

    updateElement(selectedElementId, {
      x: Math.round(newX * 2) / 2,
      y: Math.round(newY * 2) / 2,
    });
  }, [isDragging, selectedElementId, dragOffset, activeTemplate.paperHeight, activeTemplate.paperWidth, updateElement]);

  const handleCanvasMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // ==================== Keyboard Arrow Nudge ====================

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedElementId) return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;

      const step = e.shiftKey ? 0.5 : 1;
      let dx = 0, dy = 0;
      switch (e.key) {
        case 'ArrowLeft':  dy = -step; break;
        case 'ArrowRight': dy = step;  break;
        case 'ArrowUp':    dx = -step; break;
        case 'ArrowDown':  dx = step;  break;
        default: return;
      }
      e.preventDefault();
      setActiveTemplate(prev => ({
        ...prev,
        elements: prev.elements.map(el => {
          if (el.id !== selectedElementId) return el;
          return {
            ...el,
            x: Math.max(0, Math.min(prev.paperHeight, Math.round((el.x + dx) * 2) / 2)),
            y: Math.max(0, Math.min(prev.paperWidth, Math.round((el.y + dy) * 2) / 2)),
          };
        }),
      }));
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedElementId]);

  // ==================== Render ====================

  // paperWidth (75mm) = 横轴, paperHeight (30mm) = 纵轴
  const canvasWidth = activeTemplate.paperWidth * SCALE;
  const canvasHeight = activeTemplate.paperHeight * SCALE;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-amber-50/30 to-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className="p-2 hover:bg-white/80 rounded-xl transition-colors"
            >
              <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </button>
            <div className="p-3 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl shadow-lg shadow-purple-200/50">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">标签样式设计</h1>
              <p className="text-gray-500 text-sm">设计珠宝吊牌标签布局，拖拽元素调整位置</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowTemplateList(!showTemplateList)}
              className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors text-sm font-medium"
            >
              模板列表
            </button>
            <button
              onClick={saveCurrentTemplate}
              className="px-4 py-2 bg-gradient-to-r from-amber-500 to-yellow-500 text-white rounded-xl hover:from-amber-600 hover:to-yellow-600 transition-colors shadow-lg shadow-amber-200/50 text-sm font-medium"
            >
              保存模板
            </button>
          </div>
        </div>

        {/* Template List Panel */}
        {showTemplateList && (
          <div className="mb-6 bg-white rounded-2xl shadow-sm p-5 border border-gray-100">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">模板管理</h3>
            <div className="space-y-2 mb-4">
              {templates.length === 0 && (
                <p className="text-gray-400 text-sm py-2">暂无已保存的模板</p>
              )}
              {templates.map(t => (
                <div
                  key={t.id}
                  className={`flex items-center justify-between p-3 rounded-xl cursor-pointer transition-all ${
                    activeTemplate.id === t.id
                      ? 'bg-amber-50 border-2 border-amber-300'
                      : 'bg-gray-50 border-2 border-transparent hover:border-gray-200'
                  }`}
                  onClick={() => {
                    if (renamingId === t.id) return;
                    setActiveTemplate(t);
                    localStorage.setItem(ACTIVE_TEMPLATE_KEY, t.id);
                    setSelectedElementId(null);
                  }}
                >
                  <div className="flex-1 min-w-0">
                    {renamingId === t.id ? (
                      <input
                        type="text"
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') commitRename(t.id); if (e.key === 'Escape') setRenamingId(null); }}
                        onBlur={() => commitRename(t.id)}
                        autoFocus
                        className="px-2 py-1 text-sm border border-purple-300 rounded-lg focus:ring-2 focus:ring-purple-300 focus:outline-none w-48"
                        onClick={e => e.stopPropagation()}
                      />
                    ) : (
                      <>
                        <span className="font-medium text-gray-800">{t.name}</span>
                        <span className="text-xs text-gray-400 ml-3">
                          {new Date(t.updatedAt).toLocaleString('zh-CN')}
                        </span>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 ml-2">
                    {activeTemplate.id === t.id && (
                      <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">当前</span>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setRenamingId(t.id);
                        setRenameValue(t.name);
                      }}
                      className="text-gray-400 hover:text-purple-600 p-1"
                      title="重命名"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteTemplate(t.id); }}
                      className="text-red-400 hover:text-red-600 p-1"
                      title="删除"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 pt-3 border-t border-gray-100">
              <input
                type="text"
                value={newTemplateName}
                onChange={e => setNewTemplateName(e.target.value)}
                placeholder="新模板名称..."
                className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-purple-300 focus:border-transparent"
                onKeyDown={e => e.key === 'Enter' && createNewTemplate()}
              />
              <button
                onClick={createNewTemplate}
                className="px-4 py-2 bg-purple-500 text-white rounded-xl hover:bg-purple-600 transition-colors text-sm font-medium"
              >
                新建模板
              </button>
              <button
                onClick={() => {
                  setActiveTemplate(createDefaultTemplate());
                  setSelectedElementId(null);
                  toast.success('已恢复默认模板');
                }}
                className="px-4 py-2 bg-gray-100 text-gray-600 rounded-xl hover:bg-gray-200 transition-colors text-sm font-medium"
              >
                恢复默认
              </button>
            </div>
          </div>
        )}

        <div>
          {/* Canvas Area */}
          <div className="bg-white rounded-2xl shadow-sm p-6 border border-gray-100">
            {/* Header row: element tabs + template name */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-1.5 flex-wrap">
                {activeTemplate.elements.map(el => (
                  <button
                    key={el.id}
                    onClick={() => setSelectedElementId(el.id === selectedElementId ? null : el.id)}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      el.id === selectedElementId
                        ? 'bg-purple-100 text-purple-700 ring-2 ring-purple-300'
                        : el.visible
                          ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          : 'bg-gray-50 text-gray-400'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${el.visible ? 'bg-green-400' : 'bg-gray-300'}`} />
                    {el.name}
                  </button>
                ))}
                <span className="text-gray-200 mx-0.5">|</span>
                <button
                  onClick={() => addElement('text')}
                  className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium bg-amber-50 text-amber-600 hover:bg-amber-100 transition-all"
                  title="添加文本元素"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                  文本
                </button>
                <button
                  onClick={() => addElement('barcode')}
                  className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium bg-blue-50 text-blue-600 hover:bg-blue-100 transition-all"
                  title="添加条码元素"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                  条码
                </button>
              </div>
              <div className="flex items-center gap-1.5 bg-gray-50 rounded-full pl-3 pr-1 py-1 shrink-0 ml-3">
                <span className="text-xs text-gray-400">模板:</span>
                <input
                  type="text"
                  value={activeTemplate.name}
                  onChange={e => setActiveTemplate(prev => ({ ...prev, name: e.target.value }))}
                  className="text-xs text-gray-600 font-medium bg-transparent border-none focus:outline-none focus:ring-0 w-28 px-0"
                  title="点击编辑模板名称"
                />
              </div>
            </div>

              {/* Label Canvas - shown rotated to match physical tag orientation */}
              <div className="flex justify-center">
                <div className="relative inline-block">
                  {/* Physical label outline */}
                  <div
                    ref={canvasRef}
                    className="relative border-2 border-dashed border-gray-300 bg-white rounded-sm cursor-crosshair select-none"
                    style={{
                      width: canvasWidth,
                      height: canvasHeight,
                      background: `repeating-linear-gradient(0deg, transparent, transparent ${SCALE * 5 - 1}px, #f0f0f0 ${SCALE * 5 - 1}px, #f0f0f0 ${SCALE * 5}px), repeating-linear-gradient(90deg, transparent, transparent ${SCALE * 5 - 1}px, #f0f0f0 ${SCALE * 5 - 1}px, #f0f0f0 ${SCALE * 5}px)`,
                    }}
                    onMouseMove={handleCanvasMouseMove}
                    onMouseUp={handleCanvasMouseUp}
                    onMouseLeave={handleCanvasMouseUp}
                    onClick={() => { if (!isDragging) setSelectedElementId(null); }}
                  >
                    {/* Mm rulers: horizontal = paperWidth(75mm), vertical = paperHeight(30mm) */}
                    <div className="absolute top-0 left-0 w-full h-full pointer-events-none">
                      {Array.from({ length: Math.floor(activeTemplate.paperWidth) + 1 }, (_, i) => (
                        i % 5 === 0 && (
                          <div key={`rx-${i}`} className="absolute" style={{ left: i * SCALE - 4, top: -16 }}>
                            <span className="text-[10px] text-gray-400 font-mono">{i}</span>
                          </div>
                        )
                      ))}
                      {Array.from({ length: Math.floor(activeTemplate.paperHeight) + 1 }, (_, i) => (
                        i % 5 === 0 && (
                          <div key={`ry-${i}`} className="absolute" style={{ top: i * SCALE - 6, left: -22 }}>
                            <span className="text-[10px] text-gray-400 font-mono">{i}</span>
                          </div>
                        )
                      ))}
                    </div>

                    {/* Render elements */}
                    {activeTemplate.elements.filter(el => el.visible).map(el => {
                      const isSelected = el.id === selectedElementId;
                      const content = resolveTemplate(el.contentTemplate, SAMPLE_DATA);
                      if (!content && el.type === 'text') return null;

                      const elLeft = el.y * SCALE;
                      const elTop = el.x * SCALE;
                      // barcode 的 Lodop width/height 含义与文本不同，显示时需要互换
                      const elWidth = (el.type === 'barcode' ? el.height : el.width) * SCALE;
                      const elHeight = (el.type === 'barcode' ? el.width : el.height) * SCALE;

                      return (
                        <div
                          key={el.id}
                          className={`absolute ${
                            isSelected
                              ? 'z-20'
                              : 'z-10'
                          }`}
                          style={{
                            left: elLeft,
                            top: elTop,
                            width: elWidth,
                            height: elHeight,
                            cursor: isDragging && isSelected ? 'grabbing' : 'grab',
                            transform: el.angle ? `rotate(${-el.angle}deg)` : undefined,
                            transformOrigin: 'top left',
                          }}
                          onMouseDown={e => handleCanvasMouseDown(e, el.id)}
                          onClick={e => e.stopPropagation()}
                        >
                          <div className={`w-full h-full ${
                            isSelected
                              ? 'ring-2 ring-purple-500 ring-offset-1'
                              : 'hover:ring-2 hover:ring-amber-300'
                          }`}>
                            {el.type === 'barcode' ? (
                              <div className="w-full h-full flex flex-col items-center justify-center bg-white/90 border border-gray-300 rounded-sm overflow-hidden">
                                <div className="flex-1 w-full flex items-center justify-center px-1">
                                  <div className="flex items-end gap-[1px] h-[75%]">
                                    {Array.from({ length: 30 }).map((_, i) => (
                                      <div
                                        key={i}
                                        className="bg-black"
                                        style={{
                                          width: (i % 4 === 0) ? 2 : 1,
                                          height: `${60 + (i % 3) * 15}%`,
                                        }}
                                      />
                                    ))}
                                  </div>
                                </div>
                                <span className="text-[9px] text-gray-700 font-mono leading-none pb-1">{content}</span>
                              </div>
                            ) : (
                              <div
                                className="w-full h-full flex items-center px-1 bg-amber-50/50 border border-amber-200/70 rounded-sm overflow-hidden"
                                style={{
                                  fontSize: Math.max(9, el.fontSize * 1.4),
                                  fontWeight: el.bold ? 'bold' : 'normal',
                                }}
                              >
                                <span className="truncate text-gray-800 leading-tight whitespace-nowrap">
                                  {content}
                                </span>
                              </div>
                            )}
                          </div>
                          {isSelected && (
                            <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[9px] text-purple-600 font-medium whitespace-nowrap bg-purple-50 px-2 py-0.5 rounded-full shadow-sm"
                              style={{ transform: el.angle ? `rotate(${el.angle}deg)` : undefined }}
                            >
                              {el.name} ({el.angle}°)
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Axis labels */}
                  <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[9px] text-gray-300 font-medium">
                    ← 宽 {activeTemplate.paperWidth}mm →
                  </div>
                  <div className="absolute -right-6 top-1/2 -translate-y-1/2 text-[9px] text-gray-300 font-medium" style={{ writingMode: 'vertical-rl' }}>
                    ↑ 高 {activeTemplate.paperHeight}mm ↓
                  </div>
              </div>
            </div>

            {/* Inline Property Editor - appears below canvas when element selected */}
            {selectedElement && (
              <div className="mt-5 pt-5 border-t border-gray-100">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={selectedElement.name}
                      onChange={e => updateElement(selectedElement.id, { name: e.target.value })}
                      className="text-sm font-semibold text-purple-700 bg-transparent border-none focus:outline-none focus:ring-0 px-0 w-24"
                      title="编辑元素名称"
                    />
                    <span className="text-[10px] bg-purple-100 text-purple-600 px-2 py-0.5 rounded-full">
                      {selectedElement.type === 'barcode' ? '条码' : '文本'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => updateElement(selectedElement.id, { visible: !selectedElement.visible })}
                      className={`text-xs px-2 py-1 rounded-lg ${selectedElement.visible ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-400'}`}
                    >
                      {selectedElement.visible ? '可见' : '隐藏'}
                    </button>
                    <button
                      onClick={() => {
                        setConfirmDialog({
                          isOpen: true,
                          title: '删除模板',
                          message: `确定删除元素「${selectedElement.name}」？`,
                          isDestructive: true,
                          onConfirm: () => {
                            setConfirmDialog(prev => ({...prev, isOpen: false}));
                            deleteElement(selectedElement.id);
                          }
                        });
                      }}
                      className="text-xs px-2 py-1 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 transition-colors"
                    >
                      删除
                    </button>
                    <button
                      onClick={() => setSelectedElementId(null)}
                      className="text-gray-400 hover:text-gray-600 p-1"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Row 1: Position & Size & Angle */}
                <div className="grid grid-cols-6 gap-2 mb-3">
                  <div>
                    <label className="text-[10px] text-gray-400 block mb-0.5">Left(横)</label>
                    <input type="number" step="0.5" value={selectedElement.y}
                      onChange={e => updateElement(selectedElement.id, { y: Number(e.target.value) })}
                      className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-300"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 block mb-0.5">Top(纵)</label>
                    <input type="number" step="0.5" value={selectedElement.x}
                      onChange={e => updateElement(selectedElement.id, { x: Number(e.target.value) })}
                      className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-300"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 block mb-0.5">Width</label>
                    <input type="number" step="0.5" value={selectedElement.width}
                      onChange={e => updateElement(selectedElement.id, { width: Number(e.target.value) })}
                      className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-300"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 block mb-0.5">Height</label>
                    <input type="number" step="0.5" value={selectedElement.height}
                      onChange={e => updateElement(selectedElement.id, { height: Number(e.target.value) })}
                      className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-300"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 block mb-0.5">Angle</label>
                    <select value={selectedElement.angle}
                      onChange={e => updateElement(selectedElement.id, { angle: Number(e.target.value) })}
                      className="w-full px-1 py-1.5 text-xs border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-300"
                    >
                      <option value={0}>0°</option>
                      <option value={90}>90°</option>
                      <option value={180}>180°</option>
                      <option value={270}>270°</option>
                    </select>
                  </div>
                  {selectedElement.type === 'text' && (
                    <div className="flex items-end gap-1">
                      <div className="flex-1">
                        <label className="text-[10px] text-gray-400 block mb-0.5">字号</label>
                        <input type="number" min="4" max="24" value={selectedElement.fontSize}
                          onChange={e => updateElement(selectedElement.id, { fontSize: Number(e.target.value) })}
                          className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-300"
                        />
                      </div>
                      <button
                        onClick={() => updateElement(selectedElement.id, { bold: !selectedElement.bold })}
                        className={`px-2 py-1.5 text-xs font-bold rounded-lg shrink-0 ${
                          selectedElement.bold ? 'bg-purple-500 text-white' : 'bg-gray-100 text-gray-500'
                        }`}
                      >B</button>
                    </div>
                  )}
                </div>

                {/* Row 2: Content template */}
                <div className="flex items-center gap-2">
                  <label className="text-[10px] text-gray-400 shrink-0">内容</label>
                  <input type="text" value={selectedElement.contentTemplate}
                    onChange={e => updateElement(selectedElement.id, { contentTemplate: e.target.value })}
                    className="flex-1 px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-300"
                  />
                  <span className="text-[10px] text-gray-300 shrink-0">
                    → {resolveTemplate(selectedElement.contentTemplate, SAMPLE_DATA) || '(空)'}
                  </span>
                </div>
              </div>
            )}

            {/* Paper size - compact row */}
            <div className="mt-4 pt-4 border-t border-gray-100 flex items-center gap-4 text-xs text-gray-500">
              <span className="font-medium text-gray-600">纸张:</span>
              <div className="flex items-center gap-1">
                <span>宽</span>
                <input type="number" value={activeTemplate.paperWidth}
                  onChange={e => setActiveTemplate(prev => ({ ...prev, paperWidth: Number(e.target.value) || 75 }))}
                  className="w-14 px-1.5 py-1 text-xs border border-gray-200 rounded focus:ring-1 focus:ring-amber-300"
                />
                <span>mm</span>
              </div>
              <div className="flex items-center gap-1">
                <span>高</span>
                <input type="number" value={activeTemplate.paperHeight}
                  onChange={e => setActiveTemplate(prev => ({ ...prev, paperHeight: Number(e.target.value) || 30 }))}
                  className="w-14 px-1.5 py-1 text-xs border border-gray-200 rounded focus:ring-1 focus:ring-amber-300"
                />
                <span>mm</span>
              </div>
              <span className="text-gray-300">|</span>
              <span className="text-[10px] text-gray-400">
                变量: {'{barcode}'} {'{productName}'} {'{goldWeight}'} {'{laborCost}'} {'{pieceLaborCost}'} {'{mainStone}'} {'{sideStone}'}
              </span>
            </div>
          </div>
        </div>
      </div>
      <ConfirmationDialog
        isOpen={confirmDialog.isOpen}
        onClose={() => setConfirmDialog(prev => ({...prev, isOpen: false}))}
        onConfirm={confirmDialog.onConfirm}
        title={confirmDialog.title}
        message={confirmDialog.message}
        isDestructive={confirmDialog.isDestructive}
      />
    </div>
  );
};

export default LabelDesignPage;
