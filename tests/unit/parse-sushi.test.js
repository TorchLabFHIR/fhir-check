// Unit tests: parseDepsFromSushiConfig
const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { parseDepsFromSushiConfig } = require('../../index.js')

function tmpYaml(content) {
  const f = path.join(os.tmpdir(), `sushi-${Date.now()}-${Math.random().toString(36).slice(2)}.yaml`)
  fs.writeFileSync(f, content)
  return f
}

describe('parseDepsFromSushiConfig — basic parsing', () => {
  test('parses simple key: value dependencies', () => {
    const f = tmpYaml('dependencies:\n  hl7.fhir.us.core: 6.1.0\n  hl7.fhir.uv.sdc: current\n')
    assert.deepEqual(parseDepsFromSushiConfig(f), {
      'hl7.fhir.us.core': '6.1.0',
      'hl7.fhir.uv.sdc': 'current',
    })
  })

  test('handles "current" as a version string', () => {
    const f = tmpYaml('dependencies:\n  pkg.a: current\n')
    assert.equal(parseDepsFromSushiConfig(f)['pkg.a'], 'current')
  })

  test('handles prerelease version suffixes', () => {
    const f = tmpYaml('dependencies:\n  pkg.a: 2.0.0-ballot\n')
    assert.equal(parseDepsFromSushiConfig(f)['pkg.a'], '2.0.0-ballot')
  })

  test('parses dependencies with leading whitespace in realistic sushi-config', () => {
    const f = tmpYaml(
      'id: my.ig\nname: MyIG\nstatus: draft\nversion: 0.1.0\ndependencies:\n  hl7.fhir.us.core: 6.1.0\n  hl7.fhir.uv.sdc: current\nfhirVersion:\n  - 4.0.1\n'
    )
    const deps = parseDepsFromSushiConfig(f)
    assert.equal(Object.keys(deps).length, 2)
    assert.equal(deps['hl7.fhir.us.core'], '6.1.0')
    assert.equal(deps['hl7.fhir.uv.sdc'], 'current')
  })

  test('parses one-entry deps correctly', () => {
    const f = tmpYaml('dependencies:\n  pkg.only: 3.0.0\n')
    const deps = parseDepsFromSushiConfig(f)
    assert.equal(Object.keys(deps).length, 1)
    assert.equal(deps['pkg.only'], '3.0.0')
  })
})

describe('parseDepsFromSushiConfig — quote handling', () => {
  test('strips single-quoted version strings', () => {
    const f = tmpYaml("dependencies:\n  pkg.a: '1.2.3'\n")
    assert.equal(parseDepsFromSushiConfig(f)['pkg.a'], '1.2.3')
  })

  test('strips double-quoted version strings', () => {
    const f = tmpYaml('dependencies:\n  pkg.a: "1.2.3"\n')
    assert.equal(parseDepsFromSushiConfig(f)['pkg.a'], '1.2.3')
  })

  test('strips mixed-position quotes', () => {
    const f = tmpYaml("dependencies:\n  pkg.a: '6.1.0-ballot'\n")
    assert.equal(parseDepsFromSushiConfig(f)['pkg.a'], '6.1.0-ballot')
  })
})

describe('parseDepsFromSushiConfig — comment handling', () => {
  test('strips inline YAML comments', () => {
    const f = tmpYaml('dependencies:\n  pkg.a: 6.1.0 # stable release\n')
    assert.equal(parseDepsFromSushiConfig(f)['pkg.a'], '6.1.0')
  })

  test('strips inline comments with multiple hash characters', () => {
    const f = tmpYaml('dependencies:\n  pkg.a: current # see also https://example.com # note\n')
    assert.equal(parseDepsFromSushiConfig(f)['pkg.a'], 'current')
  })

  test('strips comments from quoted versions', () => {
    const f = tmpYaml("dependencies:\n  pkg.a: '6.1.0' # pinned\n")
    assert.equal(parseDepsFromSushiConfig(f)['pkg.a'], '6.1.0')
  })
})

describe('parseDepsFromSushiConfig — section boundary handling', () => {
  test('stops parsing at the next top-level key', () => {
    const f = tmpYaml('dependencies:\n  pkg.a: 1.0.0\nresources:\n  pkg.b: 2.0.0\n')
    const deps = parseDepsFromSushiConfig(f)
    assert.ok('pkg.a' in deps, 'expected pkg.a to be present')
    assert.ok(!('pkg.b' in deps), 'expected pkg.b to be absent (different section)')
  })

  test('does not include fhirVersion entries after deps', () => {
    const f = tmpYaml('dependencies:\n  pkg.a: 1.0.0\nfhirVersion:\n  - 4.0.1\n')
    const deps = parseDepsFromSushiConfig(f)
    assert.deepEqual(Object.keys(deps), ['pkg.a'])
  })
})

describe('parseDepsFromSushiConfig — empty / missing deps', () => {
  test('returns empty object when no dependencies section exists', () => {
    const f = tmpYaml('name: test-ig\nversion: 1.0.0\n')
    assert.deepEqual(parseDepsFromSushiConfig(f), {})
  })

  test('returns empty object when dependencies section has no entries', () => {
    const f = tmpYaml('dependencies:\nother: value\n')
    assert.deepEqual(parseDepsFromSushiConfig(f), {})
  })

  test('returns empty object for dependencies followed immediately by EOF', () => {
    const f = tmpYaml('dependencies:\n')
    assert.deepEqual(parseDepsFromSushiConfig(f), {})
  })

  test('returns empty object for empty file', () => {
    const f = tmpYaml('')
    assert.deepEqual(parseDepsFromSushiConfig(f), {})
  })
})

describe('parseDepsFromSushiConfig — indentation variants', () => {
  test('handles two-space indentation', () => {
    const f = tmpYaml('dependencies:\n  pkg.a: 1.0.0\n')
    assert.equal(parseDepsFromSushiConfig(f)['pkg.a'], '1.0.0')
  })

  test('handles four-space indentation', () => {
    const f = tmpYaml('dependencies:\n    pkg.a: 1.0.0\n')
    assert.equal(parseDepsFromSushiConfig(f)['pkg.a'], '1.0.0')
  })

  test('handles tab indentation', () => {
    const f = tmpYaml('dependencies:\n\tpkg.a: 1.0.0\n')
    assert.equal(parseDepsFromSushiConfig(f)['pkg.a'], '1.0.0')
  })
})

describe('parseDepsFromSushiConfig — error handling', () => {
  test('throws when file does not exist', () => {
    assert.throws(() => parseDepsFromSushiConfig('/no/such/path/sushi-config.yaml'))
  })
})
