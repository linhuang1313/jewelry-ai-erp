import { describe, expect, it } from 'vitest'
import { parseInboundTable } from './excelImport'

describe('parseInboundTable', () => {
  it('maps headers and parses valid rows', () => {
    const table = [
      ['商品编码', '商品名称', '克重(g)', '克工费(元)', '件数', '件工费(元)'],
      ['JPJZ', '精品金镯', '10.5', '5', '2', '3'],
    ]

    const result = parseInboundTable(table)

    expect(result.errors.length).toBe(0)
    expect(result.rows.length).toBe(1)
    expect(result.rows[0]).toEqual({
      productCode: 'JPJZ',
      productName: '精品金镯',
      weight: 10.5,
      laborCost: 5,
      pieceCount: 2,
      pieceLaborCost: 3,
      remark: undefined,
    })
  })

  it('reports missing required fields', () => {
    const table = [
      ['商品名称', '克重(g)', '克工费(元)'],
      ['', '10', '2'],
    ]

    const result = parseInboundTable(table)
    expect(result.rows.length).toBe(0)
    expect(result.errors.length).toBe(1)
  })
})
