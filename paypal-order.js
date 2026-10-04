const clientId = process.env.PAYPAL_CLIENT_ID;
const secret = process.env.PAYPAL_CLIENT_SECRET;
const base = process.env.PAYPAL_BASE_URL || "https://api-m.sandbox.paypal.com";
const amount = process.argv[2] || "1.00";
const approved = process.env.BOLT_APPROVED === "1";

if (!clientId || !secret) {
  console.error("Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.");
  process.exit(1);
}
if (!approved) {
  console.error("BOLT approval required before creating a PayPal order. Set BOLT_APPROVED=1 only after explicit approval.");
  process.exit(2);
}

const auth = Buffer.from(clientId + ":" + secret).toString("base64");
const tokenRes = await fetch(base + "/v1/oauth2/token", {
  method: "POST",
  headers: { Authorization: "Basic " + auth, "Content-Type": "application/x-www-form-urlencoded" },
  body: "grant_type=client_credentials"
});
const tokenJson = await tokenRes.json();
if (!tokenRes.ok) throw new Error(JSON.stringify(tokenJson));

const orderRes = await fetch(base + "/v2/checkout/orders", {
  method: "POST",
  headers: {
    Authorization: "Bearer " + tokenJson.access_token,
    "Content-Type": "application/json",
    "PayPal-Request-Id": "bolt-demo-" + Date.now()
  },
  body: JSON.stringify({
    intent: "CAPTURE",
    purchase_units: [{ amount: { currency_code: "EUR", value: amount } }]
  })
});
const order = await orderRes.json();
console.log(JSON.stringify({status:orderRes.status,order}, null, 2));
if (!orderRes.ok) process.exit(3);
