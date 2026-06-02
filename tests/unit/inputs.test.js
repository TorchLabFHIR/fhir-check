// Unit tests: getInput, fail-on-missing, fail-on-deprecated flag logic
const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { getInput } = require('../../index.js')

function withEnv(key, value, fn) {
  const envKey = `INPUT_${key.replace(/-/g, '_').toUpperCase()}`
  const saved = process.env[envKey]
  if (value === undefined) delete process.env[envKey]
  else process.env[envKey] = value
  try { fn() } finally {
    if (saved === undefined) delete process.env[envKey]
    else process.env[envKey] = saved
  }
}

describe('getInput', () => {
  test('returns the env var value when set', () => {
    withEnv('sushi-config', 'my-config.yaml', () => {
      assert.equal(getInput('sushi-config', 'sushi-config.yaml'), 'my-config.yaml')
    })
  })

  test('returns the default when env var is not set', () => {
    withEnv('sushi-config', undefined, () => {
      assert.equal(getInput('sushi-config', 'sushi-config.yaml'), 'sushi-config.yaml')
    })
  })

  test('returns empty string when no default given and env var is not set', () => {
    withEnv('some-unset-input', undefined, () => {
      assert.equal(getInput('some-unset-input'), '')
    })
  })

  test('converts hyphens to underscores in env var name', () => {
    withEnv('fail-on-missing', 'false', () => {
      assert.equal(getInput('fail-on-missing', 'true'), 'false')
    })
  })

  test('is case-insensitive to input names (converted to uppercase)', () => {
    process.env['INPUT_SUSHI_CONFIG'] = 'override.yaml'
    try {
      assert.equal(getInput('sushi-config', 'sushi-config.yaml'), 'override.yaml')
    } finally {
      delete process.env['INPUT_SUSHI_CONFIG']
    }
  })
})

describe('fail-on-missing flag logic', () => {
  test('is true by default (env var not set)', () => {
    withEnv('fail-on-missing', undefined, () => {
      assert.equal(getInput('fail-on-missing', 'true') !== 'false', true)
    })
  })

  test('is false when set to exactly "false"', () => {
    withEnv('fail-on-missing', 'false', () => {
      assert.equal(getInput('fail-on-missing', 'true') !== 'false', false)
    })
  })

  test('is true when set to "true"', () => {
    withEnv('fail-on-missing', 'true', () => {
      assert.equal(getInput('fail-on-missing', 'true') !== 'false', true)
    })
  })

  test('is true when set to "yes" (only exact "false" disables it)', () => {
    withEnv('fail-on-missing', 'yes', () => {
      assert.equal(getInput('fail-on-missing', 'true') !== 'false', true)
    })
  })

  test('is true when set to "1"', () => {
    withEnv('fail-on-missing', '1', () => {
      assert.equal(getInput('fail-on-missing', 'true') !== 'false', true)
    })
  })
})

describe('fail-on-deprecated flag logic', () => {
  test('is false by default (env var not set)', () => {
    withEnv('fail-on-deprecated', undefined, () => {
      assert.equal(getInput('fail-on-deprecated', 'false') !== 'false', false)
    })
  })

  test('is false when set to "false"', () => {
    withEnv('fail-on-deprecated', 'false', () => {
      assert.equal(getInput('fail-on-deprecated', 'false') !== 'false', false)
    })
  })

  test('is true when set to "true"', () => {
    withEnv('fail-on-deprecated', 'true', () => {
      assert.equal(getInput('fail-on-deprecated', 'false') !== 'false', true)
    })
  })
})
