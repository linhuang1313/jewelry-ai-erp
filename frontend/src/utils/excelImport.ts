import * as XLSX from 'xlsx'

export interface InboundImportRow {
  productCode?: string
  barcode?: string
  productName: string
  weight: number
  laborCost: number
  pieceCount?: number
  pieceLaborCost?: number
  remark?: string
}

export type FieldErrors = Partial<
  Record<
    'productCode' | 'productName' | 'weight' | 'laborCost' | 'pieceCount' | 'pieceLaborCost' | 'remark',
    string
  >
>

export interface ParsedInboundRow {
  data: InboundImportRow
  errors: FieldErrors
}

export interface ImportError {
  row: number
  message: string
}

const HEADER_MAP: Record<string, keyof InboundImportRow> = {
  商品编码: 'productCode',
  商品名称: 'productName',
  商品名: 'productName',
  品名: 'productName',
  '克重(g)': 'weight',
  重量: 'weight',
  克重: 'weight',
  '克工费(元)': 'laborCost',
  克工费: 'laborCost',
  件数: 'pieceCount',
  '件工费(元)': 'pieceLaborCost',
  件工费: 'pieceLaborCost',
  备注: 'remark',
}

const REQUIRED_HEADER_DEFS = [
  { label: '商品名称', headers: ['商品名称', '商品名', '品名'] },
  { label: '克重(g)', headers: ['克重(g)', '重量', '克重'] },
  { label: '克工费(元)', headers: ['克工费(元)', '克工费'] },
]

const normalizeHeader = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  const header = String(value).trim()
  return header.replace(/^\uFEFF/, '')
}

const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null
  const num = Number(String(value).trim().replace(/,/g, ''))
  return Number.isFinite(num) ? num : null
}

const isEmptyRow = (row: unknown[]): boolean => {
  return row.every(cell => String(cell ?? '').trim() === '')
}

export const parseInboundTable = (table: unknown[][]): {
  rows: ParsedInboundRow[]
  errors: ImportError[]
} => {
  const errors: ImportError[] = []
  const rows: ParsedInboundRow[] = []

  if (!table || table.length === 0) {
    return {
      rows,
      errors: [{ row: 1, message: '表格为空' }],
    }
  }

  const headerRow = table[0] || []
  const headerIndexMap = new Map<string, number>()
  const productNameIndexes = new Set<number>()

  for (let index = 0; index < headerRow.length; index += 1) {
    const header = normalizeHeader(headerRow[index])
    if (header) {
      headerIndexMap.set(header, index)
      if (HEADER_MAP[header] === 'productName') {
        productNameIndexes.add(index)
        let nextIndex = index + 1
        while (nextIndex < headerRow.length && normalizeHeader(headerRow[nextIndex]) === '') {
          productNameIndexes.add(nextIndex)
          nextIndex += 1
        }
      }
    }
  }

  const hasAnyHeader = (headers: string[]) => headers.some(h => headerIndexMap.has(h))
  const missingHeaders = REQUIRED_HEADER_DEFS.filter(def => !hasAnyHeader(def.headers)).map(def => def.label)
  if (missingHeaders.length > 0) {
    errors.push({
      row: 1,
      message: `缺少表头: ${missingHeaders.join('、')}`,
    })
  }

  for (let i = 1; i < table.length; i += 1) {
    const rawRow = table[i] || []
    if (isEmptyRow(rawRow)) continue

    const rowNumber = i + 1
    const rowData: Partial<InboundImportRow> = {}
    const rowErrors: FieldErrors = {}

    headerIndexMap.forEach((index, header) => {
      const key = HEADER_MAP[header]
      if (!key) return
      const value = rawRow[index]
      if (value === null || value === undefined) return
      ;(rowData as any)[key] = String(value).trim()
    })

    const productNameParts: string[] = []
    productNameIndexes.forEach(index => {
      const value = rawRow[index]
      const trimmed = String(value ?? '').trim()
      if (trimmed) productNameParts.push(trimmed)
    })
    const productName = productNameParts.length > 0 ? productNameParts.join('') : String(rowData.productName ?? '').trim()
    const weight = toNumber(rowData.weight ?? '')
    const laborCost = toNumber(rowData.laborCost ?? '')
    const pieceCount = toNumber(rowData.pieceCount ?? '')
    const pieceLaborCost = toNumber(rowData.pieceLaborCost ?? '')

    if (!headerIndexMap.has('商品名称') || !productName) {
      rowErrors.productName = headerIndexMap.has('商品名称') ? '商品名称不能为空' : '缺少表头'
    }
    if (!headerIndexMap.has('克重(g)') || weight === null || weight <= 0) {
      rowErrors.weight = headerIndexMap.has('克重(g)') ? '克重必须大于 0' : '缺少表头'
    }
    if (!headerIndexMap.has('克工费(元)') || laborCost === null || laborCost < 0) {
      rowErrors.laborCost = headerIndexMap.has('克工费(元)') ? '克工费必须大于等于 0' : '缺少表头'
    }
    if (pieceCount !== null && pieceCount < 0) {
      rowErrors.pieceCount = '件数必须大于等于 0'
    }
    if (pieceLaborCost !== null && pieceLaborCost < 0) {
      rowErrors.pieceLaborCost = '件工费必须大于等于 0'
    }

    rows.push({
      data: {
        productCode: rowData.productCode ? String(rowData.productCode).trim() : undefined,
        barcode: rowData.barcode ? String(rowData.barcode).trim() : undefined,
        productName,
        weight: weight ?? 0,
        laborCost: laborCost ?? 0,
        pieceCount: pieceCount === null ? undefined : Math.trunc(pieceCount),
        pieceLaborCost: pieceLaborCost === null ? undefined : pieceLaborCost,
        remark: rowData.remark ? String(rowData.remark).trim() : undefined,
      },
      errors: rowErrors,
    })
  }

  return { rows, errors }
}

export const parseInboundFile = (file: File): Promise<{
  rows: ParsedInboundRow[]
  errors: ImportError[]
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
        resolve(parseInboundTable(table))
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
