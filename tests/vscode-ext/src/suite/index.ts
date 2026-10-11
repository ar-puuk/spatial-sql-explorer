import * as path from 'path'
import Mocha from 'mocha'
import { glob } from 'glob'

export function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 60000 })
  const testsRoot = path.resolve(__dirname, '.')

  const files = glob.sync(process.env.SE_TEST_GLOB ?? '**/*.test.js', { cwd: testsRoot })
  files.forEach((f: string) => mocha.addFile(path.resolve(testsRoot, f)))

  return new Promise((resolve, reject) => {
    try {
      mocha.run((failures: number) => {
        if (failures > 0) {
          reject(new Error(`${failures} tests failed.`))
        } else {
          resolve()
        }
      })
    } catch (err) {
      reject(err)
    }
  })
}
