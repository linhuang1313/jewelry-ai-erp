// frontend/src/utils/lodopPrint.js

/**
 * 加载 Lodop 打印控件
 * C-Lodop 服务运行在服务器 http://47.83.236.217/
 */
export function getLodop() {
    // 优先使用 C-Lodop (云打印)
    try {
        const LODOP = window.getCLodop()
        if (LODOP) return LODOP
    } catch (e) {
        console.warn('C-Lodop not available:', e)
    }
    return null
}

/**
 * 打印珠宝吊牌标签
 * @param {Object} product - 商品数据
 * @param {string} product.barcode - 条形码编号（如 F00147550）
 * @param {string} product.productName - 商品名称（如 足金5D钻石挂坠）
 * @param {number} product.goldWeight - 金重（克）
 * @param {number} product.laborCost - 工费（元/克）
 * @param {number} product.pieceLaborCost - 件工费（元/件）
 * @param {string} product.mainStone - 主石信息（可选）
 * @param {string} product.sideStone - 副石信息（可选）
 */
export function printJewelryLabel(product, options = {}) {
    const { preview = false, printer = 'GODEX' } = options

    const LODOP = getLodop()
    if (!LODOP) {
        alert('打印控件未安装，请先安装 C-Lodop 打印服务')
        window.open('http://www.lodop.net/download.html')
        return
    }

    // 初始化打印任务
    LODOP.PRINT_INIT('珠宝标签')

    // 设置标签纸尺寸（单位 mm）
    LODOP.SET_PRINT_PAGESIZE(1, '75mm', '30mm', '')

    // 打印条形码
    LODOP.ADD_PRINT_BARCODE('2mm', '21mm', '6mm', '26mm', '128Auto', product.barcode)
    LODOP.SET_PRINT_STYLEA(0, 'Angle', 270)

    // 主石/副石信息（如果有）
    if (product.mainStone) {
        LODOP.ADD_PRINT_TEXT('2mm', '20mm', '26mm', '3mm', `主石:${product.mainStone}`)
        LODOP.SET_PRINT_STYLEA(0, 'FontSize', 6)
        LODOP.SET_PRINT_STYLEA(0, 'Angle', 270)
    }
    if (product.sideStone) {
        LODOP.ADD_PRINT_TEXT('2mm', '17mm', '26mm', '3mm', `副石:${product.sideStone}`)
        LODOP.SET_PRINT_STYLEA(0, 'FontSize', 6)
        LODOP.SET_PRINT_STYLEA(0, 'Angle', 270)
    }

    // 商品名称（加粗）
    LODOP.ADD_PRINT_TEXT('2mm', '12mm', '26mm', '3mm', product.productName)
    LODOP.SET_PRINT_STYLEA(0, 'FontSize', 9)
    LODOP.SET_PRINT_STYLEA(0, 'Bold', 1)
    LODOP.SET_PRINT_STYLEA(0, 'Angle', 270)

    // 工费信息
    LODOP.ADD_PRINT_TEXT('2mm', '8mm', '26mm', '2mm',
        `工费: ${product.laborCost.toFixed(2)}/克`)
    LODOP.SET_PRINT_STYLEA(0, 'FontSize', 6)
    LODOP.SET_PRINT_STYLEA(0, 'Angle', 270)

    if (product.pieceLaborCost > 0) {
        LODOP.ADD_PRINT_TEXT('2mm', '6mm', '26mm', '2mm',
            `其他工费: ${product.pieceLaborCost.toFixed(2)}/件`)
        LODOP.SET_PRINT_STYLEA(0, 'FontSize', 6)
        LODOP.SET_PRINT_STYLEA(0, 'Angle', 270)
    }

    // 金重（加粗加大，底部显示）
    LODOP.ADD_PRINT_TEXT('2mm', '4mm', '26mm', '5mm',
        `金重: ${product.goldWeight.toFixed(product.goldWeight < 10 ? 2 : 3)}g`)
    LODOP.SET_PRINT_STYLEA(0, 'FontSize', 9)
    LODOP.SET_PRINT_STYLEA(0, 'Bold', 1)
    LODOP.SET_PRINT_STYLEA(0, 'Angle', 270)

    // 选择打印机并打印
    LODOP.SET_PRINTER_INDEX(printer) // 可指定打印机名称
    if (preview) {
        LODOP.PREVIEW()
    } else {
        LODOP.PRINT()
    }
}

/**
 * 批量打印珠宝吊牌标签
 * @param {Array} products - 商品数据数组
 * @param {Object} options - 打印选项
 * @param {boolean} options.preview - 是否预览模式（默认 false）
 * @param {string} options.printer - 打印机名称（默认 'GODEX'）
 */
export function printJewelryLabels(products, options = {}) {
    const { preview = false, printer = 'GODEX' } = options

    if (!products || products.length === 0) {
        alert('没有可打印的商品')
        return
    }

    const LODOP = getLodop()
    if (!LODOP) {
        alert('打印控件未安装，请先安装 C-Lodop 打印服务')
        window.open('http://www.lodop.net/download.html')
        return
    }

    // 初始化打印任务
    LODOP.PRINT_INIT('珠宝标签批量打印')

    // 设置标签纸尺寸（单位 mm）
    LODOP.SET_PRINT_PAGESIZE(1, '75mm', '30mm', '')

    // 遍历每个商品，添加到打印任务
    products.forEach((product, index) => {
        // 除了第一个，后续商品需要新建页面
        if (index > 0) {
            LODOP.NEWPAGE()
        }

        // 打印条形码
        LODOP.ADD_PRINT_BARCODE('2mm', '21mm', '6mm', '26mm', '128Auto', product.barcode)
        LODOP.SET_PRINT_STYLEA(0, 'Angle', 270)

        // 主石/副石信息（如果有）
        if (product.mainStone) {
            LODOP.ADD_PRINT_TEXT('2mm', '20mm', '26mm', '3mm', `主石:${product.mainStone}`)
            LODOP.SET_PRINT_STYLEA(0, 'FontSize', 6)
            LODOP.SET_PRINT_STYLEA(0, 'Angle', 270)
        }
        if (product.sideStone) {
            LODOP.ADD_PRINT_TEXT('2mm', '17mm', '26mm', '3mm', `副石:${product.sideStone}`)
            LODOP.SET_PRINT_STYLEA(0, 'FontSize', 6)
            LODOP.SET_PRINT_STYLEA(0, 'Angle', 270)
        }

        // 商品名称（加粗）
        LODOP.ADD_PRINT_TEXT('2mm', '12mm', '26mm', '3mm', product.productName)
        LODOP.SET_PRINT_STYLEA(0, 'FontSize', 9)
        LODOP.SET_PRINT_STYLEA(0, 'Bold', 1)
        LODOP.SET_PRINT_STYLEA(0, 'Angle', 270)

        // 工费信息
        LODOP.ADD_PRINT_TEXT('2mm', '8mm', '26mm', '2mm',
            `工费: ${product.laborCost.toFixed(2)}/克`)
        LODOP.SET_PRINT_STYLEA(0, 'FontSize', 6)
        LODOP.SET_PRINT_STYLEA(0, 'Angle', 270)

        if (product.pieceLaborCost > 0) {
            LODOP.ADD_PRINT_TEXT('2mm', '6mm', '26mm', '2mm',
                `其他工费: ${product.pieceLaborCost.toFixed(2)}/件`)
            LODOP.SET_PRINT_STYLEA(0, 'FontSize', 6)
            LODOP.SET_PRINT_STYLEA(0, 'Angle', 270)
        }

        // 金重（加粗加大，底部显示）
        LODOP.ADD_PRINT_TEXT('2mm', '4mm', '26mm', '5mm',
            `金重: ${product.goldWeight.toFixed(product.goldWeight < 10 ? 2 : 3)}g`)
        LODOP.SET_PRINT_STYLEA(0, 'FontSize', 9)
        LODOP.SET_PRINT_STYLEA(0, 'Bold', 1)
        LODOP.SET_PRINT_STYLEA(0, 'Angle', 270)
    })

    // 选择打印机并打印
    LODOP.SET_PRINTER_INDEX(printer)

    if (preview) {
        LODOP.PREVIEW()
    } else {
        LODOP.PRINT()
    }

    return products.length
}