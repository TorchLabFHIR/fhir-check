// Unit tests: CORE_SKIP constant and filtering behavior
const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { CORE_SKIP } = require('../../index.js')

const EXPECTED_CORE_PACKAGES = [
  'hl7.fhir.r4.core',
  'hl7.fhir.r4b.core',
  'hl7.fhir.r5.core',
  'hl7.fhir.r3.core',
  'hl7.fhir.r2.core',
  'hl7.terminology',
  'hl7.terminology.r4',
  'hl7.terminology.r5',
]

describe('CORE_SKIP — required packages', () => {
  for (const pkg of EXPECTED_CORE_PACKAGES) {
    test(`contains "${pkg}"`, () => {
      assert.ok(CORE_SKIP.has(pkg), `CORE_SKIP is missing required entry: "${pkg}"`)
    })
  }

  test('is a Set for O(1) lookup', () => {
    assert.ok(CORE_SKIP instanceof Set)
  })

  test('contains exactly the expected 8 packages', () => {
    assert.equal(CORE_SKIP.size, EXPECTED_CORE_PACKAGES.length)
  })
})

describe('CORE_SKIP — non-core packages are NOT skipped', () => {
  const nonCorePkgs = [
    'hl7.fhir.us.core',
    'hl7.fhir.uv.sdc',
    'hl7.fhir.us.davinci-pdex',
    'hl7.fhir.us.davinci-hrex',
    'hl7.fhir.uv.ipa',
    'ihe.formatcode.fhir',
    'us.nlm.vsac',
  ]

  for (const pkg of nonCorePkgs) {
    test(`does NOT skip "${pkg}"`, () => {
      assert.ok(!CORE_SKIP.has(pkg), `CORE_SKIP incorrectly contains "${pkg}"`)
    })
  }
})

describe('CORE_SKIP — filtering logic', () => {
  test('removes all core packages from a mixed list', () => {
    const all = [
      ['hl7.fhir.r4.core', '4.0.1'],
      ['hl7.fhir.us.core', '6.1.0'],
      ['hl7.terminology', 'current'],
      ['hl7.fhir.uv.sdc', 'current'],
    ]
    const filtered = all.filter(([k]) => !CORE_SKIP.has(k))
    assert.equal(filtered.length, 2)
    assert.ok(filtered.some(([k]) => k === 'hl7.fhir.us.core'))
    assert.ok(filtered.some(([k]) => k === 'hl7.fhir.uv.sdc'))
  })

  test('returns all entries when none are core packages', () => {
    const all = [
      ['hl7.fhir.us.core', '6.1.0'],
      ['hl7.fhir.uv.sdc', 'current'],
    ]
    const filtered = all.filter(([k]) => !CORE_SKIP.has(k))
    assert.equal(filtered.length, 2)
  })

  test('returns empty array when all deps are core packages', () => {
    const all = EXPECTED_CORE_PACKAGES.map(pkg => [pkg, 'current'])
    const filtered = all.filter(([k]) => !CORE_SKIP.has(k))
    assert.equal(filtered.length, 0)
  })

  test('returns empty array for empty input', () => {
    const filtered = [].filter(([k]) => !CORE_SKIP.has(k))
    assert.equal(filtered.length, 0)
  })
})
