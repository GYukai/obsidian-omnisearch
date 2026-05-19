import { readFileSync, writeFileSync } from 'fs'
import process from 'process'

const targetVersion = process.env.npm_package_version
console.log(`Bumping version to ${targetVersion}`)

// read minAppVersion from manifest.json and bump manifests to target version
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'))
const { minAppVersion } = manifest
manifest.version = targetVersion
writeFileSync('manifest.json', JSON.stringify(manifest, null, 2) + '\n')

const betaManifest = JSON.parse(readFileSync('manifest-beta.json', 'utf8'))
betaManifest.version = targetVersion
writeFileSync(
  'manifest-beta.json',
  JSON.stringify(betaManifest, null, '\t') + '\n'
)

// update versions.json with target version and minAppVersion from manifest.json
const versions = JSON.parse(readFileSync('versions.json', 'utf8'))
versions[targetVersion] = minAppVersion
writeFileSync('versions.json', JSON.stringify(versions, null, '\t') + '\n')
