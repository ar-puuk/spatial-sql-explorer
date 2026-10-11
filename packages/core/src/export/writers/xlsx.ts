// Excel workbook (spec 008 FR-020, research §3): the smallest valid OOXML
// SpreadsheetML package (ECMA-376): one sheet, a header row, inline strings,
// numbers and booleans; dates as ISO text. Zipped with fflate. The engine's
// own xlsx writer is not used: its output starts with a stray byte and loads
// nowhere (research §3), and it would load an extension at every start.
import { zipSync } from 'fflate'
import { XLSX_MAX_ROWS } from '../formats.js'
import { ChunkBuffer, textOf, toNumber, xmlEscape, type ExportRow, type RowWriter, type WriterColumn } from './common.js'

/** A1-style column letters: 0 -> A, 25 -> Z, 26 -> AA. */
export function columnLetters(index: number): string {
  let s = ''
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

const inline = (ref: string, text: string): string => `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`

export function xlsxWriter(columns: readonly WriterColumn[]): RowWriter {
  const sheet = new ChunkBuffer()
  const letters = columns.map((_, i) => columnLetters(i))
  sheet.push(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
      `<row r="1">${columns.map((c, i) => inline(`${letters[i]}1`, c.name)).join('')}</row>`
  )
  let row = 1
  let pending = ''
  return {
    add({ values }: ExportRow) {
      if (row >= XLSX_MAX_ROWS) return // the plan says the rest is left out
      row++
      let cells = ''
      columns.forEach((c, i) => {
        const v = values[i]
        if (v === null || v === undefined) return
        const ref = `${letters[i]}${row}`
        if (c.kind === 'bool') cells += `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`
        else if (c.kind === 'int' || c.kind === 'double' || (c.kind === 'bigint' && Number.isSafeInteger(Number(v)))) {
          const n = toNumber(v)
          if (n !== null) cells += `<c r="${ref}"><v>${n}</v></c>`
        } else cells += inline(ref, textOf(v))
      })
      pending += `<row r="${row}">${cells}</row>`
      if (pending.length > 1 << 20) {
        sheet.push(pending)
        pending = ''
      }
    },
    get size() {
      return sheet.size + pending.length
    },
    finish() {
      sheet.push(pending)
      sheet.push('</sheetData></worksheet>')
      const enc = new TextEncoder()
      return zipSync(
        {
          '[Content_Types].xml': enc.encode(
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
              '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
              '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
              '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'
          ),
          '_rels/.rels': enc.encode(
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
              '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
          ),
          'xl/workbook.xml': enc.encode(
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
              '<sheets><sheet name="Export" sheetId="1" r:id="rId1"/></sheets></workbook>'
          ),
          'xl/_rels/workbook.xml.rels': enc.encode(
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
              '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'
          ),
          'xl/worksheets/sheet1.xml': sheet.bytes(),
        },
        { level: 6 }
      )
    },
  }
}
