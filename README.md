# BOLT Payflow Guard

BOLT Payflow Guard is a governed AI-to-payment workflow prototype for the PayPal AI Hackathon.

## Flow

1. A local AI model running in Ollama analyzes a natural-language payment request and returns a structured recommendation. The AI is advisory only and cannot execute payments.
2. A separate BOLT approval gate blocks the payment step unless explicit human approval is present.
3. After approval, the PayPal module authenticates with OAuth 2.0 and creates a PayPal Orders v2 Sandbox order.

## AI integration

The demo uses Ollama with `qwen2.5:7b` by default, so the AI part can run locally without cloud credentials.

Run:

`npm run ai -- "Pay 1 EUR for a test purchase"`

The model returns JSON with `should_pay`, `amount_eur`, and `reason`.

## PayPal integration

Requires PayPal Sandbox credentials. Keep them in environment variables only:

- `PAYPAL_CLIENT_ID`
- `PAYPAL_CLIENT_SECRET`
- optional `PAYPAL_BASE_URL` (defaults to the Sandbox API)

Then explicitly approve the sandbox transaction with `BOLT_APPROVED=1` and run `npm run paypal -- 1.00`.

Without approval, the payment module exits before contacting PayPal.

## Security and governance

- No PayPal credentials are committed.
- PayPal Sandbox is the default environment.
- AI can recommend but cannot bypass the human approval gate.
- `PayPal-Request-Id` is sent for request traceability/idempotency.
- Local `.env` files are ignored.

## Team

Omar Baró — Founder, Unfire
https://unfire.technology
