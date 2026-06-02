// Module for the iii Go SDK examples. It depends on the sibling iii module via a
// replace directive pointing at ../iii, so the examples build against the local SDK
// source (there is no published module tag yet). Mirrors how the Rust iii-example uses
// `iii-sdk = { path = "../iii" }` and the Node one uses `iii-sdk: workspace:*`.
module github.com/iii-hq/iii/sdk/packages/go/iii-example

go 1.23

require github.com/iii-hq/iii/sdk/packages/go/iii v0.0.0

require (
	github.com/coder/websocket v1.8.14 // indirect
	github.com/google/uuid v1.6.0 // indirect
)

replace github.com/iii-hq/iii/sdk/packages/go/iii => ../iii
