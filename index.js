#!/usr/bin/env node
// TorchLab FHIR Check — GitHub Action entry point
// Validates sushi-config.yaml dependencies against the TorchLab registry

const https      = require('https')
const fs         = require('fs')
const path       = require('path')
const { execSync } = require('child_process')

// GitHub Actions core functions (inline to keep zero dependencies)
function setOutput(name, value) {
  const outFile = process.env.GITHUB_OUTPUT
  if (outFile) {
    fs.appendFileSync(outFile, `${name}=${value}\n`)
  } else {
    process.stdout.write(`::set-output name=${name}::${value}\n`)
  }
}
function info(msg)    { console.log(msg) }
function warning(msg) { process.stdout.write(`::warning::${msg}\n`) }
function error(msg)   { process.stdout.write(`::error::${msg}\n`) }
function setFailed(msg) { error(msg); process.exit(1) }
function getInput(name, def = '') {
  return process.env[`INPUT_${name.replace(/-/g, '_').toUpperCase()}`] ?? def
}

const RESET = '\x1b[0m', GREEN = '\x1b[32m', YELLOW = '\x1b[33m', CYAN = '\x1b[36m', BOLD = '\x1b[1m', DIM = '\x1b[2m'
const API   = 'https://www.torchlab.dev/api/v1'

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const opts = { headers: { 'User-Agent': 'torchlab-fhir-check/1.0 (GitHub Action)' } }
    const req = https.get(url, opts, res => {
      // Follow 301/302/307/308 redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        return resolve(fetchJson(res.headers.location))
      }
      let body = ''
      res.on('data', d => body += d)
      res.on('end', () => {
        try { resolve(JSON.parse(body)) } catch { reject(new Error(`Invalid JSON from ${url} (status ${res.statusCode})`)) }
      })
    }).on('error', reject)
    req.setTimeout(10_000, () => req.destroy(new Error(`Registry request timed out: ${url}`)))
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

// Pure helper — replaces placeholder badge URLs; testable without I/O
function applyBadgePatch(content, repo) {
  return content.replace(
    /https:\/\/github\.com\/YOUR_ORG\/YOUR_REPO\/actions\/workflows\/fhir-check\.yml/g,
    `https://github.com/${repo}/actions/workflows/fhir-check.yml`
  )
}

function patchReadmeBadge(repo = process.env.GITHUB_REPOSITORY) {
  if (!repo) return false

  const candidates = ['README.md', 'readme.md', 'README', 'README.rst']
  const readmeFile = candidates.find(f => fs.existsSync(f))
  if (!readmeFile) return false

  const original = fs.readFileSync(readmeFile, 'utf8')
  const patched  = applyBadgePatch(original, repo)
  if (patched === original) return false

  fs.writeFileSync(readmeFile, patched, 'utf8')
  info(`  ${GREEN}✔${RESET}  Patched ${readmeFile}: YOUR_ORG/YOUR_REPO → ${repo}`)

  try {
    const git = cmd => execSync(cmd, { stdio: 'pipe' })
    git('git config user.name "github-actions[bot]"')
    git('git config user.email "41898282+github-actions[bot]@users.noreply.github.com"')
    git(`git add "${readmeFile}"`)
    // No-op if nothing staged (placeholder was already fixed by a prior run)
    execSync(
      'git diff --cached --quiet || git commit -m "fix(readme): patch fhir-check badge URL [skip ci]"',
      { stdio: 'pipe', shell: true }
    )
    git('git push')
    info(`  ${GREEN}✔${RESET}  Badge URL committed and pushed`)
  } catch (e) {
    fs.writeFileSync(readmeFile, original, 'utf8')
    warning('README badge patched but could not be committed automatically. ' +
      'Add "permissions: contents: write" to your workflow job.')
  }

  return true
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

  if (getInput('patch-readme', 'true') !== 'false') patchReadmeBadge()

  if (missing > 0 && failOnMissing) {
    setFailed(`${missing} FHIR ${missing === 1 ? 'dependency' : 'dependencies'} not found in the TorchLab registry.`)
  }
  if (deprecated > 0 && failOnDeprecated) {
    setFailed(`${deprecated} FHIR ${deprecated === 1 ? 'dependency has' : 'dependencies have'} not been updated in over 2 years.`)
  }
}

if (require.main === module) run().catch(e => setFailed(e.message))

module.exports = { parseDepsFromSushiConfig, parseDepsFromPackageJson, CORE_SKIP, getInput, setOutput, fetchJson, applyBadgePatch, patchReadmeBadge }
