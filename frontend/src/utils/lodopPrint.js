// frontend/src/utils/lodopPrint.js

const STORAGE_KEY = 'jewelry_label_templates'
const ACTIVE_TEMPLATE_KEY = 'jewelry_active_template_id'

/**
 * 加载 Lodop 打印控件
 * C-Lodop 服务运行在服务器
 */
export function getLodop() {
    try {
        const LODOP = window.getCLodop()
        LODOP.SET_LICENSES("", "79B8F023051D25404D284BDADC858762", "", "");
        if (LODOP) return LODOP
    } catch (e) {
        console.warn('C-Lodop not available:', e)
    }
    return null
}

/**
 * 获取当前激活的标签模板（从 localStorage 读取）
 * 如果没有保存过模板，返回内置默认模板
 */
export function getActiveLabelTemplate() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY)
        if (stored) {
            const templates = JSON.parse(stored)
            const activeId = localStorage.getItem(ACTIVE_TEMPLATE_KEY)
            const found = templates.find(t => t.id === activeId)
            if (found) return found
            if (templates.length > 0) return templates[0]
        }
    } catch (e) {
        console.warn('读取标签模板失败，使用默认模板:', e)
    }
    return getDefaultLabelTemplate()
}

/**
 * 内置默认标签模板（与标签设计页面的 createDefaultTemplate 保持一致）
 */
export function getDefaultLabelTemplate() {
    return {
        id: 'default',
        name: '珠宝吊牌标签',
        paperWidth: 75,
        paperHeight: 30,
        elements: [
            { id: 'barcode', type: 'barcode', name: '条形码', contentTemplate: '{barcode}', x: 2, y: 21, width: 6, height: 30, fontSize: 0, bold: false, visible: true, angle: 270 },
            { id: 'mainStone', type: 'text', name: '主石信息', contentTemplate: '主石:{mainStone}', x: 2, y: 20, width: 30, height: 3, fontSize: 6, bold: false, visible: true, angle: 270 },
            { id: 'sideStone', type: 'text', name: '副石信息', contentTemplate: '副石:{sideStone}', x: 2, y: 17, width: 30, height: 3, fontSize: 6, bold: false, visible: true, angle: 270 },
            { id: 'productName', type: 'text', name: '商品名称', contentTemplate: '{productName}', x: 2, y: 12, width: 30, height: 3, fontSize: 9, bold: true, visible: true, angle: 270 },
            { id: 'laborCost', type: 'text', name: '克工费', contentTemplate: '工费: {laborCost}/克', x: 2, y: 8, width: 30, height: 2, fontSize: 6, bold: false, visible: true, angle: 270 },
            { id: 'pieceLaborCost', type: 'text', name: '件工费', contentTemplate: '其他工费: {pieceLaborCost}/件', x: 2, y: 6, width: 26, height: 2, fontSize: 6, bold: false, visible: true, angle: 270 },
            { id: 'goldWeight', type: 'text', name: '金重', contentTemplate: '金重: {goldWeight}g', x: 2, y: 4, width: 30, height: 5, fontSize: 9, bold: true, visible: true, angle: 270 },
        ],
    }
}

/**
 * 解析内容模板，将 {变量名} 替换为实际数据
 */
function resolveTemplate(template, data) {
    return template.replace(/\{(\w+)\}/g, (_, key) => {
        const val = data[key]
        if (val === undefined || val === null || val === '') return ''
        if (typeof val === 'number') {
            if (key === 'goldWeight') return val < 10 ? val.toFixed(2) : val.toFixed(3)
            if (key === 'laborCost' || key === 'pieceLaborCost') return val.toFixed(2)
        }
        return String(val)
    })
}

/**
 * 根据标签模板和商品数据，向 LODOP 添加一页打印内容
 * @param {Object} LODOP - Lodop 控件实例
 * @param {Object} template - 标签模板对象（含 elements 数组）
 * @param {Object} product - 商品数据
 */
function addLabelPage(LODOP, template, product) {
    const data = {
        barcode: product.barcode || '',
        productName: product.productName || '',
        goldWeight: product.goldWeight || 0,
        laborCost: product.laborCost || 0,
        pieceLaborCost: product.pieceLaborCost || 0,
        mainStone: product.mainStone || '',
        sideStone: product.sideStone || '',
    }

    for (const el of template.elements) {
        if (!el.visible) continue

        const content = resolveTemplate(el.contentTemplate, data)
        if (!content) continue

        const top = `${el.x}mm`
        const left = `${el.y}mm`
        const width = `${el.width}mm`
        const height = `${el.height}mm`

        if (el.type === 'barcode') {
            LODOP.ADD_PRINT_BARCODE(top, left, width, height, '128Auto', content)
        } else {
            LODOP.ADD_PRINT_TEXT(top, left, width, height, content)
            if (el.fontSize) LODOP.SET_PRINT_STYLEA(0, 'FontSize', el.fontSize)
            if (el.bold) LODOP.SET_PRINT_STYLEA(0, 'Bold', 1)
        }

        if (el.angle) LODOP.SET_PRINT_STYLEA(0, 'Angle', el.angle)
    }
}

/**
 * 打印单个珠宝吊牌标签
 * @param {Object} product - 商品数据 { barcode, productName, goldWeight, laborCost, pieceLaborCost, mainStone, sideStone }
 * @param {Object} options - { preview, template }
 * @param {Object} [options.template] - 可选，传入标签模板对象；不传则自动读取 localStorage 中的当前模板
 * @param {boolean} [options.preview] - 是否预览模式
 */
export async function printJewelryLabel(product, options = {}) {
    const { preview = false, template: customTemplate } = options

    const LODOP = await getLodop()
    if (!LODOP) {
        alert('打印控件未连接，请确认 C-Lodop 打印服务已启动')
        return
    }

    const template = customTemplate || getActiveLabelTemplate()

    LODOP.PRINT_INIT('珠宝标签')
    LODOP.SET_BRIDGE_INDEX("C3699006567;HDF101,5")
    LODOP.SET_PRINT_PAGESIZE(1, `${template.paperWidth}mm`, `${template.paperHeight}mm`, '')

    addLabelPage(LODOP, template, product)

    LODOP.On_Return = function (TaskID, Value) { console.log("打印结果:\n" + Value) }
    if (preview) {
        LODOP.PREVIEW()
    } else {
        LODOP.PRINT()
    }
}

/**
 * 批量打印珠宝吊牌标签
 * @param {Array} products - 商品数据数组
 * @param {Object} options - { preview, template }
 * @param {Object} [options.template] - 可选，传入标签模板对象
 * @param {boolean} [options.preview] - 是否预览模式
 */
export async function printJewelryLabels(products, options = {}) {
    const { preview = false, template: customTemplate } = options

    if (!products || products.length === 0) {
        alert('没有可打印的商品')
        return
    }

    const LODOP = await getLodop()
    if (!LODOP) {
        alert('打印控件未连接，请确认 C-Lodop 打印服务已启动')
        return
    }

    const template = customTemplate || getActiveLabelTemplate()

    LODOP.PRINT_INIT('珠宝标签批量打印')
    LODOP.SET_BRIDGE_INDEX("C3699006567;HDF101,5")
    LODOP.SET_PRINT_PAGESIZE(1, `${template.paperWidth}mm`, `${template.paperHeight}mm`, '')

    products.forEach((product, index) => {
        if (index > 0) LODOP.NEWPAGE()
        addLabelPage(LODOP, template, product)
    })

    LODOP.On_Return = function (TaskID, Value) { alert("打印结果:" + Value) }

    if (preview) {
        LODOP.PREVIEW()
    } else {
        LODOP.PRINT()
    }

    return products.length
}
