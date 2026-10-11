// T026 (spec 008 US2): the column choice persists across reopen in VS Code,
// and a filter narrows the table and a "filtered rows" export.
import * as assert from 'assert'
import * as fs from 'fs'
import * as vscode from 'vscode'
import * as path from 'path'
import { openCopy, runExport } from './export.test'

interface TableState {
  hidden: string[]
  filters: Array<{ column: string; kind: string; valid?: boolean }>
  matching: number | null
  total: number
  selected: number
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const tableState = (): Thenable<TableState | null> => vscode.commands.executeCommand('spatialExplorer._getTableState')

async function waitTable(until: (s: TableState) => boolean, what: string): Promise<TableState> {
  const deadline = Date.now() + 20000
  for (;;) {
    const s = await tableState()
    if (s && until(s)) return s
    assert.ok(Date.now() < deadline, `${what}: ${JSON.stringify(s)}`)
    await sleep(150)
  }
}

suite('Spec 008 US2: table tools in VS Code', () => {
  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })

  test('hidden columns are remembered for the file across reopening', async function () {
    this.timeout(90000)
    const { dir, file } = await openCopy('wide-50.parquet')
    try {
      await vscode.commands.executeCommand('spatialExplorer._setHiddenColumns', ['text_6', 'int_1'])
      await waitTable((s) => s.hidden.length === 2, 'columns not hidden')
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(file), 'spatialExplorer.editorOption')
      const s = await waitTable((x) => x.hidden.length === 2, 'the choice was not restored')
      assert.deepStrictEqual([...s.hidden].sort(), ['int_1', 'text_6'])
      await vscode.commands.executeCommand('spatialExplorer._setHiddenColumns', [])
      await waitTable((x) => x.hidden.length === 0, 'columns not shown again')
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('a filter narrows the rows, and "filtered rows" exports only those', async function () {
    this.timeout(90000)
    const { dir } = await openCopy('wide-50.parquet')
    try {
      await vscode.commands.executeCommand('spatialExplorer._setFilter', 'int_1', { column: 'int_1', kind: 'lte', value: '99' })
      const s = await waitTable((x) => x.matching !== null, 'filter not counted')
      assert.ok(s.matching! > 0 && s.matching! < 200, `matching ${s.matching}`)
      const out = path.join(dir, 'filtered.csv')
      const done = await runExport({ format: 'csv', scope: 'filtered' }, out)
      assert.strictEqual(done.outcome?.kind, 'saved', JSON.stringify(done.outcome))
      const lines = fs.readFileSync(out, 'utf8').trim().split(/\r?\n/)
      assert.strictEqual(lines.length - 1, s.matching)
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
