import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const rootDir = process.cwd()
const packageJsonPath = join(rootDir, 'package.json')
const cargoTomlPath = join(rootDir, 'src-tauri', 'Cargo.toml')
const tauriConfigPath = join(rootDir, 'src-tauri', 'tauri.conf.json')

const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
const sourceVersion = String(packageJson.version || '').trim()

if (!sourceVersion) {
  throw new Error('package.json version is missing or empty.')
}

const semverLike = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/
if (!semverLike.test(sourceVersion)) {
  throw new Error(`package.json version is not a valid semver-like string: ${sourceVersion}`)
}

const cargoRaw = readFileSync(cargoTomlPath, 'utf8')
const cargoLines = cargoRaw.split(/\r?\n/)
let inPackageSection = false
let updatedCargo = false

for (let index = 0; index < cargoLines.length; index++) {
  const line = cargoLines[index]
  const trimmed = line.trim()

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    inPackageSection = trimmed === '[package]'
    continue
  }

  if (inPackageSection && /^version\s*=\s*".*"\s*$/.test(trimmed)) {
    cargoLines[index] = `version = "${sourceVersion}"`
    updatedCargo = true
    break
  }
}

if (!updatedCargo) {
  throw new Error('Failed to find [package] version in src-tauri/Cargo.toml')
}

const nextCargo = cargoLines.join('\n')
if (nextCargo !== cargoRaw) {
  writeFileSync(cargoTomlPath, nextCargo, 'utf8')
}

const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, 'utf8'))
tauriConfig.version = sourceVersion
writeFileSync(tauriConfigPath, `${JSON.stringify(tauriConfig, null, 2)}\n`, 'utf8')

console.log(`[sync-version] Synchronized versions to ${sourceVersion}`)
