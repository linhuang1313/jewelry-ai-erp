import * as XLSX from 'xlsx'

/**
 * 镶嵌入库Excel导入解析器
 * 支持的字段：品名(B+C+D列拼接)、件数、重量、克工费、件工费、
 * 主石重、主石粒数、主石单价、主石额、副石重、副石粒数、副石单价、副石额、
 * 镶石费、总金额、主石字印、副石字印、珍珠重、轴承重、销售克工费、销售件工费
 */

export interface InlayInboundRow {
  productCode?: string
  productName: string
  weight: number
  laborCost: number
  pieceCount?: number
  pieceLaborCost?: number
  // 镶嵌相关字段
  mainStoneWeight?: number
  mainStoneCount?: number
  mainStonePrice?: number
  mainStoneAmount?: number
  subStoneWeight?: number
  subStoneCount?: number
  subStonePrice?: number
  subStoneAmount?: number
  stoneSettingFee?: number
  totalAmount?: number
  mainStoneMark?: string
  subStoneMark?: string
  pearlWeight?: number
  bearingWeight?: number
  saleLaborCost?: number
  salePieceLaborCost?: number
}

export type InlayFieldErrors = Partial<Record<keyof InlayInboundRow, string>>

export interface ParsedInlayRow {
  data: InlayInboundRow
  errors: InlayFieldErrors
}

export interface InlayImportError {
  row: number
  message: string
}

// 表头映射：支持多种表头名称（小写版本用于不区分大小写匹配）
const HEADER_MAP: Record<string, keyof InlayInboundRow> = {
  // 基础字段
  商品编码: 'productCode',
  编码: 'productCode',
  品名: 'productName',
  商品名称: 'productName',
  商品名: 'productName',
  重量: 'weight',
  克重: 'weight',
  '克重(g)': 'weight',
  '克重(G)': 'weight',
  克工费: 'laborCost',
  '克工费(元)': 'laborCost',
  工费: 'laborCost',
  件数: 'pieceCount',
  数量: 'pieceCount',
  件工费: 'pieceLaborCost',
  '件工费(元)': 'pieceLaborCost',
  // 镶嵌字段
  主石重: 'mainStoneWeight',
  主石粒数: 'mainStoneCount',
  主石单价: 'mainStonePrice',
  主石额: 'mainStoneAmount',
  副石重: 'subStoneWeight',
  副石粒数: 'subStoneCount',
  副石单价: 'subStonePrice',
  副石额: 'subStoneAmount',
  镶石费: 'stoneSettingFee',
  总金额: 'totalAmount',
  总额: 'totalAmount',
  主石字印: 'mainStoneMark',
  副石字印: 'subStoneMark',
  珍珠重: 'pearlWeight',
  轴承重: 'bearingWeight',
  销售克工费: 'saleLaborCost',
  销售件工费: 'salePieceLaborCost',
}

// 品名相关的表头（用于识别需要拼接的列）
const PRODUCT_NAME_HEADERS = ['品名', '商品名称', '商品名']

// 可以跳过的列（不影响导入）
const SKIP_HEADERS = ['序号', '序', 'no', 'No', 'NO', '#']

const normalizeHeader = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  const header = String(value).trim()
  return header.replace(/^\uFEFF/, '').replace(/\s+/g, '') // 去掉BOM和空格
}

const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null
  const num = Number(String(value).trim().replace(/,/g, ''))
  return Number.isFinite(num) ? num : null
}

const isEmptyRow = (row: unknown[]): boolean => {
  return row.every(cell => String(cell ?? '').trim() === '')
}

// 检测哪一行是表头行（支持首行是标题的情况）
const findHeaderRowIndex = (table: unknown[][]): number => {
  for (let i = 0; i < Math.min(3, table.length); i++) {
    const row = table[i] || []
    const headers = row.map(cell => normalizeHeader(cell))
    // 如果这一行包含关键字段，认为是表头行
    const hasKeyHeaders = headers.some(h => 
      h === '件数' || h === '重量' || h === '克工费' || h === '克重' || 
      PRODUCT_NAME_HEADERS.includes(h) || h === '主石重'
    )
    if (hasKeyHeaders) return i
  }
  return 0 // 默认第一行
}

export const parseInlayInboundTable = (table: unknown[][]): {
  rows: ParsedInlayRow[]
  errors: InlayImportError[]
} => {
  const errors: InlayImportError[] = []
  const rows: ParsedInlayRow[] = []

  if (!table || table.length === 0) {
    return {
      rows,
      errors: [{ row: 1, message: '表格为空' }],
    }
  }

  // 自动检测表头行
  const headerRowIndex = findHeaderRowIndex(table)
  const headerRow = table[headerRowIndex] || []
  const headerIndexMap = new Map<string, number>()
  const productNameIndexes: number[] = []
  
  console.log('镶嵌入库解析 - 表头行索引:', headerRowIndex)
  console.log('镶嵌入库解析 - 原始表头:', headerRow)

  // 解析表头
  let foundProductName = false
  for (let index = 0; index < headerRow.length; index += 1) {
    const header = normalizeHeader(headerRow[index])
    if (header && !SKIP_HEADERS.includes(header)) {
      headerIndexMap.set(header, index)
      // 记录品名列的位置（可能有多列需要拼接）- 只处理第一个品名列
      if (!foundProductName && PRODUCT_NAME_HEADERS.includes(header)) {
        foundProductName = true
        productNameIndexes.push(index)
        // 检查后续空白列（可能是品名的延续列，如 B, C, D 列）
        let nextIndex = index + 1
        while (nextIndex < headerRow.length) {
          const nextHeader = normalizeHeader(headerRow[nextIndex])
          // 如果下一列为空或者不在已知表头中且不是跳过的表头，可能是品名的延续
          if (nextHeader === '' || (!HEADER_MAP[nextHeader] && !PRODUCT_NAME_HEADERS.includes(nextHeader) && !SKIP_HEADERS.includes(nextHeader))) {
            productNameIndexes.push(nextIndex)
            nextIndex += 1
          } else {
            break
          }
        }
        // 不要 break，继续处理其他表头
      }
    }
  }
  
  // 如果没有找到品名表头，但有数据，尝试使用第1-3列（B,C,D）作为品名列
  if (productNameIndexes.length === 0 && table.length > headerRowIndex + 1) {
    // 检查第一行数据，看看前几列是否像品名（中文字符）
    const firstDataRow = table[headerRowIndex + 1] || []
    for (let i = 0; i < Math.min(4, firstDataRow.length); i++) {
      const header = normalizeHeader(headerRow[i])
      // 如果这列没有被识别为其他字段，且数据看起来像中文品名
      if (!HEADER_MAP[header] && !SKIP_HEADERS.includes(header)) {
        const cellValue = String(firstDataRow[i] ?? '').trim()
        // 检查是否包含中文字符（可能是品名的一部分）
        if (/[\u4e00-\u9fa5]/.test(cellValue)) {
          productNameIndexes.push(i)
        }
      }
    }
    console.log('镶嵌入库解析 - 自动检测品名列:', productNameIndexes)
  }

  console.log('镶嵌入库解析 - 识别的表头:', Array.from(headerIndexMap.entries()))
  console.log('镶嵌入库解析 - 品名列索引:', productNameIndexes)

  // 检查必要字段
  const hasProductName = PRODUCT_NAME_HEADERS.some(h => headerIndexMap.has(h)) || productNameIndexes.length > 0
  const hasWeight = headerIndexMap.has('重量') || headerIndexMap.has('克重') || headerIndexMap.has('克重(g)') || headerIndexMap.has('克重(G)')
  const hasLaborCost = headerIndexMap.has('克工费') || headerIndexMap.has('克工费(元)') || headerIndexMap.has('工费')

  if (!hasProductName) {
    errors.push({ row: headerRowIndex + 1, message: `缺少表头: 品名 (检测到的表头: ${Array.from(headerIndexMap.keys()).join(', ')})` })
  }
  if (!hasWeight) {
    errors.push({ row: headerRowIndex + 1, message: `缺少表头: 重量/克重 (检测到的表头: ${Array.from(headerIndexMap.keys()).join(', ')})` })
  }
  if (!hasLaborCost) {
    errors.push({ row: headerRowIndex + 1, message: `缺少表头: 克工费 (检测到的表头: ${Array.from(headerIndexMap.keys()).join(', ')})` })
  }

  // 解析数据行（从表头行的下一行开始）
  for (let i = headerRowIndex + 1; i < table.length; i += 1) {
    const rawRow = table[i] || []
    if (isEmptyRow(rawRow)) continue

    const rowData: Partial<InlayInboundRow> = {}
    const rowErrors: InlayFieldErrors = {}

    // 解析品名（拼接多列）
    const productNameParts: string[] = []
    for (const index of productNameIndexes) {
      const value = rawRow[index]
      const trimmed = String(value ?? '').trim()
      if (trimmed) productNameParts.push(trimmed)
    }
    const productName = productNameParts.join('')

    // 解析其他字段
    headerIndexMap.forEach((index, header) => {
      const key = HEADER_MAP[header]
      if (!key || key === 'productName') return // 品名已单独处理
      const value = rawRow[index]
      if (value === null || value === undefined || String(value).trim() === '') return
      rowData[key] = String(value).trim() as never
    })

    // 转换数值字段
    const weight = toNumber(rowData.weight ?? '')
    const laborCost = toNumber(rowData.laborCost ?? '')
    const pieceCount = toNumber(rowData.pieceCount ?? '')
    const pieceLaborCost = toNumber(rowData.pieceLaborCost ?? '')
    const mainStoneWeight = toNumber(rowData.mainStoneWeight ?? '')
    const mainStoneCount = toNumber(rowData.mainStoneCount ?? '')
    const mainStonePrice = toNumber(rowData.mainStonePrice ?? '')
    const mainStoneAmount = toNumber(rowData.mainStoneAmount ?? '')
    const subStoneWeight = toNumber(rowData.subStoneWeight ?? '')
    const subStoneCount = toNumber(rowData.subStoneCount ?? '')
    const subStonePrice = toNumber(rowData.subStonePrice ?? '')
    const subStoneAmount = toNumber(rowData.subStoneAmount ?? '')
    const stoneSettingFee = toNumber(rowData.stoneSettingFee ?? '')
    const totalAmount = toNumber(rowData.totalAmount ?? '')
    const pearlWeight = toNumber(rowData.pearlWeight ?? '')
    const bearingWeight = toNumber(rowData.bearingWeight ?? '')
    const saleLaborCost = toNumber(rowData.saleLaborCost ?? '')
    const salePieceLaborCost = toNumber(rowData.salePieceLaborCost ?? '')

    // 验证必填字段
    if (!productName) {
      rowErrors.productName = '品名不能为空'
    }
    if (weight === null || weight <= 0) {
      rowErrors.weight = '重量必须大于 0'
    }
    if (laborCost === null || laborCost < 0) {
      rowErrors.laborCost = '克工费必须大于等于 0'
    }

    rows.push({
      data: {
        productCode: rowData.productCode ? String(rowData.productCode).trim() : undefined,
        productName,
        weight: weight ?? 0,
        laborCost: laborCost ?? 0,
        pieceCount: pieceCount === null ? undefined : Math.trunc(pieceCount),
        pieceLaborCost: pieceLaborCost === null ? undefined : pieceLaborCost,
        mainStoneWeight: mainStoneWeight ?? undefined,
        mainStoneCount: mainStoneCount === null ? undefined : Math.trunc(mainStoneCount),
        mainStonePrice: mainStonePrice ?? undefined,
        mainStoneAmount: mainStoneAmount ?? undefined,
        subStoneWeight: subStoneWeight ?? undefined,
        subStoneCount: subStoneCount === null ? undefined : Math.trunc(subStoneCount),
        subStonePrice: subStonePrice ?? undefined,
        subStoneAmount: subStoneAmount ?? undefined,
        stoneSettingFee: stoneSettingFee ?? undefined,
        totalAmount: totalAmount ?? undefined,
        mainStoneMark: rowData.mainStoneMark ? String(rowData.mainStoneMark).trim() : undefined,
        subStoneMark: rowData.subStoneMark ? String(rowData.subStoneMark).trim() : undefined,
        pearlWeight: pearlWeight ?? undefined,
        bearingWeight: bearingWeight ?? undefined,
        saleLaborCost: saleLaborCost ?? undefined,
        salePieceLaborCost: salePieceLaborCost ?? undefined,
      },
      errors: rowErrors,
    })
  }

  return { rows, errors }
}

export const parseInlayInboundFile = (file: File): Promise<{
  rows: ParsedInlayRow[]
  errors: InlayImportError[]
}> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    const isCsv = file.name.toLowerCase().endsWith('.csv')

    reader.onload = event => {
      try {
        const data = event.target?.result
        if (!data) {
          resolve({ rows: [], errors: [{ row: 1, message: '读取文件失败' }] })
          return
        }
        const workbook = XLSX.read(data, { type: isCsv ? 'string' : 'array' })
        const firstSheetName = workbook.SheetNames[0]
        if (!firstSheetName) {
          resolve({ rows: [], errors: [{ row: 1, message: '找不到工作表' }] })
          return
        }
        const sheet = workbook.Sheets[firstSheetName]
        const table = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }) as unknown[][]
        resolve(parseInlayInboundTable(table))
      } catch (error) {
        reject(error)
      }
    }

    reader.onerror = () => {
      reject(new Error('读取文件失败'))
    }

    if (isCsv) {
      reader.readAsText(file)
    } else {
      reader.readAsArrayBuffer(file)
    }
  })
}
