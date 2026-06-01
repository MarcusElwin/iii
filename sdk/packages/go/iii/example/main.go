// Command example is a hello-world iii worker, mirroring the Node SDK README's
// hello-world (sdk/packages/node/iii/README.md). It registers a function, binds an HTTP
// trigger to it, invokes it once to show the round trip, then serves until interrupted
// so the HTTP trigger can be exercised against a running engine.
//
// Run it against a local engine:
//
//	iii project init      # in another terminal, starts the engine on :49134 / :3111
//	go run ./example       # from sdk/packages/go/iii
//	curl -X POST localhost:3111/greet -d '{"name":"world"}'
package main

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	iii "github.com/iii-hq/iii/sdk/packages/go/iii"
)

// greetInput is the payload hello::greet expects.
type greetInput struct {
	Name string `json:"name"`
}

// greetOutput is what it returns.
type greetOutput struct {
	Message string `json:"message"`
}

func main() {
	url := os.Getenv("III_URL")
	if url == "" {
		url = iii.DefaultEngineURL
	}

	client := iii.New(url)

	// Register the function. The handler receives the raw JSON payload and returns any
	// value, which the SDK marshals into the invocation result.
	if err := client.RegisterFunction("hello::greet", func(ctx context.Context, data json.RawMessage) (any, error) {
		var in greetInput
		if err := json.Unmarshal(data, &in); err != nil {
			return nil, err
		}
		if in.Name == "" {
			in.Name = "world"
		}
		return greetOutput{Message: "Hello, " + in.Name + "!"}, nil
	}); err != nil {
		log.Fatalf("register function: %v", err)
	}

	// Bind an HTTP trigger so the engine exposes the function at POST /greet.
	if err := client.RegisterTrigger(
		"hello-http",
		"http",
		"hello::greet",
		json.RawMessage(`{"api_path":"/greet","http_method":"POST"}`),
		nil,
	); err != nil {
		log.Fatalf("register trigger: %v", err)
	}

	// Connect and run the registration handshake.
	connectCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := client.Connect(connectCtx); err != nil {
		log.Fatalf("connect to engine at %s: %v", url, err)
	}
	defer client.Close()
	log.Printf("worker connected to %s", url)

	// Invoke the function once over the socket to show the await round trip.
	callCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	result, err := client.Trigger(callCtx, iii.TriggerRequest{
		FunctionID: "hello::greet",
		Data:       json.RawMessage(`{"name":"world"}`),
	})
	if err != nil {
		log.Printf("trigger hello::greet: %v", err)
	} else {
		log.Printf("hello::greet returned: %s", result)
	}

	// Serve until interrupted so the HTTP trigger stays live.
	log.Print("serving; POST to /greet on the engine's HTTP port, or Ctrl-C to exit")
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	<-sig
	log.Print("shutting down")
}
