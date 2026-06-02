# iii Go SDK — test, CI & publish plan (for #1719)

Thanks for the thorough guidance, @sergiofilhowz — agreed on all of it. Here is the
plan before we go further. It deliberately mirrors the Rust SDK end to end (tests under
`sdk/packages/rust/iii/tests`, the `sdk-rust-ci` job, and `_rust-cargo.yml`) so a Go
contributor and a Go suite slot into the conventions you already maintain.

> **Decisions confirmed (maintainer reply, 2026-06-02):**
> - **Versioning = option (a), lockstep dual-tag.** `iii/vX.Y.Z` cannot satisfy a Go
>   subdirectory module, so `release-iii.yml` gets a new step that also pushes
>   `sdk/packages/go/iii/vX.Y.Z` on the release commit.
> - **Channels moves into v1 scope** ("a big part of iii"). This requires building
>   `channels.go` first, then `data_channels_test.go`. See §2.

## 1. Current state (already pushed on the branch)

The transport core exists and is unit-tested in-package:

- `protocol.go` — every wire message, golden-frame tested against the engine's own
  serde tests in `engine/src/protocol.rs` (the `trigger_type` rename, fire-and-forget
  `invocation_id`, null `request_format`/`response_format`, void/enqueue actions).
- `constants.go`, `errors.go`, `triggers.go` — endpoints, reconnect defaults,
  `runtime: "go"`, typed errors.
- `client.go` — connect, reconnect-with-backoff (Node formula), offline buffer,
  registries, pending-invocation map, await/void/enqueue `Trigger`, inbound invoke +
  trigger dispatch, ping/pong, graceful `Close`. Ported with `iii.rs`/`iii.ts` line
  citations.
- `mockengine_test.go` + `*_test.go` — fast unit tests (no engine), 82% coverage.
- `example/` — hello-world worker, **verified end-to-end against `iiidev/iii:latest`**
  (`POST /greet` → `call hello::greet`, trace tree `ok`).

These unit tests stay (fast, hermetic, run on every push). The work below is the
**live-engine integration parity** you're asking for.

## 2. Test plan — live-engine integration suite

Tests live in **`sdk/packages/go/iii/tests/`** (separate `iii_test` package, build-tagged
`//go:build integration`) and run against a **live engine started from the CI binary
artifact**, exactly like `sdk-rust-ci`. They honor `III_URL` / `III_HTTP_URL`.

Port-for-port coverage of the existing Rust/Python/Node suites. Proposed files and what
each asserts:

| File | Mirrors | Asserts |
|---|---|---|
| `bridge_test.go` | `bridge.rs` | connect, register, invoke→result roundtrip, reconnect + re-register after engine drop |
| `registration_dedup_test.go` | `registration_dedup.rs` | re-register on reconnect does not duplicate functions/triggers on the engine |
| `worker_metadata_test.go` | `register-worker-metadata.test.ts` | `engine::workers::register` payload: `runtime:"go"`, name, os, pid; visible via `engine::workers::list` |
| `api_triggers_test.go` | `api_triggers.rs` | HTTP trigger registration; `POST` routes through the engine to the handler and back (the envelope we verified) |
| `payload_test.go` | `payload_capture.rs` | request/response payloads survive the roundtrip byte-for-byte, incl. unicode + nested JSON |
| `healthcheck_test.go` | `healthcheck.rs` | worker stays registered; `engine::workers::list`/`info` reflect it |
| `errors_test.go` | `errors.test.ts` | remote error → `*InvocationError` with `code`; RBAC `FORBIDDEN`; timeout → `ErrTimeout` |
| `trigger_registration_error_test.go` | `trigger-registration-error.test.ts` | `trigger_type_not_found` / `trigger_registration_failed` paths |
| `queue_integration_test.go` | `queue_integration.rs` | enqueue action routes via a named queue and awaits the receipt |
| `state_test.go` | `state.rs` | (if in v1 scope) state get/set via engine builtins |

**Out of v1 scope, called out explicitly** (follow-up PRs, to avoid derailing): channels
/ streams (`channels.rs`, `stream.rs`), full OTel span propagation + `span-ops`
(`span_ops_api.rs`), pubsub, middleware, data-channels. The wire already carries
`traceparent`/`baggage`; v1 ships it as a no-op seam and the integration suite asserts it
is echoed, with real OTel wiring as the next PR. **Question for you:** which of these are
acceptance-blocking for the first merge vs. fast-follow?

Local run: `go test ./...` (unit) and `go test -tags integration ./tests/...` with a
running engine. Bar: all green, race-clean (`-race`), `go vet` + `gofmt` clean.

## 3. CI pipeline — `sdk-go-ci`

A new job in `ci.yml`, modeled exactly on `sdk-rust-ci` (`needs: engine-build`, download
`iii-binary`, start via `scripts/start-iii.sh --config sdk/fixtures/config-test.yaml
--port 49199`, run, stop via `scripts/stop-iii.sh`):

```yaml
sdk-go-ci:
  name: SDK Go Tests
  needs: engine-build
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-go@v5
      with: { go-version: '1.23', cache-dependency-path: sdk/packages/go/iii/go.sum }
    - name: gofmt
      run: test -z "$(gofmt -l sdk/packages/go/iii)"
    - name: go vet
      working-directory: sdk/packages/go/iii
      run: go vet ./...
    - name: Unit tests (race)
      working-directory: sdk/packages/go/iii
      run: go test -race ./...
    - name: Download III binary
      uses: actions/download-artifact@v4
      with: { name: iii-binary }
    - name: Start III Engine
      run: |
        chmod +x ./iii
        bash scripts/start-iii.sh --config sdk/fixtures/config-test.yaml --port 49199
    - name: Integration tests
      working-directory: sdk/packages/go/iii
      env: { III_URL: ws://localhost:49199, III_HTTP_URL: http://localhost:3199 }
      run: go test -tags integration ./tests/...
    - name: Stop III Engine
      if: always()
      run: bash scripts/stop-iii.sh /tmp/iii-engine.pid
```

(Optional, if you want it: `staticcheck` and a `golangci-lint` gate — happy to add.)

## 4. Publish pipeline

Go is fundamentally different from npm / PyPI / crates.io and it changes what this step
even does. **There is no registry and nothing to upload.** A Go module is "published"
simply by pushing a git tag; consumers fetch it straight from the repo through the Go
module proxy. Reference: [Developing and publishing
modules](https://go.dev/doc/modules/developing) and [Publishing a
module](https://go.dev/doc/modules/publishing).

What this means concretely:

- **No secret, no account, no upload.** Unlike `_npm.yml` (`NPM_TOKEN`) and
  `_rust-cargo.yml` (`CARGO_REGISTRY_TOKEN`), the Go publish job needs **no credentials**.
- **The repo is the registry.** Once a matching tag exists on the public repo,
  `go get github.com/iii-hq/iii/sdk/packages/go/iii@<version>` works immediately;
  `proxy.golang.org` fetches from GitHub on first request and then caches that version
  immutably forever.
- **So the "publish" job is validate + dry-run + warm-the-proxy**, not an upload.

### The one hard constraint: subdirectory-scoped tags

> [!WARNING]
> The Go module lives in a subdirectory, so its release tag **must** be
> `sdk/packages/go/iii/vX.Y.Z` — not the repo's existing `iii/vX.Y.Z`. With the wrong
> tag, `go get …@vX.Y.Z` simply **fails to resolve**: the module looks unpublished even
> though the code is on `main`. This is the one decision that has to be settled before the
> publish job is wired up.

The module lives in a subdirectory (`sdk/packages/go/iii/`), and Go's rule for a module
**not at the repo root** is that its version tag **must be prefixed with the module's
path relative to the repo root** ([modules
reference](https://go.dev/ref/mod#vcs-version)). That is:

| | value |
|---|---|
| Module path | `github.com/iii-hq/iii/sdk/packages/go/iii` |
| Required tag for `v0.1.0` | **`sdk/packages/go/iii/v0.1.0`** |
| What will **not** resolve | bare `v0.1.0`, or the repo's existing `iii/v*` tag |

This directly conflicts with the current release tagging: `release-iii.yml` triggers on
**`iii/v*`** and derives the version via `VERSION="${TAG#iii/v}"`. An `iii/v0.17.0` tag
does **not** make the Go module resolvable — `go get …@v0.17.0` would fail. So the Go SDK
needs its own `sdk/packages/go/iii/vX.Y.Z` tag regardless of which option below you pick.

**Decision for you — how to version the Go SDK:**

- **(a) Lockstep, dual tag (my recommendation).** On each `iii/vX.Y.Z` release,
  `release-iii.yml` also pushes a `sdk/packages/go/iii/vX.Y.Z` tag on the same commit. Go
  SDK version tracks the engine, matching how the npm/py/rust SDKs version today. Cost:
  one extra `git tag … && git push origin …` in the `sdk-go` job.
- **(b) Independent versioning.** The Go SDK gets its own tag line on its own cadence.
  More flexible, but breaks the "everything ships at one version" model.

**Heads-up for later (not v0/v1):** at `v2.0.0`+ Go requires the **major version in the
import path** (`…/sdk/packages/go/iii/v2`) and a corresponding `/v2` on the module path in
`go.mod` ([major version
suffixes](https://go.dev/doc/modules/major-version)). Worth noting now so lockstep
doesn't surprise anyone if the engine crosses a major before the SDK is ready to.

### Proposed `sdk-go` job (fits the `sdk-npm` / `sdk-py` / `sdk-rust` fan-out)

Two pieces, mirroring the Rust pair (`_rust-cargo.yml` + the `sdk-rust` job) — minus the
registry token, which Go doesn't have. The single externally-visible action is the tag
push, so `dry_run` runs the *entire* validation path and just omits that one mutating
step — exactly what a dry-run should exercise.

**Caller in `release-iii.yml`** (mirrors `sdk-rust:`):

```yaml
sdk-go:
  name: SDK Go Publish
  needs: [setup, create-iii-release]
  if: ${{ !failure() && !cancelled() }}
  uses: ./.github/workflows/_go.yml
  with:
    package_path: sdk/packages/go/iii
    version: ${{ needs.setup.outputs.version }}
    dry_run: ${{ needs.setup.outputs.dry_run == 'true' }}
    slack_thread_ts: ${{ needs.setup.outputs.slack_ts }}
    slack_label: SDK Go (module)
  secrets:
    SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
    SLACK_CHANNEL_ID: ${{ secrets.SLACK_CHANNEL_ID }}
    # No registry token — Go has nothing to authenticate to.
```

**Reusable `_go.yml`** (mirrors `_rust-cargo.yml`):

```yaml
name: Go Module Publish

on:
  workflow_call:
    inputs:
      package_path: { description: 'Path to the Go module', required: true, type: string }
      version:      { description: 'Version, e.g. 0.1.0',   required: true, type: string }
      dry_run:      { description: 'Validate without tagging', required: false, type: boolean, default: false }
      slack_thread_ts: { required: false, type: string, default: '' }
      slack_label:     { required: false, type: string, default: '' }
    secrets:
      SLACK_BOT_TOKEN:  { required: false }
      SLACK_CHANNEL_ID: { required: false }

jobs:
  publish:
    name: Publish Go module
    runs-on: ubuntu-latest
    permissions:
      contents: write          # to push the version tag
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 } # full history so we can tag

      - uses: actions/setup-go@v5
        with: { go-version: '1.23', cache-dependency-path: ${{ inputs.package_path }}/go.sum }

      # Validation — runs in BOTH dry-run and real release.
      - name: Build, vet, test, verify
        working-directory: ${{ inputs.package_path }}
        run: |
          go build ./...
          go vet ./...
          go test ./...
          go mod verify

      # The only side effect — skipped on dry-run.
      - name: Push subdirectory-scoped module tag
        if: ${{ inputs.dry_run == false }}
        env:
          TAG: ${{ inputs.package_path }}/v${{ inputs.version }}
        run: |
          git tag "$TAG"
          git push origin "$TAG"

      - name: Verify the proxy resolves the published version
        if: ${{ inputs.dry_run == false }}
        env:
          GOPROXY: proxy.golang.org
        run: go list -m github.com/iii-hq/iii/sdk/packages/go/iii@v${{ inputs.version }}

      # (Slack in-progress / result steps copied verbatim from _rust-cargo.yml.)
```

How it differs from the existing publishers, at a glance:

| | `_rust-cargo.yml` / `_npm.yml` | `_go.yml` |
|---|---|---|
| Secret | `CARGO_REGISTRY_TOKEN` / `NPM_TOKEN` | **none** |
| Publish action | `cargo publish` / `npm publish` (uploads) | **`git push` a tag** |
| `dry_run` does | `cargo publish --dry-run` | full `build`/`vet`/`test`/`verify`, no tag |
| Extra permission | — | `contents: write` (to push the tag) |
| Tag shape | repo `iii/v*` | **`sdk/packages/go/iii/v*`** (subdir-scoped) |

## 5. Sequencing (so this doesn't derail your roadmap)

1. **This plan approved** (and the open questions above answered).
2. PR 1 — the integration `tests/` suite + `sdk-go-ci` in `ci.yml`, all green. (The
   transport code is already on the branch; this is the regression safety net you asked
   for, landing *with* it.)
3. PR 2 — `_go.yml` + `sdk-go` in `release-iii.yml` with dry-run.
4. Fast-follow PRs — OTel parity, then channels/streams, per your priority.

Open questions consolidated: (1) which surfaces are acceptance-blocking vs fast-follow;
(2) the Go module tag strategy (subdir-scoped vs independent); (3) want `staticcheck` /
`golangci-lint` in the Go CI gate? Happy to adjust any of this.