import * as path from 'path'
import { runTests } from '@vscode/test-electron'

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, '../../../apps/vscode-ext')
  const extensionTestsPath = path.resolve(__dirname, './suite/index')
  const workspacePath = path.resolve(__dirname, '../fixtures')

  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [workspacePath, '--disable-extensions'],
    })
  } catch (err) {
    console.error('Failed to run tests:', err)
    process.exit(1)
  }
}

void main()
