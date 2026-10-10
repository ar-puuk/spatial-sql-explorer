// Copies the repo-root LICENSE, CHANGELOG.md and THIRD-PARTY-NOTICES.md into
// the extension folder so `vsce package` includes them (it only packages
// files under apps/vscode-ext). The root copies are the single source of
// truth; these copies are build artifacts (gitignored). Mirrors
// ../omx-viewer/apps/vscode-ext/scripts/copy-changelog.js.
import { copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..', '..', '..')

for (const file of ['LICENSE', 'CHANGELOG.md', 'THIRD-PARTY-NOTICES.md']) {
  copyFileSync(join(root, file), join(__dirname, '..', file))
  console.log(`Copied ${file} -> apps/vscode-ext/${file}`)
}
