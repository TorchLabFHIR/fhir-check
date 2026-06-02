// Unit tests: README badge placeholder patching
const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { applyBadgePatch, patchReadmeBadge } = require('../../index.js')

const PLACEHOLDER_BADGE =
  '[![FHIR Check](https://github.com/YOUR_ORG/YOUR_REPO/actions/workflows/fhir-check.yml/badge.svg)]' +
  '(https://github.com/YOUR_ORG/YOUR_REPO/actions/workflows/fhir-check.yml)'

const FIXED_BADGE = (repo) =>
  `[![FHIR Check](https://github.com/${repo}/actions/workflows/fhir-check.yml/badge.svg)]` +
  `(https://github.com/${repo}/actions/workflows/fhir-check.yml)`

// ── applyBadgePatch (pure) ────────────────────────────────────────────────────

describe('applyBadgePatch', () => {
  test('replaces placeholder badge URL with repo', () => {
    const input = `# My IG\n\n${PLACEHOLDER_BADGE}\n`
    const result = applyBadgePatch(input, 'MyOrg/my-repo')
    assert.ok(result.includes(FIXED_BADGE('MyOrg/my-repo')))
    assert.ok(!result.includes('YOUR_ORG/YOUR_REPO'))
  })

  test('replaces all occurrences (badge image src + href)', () => {
    const input = `${PLACEHOLDER_BADGE}\n${PLACEHOLDER_BADGE}\n`
    const result = applyBadgePatch(input, 'MyOrg/my-repo')
    assert.equal((result.match(/YOUR_ORG\/YOUR_REPO/g) ?? []).length, 0)
  })

  test('is a no-op when placeholder is absent', () => {
    const input = '# My IG\n\nNo badge here.\n'
    assert.equal(applyBadgePatch(input, 'MyOrg/my-repo'), input)
  })

  test('does not touch unrelated URLs', () => {
    const input = 'See https://github.com/some/other-repo for details.\n'
    assert.equal(applyBadgePatch(input, 'MyOrg/my-repo'), input)
  })

  test('handles repo names with hyphens and dots', () => {
    const input = `${PLACEHOLDER_BADGE}\n`
    const result = applyBadgePatch(input, 'Torch-Lab/fhir.check')
    assert.ok(result.includes('Torch-Lab/fhir.check'))
  })
})

// ── patchReadmeBadge (file I/O, git expected to fail in temp dir) ─────────────

describe('patchReadmeBadge', () => {
  test('returns false when GITHUB_REPOSITORY is not set', () => {
    const saved = process.env.GITHUB_REPOSITORY
    delete process.env.GITHUB_REPOSITORY
    try {
      assert.equal(patchReadmeBadge(), false)
    } finally {
      if (saved !== undefined) process.env.GITHUB_REPOSITORY = saved
    }
  })

  test('returns false when no README exists in cwd', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fhir-patch-'))
    const saved = process.cwd()
    try {
      process.chdir(dir)
      assert.equal(patchReadmeBadge('MyOrg/my-repo'), false)
    } finally {
      process.chdir(saved)
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('returns false when README has no placeholder', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fhir-patch-'))
    const saved = process.cwd()
    try {
      fs.writeFileSync(path.join(dir, 'README.md'), '# My IG\n\nNo badge.\n')
      process.chdir(dir)
      assert.equal(patchReadmeBadge('MyOrg/my-repo'), false)
    } finally {
      process.chdir(saved)
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('returns true and reverts file gracefully when git is not available', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fhir-patch-'))
    const readmePath = path.join(dir, 'README.md')
    const original = `# My IG\n\n${PLACEHOLDER_BADGE}\n`
    const saved = process.cwd()
    try {
      fs.writeFileSync(readmePath, original)
      process.chdir(dir)
      // git will fail (no repo) — function must not throw and must revert the file
      const result = patchReadmeBadge('MyOrg/my-repo')
      assert.equal(result, true)
      assert.equal(fs.readFileSync(readmePath, 'utf8'), original)
    } finally {
      process.chdir(saved)
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
