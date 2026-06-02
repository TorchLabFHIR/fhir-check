// Unit tests: setOutput — GITHUB_OUTPUT vs legacy ::set-output
const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { setOutput } = require('../../index.js')

function withOutputFile(fn) {
  const outFile = path.join(os.tmpdir(), `github-out-${Date.now()}.txt`)
  fs.writeFileSync(outFile, '')
  const saved = process.env.GITHUB_OUTPUT
  process.env.GITHUB_OUTPUT = outFile
  try {
    fn(outFile)
  } finally {
    if (saved === undefined) delete process.env.GITHUB_OUTPUT
    else process.env.GITHUB_OUTPUT = saved
    if (fs.existsSync(outFile)) fs.unlinkSync(outFile)
  }
}

function withoutOutputFile(fn) {
  const saved = process.env.GITHUB_OUTPUT
  delete process.env.GITHUB_OUTPUT
  const writes = []
  const origWrite = process.stdout.write.bind(process.stdout)
  process.stdout.write = (chunk, ...rest) => { writes.push(String(chunk)); return origWrite(chunk, ...rest) }
  try {
    fn(writes)
  } finally {
    process.stdout.write = origWrite
    if (saved !== undefined) process.env.GITHUB_OUTPUT = saved
  }
}

describe('setOutput — GITHUB_OUTPUT file (modern path)', () => {
  test('writes name=value to GITHUB_OUTPUT file', () => {
    withOutputFile(outFile => {
      setOutput('deps-found', '3')
      const content = fs.readFileSync(outFile, 'utf8')
      assert.ok(content.includes('deps-found=3'), `Expected 'deps-found=3' in ${content}`)
    })
  })

  test('appends a newline after each output entry', () => {
    withOutputFile(outFile => {
      setOutput('deps-found', '3')
      const content = fs.readFileSync(outFile, 'utf8')
      assert.ok(content.endsWith('\n'), 'Expected trailing newline')
    })
  })

  test('appends multiple outputs without overwriting', () => {
    withOutputFile(outFile => {
      setOutput('deps-found', '2')
      setOutput('deps-missing', '1')
      setOutput('deps-total', '3')
      const content = fs.readFileSync(outFile, 'utf8')
      assert.ok(content.includes('deps-found=2'))
      assert.ok(content.includes('deps-missing=1'))
      assert.ok(content.includes('deps-total=3'))
    })
  })

  test('does NOT write ::set-output to stdout when GITHUB_OUTPUT is set', () => {
    const stdoutWrites = []
    const origWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = (chunk, ...rest) => { stdoutWrites.push(String(chunk)); return origWrite(chunk, ...rest) }
    try {
      withOutputFile(() => {
        setOutput('deps-found', '3')
      })
    } finally {
      process.stdout.write = origWrite
    }
    const combined = stdoutWrites.join('')
    assert.ok(!combined.includes('::set-output'), `Deprecated ::set-output found in stdout: ${combined}`)
  })

  test('works with numeric string values', () => {
    withOutputFile(outFile => {
      setOutput('deps-total', '0')
      const content = fs.readFileSync(outFile, 'utf8')
      assert.ok(content.includes('deps-total=0'))
    })
  })
})

describe('setOutput — legacy fallback (no GITHUB_OUTPUT)', () => {
  test('falls back to ::set-output format on stdout', () => {
    withoutOutputFile(writes => {
      setOutput('deps-found', '5')
      const combined = writes.join('')
      assert.ok(
        combined.includes('::set-output name=deps-found::5'),
        `Expected legacy ::set-output in stdout, got: ${combined}`
      )
    })
  })
})

describe('setOutput — output name coverage (action contract)', () => {
  const requiredOutputs = ['deps-found', 'deps-missing', 'deps-total']

  for (const outputName of requiredOutputs) {
    test(`can write the required output "${outputName}"`, () => {
      withOutputFile(outFile => {
        setOutput(outputName, '0')
        const content = fs.readFileSync(outFile, 'utf8')
        assert.ok(content.includes(`${outputName}=0`))
      })
    })
  }
})
