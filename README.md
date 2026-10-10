# BOLT PayFlow Guard — PayPal Sandbox Approval Demo

Unfire's experimental payment-approval workflow for the PayPal AI Hackathon 2026. This repository implements a local AI recommendation, mandatory exact-amount human approval in the same process and optional PayPal Orders V2 Sandbox order creation. No captures, real money transfers, real PayPal endpoints or background execution.

## Test the no-credential functional demonstration

Requires Node.js 20+. No npm install needed.

    npm test
    npm run demo

Demo mode uses a canned simulated recommendation, NOT actual AI inference, and makes no network calls. Type APPROVE 1.00 EUR exactly to generate a mock-only order. Any other input blocks the workflow.

## Real local AI + PayPal Sandbox (test-only)

1. Install Ollama and pull qwen2.5:7b, or set OLLAMA_MODEL to a locally installed model. Start Ollama at 127.0.0.1:11434.
2. Create PayPal Sandbox client credentials at https://developer.paypal.com/ . NEVER use live credentials.
3. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET locally. Do not commit credentials.
4. Run:

    npm run sandbox

5. If the local AI suggests an appropriate sandbox test order, type APPROVE followed by the exact displayed amount and EUR. Refusal or a mismatched amount blocks the request.

The only PayPal endpoints in the new workflow are https://api-m.sandbox.paypal.com/v1/oauth2/token and https://api-m.sandbox.paypal.com/v2/checkout/orders . Sandbox order creation never calls a capture or live payment endpoint. For judging, a tester must provide their own PayPal Sandbox credentials and a running local Ollama instance. The no-credential demo alone does not prove that a real PayPal Sandbox API request or AI inference occurred.

## Changes made after 1 October 2026

- secure-flow.js: integrates local AI recommendation, exact-amount approval and PayPal Sandbox order creation.
- Strict AI plan parsing and demo-only 0.01–50.00 EUR limit.
- Human approval tied to exact displayed amount and unique order intent; reuse rejected in the same workflow.
- PayPal Sandbox endpoint is fixed in code, not configurable to the Live endpoint.
- Deprecated the previous BOLT_APPROVED=1 environment-variable authorization because this was not an adequate human approval mechanism.
- Automated unit tests use mocked HTTP requests, so tests require no keys or paid services.

## Boundaries

This is a single-operator terminal demonstration, not a production payment-authorization system. The terminal operator is not independently authenticated. There is no durable RBAC/SSO, cross-process replay defense, transaction signing by an external identity provider, regulatory certification, or full PayPal merchant checkout workflow. No real payments should be executed with this repository.

The standalone ai-recommend.js remains as an example. The old paypal-order.js has been disabled. Use secure-flow.js for the governed path.

Author: Omar Baró — Unfire — https://unfire.technology
