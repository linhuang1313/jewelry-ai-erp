import * as XLSX from 'xlsx'

export interface InboundImportRow {
  productCode?: string
  productName: string
  weight: number
  laborCost: number
  pieceCount?: number
  pieceLaborCost?: number
  remark?: string
}

export interface ImportError {
  row: number
  message: string
}

const HEADER_MAP: Record<string, keyof InboundImportRow> = {
  商品编码: 'productCode',
  商品名称: 'productName',
  '克重(g)': 'weight',
  '克工费(元)': 'laborCost',
  件数: 'pieceCount',
  '件工费(元)': 'pieceLaborCost',
  备注: 'remark',
}

const REQUIRED_HEADERS = ['商品名称', '克重(g)', '克工费(元)']

const normalizeHeader = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  const header = String(value).trim()
  return header.replace(/^\uFEFF/, '')
}

const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null
  const num = Number(String(value).trim())
  return Number.isFinite(num) ? num : null
}

const isEmptyRow = (row: unknown[]): boolean => {
  return row.every(cell => String(cell ?? '').trim() === '')
}

export const parseInboundTable = (table: unknown[][]): {
  rows: InboundImportRow[]
  errors: ImportError[]
} => {
  const errors: ImportError[] = []
  const rows: InboundImportRow[] = []

  if (!table || table.length === 0) {
    return {
      rows,
      errors: [{ row: 1, message: '表格为空' }],
    }
  }

  const headerRow = table[0] || []
  const headerIndexMap = new Map<string, number>()

  headerRow.forEach((cell, index) => {
    const header = normalizeHeader(cell)
    if (header) {
      headerIndexMap.set(header, index)
    }
  })

  const missingHeaders = REQUIRED_HEADERS.filter(h => !headerIndexMap.has(h))
  if (missingHeaders.length > 0) {
    errors.push({
      row: 1,
      message: `缺少表头: ${missingHeaders.join('、')}`,
    })
    return { rows, errors }
  }

  for (let i = 1; i < table.length; i += 1) {
    const rawRow = table[i] || []
    if (isEmptyRow(rawRow)) continue

    const rowNumber = i + 1
    const rowData: Partial<InboundImportRow> = {}

    headerIndexMap.forEach((index, header) => {
      const key = HEADER_MAP[header]
      if (!key) return
      const value = rawRow[index]
      if (value === null || value === undefined) return
      rowData[key] = String(value).trim()
    })

    const productName = String(rowData.productName ?? '').trim()
    const weight = toNumber(rowData.weight ?? '')
    const laborCost = toNumber(rowData.laborCost ?? '')
    const pieceCount = toNumber(rowData.pieceCount ?? '')
    const pieceLaborCost = toNumber(rowData.pieceLaborCost ?? '')

    if (!productName) {
      errors.push({ row: rowNumber, message: '商品名称不能为空' })
      continue
    }
    if (weight === null || weight <= 0) {
      errors.push({ row: rowNumber, message: '克重必须大于 0' })
      continue
    }
    if (laborCost === null || laborCost < 0) {
      errors.push({ row: rowNumber, message: '克工费必须大于等于 0' })
      continue
    }
    if (pieceCount !== null && pieceCount < 0) {
      errors.push({ row: rowNumber, message: '件数必须大于等于 0' })
      continue
    }
    if (pieceLaborCost !== null && pieceLaborCost < 0) {
      errors.push({ row: rowNumber, message: '件工费必须大于等于 0' })
      continue
    }

    rows.push({
      productCode: rowData.productCode ? String(rowData.productCode).trim() : undefined,
      productName,
      weight,
      laborCost,
      pieceCount: pieceCount === null ? undefined : Math.trunc(pieceCount),
      pieceLaborCost: pieceLaborCost === null ? undefined : pieceLaborCost,
      remark: rowData.remark ? String(rowData.remark).trim() : undefined,
    })
  }

  return { rows, errors }
}

export const parseInboundFile = (file: File): Promise<{
  rows: InboundImportRow[]
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
