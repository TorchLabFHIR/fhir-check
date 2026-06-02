// Integration tests: full action end-to-end via child_process
// Spawns index.js with mocked env vars and reads GITHUB_OUTPUT
const { describe, test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const ACTION = path.resolve(__dirname, '../../index.js')
const NETWORK_TIMEOUT = 30_000

function runAction({ env = {}, cwd } = {}) {
  const outFile = path.join(os.tmpdir(), `github-out-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`)
  fs.writeFileSync(outFile, '')

  const result = spawnSync('node', [ACTION], {
    env: { ...process.env, GITHUB_OUTPUT: outFile, ...env },
    cwd: cwd ?? os.tmpdir(),
    encoding: 'utf8',
    timeout: NETWORK_TIMEOUT,
  })

  const outputs = {}
  for (const line of fs.readFileSync(outFile, 'utf8').split('\n').filter(Boolean)) {
    const idx = line.indexOf('=')
    if (idx > 0) outputs[line.slice(0, idx)] = line.slice(idx + 1)
  }

  fs.unlinkSync(outFile)
  return { exitCode: result.status, stdout: result.stdout, stderr: result.stderr, outputs }
}

describe('action end-to-end', () => {
  let workDir

  before(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fhir-check-e2e-'))
  })

  after(() => {
    fs.rmSync(workDir, { recursive: true, force: true })
  })

  // ── Happy path ──────────────────────────────────────────────────────────────

  test('exits 0 with known-good deps in sushi-config.yaml', { timeout: NETWORK_TIMEOUT }, () => {
    const cfg = path.join(workDir, 'sushi-ok.yaml')
    fs.writeFileSync(cfg, 'dependencies:\n  hl7.fhir.us.core: 6.1.0\n  hl7.fhir.uv.sdc: current\n')
    const { exitCode, outputs } = runAction({
      env: { INPUT_SUSHI_CONFIG: cfg, INPUT_FAIL_ON_MISSING: 'true' },
      cwd: workDir,
    })
    assert.equal(exitCode, 0, 'Expected exit code 0 for all-found deps')
    assert.equal(outputs['deps-found'],   '2')
    assert.equal(outputs['deps-missing'], '0')
    assert.equal(outputs['deps-total'],   '2')
  })

  test('sets deps-total to 0 when all deps are core packages', { timeout: NETWORK_TIMEOUT }, () => {
    const cfg = path.join(workDir, 'sushi-core.yaml')
    fs.writeFileSync(cfg, 'dependencies:\n  hl7.fhir.r4.core: 4.0.1\n  hl7.terminology: current\n')
    const { exitCode, outputs } = runAction({
      env: { INPUT_SUSHI_CONFIG: cfg, INPUT_FAIL_ON_MISSING: 'true' },
      cwd: workDir,
    })
    assert.equal(exitCode, 0)
    assert.equal(outputs['deps-total'], '0')
  })

  test('exits 0 with no external dependencies section', { timeout: NETWORK_TIMEOUT }, () => {
    const cfg = path.join(workDir, 'sushi-nodeps.yaml')
    fs.writeFileSync(cfg, 'name: test-ig\nversion: 0.1.0\n')
    const { exitCode, outputs } = runAction({
      env: { INPUT_SUSHI_CONFIG: cfg },
      cwd: workDir,
    })
    assert.equal(exitCode, 0)
    assert.equal(outputs['deps-total'], '0')
  })

  test('reads from package.json when sushi-config is absent', { timeout: NETWORK_TIMEOUT }, () => {
    const pkgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fhir-pkg-'))
    try {
      fs.writeFileSync(
        path.join(pkgDir, 'package.json'),
        JSON.stringify({ dependencies: { 'hl7.fhir.us.core': '6.1.0' } })
      )
      const { exitCode, outputs } = runAction({ cwd: pkgDir })
      assert.equal(exitCode, 0)
      assert.equal(outputs['deps-found'], '1')
    } finally {
      fs.rmSync(pkgDir, { recursive: true, force: true })
    }
  })

  // ── Missing deps ─────────────────────────────────────────────────────────────

  test('exits 1 when dep is missing and fail-on-missing is true (default)', { timeout: NETWORK_TIMEOUT }, () => {
    const cfg = path.join(workDir, 'sushi-missing.yaml')
    fs.writeFileSync(cfg, 'dependencies:\n  this.package.does.not.exist.xyz: 1.0.0\n')
    const { exitCode, outputs } = runAction({
      env: { INPUT_SUSHI_CONFIG: cfg, INPUT_FAIL_ON_MISSING: 'true' },
      cwd: workDir,
    })
    assert.equal(exitCode, 1, 'Expected failure for missing dep')
    assert.equal(outputs['deps-missing'], '1')
    assert.equal(outputs['deps-found'],   '0')
  })

  test('exits 0 when dep is missing but fail-on-missing is false', { timeout: NETWORK_TIMEOUT }, () => {
    const cfg = path.join(workDir, 'sushi-missing-nofail.yaml')
    fs.writeFileSync(cfg, 'dependencies:\n  this.package.does.not.exist.xyz: 1.0.0\n')
    const { exitCode, outputs } = runAction({
      env: { INPUT_SUSHI_CONFIG: cfg, INPUT_FAIL_ON_MISSING: 'false' },
      cwd: workDir,
    })
    assert.equal(exitCode, 0)
    assert.equal(outputs['deps-missing'], '1')
  })

  test('missing dep count is accurate across mixed found/missing', { timeout: NETWORK_TIMEOUT }, () => {
    const cfg = path.join(workDir, 'sushi-mixed.yaml')
    fs.writeFileSync(
      cfg,
      'dependencies:\n  hl7.fhir.us.core: 6.1.0\n  this.package.does.not.exist.xyz: 1.0.0\n'
    )
    const { outputs } = runAction({
      env: { INPUT_SUSHI_CONFIG: cfg, INPUT_FAIL_ON_MISSING: 'false' },
      cwd: workDir,
    })
    assert.equal(outputs['deps-found'],   '1')
    assert.equal(outputs['deps-missing'], '1')
    assert.equal(outputs['deps-total'],   '2')
  })

  // ── Config file resolution ────────────────────────────────────────────────────

  test('exits 1 when no config file exists in the workspace', () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fhir-empty-'))
    try {
      const { exitCode, stdout } = runAction({ cwd: emptyDir })
      assert.equal(exitCode, 1)
      assert.ok(stdout.includes('No sushi-config.yaml'), `Expected error message in stdout: ${stdout}`)
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true })
    }
  })

  test('uses sushi-config.yml as fallback when .yaml is absent', { timeout: NETWORK_TIMEOUT }, () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'fhir-yml-'))
    try {
      fs.writeFileSync(path.join(d, 'sushi-config.yml'), 'dependencies:\n  hl7.fhir.us.core: 6.1.0\n')
      const { exitCode } = runAction({ cwd: d })
      assert.equal(exitCode, 0)
    } finally {
      fs.rmSync(d, { recursive: true, force: true })
    }
  })

  // ── Output format ─────────────────────────────────────────────────────────────

  test('writes outputs via GITHUB_OUTPUT (not deprecated ::set-output)', { timeout: NETWORK_TIMEOUT }, () => {
    const cfg = path.join(workDir, 'sushi-output-check.yaml')
    fs.writeFileSync(cfg, 'dependencies:\n  hl7.fhir.us.core: 6.1.0\n')
    const { stdout, outputs } = runAction({
      env: { INPUT_SUSHI_CONFIG: cfg },
      cwd: workDir,
    })
    assert.ok(!stdout.includes('::set-output'), `Deprecated ::set-output found in stdout: ${stdout}`)
    assert.ok(Object.keys(outputs).length > 0, 'Expected outputs to be written via GITHUB_OUTPUT')
  })

  test('all three required outputs are always set', { timeout: NETWORK_TIMEOUT }, () => {
    const cfg = path.join(workDir, 'sushi-all-outputs.yaml')
    fs.writeFileSync(cfg, 'dependencies:\n  hl7.fhir.us.core: 6.1.0\n')
    const { outputs } = runAction({ env: { INPUT_SUSHI_CONFIG: cfg }, cwd: workDir })
    assert.ok('deps-found'   in outputs, 'Missing output: deps-found')
    assert.ok('deps-missing' in outputs, 'Missing output: deps-missing')
    assert.ok('deps-total'   in outputs, 'Missing output: deps-total')
  })

  test('output values are numeric strings', { timeout: NETWORK_TIMEOUT }, () => {
    const cfg = path.join(workDir, 'sushi-numeric.yaml')
    fs.writeFileSync(cfg, 'dependencies:\n  hl7.fhir.us.core: 6.1.0\n')
    const { outputs } = runAction({ env: { INPUT_SUSHI_CONFIG: cfg }, cwd: workDir })
    for (const [key, val] of Object.entries(outputs)) {
      assert.ok(!isNaN(Number(val)), `Output "${key}" value "${val}" is not numeric`)
    }
  })

  // ── Error handling ─────────────────────────────────────────────────────────────

  test('exits 1 and prints message on malformed YAML (invalid JSON fallback)', () => {
    const f = path.join(workDir, 'bad.json')
    fs.writeFileSync(f, '{ not valid json }')
    const { exitCode, stdout } = runAction({
      env: { INPUT_SUSHI_CONFIG: f },
      cwd: workDir,
    })
    assert.equal(exitCode, 1)
    assert.ok(stdout.includes('Failed to parse'), `Expected parse error in stdout: ${stdout}`)
  })
})
