# iii Specifications

This directory contains the normative specifications for the iii protocol.

> **Status:** Working drafts. Not yet stabilised. **Licensing pending IP counsel review** — see each document's front matter. Do not implement against these documents in production until they reach `1.0` and final licence text is in place.

## Why this directory exists

The iii protocol is a first-class artifact, independent of any specific implementation. Anyone should be able to implement a conforming iii engine, worker, or intermediary by reading these documents — without reading the Rust source of the reference engine.

This directory is the source of truth for *what the protocol is*. The code in `engine/` is one implementation of it.

## Document set

The specification is split into multiple documents, each versioned independently. This allows the small, stable core to lock down quickly while companion documents continue to evolve.

| Document | Status | Description |
|---|---|---|
| [`core-protocol.md`](./core-protocol.md) | Draft v0.1 | The transport-agnostic core. Defines functions, triggers, workers, invocations, lifecycle, errors, versioning. |
| `wire-format-json.md` | Planned | Concrete encoding of abstract messages as JSON. |
| `binding-control-websocket.md` | Planned | Mapping of control-plane operations to a WebSocket session. |
| `binding-invocation-websocket-push.md` | Planned | Mapping of invocation-plane operations to a worker's active WebSocket session. |
| `binding-invocation-http.md` | Planned | Mapping of invocation-plane operations to HTTP requests against a registered URL. |
| `capability-iii.queue-v1.md` | Planned | Standard queue capability interface. |
| `capability-iii.state-v1.md` | Planned | Standard state capability interface. |
| `capability-iii.http-v1.md` | Planned | Standard HTTP entry capability interface. |
| `capability-iii.cron-v1.md` | Planned | Standard cron capability interface. |
| `capability-iii.pubsub-v1.md` | Planned | Standard pub/sub capability interface. |
| `capability-iii.observability-v1.md` | Planned | Standard observability capability interface. |
| `adapter-interfaces/` | Planned | Internal contracts for swappable backends of load-bearing capabilities. |
| `conformance-tests/` | Planned | Executable normative test suite. |
| `security-considerations.md` | Planned | Extended threat model and mitigations. |

## Design principles

These principles govern every drafting decision. Any proposed change to a spec document should be evaluated against them.

1. **Specify behaviour, not implementation.** The spec describes what a conforming engine and worker do from each other's perspective. No mention of programming languages, libraries, or runtime details. If two parties on the wire cannot tell the difference, they conform.
2. **Specify the minimum that makes interoperation possible. Nothing more.** Every additional `MUST` is a future compatibility constraint.
3. **Separate protocol from semantics from transport.** Wire format, lifecycle semantics, and transport binding are each defined separately so each can evolve independently.
4. **Three nouns. Function, Trigger, Worker.** The vocabulary is closed. New requirements must fit the existing abstractions, not expand them.
5. **Transport-agnostic core, transport-specific bindings.** Functions are reachable through pluggable invocation bindings. WebSocket, HTTP, and future transports are bindings, not part of the core.

## Versioning

Each document declares its own version using `MAJOR.MINOR.PATCH`. Versions advance independently per document.

The core protocol's stability is the highest priority: once at `1.0`, it changes only via `MINOR` additions or `MAJOR` breaks. Companion documents may iterate faster while still conforming to a stable core.

See `core-protocol.md` §7 for the full versioning rules.

## Conformance

A conforming implementation must pass the conformance test suite for the targets and bindings it claims to support. The test suite is normative; the prose specifications are the source of intent, and the tests are the operational definition of "conforming."

The test suite does not yet exist. Establishing it is a near-term priority.

## Governance and contribution

The process for proposing changes to these documents is being defined. In the interim:

- File an issue in the iii repository tagged `spec` for any proposed change.
- Substantive changes (new messages, new bindings, new capability interfaces, breaking changes) require maintainer review.
- Editorial changes (clarifications, fixes, examples) follow the standard contribution process.

## Open issues

Each document maintains its own list of open issues that must be resolved before it reaches `1.0`. See the **Open Issues** section in each document.

## Licensing

**Licensing is not yet finalised.** Each document carries a `License` field in its front matter; until counsel review is complete, that field reads "TBD pending IP counsel review."

The intended posture, subject to revision:

- A permissive open licence (current candidate: Apache License 2.0 or equivalent) for the spec text.
- A perpetual, worldwide, royalty-free patent licence to any party implementing the specification in a conforming manner.
- Defensive termination only.

Until that posture is confirmed in writing, no rights are granted by the publication of these documents. They are provided for review and comment only.

## Prior art

These specifications stand on the shoulders of many existing protocols. See the Acknowledgements section of each document for the specific influences. The most direct stylistic and structural inspirations are:

- Language Server Protocol (LSP) — for the bidirectional, registration-driven shape.
- gRPC — for the separation of service definition from transport binding.
- OpenTelemetry Protocol (OTLP) — for versioned bindings-per-transport documentation families.
- W3C Trace Context — for trace propagation requirements.
- Model Context Protocol (MCP) — for the model of an open registry of capability servers behind a uniform protocol.
