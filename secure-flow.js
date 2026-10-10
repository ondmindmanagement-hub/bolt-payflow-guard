/* Unfire BOLT PayFlow Guard: interactive Sandbox-only workflow.
 * Not a production authorization service. No captures or real payments.
 */
import { randomUUID, createHash } from 'node:crypto';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const SANDBOX = 'https://api-m.sandbox.paypal.com';

export function amountEUR(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/.test(value)) {
    throw Error('INVALID_AMOUNT');
  }
  const parts = value.split('.');
  const cents = Number(parts[0])*100 + Number((parts[1]||'').padEnd(2,'0'));
  if (cents < 1 || cents > 5000) throw Error('LIMIT_0_01_TO_50_EUR');
  return (cents/100).toFixed(2);
}
export function validatePlan(raw) {
  const x = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!x || x.should_pay !== true || typeof x.reason !== 'string' || x.reason.length > 400) {
    throw Error('AI_PLAN_DENIED');
  }
  return { amount_eur: amountEUR(x.amount_eur), reason:x.reason };
}
export function makeIntent(plan) {
  const intent = {kind:'CREATE_SANDBOX_ORDER', amount_eur:amountEUR(plan.amount_eur),
    currency:'EUR', idempotency_key:randomUUID()};
  return Object.freeze({...intent, hash:createHash('sha256').update(JSON.stringify(intent)).digest('hex')});
}
export class OneUseGate {
  #used=false;
  constructor(intent) { this.intent = intent; }
  approve(typed, intent) {
    if (this.#used) throw Error('APPROVAL_REPLAY_DENIED');
    if (intent !== this.intent || intent.hash !== this.intent.hash) throw Error('INTENT_MISMATCH');
    if (typed !== 'APPROVE '+this.intent.amount_eur+' EUR') throw Error('HUMAN_APPROVAL_REQUIRED');
    this.#used=true;
    return true;
  }
}
export async function paypalSandboxCreate(intent, credentials, transport=fetch) {
  if (!intent || intent.kind !== 'CREATE_SANDBOX_ORDER' || intent.currency !== 'EUR') throw Error('INVALID_INTENT');
  const amount = amountEUR(intent.amount_eur);
  if (!credentials?.id || !credentials?.secret) throw Error('SANDBOX_CREDENTIALS_MISSING');
  const basic = Buffer.from(credentials.id+':'+credentials.secret).toString('base64');
  const tokenRes = await transport(SANDBOX+'/v1/oauth2/token', {
    method:'POST', headers:{Authorization:'Basic '+basic,'Content-Type':'application/x-www-form-urlencoded'},
    body:'grant_type=client_credentials'});
  if (!tokenRes.ok) throw Error('SANDBOX_AUTH_FAILED_'+tokenRes.status);
  const token = await tokenRes.json();
  if (typeof token.access_token !== 'string') throw Error('SANDBOX_TOKEN_MISSING');
  const res = await transport(SANDBOX+'/v2/checkout/orders', {
    method:'POST', headers:{Authorization:'Bearer '+token.access_token,'Content-Type':'application/json',
      'PayPal-Request-Id':intent.idempotency_key},
    body:JSON.stringify({intent:'CAPTURE', purchase_units:[{amount:{currency_code:'EUR',value:amount}}]})});
  if (!res.ok) throw Error('SANDBOX_ORDER_FAILED_'+res.status);
  const data=await res.json();
  if (typeof data.id !== 'string') throw Error('SANDBOX_ORDER_ID_MISSING');
  return {order_id:data.id, status:data.status, amount_eur:amount, sandbox:true, captured:false};
}
export async function aiSuggest(prompt, transport=fetch) {
  const result=await transport('http://127.0.0.1:11434/api/generate',{
    method:'POST', headers:{'Content-Type':'application/json'}, signal:AbortSignal.timeout(15000),
    body:JSON.stringify({model:process.env.OLLAMA_MODEL || 'qwen2.5:7b',stream:false,format:'json',
      prompt:'For a PayPal Sandbox demo ONLY, output JSON with should_pay boolean, amount_eur string, reason string. Do not execute. Reject uncertainty. User request: '+prompt.slice(0,300)})});
  if (!result.ok) throw Error('OLLAMA_UNAVAILABLE_'+result.status);
  return validatePlan((await result.json()).response);
}
export async function run({ollama=false,sandbox=false,ask=null,transport=fetch}={}) {
  if (sandbox && !ollama) throw Error('REAL_AI_MODE_REQUIRED_FOR_SANDBOX_TEST');
  const plan=ollama ? await aiSuggest('Create a 1 EUR test order, if appropriate',transport)
    : validatePlan({should_pay:true,amount_eur:'1.00',reason:'SIMULATED SAMPLE: no AI inference'});
  const intent=makeIntent(plan);
  console.log(JSON.stringify({mode:ollama?'LOCAL_OLLAMA':'SIMULATED_AI_NO_MODEL',
    amount_eur:intent.amount_eur,reason:plan.reason, intent_hash:intent.hash}));
  let answer;
  if (ask) answer=await ask('APPROVE '+intent.amount_eur+' EUR');
  else {
    const rl=readline.createInterface({input:stdin,output:stdout});
    try { answer=await rl.question('Type APPROVE '+intent.amount_eur+' EUR to continue: '); }
    finally {rl.close();}
  }
  new OneUseGate(intent).approve(answer.trim(),intent);
  if (!sandbox) {
    console.log(JSON.stringify({mode:'SIMULATION',network:false,order_id:'MOCK_ONLY',captured:false}));
    return {simulation:true};
  }
  const result=await paypalSandboxCreate(intent,{id:process.env.PAYPAL_CLIENT_ID,secret:process.env.PAYPAL_CLIENT_SECRET},transport);
  console.log(JSON.stringify(result));
  return result;
}
if (process.argv[1]?.endsWith('/secure-flow.js')) {
  const args=process.argv.slice(2);
  if (args.some(x=>!['--demo','--ollama','--sandbox'].includes(x)) || args.includes('--demo')===args.includes('--ollama')) {
    console.error('Usage: node secure-flow.js (--demo | --ollama) [--sandbox]');
    process.exitCode=2;
  } else {
    run({ollama:args.includes('--ollama'),sandbox:args.includes('--sandbox')})
      .catch(err=>{console.error('BLOCKED: '+err.message);process.exitCode=1;});
  }
}
