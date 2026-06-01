# torchlab/fhir-check

Validates your FHIR IG's dependencies against the [TorchLab registry](https://torchlab.dev).

## Usage

```yaml
- uses: torchlab/fhir-check@v1
```

Or with options:

```yaml
- uses: torchlab/fhir-check@v1
  with:
    sushi-config: sushi-config.yaml   # default
    fail-on-missing: true             # default: fail if dep not in registry
    fail-on-deprecated: false         # default: warn only on stale deps
```

## What it checks

- All dependencies declared in `sushi-config.yaml` (or `package.json`) exist in the TorchLab registry
- Optionally warns when a dependency hasn't published a new version in 2+ years

Core HL7 packages (`hl7.fhir.r4.core`, `hl7.terminology.*` etc.) are skipped — they're always present.

## Outputs

| Output | Description |
|---|---|
| `deps-found` | Number of dependencies found in registry |
| `deps-missing` | Number of dependencies not found |
| `deps-total` | Total dependencies checked |

## Full workflow example

```yaml
name: FHIR IG validation
on: [push, pull_request]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: torchlab/fhir-check@v1
        with:
          fail-on-missing: true
          fail-on-deprecated: true
```

## Why

If one of your dependencies removes a version or is abandoned, you'll know before your IG Publisher build fails in production.

Every badge embedded in an IG README using `torchlab/fhir-check` creates a live dependency on the TorchLab registry — which is the point.

---

This action uses the [TorchLab Public API](https://torchlab.dev/docs/api). No token required.
