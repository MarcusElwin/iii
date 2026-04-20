# iii Core Protocol Specification

**Version:** 0.1.0-draft
**Status:** Working Draft
**Date:** 2026-04-20
**License:** **TO BE DETERMINED** — pending IP counsel review. Until a final license is selected, this document is published for review purposes only. No grant of rights, express or implied, is made by its publication. A patent grant for conforming implementations is anticipated; see §22.

---

## Status of This Document

This is a working draft of the iii Core Protocol. It is incomplete, subject to change without notice, and not suitable for production use. Comments and proposed changes should be filed against the iii repository.

This document specifies the abstract protocol only. Wire encodings (e.g. JSON), transport bindings (e.g. WebSocket, HTTP), and capability interfaces (e.g. `iii.queue/v1`) are defined in companion documents listed in §21.

---

## Abstract

The iii Core Protocol defines an abstract message-based protocol for registering, discovering, and invoking named units of work — *functions* — together with the event sources that cause them to run — *triggers* — and the entities that provide or invoke them — *workers*. The protocol is transport-agnostic: implementations bind it to one or more concrete transports specified in companion documents. The protocol is wire-format-agnostic: implementations bind it to one or more concrete encodings specified in companion documents.

The protocol's design goals are: a small closed vocabulary of three abstractions (function, trigger, worker); independence of any specific transport, encoding, or implementation language; suitability for both polyglot in-process composition and federated cross-organisation execution; and explicit versioning to support long-lived ecosystem implementations.

---

## 1. Notational Conventions

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHALL NOT**, **SHOULD**, **SHOULD NOT**, **RECOMMENDED**, **MAY**, and **OPTIONAL** in this document are to be interpreted as described in BCP 14 (RFC 2119, RFC 8174) when, and only when, they appear in all capitals.

The term *implementation* refers to any software that claims conformance to this specification (see §4).

---

## 2. Table of Contents

1. Notational Conventions
2. Table of Contents
3. Introduction
4. Conformance
5. Terminology
6. Architecture Overview
7. Versioning
8. The Function Abstraction
9. The Trigger Abstraction
10. The Worker Abstraction
11. Sessions and Lifecycle
12. The Invocation Model
13. Identity, Authentication, and Authorisation
14. Observability Requirements
15. Error Model
16. Extensibility
17. Capability Interfaces
18. Security Considerations
19. Registries
20. Open Issues
21. Companion Documents
22. Intellectual Property Considerations
23. Acknowledgements and Prior Art

---

## 3. Introduction

The iii Core Protocol describes the messages exchanged between an **Engine** and one or more **Workers** to:

- Register and discover named **Functions** that perform work.
- Register **Triggers** that invoke those functions in response to events.
- Invoke functions and observe their results.
- Propagate distributed trace context across all of the above.

The protocol is intentionally minimal. It does not specify how functions execute, how state is stored, how queues are implemented, how observability is collected, or how the engine is deployed. These concerns are addressed by capability interfaces (§17) and by implementations.

This document specifies *what* messages exist and *what they mean*. It does not specify *how* they are encoded on a wire (see Wire Format companion documents) or *how* they are transported (see Binding companion documents).

---

## 4. Conformance

### 4.1 Conformance Targets

This specification defines four conformance targets:

- A **Conforming Engine** implements the abstract semantics defined in this document and supports at least one Control Plane Binding and at least one Invocation Binding.
- A **Conforming Worker** implements the abstract semantics required of workers and supports at least one Control Plane Binding compatible with an engine it intends to interoperate with.
- A **Conforming Invocation Target** is any addressable entity that can receive invocations through at least one Invocation Binding. A Conforming Worker is also a Conforming Invocation Target; an external HTTP endpoint registered through an HTTP Invocation Binding is a Conforming Invocation Target without being a Conforming Worker.
- A **Conforming Intermediary** relays messages between engines and workers (e.g. bridges, proxies, federation gateways) without altering protocol semantics.

### 4.2 Required and Optional Behaviour

An implementation MUST satisfy every requirement marked **MUST** or **REQUIRED** that applies to its conformance target. An implementation SHOULD satisfy every requirement marked **SHOULD** or **RECOMMENDED**, and MAY satisfy requirements marked **MAY** or **OPTIONAL**.

### 4.3 Conformance Test Suite

A normative Conformance Test Suite is published alongside this specification (see §21). An implementation that passes the Conformance Test Suite for its declared targets and bindings is presumed conforming.

### 4.4 Extensions

Implementations MAY define and use extension messages, fields, or capabilities (see §16). An implementation that uses an extension MUST still conform to all REQUIRED behaviour of the core protocol.

---

## 5. Terminology

For the purposes of this document, the following terms are defined:

- **Engine** — A conforming implementation that maintains the registry of functions, triggers, and workers, and that routes invocations among them.
- **Worker** — An entity that participates in the protocol via a Control Plane Binding, registers and serves functions, and may register and emit triggers.
- **Function** — A named, schema-described, network-addressable unit of work. Identified by a Function ID.
- **Function ID** — A string identifying a function within an engine. Function IDs use the namespace separator `::` (e.g. `orders::validate`).
- **Trigger** — A registered binding from an event source to a function, optionally with engine-side routing or queueing behaviour.
- **Trigger Type** — A kind of event source (e.g. `http`, `cron`, `queue`). Trigger types are themselves registered through the protocol and are extensible.
- **Invocation** — A single execution of a function, identified by an Invocation ID, with input data and either a result or an error.
- **Invocation ID** — A globally unique identifier for an invocation. RECOMMENDED to be a UUID v4 or v7.
- **Control Plane** — The set of operations relating to registration, discovery, lifecycle, and observability of workers, functions, and triggers.
- **Invocation Plane** — The set of operations relating to executing a function and returning its result.
- **Control Plane Binding** — A specification mapping control-plane operations to a concrete transport.
- **Invocation Binding** — A specification mapping invocation-plane operations to a concrete transport, on a per-function basis.
- **Capability Interface** — A standardised contract defining a set of function IDs, schemas, and behavioural guarantees that an implementor commits to (e.g. `iii.queue/v1`).
- **Session** — A live association between a worker and an engine, established through a Control Plane Binding.

---

## 6. Architecture Overview

The protocol describes interactions among three role abstractions:

```
┌──────────┐        Control plane         ┌──────────┐
│          │◄────── (registration,    ───►│          │
│  Worker  │        events, lifecycle)    │  Engine  │
│          │                              │          │
│          │◄────── Invocation plane ────►│          │
└──────────┘        (per-function)        └──────────┘
                                                │
                                                │  Invocation plane
                                                ▼
                                          ┌──────────┐
                                          │ External │
                                          │  target  │
                                          │ (HTTP,   │
                                          │  gRPC…)  │
                                          └──────────┘
```

Functions are abstract callables identified by Function ID. The transport by which the engine reaches a given function is a property of that function's registration, not a property of the protocol. A function MAY be reachable through:

- A Control Plane Binding session held by the worker that registered it (the engine pushes invocations to that session).
- An Invocation Binding identified by an explicit reference (e.g. an HTTP URL) supplied at registration time.
- Any future Invocation Binding defined in a companion document.

This separation is fundamental: it allows existing services with no awareness of iii to be registered as functions, and allows the protocol to accommodate new transports without altering the core abstractions.

---

## 7. Versioning

### 7.1 Version Identifier

Each version of this specification is identified by a string of the form `MAJOR.MINOR.PATCH` (semantic versioning).

- A **PATCH** increment indicates editorial changes only; no implementation behaviour need change.
- A **MINOR** increment MAY add new optional messages, fields, or capabilities. Conforming implementations of an earlier MINOR version MUST remain conforming.
- A **MAJOR** increment MAY introduce backward-incompatible changes. Conforming implementations of a different MAJOR version are not required to interoperate.

### 7.2 Version Negotiation

Every Control Plane Binding MUST specify a version negotiation procedure exchanged at session establishment. The negotiation MUST result in either:

- An agreed protocol version supported by both parties; or
- A failure, in which case the session MUST be closed with a `version_mismatch` error (see §15).

### 7.3 Compatibility

A Conforming Engine SHOULD accept connections from workers implementing any MINOR version equal to or less than its own within the same MAJOR version. A Conforming Engine MUST reject connections from workers with a different MAJOR version unless it explicitly supports that version.

### 7.4 Field Forward Compatibility

Implementations MUST ignore unrecognised fields in received messages. Implementations MUST NOT reject messages solely because they contain fields not defined in the implementation's protocol version.

### 7.5 Experimental Fields

Experimental and implementation-specific fields MUST be prefixed with `x_`. Such fields MUST NOT be relied upon by other implementations and MAY be removed without notice. Field names without an `x_` prefix are reserved for this specification and its companion documents.

---

## 8. The Function Abstraction

### 8.1 Definition

A function is identified by a Function ID (§5). Each function has:

- A **Function ID** (REQUIRED).
- A **Description** (OPTIONAL, human-readable).
- A **Request Schema** (OPTIONAL, machine-readable; format defined by the wire-format binding, typically JSON Schema).
- A **Response Schema** (OPTIONAL, machine-readable).
- **Metadata** (OPTIONAL, opaque key-value attributes).
- An **Invocation Reference** (REQUIRED, see §8.3).

### 8.2 Function ID Naming

Function IDs MUST be UTF-8 strings of length 1 to 256 octets. They MUST NOT contain control characters (U+0000–U+001F, U+007F).

The substring `::` is RESERVED as a namespace separator. Function IDs SHOULD use `::` to separate logical scopes (e.g. `orders::validate`, `iii::state::get`). The namespace `iii::*` is RESERVED for use by this specification and its companion documents.

Function ID uniqueness is per-engine. Two different engines MAY register the same Function ID for different functions.

### 8.3 Invocation Reference

Each function registration MUST carry exactly one Invocation Reference, identifying how the engine reaches the function when it is invoked. An Invocation Reference identifies:

- The Invocation Binding (e.g. `control-session-push`, `http`, `grpc`).
- Binding-specific addressing parameters.

A function whose Invocation Reference is `control-session-push` is reachable only while the worker that registered it has an active session (§11). A function whose Invocation Reference is, for example, `http` is reachable independently of any session.

### 8.4 Registration

A function is registered by a `RegisterFunction` operation. The operation MUST include all REQUIRED fields above. The engine MUST acknowledge the registration with a `FunctionRegistrationResult` indicating success or a structured error (§15).

### 8.5 Conflicting Registrations

If a `RegisterFunction` operation refers to a Function ID already registered, the engine's behaviour is OPEN ISSUE §20.1.

### 8.6 Unregistration

A function is unregistered by an `UnregisterFunction` operation, by the loss of the registering worker's session (for `control-session-push` invocation references), or by engine-defined administrative action.

After unregistration, the engine MUST reject subsequent invocations of that Function ID with a `function_not_found` error (§15).

---

## 9. The Trigger Abstraction

### 9.1 Trigger Types

A Trigger Type identifies a category of event source (e.g. `http`, `cron`, `queue`). Trigger Types are themselves registered with the engine through `RegisterTriggerType`. This allows new event sources to be introduced without engine changes.

A Trigger Type registration includes:

- A **Trigger Type ID** (REQUIRED, e.g. `http`, `cron`).
- A **Description** (OPTIONAL).
- A **Trigger Configuration Schema** (OPTIONAL) defining the shape of valid trigger configurations of this type.
- A **Trigger Event Schema** (OPTIONAL) defining the shape of events fired by triggers of this type.

The Trigger Type IDs `iii.*` are RESERVED for use by this specification and its companion documents.

### 9.2 Triggers

A trigger binds an event source to a function. A trigger registration includes:

- A **Trigger ID** (REQUIRED, opaque identifier).
- A **Trigger Type ID** (REQUIRED, referencing a previously registered Trigger Type).
- A **Function ID** (REQUIRED, the function to invoke when the trigger fires).
- A **Configuration** (REQUIRED, conforming to the Trigger Type's Configuration Schema).
- **Metadata** (OPTIONAL).

### 9.3 Firing

When the conditions of a registered trigger are met, the engine MUST invoke the bound function according to the invocation model (§12), passing the trigger event as the function input, unless the trigger's configuration specifies an alternative outcome (§9.4).

### 9.4 Trigger Outcomes

A trigger MAY be configured with an outcome other than direct invocation. Defined outcomes are:

- **Direct invocation** (DEFAULT): the engine invokes the bound function and discards the result unless an explicit response channel is configured by the trigger type.
- **Enqueue**: the engine enqueues the trigger event onto a named queue (referenced by capability interface `iii.queue/v1`). Workers consuming that queue invoke the function.

Additional outcomes MAY be defined by future versions of this specification.

### 9.5 Unregistration

A trigger is unregistered by an `UnregisterTrigger` operation or by engine-defined administrative action. After unregistration, the trigger MUST NOT fire.

---

## 10. The Worker Abstraction

### 10.1 Definition

A worker is an entity that participates in the protocol via a Control Plane Binding. A worker MAY:

- Register one or more functions (§8).
- Register one or more triggers (§9).
- Register one or more Trigger Types (§9.1).
- Receive invocations of functions it has registered with `control-session-push` invocation references (§8.3).
- Emit trigger events for Trigger Types it has registered.

A worker is identified by a **Worker ID** assigned by the engine at session establishment (§11).

### 10.2 Worker Identity

The Worker ID is opaque, unique within the engine, and stable for the duration of a session. Whether a Worker ID persists across reconnection is OPEN ISSUE §20.2.

### 10.3 Worker Metrics

A worker MAY periodically report resource metrics (memory, CPU, runtime info) to the engine via the `WorkerMetrics` operation. The engine MAY use these for observability and routing. Metrics are advisory; their absence MUST NOT cause invocation failures.

---

## 11. Sessions and Lifecycle

### 11.1 Session Definition

A session is the live association between one worker and one engine, established through a Control Plane Binding. A worker MAY hold sessions with multiple engines simultaneously; an engine MAY hold sessions with arbitrarily many workers.

### 11.2 Session State Machine

```
   ┌─────────────┐
   │ Disconnected│
   └─────┬───────┘
         │ open
         ▼
   ┌─────────────┐
   │  Handshake  │──── version mismatch / auth fail ──┐
   └─────┬───────┘                                    │
         │ negotiated                                 │
         ▼                                            │
   ┌─────────────┐                                    │
   │Authenticated│                                    │
   └─────┬───────┘                                    │
         │ register completed                         │
         ▼                                            │
   ┌─────────────┐                                    │
   │   Active    │                                    │
   └─────┬───────┘                                    │
         │ shutdown / loss                            │
         ▼                                            ▼
   ┌─────────────┐                              ┌─────────┐
   │  Draining   │──────────────────────────────▶│ Closed  │
   └─────────────┘                               └─────────┘
```

### 11.3 Handshake

Every Control Plane Binding MUST specify a handshake exchanged at session open. The handshake MUST establish:

- The agreed protocol version (§7).
- The worker's identity claims (§13).
- The set of bindings supported by both parties.

On successful handshake, the engine MUST issue a `WorkerRegistered` message containing the assigned Worker ID. Until this message is received, the worker MUST NOT issue registration messages.

### 11.4 Heartbeats and Liveness

A Control Plane Binding MUST specify a heartbeat or liveness mechanism. If no heartbeat is received within a binding-defined timeout, the engine MUST treat the session as lost and transition it to `Closed`.

The protocol defines an abstract `Ping` / `Pong` exchange that bindings MAY use directly or replace with a transport-native mechanism.

### 11.5 Session Loss

When a session is lost (whether by graceful close or transport failure), the engine MUST:

1. Mark all functions registered by that worker with `control-session-push` invocation references as unreachable.
2. Mark all triggers registered by that worker as inactive.
3. Fire the standard event `iii::events::worker_disconnected` (§14.4).
4. Reject in-flight invocations targeting unreachable functions with a `worker_unavailable` error (§15).

Functions registered by the worker with non-session-bound invocation references (e.g. `http`) remain reachable independently of session state.

### 11.6 Reconnection

A worker MAY reconnect after session loss. Whether reconnection restores prior registrations automatically, or requires the worker to re-register, is OPEN ISSUE §20.2.

### 11.7 Graceful Shutdown

A worker that intends to shut down SHOULD enter `Draining` state by issuing a `Drain` message. In `Draining` state:

- The engine MUST NOT initiate new invocations to the worker.
- In-flight invocations MUST be allowed to complete or time out.
- The worker MAY explicitly close the session after in-flight invocations complete.

---

## 12. The Invocation Model

### 12.1 Invocation Operation

An invocation is an abstract operation with the following parameters:

- **Invocation ID** (REQUIRED).
- **Function ID** (REQUIRED).
- **Input data** (REQUIRED, MAY be empty/null).
- **Trace context** (REQUIRED, see §14).
- **Deadline** (OPTIONAL, absolute or relative timeout).
- **Caller identity** (REQUIRED, may be anonymous).

The invocation produces, exactly once per invocation:

- A **Result** (a value, optionally typed by the function's response schema), OR
- An **Error** (a structured error per §15).

### 12.2 Routing

Given a Function ID, the engine MUST resolve the function's Invocation Reference (§8.3) and dispatch the invocation through the corresponding Invocation Binding. If multiple workers have registered the same Function ID, the engine's selection behaviour is OPEN ISSUE §20.1.

### 12.3 Delivery Semantics

The core protocol guarantees **at-most-once** delivery for direct invocations. A function invocation that fails or times out is not automatically retried by the protocol. Retry, idempotency, and at-least-once semantics are properties of capability interfaces (e.g. `iii.queue/v1` provides at-least-once delivery for its enqueued invocations).

### 12.4 Cancellation

A caller MAY cancel an in-flight invocation by issuing a `CancelInvocation` operation referencing the Invocation ID. The engine MUST attempt to cancel the invocation but MUST NOT guarantee that cancellation prevents execution; partial execution and side effects are possible.

### 12.5 Streaming

The core protocol does NOT define streaming invocations. Streaming MAY be defined by a future version of this specification or by individual Invocation Bindings.

---

## 13. Identity, Authentication, and Authorisation

### 13.1 Scope

This specification defines the identity model in the abstract. Concrete authentication mechanisms (TLS client certificates, bearer tokens, signed handshakes, etc.) are defined by Control Plane Bindings.

### 13.2 Principals

The protocol recognises the following principal types:

- **Worker principal** — identifies a connected worker.
- **Service principal** — identifies a logical service that may comprise multiple workers (registered via `RegisterService`).
- **Caller principal** — identifies the originator of an invocation. May be a worker, the engine itself (for trigger-fired invocations), or an external identity (for invocations originating from a trigger such as HTTP with attached auth).

### 13.3 Authentication

Every session MUST be authenticated. A Control Plane Binding MUST specify how authentication credentials are presented and verified. An engine MUST reject sessions whose authentication fails with an `unauthenticated` error (§15).

### 13.4 Authorisation

The core protocol does not specify an authorisation model. Engines MAY implement RBAC, capability-based, or other authorisation schemes. When an authorisation check fails, the engine MUST respond with an `unauthorised` error (§15).

### 13.5 Identity Propagation

Caller identity MUST be propagated with every invocation, either as an explicit field or via the trace context's baggage. Bindings specify the concrete mechanism. Functions MAY use caller identity for their own authorisation decisions.

---

## 14. Observability Requirements

### 14.1 Trace Context Propagation

Every invocation message MUST carry W3C Trace Context (`traceparent`) and MAY carry W3C Baggage (`baggage`). Implementations MUST follow the propagation rules of the W3C Trace Context specification.

### 14.2 Span Emission

A Conforming Engine MUST emit at least one span per invocation, with at minimum the following attributes:

- `iii.function_id` — the invoked Function ID.
- `iii.invocation_id` — the Invocation ID.
- `iii.trigger_type` — the Trigger Type that initiated the invocation, if any.
- `iii.worker_id` — the Worker ID of the invocation target, if applicable.

A Conforming Worker SHOULD emit a span for the execution of the function within the engine's parent span.

### 14.3 Log Correlation

Logs emitted by workers and engines SHOULD include the active `trace_id` and `span_id` for correlation.

### 14.4 Standard Events

The following Trigger Type IDs are RESERVED and emitted by the engine for system events:

- `iii::events::worker_connected`
- `iii::events::worker_disconnected`
- `iii::events::function_registered`
- `iii::events::function_unregistered`
- `iii::events::trigger_registered`
- `iii::events::trigger_unregistered`

Workers MAY register triggers against these event types to react to system state changes.

---

## 15. Error Model

### 15.1 Error Structure

Every error returned by the protocol MUST conform to the following abstract structure:

- **`code`** (REQUIRED, string) — a stable identifier for the error category.
- **`message`** (REQUIRED, string) — a human-readable description.
- **`stacktrace`** (OPTIONAL, string) — implementation-defined diagnostic information.
- **`details`** (OPTIONAL, map) — structured additional information.

### 15.2 Reserved Error Codes

The following error codes are reserved by this specification:

| Code | Meaning |
|---|---|
| `version_mismatch` | Protocol version negotiation failed. |
| `unauthenticated` | Authentication failed or absent. |
| `unauthorised` | Caller is not permitted to perform the operation. |
| `function_not_found` | The referenced Function ID is not registered. |
| `trigger_not_found` | The referenced Trigger ID is not registered. |
| `worker_unavailable` | The target worker is unreachable. |
| `invocation_timeout` | The invocation exceeded its deadline. |
| `invocation_cancelled` | The invocation was cancelled by the caller. |
| `invalid_request` | The message is malformed or violates a schema. |
| `internal_error` | An unspecified engine-side error occurred. |
| `binding_error` | A transport- or binding-level error occurred (binding-specific details in `details`). |

Implementations MAY define additional codes. Implementation-defined codes SHOULD use a namespace prefix to avoid collision with future reserved codes.

### 15.3 Error Propagation

Errors raised by a function's execution MUST be returned to the caller as an Invocation Error with `code` populated by the function or by the binding. Errors raised by the engine itself MUST use a reserved code where applicable.

---

## 16. Extensibility

### 16.1 New Trigger Types

New event source categories MUST be introduced by registering a new Trigger Type (§9.1). No protocol change is required.

### 16.2 New Capability Interfaces

New standard capabilities MUST be introduced by publishing a new Capability Interface companion document (§17). No core protocol change is required.

### 16.3 New Invocation Bindings

New transports for the invocation plane MUST be introduced by publishing a new Invocation Binding companion document. The Invocation Reference field of `RegisterFunction` is open: any binding identifier registered in the iii Binding Registry (§19) is valid.

### 16.4 New Control Plane Bindings

New transports for the control plane MUST be introduced by publishing a new Control Plane Binding companion document.

### 16.5 New Message Types

New message types in the core protocol require a MINOR version increment of this specification. New message types MUST be optional: implementations of an earlier MINOR version MUST be able to operate without them.

### 16.6 Vendor Extensions

Implementations MAY define vendor-specific messages or fields using the `x_` prefix (§7.5). Such extensions MUST NOT conflict with future reserved names.

---

## 17. Capability Interfaces

A Capability Interface is a published contract defining a set of Function IDs, their schemas, and their behavioural guarantees. Examples include `iii.queue/v1`, `iii.state/v1`, `iii.http/v1`.

A Capability Interface specification MUST define:

- A unique identifier of the form `iii.<name>/v<major>` (or `<vendor>.<name>/v<major>` for non-iii capabilities).
- The Function IDs that an implementor of the interface MUST register.
- The request and response schemas of each function.
- The behavioural guarantees provided (delivery semantics, ordering, durability, isolation, etc.).
- A conformance test suite.

A worker that implements a Capability Interface MUST register it in its session metadata (mechanism defined by the Control Plane Binding) so that consumers may discover it.

This specification does not define any specific Capability Interface. Standard interfaces are published as separate companion documents.

---

## 18. Security Considerations

This section enumerates security considerations applicable to the abstract protocol. Bindings and capability interfaces define additional considerations specific to their concrete operations.

### 18.1 Trust Model

The engine is a trusted intermediary for all workers in its registry. A worker that connects to an engine implicitly trusts that engine to correctly route invocations, propagate identity, and emit telemetry. Implementations SHOULD provide mechanisms for workers to verify the identity of the engine they connect to.

### 18.2 Worker Trust

Workers in the same engine registry are not necessarily mutually trusting. The protocol does not provide isolation between workers; isolation, sandboxing, and capability scoping are responsibilities of the engine and of capability interfaces such as `iii.sandbox/v1` (when defined).

### 18.3 Function ID Squatting

Function IDs are first-come-first-served within an engine unless §20.1 is resolved otherwise. Operators of multi-tenant engines MUST implement namespace controls to prevent malicious workers from registering Function IDs that mask trusted functions.

### 18.4 Trace Context Tampering

`traceparent` and `baggage` are propagated by the protocol but their contents are not authenticated. Implementations MUST NOT make security decisions based on trace context alone. Caller identity (§13) is the authoritative source for authorisation decisions.

### 18.5 Schema Trust

Request and response schemas are advisory unless an engine explicitly enforces them. Workers MUST validate inputs they receive even when an engine claims schema enforcement.

### 18.6 Supply Chain

Workers installed from a registry of third-party packages constitute a supply-chain risk. Engines that support such installation SHOULD verify package provenance and SHOULD execute installed workers under a sandbox capability interface.

### 18.7 Denial of Service

The protocol places no limits on the rate or size of registrations, invocations, or events. Engines MUST implement rate limiting and resource quotas appropriate to their deployment.

---

## 19. Registries

The following registries are established by this specification. Each is maintained alongside this specification and updated by the same governance process.

### 19.1 Binding Registry

A registry of Invocation Binding identifiers and Control Plane Binding identifiers. Registration is per the iii governance process.

### 19.2 Capability Interface Registry

A registry of Capability Interface identifiers (e.g. `iii.queue/v1`). The `iii.*` namespace is reserved for capability interfaces published as iii specifications. Vendor namespaces (e.g. `acme.foo/v1`) are unreserved and managed by their owners.

### 19.3 Trigger Type Registry

A registry of well-known Trigger Type IDs. The `iii.*` namespace is reserved.

### 19.4 Error Code Registry

A registry of reserved error codes (§15.2). Additional codes MAY be proposed via the iii governance process.

---

## 20. Open Issues

Issues marked here are unresolved in this draft and MUST be resolved before this specification reaches `1.0`.

### 20.1 Conflicting Function ID Registrations

When two workers register the same Function ID, the engine's behaviour is undefined. Candidate resolutions:

- **Last-write-wins** (current implementation behaviour).
- **First-write-wins** (registration is rejected if the ID is already taken).
- **Replicas** (multiple registrations are treated as instances and load-balanced).
- **Versioned** (Function IDs include an implicit version; multiple versions may coexist).

### 20.2 Reconnection and Worker Identity

When a worker reconnects after a session loss, MUST it be assigned a new Worker ID? Or MAY it claim its prior Worker ID and have its prior registrations restored?

### 20.3 Streaming Invocations

The protocol does not currently define streaming. Should it, or should streaming be left to individual Invocation Bindings?

### 20.4 Invocation Authorisation

The current model places authorisation entirely at the engine and the function. Should the protocol define a standard authorisation negotiation, or remain silent?

### 20.5 Mid-Invocation Trigger Mutation

If a trigger is unregistered while an invocation it initiated is still in flight, what are the engine's obligations regarding the in-flight invocation?

---

## 21. Companion Documents

The following companion documents are part of the iii specification family and version independently of this document:

- **iii Wire Format: JSON** — concrete encoding of abstract messages as JSON.
- **iii Control Plane Binding: WebSocket** — mapping of control-plane operations to a WebSocket session.
- **iii Invocation Binding: WebSocket Push** — mapping of invocation-plane operations to a worker's active WebSocket session.
- **iii Invocation Binding: HTTP** — mapping of invocation-plane operations to HTTP requests against a registered URL.
- **iii Capability Interface: `iii.queue/v1`** — standard queue capability.
- **iii Capability Interface: `iii.state/v1`** — standard state capability.
- **iii Capability Interface: `iii.http/v1`** — standard HTTP entry capability.
- **iii Capability Interface: `iii.cron/v1`** — standard cron capability.
- **iii Capability Interface: `iii.pubsub/v1`** — standard pub/sub capability.
- **iii Capability Interface: `iii.observability/v1`** — standard observability capability.
- **iii Adapter Interfaces** — internal contracts for swappable backends of load-bearing capabilities.
- **iii Conformance Test Suite** — executable normative tests.
- **iii Security Considerations** — extended threat model and mitigations.

Each companion document carries its own version, status, and licence.

---

## 22. Intellectual Property Considerations

**This section is non-final and subject to revision before publication.**

The concepts described in this specification may be covered by one or more patents held by the publisher. It is the publisher's intent that:

- This specification will be published under a permissive open licence (current candidate: Apache License 2.0 or equivalent).
- A perpetual, worldwide, royalty-free patent licence will be granted to any party implementing this specification in a conforming manner.
- The patent licence will be terminable only upon initiation of patent litigation against the publisher by the licensee.

The exact licence text and patent grant language are pending review by intellectual-property counsel. Until such review is complete, this specification is published for review and comment only, and no rights are granted by its publication.

---

## 23. Acknowledgements and Prior Art

This specification draws on, and acknowledges its debt to, the following prior work:

- **W3C Trace Context** — for trace propagation semantics.
- **JSON-RPC 2.0** — for the abstract request/response message model.
- **Language Server Protocol (LSP)** — for the model of bidirectional, registration-driven, capability-negotiated protocols.
- **gRPC and Protocol Buffers** — for the separation of service definition from transport binding.
- **OpenTelemetry Protocol (OTLP)** — for the model of versioned, bindings-per-transport specification families.
- **AMQP 1.0** — for the model of separating an abstract protocol from its wire encodings.
- **Erlang/OTP** — for the model of named processes and registry-based discovery.
- **Dapr** — for the model of bindings as input event sources.
- **Model Context Protocol (MCP)** — for the model of an open registry of capability servers behind a uniform protocol.

The authors thank the iii community and contributors for their input on this specification.

---

**End of iii Core Protocol Specification, version 0.1.0-draft.**
