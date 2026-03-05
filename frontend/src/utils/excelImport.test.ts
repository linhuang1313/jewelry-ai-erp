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
    expect(result.rows[0].errors).toEqual({})
    expect(result.rows[0].data).toEqual({
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
    expect(result.rows.length).toBe(1)
    expect(result.rows[0].errors.productName).toBe('商品名称不能为空')
  })

  it('parses alias headers for required fields', () => {
    const table = [
      ['商品名', '重量', '克工费'],
      ['足金', '0.5', '9'],
    ]

    const result = parseInboundTable(table)

    expect(result.errors.length).toBe(0)
    expect(result.rows[0].errors).toEqual({})
    expect(result.rows[0].data).toEqual({
      productCode: undefined,
      productName: '足金',
      weight: 0.5,
      laborCost: 9,
      pieceCount: undefined,
      pieceLaborCost: undefined,
      remark: undefined,
    })
  })

  it('merges multi-column product name without spaces', () => {
    const table = [
      ['品名', '', '', '件数', '重量', '克工费'],
      ['足金', '钻石', '挂坠', '1', '0.55', '9'],
    ]

    const result = parseInboundTable(table)

    expect(result.errors.length).toBe(0)
    expect(result.rows[0].errors).toEqual({})
    expect(result.rows[0].data.productName).toBe('足金钻石挂坠')
    expect(result.rows[0].data.weight).toBe(0.55)
    expect(result.rows[0].data.laborCost).toBe(9)
    expect(result.rows[0].data.pieceCount).toBe(1)
  })
})
