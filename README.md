# BOLT Payflow Guard

BOLT Payflow Guard is a hackathon prototype for governed AI-to-payment workflows using the PayPal Orders API.

## Core idea

AI can recommend a transaction, but it should not silently execute a consequential payment. The demo separates planning from payment execution and requires an explicit BOLT approval flag before it will create a PayPal Sandbox order.

## PayPal integration

The Node.js demo authenticates with PayPal OAuth 2.0 and calls the PayPal Orders v2 Sandbox API. Credentials are loaded only from environment variables.

### Run

Requires Node.js 18+ and PayPal Sandbox credentials.

1. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.
2. Explicitly approve the demo transaction by setting BOLT_APPROVED=1.
3. Run: npm run demo -- 1.00

Without approval the script exits before contacting PayPal.

## Security and governance

- No PayPal credentials are committed.
- Sandbox is the default environment.
- A payment action is blocked until explicit approval.
- PayPal-Request-Id is used for request traceability/idempotency.

## Team

Omar Baró — Founder, Unfire
https://unfire.technology
