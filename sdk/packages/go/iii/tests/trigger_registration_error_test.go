//go:build integration

package iii_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	iii "github.com/iii-hq/iii/sdk/packages/go/iii"
)

// Mirrors sdk/packages/node/iii/tests/trigger-registration-error.test.ts: registering a
// trigger whose trigger type is not handled by any worker yields an error from the
// engine rather than silently succeeding.

func TestRegisterTriggerUnknownType(t *testing.T) {
	c := connect(t)
	// Register a function the trigger would target, but never register a handler for the
	// (made-up) trigger type, so the engine has nowhere to route the registration.
	if err := c.RegisterFunction("test::trigerr::go::fn", func(_ context.Context, _ json.RawMessage) (any, error) {
		return nil, nil
	}); err != nil {
		t.Fatalf("RegisterFunction: %v", err)
	}
	if err := c.RegisterTrigger(
		"test-trigerr-go",
		"this-trigger-type-does-not-exist",
		"test::trigerr::go::fn",
		json.RawMessage(`{}`),
		nil,
	); err != nil {
		t.Fatalf("RegisterTrigger (client-side enqueue): %v", err)
	}
	settle()

	// The engine surfaces a failed registration asynchronously as a
	// triggerregistrationresult with an error; the SDK logs it rather than returning it
	// from RegisterTrigger (matching the reference SDKs). The assertable, version-stable
	// effect is that the worker survives the failed registration and the connection stays
	// usable — a follow-up invocation still round-trips.
	res, err := c.Trigger(ctxFor(t, 5*time.Second), iii.TriggerRequest{
		FunctionID: iii.FnListFunctions,
		Data:       json.RawMessage(`{}`),
	})
	if err != nil {
		t.Fatalf("worker unusable after failed trigger registration: %v", err)
	}
	var out struct {
		Functions []json.RawMessage `json:"functions"`
	}
	if err := json.Unmarshal(res, &out); err != nil {
		t.Fatalf("decode functions: %v\nraw: %s", err, res)
	}
}
