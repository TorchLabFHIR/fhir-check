// Unit tests: parseDepsFromPackageJson
const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { parseDepsFromPackageJson } = require('../../index.js')

function tmpJson(obj) {
  const f = path.join(os.tmpdir(), `pkg-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
  fs.writeFileSync(f, JSON.stringify(obj))
  return f
}

describe('parseDepsFromPackageJson — basic parsing', () => {
  test('parses dependencies from a standard package.json', () => {
    const f = tmpJson({ dependencies: { 'hl7.fhir.us.core': '6.1.0' } })
    assert.deepEqual(parseDepsFromPackageJson(f), { 'hl7.fhir.us.core': '6.1.0' })
  })

  test('parses multiple dependencies', () => {
    const f = tmpJson({
      dependencies: {
        'hl7.fhir.us.core': '6.1.0',
        'hl7.fhir.uv.sdc': 'current',
      },
    })
    const deps = parseDepsFromPackageJson(f)
    assert.equal(Object.keys(deps).length, 2)
    assert.equal(deps['hl7.fhir.us.core'], '6.1.0')
    assert.equal(deps['hl7.fhir.uv.sdc'], 'current')
  })

  test('parses "current" as a version string', () => {
    const f = tmpJson({ dependencies: { 'pkg.a': 'current' } })
    assert.equal(parseDepsFromPackageJson(f)['pkg.a'], 'current')
  })
})

describe('parseDepsFromPackageJson — missing / empty deps', () => {
  test('returns empty object when dependencies key is absent', () => {
    const f = tmpJson({ name: 'test', version: '1.0.0' })
    assert.deepEqual(parseDepsFromPackageJson(f), {})
  })

  test('returns empty object for empty dependencies', () => {
    const f = tmpJson({ dependencies: {} })
    assert.deepEqual(parseDepsFromPackageJson(f), {})
  })
})

describe('parseDepsFromPackageJson — key isolation', () => {
  test('ignores devDependencies', () => {
    const f = tmpJson({ devDependencies: { 'some.package': '1.0.0' } })
    assert.deepEqual(parseDepsFromPackageJson(f), {})
  })

  test('ignores peerDependencies', () => {
    const f = tmpJson({ peerDependencies: { 'some.package': '1.0.0' } })
    assert.deepEqual(parseDepsFromPackageJson(f), {})
  })

  test('reads only dependencies even when other dep keys exist', () => {
    const f = tmpJson({
      dependencies: { 'pkg.a': '1.0.0' },
      devDependencies: { 'pkg.b': '2.0.0' },
    })
    const deps = parseDepsFromPackageJson(f)
    assert.ok('pkg.a' in deps)
    assert.ok(!('pkg.b' in deps))
  })
})

describe('parseDepsFromPackageJson — error handling', () => {
  test('throws on malformed JSON', () => {
    const f = path.join(os.tmpdir(), `bad-${Date.now()}.json`)
    fs.writeFileSync(f, '{ not: valid json }')
    assert.throws(() => parseDepsFromPackageJson(f))
  })

  test('throws when file does not exist', () => {
    assert.throws(() => parseDepsFromPackageJson('/no/such/file.json'))
  })
})
