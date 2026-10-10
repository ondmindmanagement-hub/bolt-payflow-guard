import test from 'node:test';
import assert from 'node:assert/strict';
import {amountEUR,validatePlan,makeIntent,OneUseGate,paypalSandboxCreate,run} from '../secure-flow.js';

test('amount is normalized',()=>assert.equal(amountEUR('2.5'),'2.50'));
test('invalid amounts fail',()=>{
  for(const x of ['-1','0','0.00','51','2.001','1e5','1000','1,2','NaN']) assert.throws(()=>amountEUR(x));
});
test('AI refusing prevents order',()=>assert.throws(()=>validatePlan({should_pay:false,amount_eur:'1.00',reason:'no'})));
test('malformed AI prevents order',()=>assert.throws(()=>validatePlan('not json')));
test('approval exact amount',()=>{
  const i=makeIntent({amount_eur:'2.00'}),g=new OneUseGate(i);
  assert.throws(()=>g.approve('APPROVE 1.00 EUR',i));
  assert.equal(g.approve('APPROVE 2.00 EUR',i),true);
});
test('approval cannot be replayed',()=>{
  const i=makeIntent({amount_eur:'1.00'}),g=new OneUseGate(i);
  g.approve('APPROVE 1.00 EUR',i);
  assert.throws(()=>g.approve('APPROVE 1.00 EUR',i),/REPLAY/);
});
test('mismatched intent blocked',()=>{
  const i=makeIntent({amount_eur:'1.00'}),g=new OneUseGate(i);
  assert.throws(()=>g.approve('APPROVE 1.00 EUR',{...i,amount_eur:'2.00'}),/MISMATCH/);
});
test('no credentials means no network',async()=>{
  let calls=0;
  await assert.rejects(paypalSandboxCreate(makeIntent({amount_eur:'1.00'}),{},async()=>{calls++}),/CREDENTIALS/);
  assert.equal(calls,0);
});
test('sandbox order only; no capture endpoint',async()=>{
  const visited=[];
  const fake=async(url,opts)=>{
    visited.push({url,opts});
    if(url.endsWith('/token'))return {ok:true,json:async()=>({access_token:'sandbox-test-token'})};
    return {ok:true,json:async()=>({id:'TEST123',status:'CREATED'})};
  };
  const result=await paypalSandboxCreate(makeIntent({amount_eur:'1.25'}),{id:'test',secret:'test'},fake);
  assert.equal(result.captured,false);
  assert.equal(visited.length,2);
  assert.ok(visited.every(x=>x.url.startsWith('https://api-m.sandbox.paypal.com/')));
  assert.ok(visited.every(x=>!x.url.includes('/capture')));
  assert.equal(JSON.parse(visited[1].opts.body).purchase_units[0].amount.value,'1.25');
});
test('cancel prevents external call',async()=>{
  let calls=0;
  await assert.rejects(run({ollama:false,sandbox:false,ask:async()=> 'CANCEL',
    transport:async()=>{calls++}}),/HUMAN_APPROVAL/);
  assert.equal(calls,0);
});
test('sandbox must have actual local AI',async()=>{
  await assert.rejects(run({ollama:false,sandbox:true,ask:async()=> 'APPROVE 1.00 EUR'}),/REAL_AI_MODE/);
});
test('simulation has zero API requests',async()=>{
  let calls=0;
  const result=await run({ollama:false,sandbox:false,ask:async()=> 'APPROVE 1.00 EUR',
    transport:async()=>{calls++}});
  assert.equal(calls,0);
  assert.equal(result.simulation,true);
});
