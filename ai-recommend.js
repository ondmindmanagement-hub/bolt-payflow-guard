const prompt = process.argv.slice(2).join(" ") || "Pay 1 EUR for a test purchase";
const model = process.env.OLLAMA_MODEL || "qwen2.5:7b";

const response = await fetch("http://127.0.0.1:11434/api/generate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model,
    stream: false,
    format: "json",
    prompt: "You are a payment-planning assistant. Do not execute payments. Analyze the request and return JSON with keys should_pay (boolean), amount_eur (string or null), and reason (string). Request: " + prompt
  })
});

const result = await response.json();
if (!response.ok) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}
console.log(result.response);
