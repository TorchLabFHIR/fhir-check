// Integration tests: TorchLab Public API (live HTTP calls)
// Run these separately — they require network access to torchlab.dev
const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { fetchJson } = require('../../index.js')

const API = 'https://torchlab.dev/api/v1'
const TIMEOUT = 20_000

describe('TorchLab API — /packages/:name', { timeout: TIMEOUT }, () => {
  test('returns a data object for a known package (hl7.fhir.us.core)', async () => {
    const res = await fetchJson(`${API}/packages/hl7.fhir.us.core`)
    assert.ok(res.data, 'Expected truthy data property in response')
    assert.equal(typeof res.data, 'object')
  })

  test('returned package includes a latest_version string', async () => {
    const res = await fetchJson(`${API}/packages/hl7.fhir.us.core`)
    assert.ok('latest_version' in res.data, 'Expected latest_version field')
    assert.equal(typeof res.data.latest_version, 'string')
    assert.ok(res.data.latest_version.length > 0)
  })

  test('returns null/undefined data for an unknown package', async () => {
    const res = await fetchJson(`${API}/packages/this.package.does.not.exist.torchlab.xyz`)
    assert.ok(!res.data, `Expected falsy data for unknown package, got: ${JSON.stringify(res.data)}`)
  })

  test('hl7.fhir.uv.sdc is present in the registry', async () => {
    const res = await fetchJson(`${API}/packages/hl7.fhir.uv.sdc`)
    assert.ok(res.data, 'Expected hl7.fhir.uv.sdc to be registered')
  })

  test('package names with dots are correctly URL-encoded and resolved', async () => {
    const name = 'hl7.fhir.us.core'
    const res = await fetchJson(`${API}/packages/${encodeURIComponent(name)}`)
    assert.ok(res.data)
  })
})

describe('TorchLab API — /packages/:name/versions', { timeout: TIMEOUT }, () => {
  test('returns an array of versions for a known package', async () => {
    const res = await fetchJson(`${API}/packages/hl7.fhir.us.core/versions`)
    assert.ok(Array.isArray(res.data), 'Expected data to be an array')
    assert.ok(res.data.length > 0, 'Expected at least one version entry')
  })

  test('version objects include a crawled_at ISO timestamp', async () => {
    const res = await fetchJson(`${API}/packages/hl7.fhir.us.core/versions`)
    const first = res.data[0]
    assert.ok('crawled_at' in first, 'Expected crawled_at field in version object')
    const d = new Date(first.crawled_at)
    assert.ok(!isNaN(d.getTime()), `crawled_at "${first.crawled_at}" is not a valid date`)
  })

  test('version entries are sorted so deprecation check (versions[0]) is meaningful', async () => {
    // The action reads versions[0].crawled_at to detect stale packages.
    // This test verifies the first version entry has a valid date — if versions are
    // in ascending order (oldest first), the deprecation logic would incorrectly flag active packages.
    const res = await fetchJson(`${API}/packages/hl7.fhir.us.core/versions`)
    assert.ok(res.data.length >= 2, 'Need at least 2 versions to verify ordering')
    const first = new Date(res.data[0].crawled_at)
    const last  = new Date(res.data[res.data.length - 1].crawled_at)
    // versions[0] should be the MOST RECENT (descending order) for the deprecation check to be correct
    assert.ok(
      first >= last,
      `Expected versions in descending order (newest first). Got: first=${first.toISOString()}, last=${last.toISOString()}`
    )
  })
})

describe('fetchJson — error handling', () => {
  test('rejects with Error on invalid JSON response', async () => {
    await assert.rejects(
      () => fetchJson('https://torchlab.dev/not-a-json-endpoint-404xyz'),
      (err) => err instanceof Error
    )
  })

  test('rejects on DNS failure / unreachable host', async () => {
    await assert.rejects(
      () => fetchJson('https://this-host-does-not-exist.torchlab-invalid.dev/api'),
      (err) => err instanceof Error
    )
  })
})
