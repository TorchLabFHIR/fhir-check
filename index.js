#!/usr/bin/env node
// TorchLab FHIR Check — GitHub Action entry point
// Validates sushi-config.yaml dependencies against the TorchLab registry

const https  = require('https')
const fs     = require('fs')
const path   = require('path')

// GitHub Actions core functions (inline to keep zero dependencies)
function setOutput(name, value) {
  process.stdout.write(`::set-output name=${name}::${value}\n`)
}
function info(msg)    { console.log(msg) }
function warning(msg) { process.stdout.write(`::warning::${msg}\n`) }
function error(msg)   { process.stdout.write(`::error::${msg}\n`) }
function setFailed(msg) { error(msg); process.exit(1) }
function getInput(name, def = '') {
  return process.env[`INPUT_${name.replace(/-/g, '_').toUpperCase()}`] ?? def
}

const RESET = '\x1b[0m', GREEN = '\x1b[32m', YELLOW = '\x1b[33m', CYAN = '\x1b[36m', BOLD = '\x1b[1m', DIM = '\x1b[2m'
const API   = 'https://torchlab.dev/api/v1'

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'torchlab-fhir-check/1.0 (GitHub Action)' } }, res => {
      let body = ''
      res.on('data', d => body += d)
      res.on('end', () => {
        try { resolve(JSON.parse(body)) } catch { reject(new Error('Invalid JSON')) }
      })
    }).on('error', reject)
  })
}

function parseDepsFromSushiConfig(file) {
  const lines   = fs.readFileSync(file, 'utf8').split('\n')
  const deps    = {}
  let inDeps    = false
  for (const line of lines) {
    if (/^dependencies\s*:/.test(line)) { inDeps = true; continue }
    if (inDeps) {
      if (/^\s/.test(line)) {
        const m = line.trim().match(/^([^:]+):\s*(.+)$/)
        if (m) deps[m[1].trim()] = m[2].trim().replace(/['"]/g, '').replace(/\s*#.*/,'').trim()
      } else { inDeps = false }
    }
  }
  return deps
}

function parseDepsFromPackageJson(file) {
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'))
  return pkg.dependencies ?? {}
}

// Packages that are always present — skip checking them
const CORE_SKIP = new Set([
  'hl7.fhir.r4.core', 'hl7.fhir.r4b.core', 'hl7.fhir.r5.core',
  'hl7.fhir.r3.core', 'hl7.fhir.r2.core',
  'hl7.terminology', 'hl7.terminology.r4', 'hl7.terminology.r5',
])

async function run() {
  const configPath     = getInput('sushi-config', 'sushi-config.yaml')
  const failOnMissing  = getInput('fail-on-missing', 'true') !== 'false'
  const failOnDeprecated = getInput('fail-on-deprecated', 'false') !== 'false'

  // Resolve config file
  const candidates = [configPath, 'sushi-config.yaml', 'sushi-config.yml', 'package.json']
  const configFile = candidates.find(f => fs.existsSync(f))

  if (!configFile) {
    setFailed('No sushi-config.yaml or package.json found. Run from the root of a FHIR IG project.')
    return
  }

  info(`\n${BOLD}TorchLab FHIR Check${RESET}  ${DIM}torchlab.dev${RESET}\n`)
  info(`  Config: ${configFile}`)

  let allDeps = {}
  try {
    allDeps = configFile.endsWith('.json')
      ? parseDepsFromPackageJson(configFile)
      : parseDepsFromSushiConfig(configFile)
  } catch (e) {
    setFailed(`Failed to parse ${configFile}: ${e.message}`)
    return
  }

  const deps = Object.entries(allDeps).filter(([k]) => !CORE_SKIP.has(k))
  if (!deps.length) {
    info('  No external dependencies to check.\n')
    setOutput('deps-found', '0')
    setOutput('deps-missing', '0')
    setOutput('deps-total', '0')
    return
  }

  info(`  Checking ${deps.length} dependenc${deps.length === 1 ? 'y' : 'ies'} against registry...\n`)

  let found = 0, missing = 0, deprecated = 0

  for (const [name, declaredVersion] of deps) {
    try {
      const data = await fetchJson(`${API}/packages/${encodeURIComponent(name)}`)

      if (!data.data) {
        missing++
        const msg = `Dependency not found in TorchLab registry: ${name}`
        if (failOnMissing) error(msg)
        else warning(msg)
        info(`  ${YELLOW}✘${RESET}  ${CYAN}${name}${RESET}  ${DIM}not in registry${RESET}`)
        continue
      }

      found++
      const latest      = data.data.latest_version ?? 'unknown'
      const versionNote = declaredVersion !== 'current' ? `${DIM}declared: ${declaredVersion} · latest: ${latest}${RESET}` : `${DIM}latest: ${latest}${RESET}`
      info(`  ${GREEN}✔${RESET}  ${CYAN}${name}${RESET}  ${versionNote}`)

      if (failOnDeprecated) {
        const verData = await fetchJson(`${API}/packages/${encodeURIComponent(name)}/versions`)
        const versions = verData.data ?? []
        if (versions.length > 0) {
          const lastCrawled = new Date(versions[0].crawled_at)
          const daysSince   = Math.floor((Date.now() - lastCrawled.getTime()) / 86_400_000)
          if (daysSince > 730) {
            deprecated++
            warning(`${name} has had no new version in ${Math.floor(daysSince / 365)} years (last: ${latest})`)
          }
        }
      }
    } catch (e) {
      warning(`Failed to check ${name}: ${e.message}`)
    }
  }

  info('')
  info(`  ${BOLD}Results:${RESET} ${GREEN}${found} found${RESET} · ${missing > 0 ? YELLOW : DIM}${missing} missing${RESET}${deprecated > 0 ? ` · ${YELLOW}${deprecated} deprecated${RESET}` : ''}\n`)

  setOutput('deps-found',   String(found))
  setOutput('deps-missing', String(missing))
  setOutput('deps-total',   String(deps.length))

  if (missing > 0 && failOnMissing) {
    setFailed(`${missing} FHIR ${missing === 1 ? 'dependency' : 'dependencies'} not found in the TorchLab registry.`)
  }
  if (deprecated > 0 && failOnDeprecated) {
    setFailed(`${deprecated} FHIR ${deprecated === 1 ? 'dependency has' : 'dependencies have'} not been updated in over 2 years.`)
  }
}

run().catch(e => setFailed(e.message))
