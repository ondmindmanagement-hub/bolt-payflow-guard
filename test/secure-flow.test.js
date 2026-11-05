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
  const intent=makeIntent({amount_eur:'1.25'});
  new OneUseGate(intent).approve('APPROVE 1.25 EUR',intent);
  const result=await paypalSandboxCreate(intent,{id:'test',secret:'test'},fake);
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


test('direct helper invocation without exact-amount approval never contacts PayPal',async()=>{
  let outbound=0;
  const intent=makeIntent({amount_eur:'3.25'});
  await assert.rejects(
    paypalSandboxCreate(intent,{id:'fake',secret:'fake'},async()=>{outbound++;}),
    /HUMAN_APPROVAL_REQUIRED/
  );
  assert.equal(outbound,0);
});

test('unissued handcrafted intents cannot pass the approval gate',async()=>{
  const forged={kind:'CREATE_SANDBOX_ORDER',amount_eur:'1.00',currency:'EUR',idempotency_key:'fabricated'};
  assert.throws(()=>new OneUseGate(forged),/INVALID_INTENT/);
  let outbound=0;
  await assert.rejects(
    paypalSandboxCreate(forged,{id:'fake',secret:'fake'},async()=>{outbound++;}),
    /INVALID_INTENT/
  );
  assert.equal(outbound,0);
});

test('approved Sandbox intent is single-use even when helper called twice',async()=>{
  const intent=makeIntent({amount_eur:'4.00'});
  new OneUseGate(intent).approve('APPROVE 4.00 EUR',intent);
  let outbound=0;
  const fake=async(url)=>{
    outbound++;
    if(url.endsWith('/token'))return {ok:true,json:async()=>({access_token:'fake-token'})};
    return {ok:true,json:async()=>({id:'FAKE-ORDER',status:'CREATED'})};
  };
  const first=await paypalSandboxCreate(intent,{id:'fake',secret:'fake'},fake);
  assert.equal(first.captured,false);
  assert.equal(outbound,2);
  await assert.rejects(
    paypalSandboxCreate(intent,{id:'fake',secret:'fake'},fake),
    /APPROVAL_REPLAY_DENIED/
  );
  assert.equal(outbound,2);
});

test('wrong amount cannot create a network request even with fake sandbox credentials',async()=>{
  const intent=makeIntent({amount_eur:'5.00'});
  const gate=new OneUseGate(intent);
  assert.throws(()=>gate.approve('APPROVE 50.00 EUR',intent),/HUMAN_APPROVAL_REQUIRED/);
  let outbound=0;
  await assert.rejects(
    paypalSandboxCreate(intent,{id:'fake',secret:'fake'},async()=>{outbound++;}),
    /HUMAN_APPROVAL_REQUIRED/
  );
  assert.equal(outbound,0);
});

test('expired approval cannot retry after a PayPal response error',async()=>{
  const intent=makeIntent({amount_eur:'1.00'});
  new OneUseGate(intent).approve('APPROVE 1.00 EUR',intent);
  let outbound=0;
  const fake=async()=>{outbound++; return {ok:false,status:503};};
  await assert.rejects(paypalSandboxCreate(intent,{id:'fake',secret:'fake'},fake),/SANDBOX_AUTH_FAILED_503/);
  assert.equal(outbound,1);
  await assert.rejects(paypalSandboxCreate(intent,{id:'fake',secret:'fake'},fake),/APPROVAL_REPLAY_DENIED/);
  assert.equal(outbound,1);
});

test('mocked Ollama positive plan is still only an offline simulation without sandbox flag',async()=>{
  const requested=[];
  const transport=async(url,opts)=>{
    requested.push(url);
    assert.equal(url,'http://127.0.0.1:11434/api/generate');
    assert.equal(opts.method,'POST');
    return {ok:true,json:async()=>({response:JSON.stringify({
      should_pay:true, amount_eur:'2.00', reason:'TEST MOCK, NOT ACTUAL INFERENCE'
    })})};
  };
  const result=await run({
    ollama:true,sandbox:false,
    ask:async expected=>{
      assert.equal(expected,'APPROVE 2.00 EUR');
      return expected;
    },
    transport
  });
  assert.equal(result.simulation,true);
  assert.deepEqual(requested,['http://127.0.0.1:11434/api/generate']);
});

test('mocked Ollama refusal never reaches approval or PayPal',async()=>{
  let requested=0,approvalPrompts=0;
  const transport=async(url)=>{
    requested++;
    assert.equal(url,'http://127.0.0.1:11434/api/generate');
    return {ok:true,json:async()=>({response:JSON.stringify({
      should_pay:false,amount_eur:'1.00',reason:'Refuse unsafe plan'
    })})};
  };
  await assert.rejects(run({
    ollama:true,sandbox:true,
    ask:async()=>{approvalPrompts++;return 'APPROVE 1.00 EUR';},
    transport
  }),/AI_PLAN_DENIED/);
  assert.equal(approvalPrompts,0);
  assert.equal(requested,1);
});

test('mocked Ollama plan with operator refusal never invokes PayPal',async()=>{
  const requests=[];
  const transport=async(url)=>{
    requests.push(url);
    assert.equal(url,'http://127.0.0.1:11434/api/generate');
    return {ok:true,json:async()=>({response:JSON.stringify({
      should_pay:true,amount_eur:'1.00',reason:'Local only mocked response'
    })})};
  };
  await assert.rejects(run({
    ollama:true,sandbox:true,ask:async()=> 'DENY',transport
  }),/HUMAN_APPROVAL_REQUIRED/);
  assert.deepEqual(requests,['http://127.0.0.1:11434/api/generate']);
});

test('full local AI + Sandbox happy path uses only three mocked endpoints after approval',async()=>{
  const calls=[];
  const transport=async(url,options)=>{
    calls.push(url);
    if(url==='http://127.0.0.1:11434/api/generate'){
      return {ok:true,json:async()=>({response:JSON.stringify({
        should_pay:true, amount_eur:'1.75', reason:'SYNTHETIC TEST RESPONSE'
      })})};
    }
    if(url==='https://api-m.sandbox.paypal.com/v1/oauth2/token'){
      assert.equal(options.method,'POST');
      return {ok:true,json:async()=>({access_token:'FAKE_TEST_TOKEN'})};
    }
    if(url==='https://api-m.sandbox.paypal.com/v2/checkout/orders'){
      assert.equal(options.method,'POST');
      assert.equal(JSON.parse(options.body).purchase_units[0].amount.value,'1.75');
      return {ok:true,json:async()=>({id:'SYNTHETIC_ORDER',status:'CREATED'})};
    }
    throw new Error('UNEXPECTED_NETWORK_DESTINATION');
  };
  const oldId=process.env.PAYPAL_CLIENT_ID;
  const oldSecret=process.env.PAYPAL_CLIENT_SECRET;
  // Inject dummy test-only values. The transport is mocked, no provider calls.
  process.env.PAYPAL_CLIENT_ID='FAKE_TEST_CLIENT_ID';
  process.env.PAYPAL_CLIENT_SECRET='FAKE_TEST_CLIENT_SECRET';
  let outcome;
  try {
    outcome=await run({
      ollama:true,sandbox:true,
      ask:async(str)=>{
        assert.equal(str,'APPROVE 1.75 EUR');
        return str;
      },
      transport
    });
  } finally {
    if(oldId===undefined)delete process.env.PAYPAL_CLIENT_ID;
    else process.env.PAYPAL_CLIENT_ID=oldId;
    if(oldSecret===undefined)delete process.env.PAYPAL_CLIENT_SECRET;
    else process.env.PAYPAL_CLIENT_SECRET=oldSecret;
  }
  assert.equal(outcome.captured,false);
  assert.equal(outcome.sandbox,true);
  assert.equal(outcome.order_id,'SYNTHETIC_ORDER');
  assert.deepEqual(calls,[
    'http://127.0.0.1:11434/api/generate',
    'https://api-m.sandbox.paypal.com/v1/oauth2/token',
    'https://api-m.sandbox.paypal.com/v2/checkout/orders'
  ]);
});


test('new approval gate cannot resurrect a consumed intent',async()=>{
  const intent=makeIntent({amount_eur:'1.00'});
  let requests=0;
  const fake=async(url)=>{
    requests++;
    return url.endsWith('/token')
      ? {ok:true,json:async()=>({access_token:'FAKE_TOKEN'})}
      : {ok:true,json:async()=>({id:'SYNTHETIC_ORDER',status:'CREATED'})};
  };
  new OneUseGate(intent).approve('APPROVE 1.00 EUR',intent);
  await paypalSandboxCreate(intent,{id:'FAKE',secret:'FAKE'},fake);
  assert.equal(requests,2);
  // Independent gate previously approved same intent again after completion.
  assert.throws(
    ()=>new OneUseGate(intent).approve('APPROVE 1.00 EUR',intent),
    /APPROVAL_REPLAY_DENIED/
  );
  await assert.rejects(
    paypalSandboxCreate(intent,{id:'FAKE',secret:'FAKE'},fake),
    /APPROVAL_REPLAY_DENIED/
  );
  assert.equal(requests,2);
});
test('failed upstream transaction cannot be reapproved with new gate',async()=>{
  const intent=makeIntent({amount_eur:'1.00'});
  let requests=0;
  const failing=async()=>{requests++; return {ok:false,status:503};};
  new OneUseGate(intent).approve('APPROVE 1.00 EUR',intent);
  await assert.rejects(
    paypalSandboxCreate(intent,{id:'FAKE',secret:'FAKE'},failing),
    /SANDBOX_AUTH_FAILED_503/
  );
  assert.throws(
    ()=>new OneUseGate(intent).approve('APPROVE 1.00 EUR',intent),
    /APPROVAL_REPLAY_DENIED/
  );
  assert.equal(requests,1);
});


test('all local AI and Sandbox HTTP requests set redirect error and finite timeout',async()=>{
  const all=[];
  const transport=async(url,opts)=>{
    all.push(url);
    assert.equal(opts.redirect,'error');
    assert.ok(opts.signal instanceof AbortSignal, 'timeout signal missing');
    assert.equal(opts.signal.aborted,false);
    if(url==='http://127.0.0.1:11434/api/generate'){
      return {ok:true,json:async()=>({response:JSON.stringify({
        should_pay:true,amount_eur:'1.00',reason:'OFFLINE TEST ONLY'
      })})};
    }
    if(url==='https://api-m.sandbox.paypal.com/v1/oauth2/token'){
      return {ok:true,json:async()=>({access_token:'FAKE_TOKEN'})};
    }
    if(url==='https://api-m.sandbox.paypal.com/v2/checkout/orders'){
      assert.ok(opts.headers['PayPal-Request-Id']);
      return {ok:true,json:async()=>({id:'SYNTHETIC',status:'CREATED'})};
    }
    throw Error('UNEXPECTED_HOST');
  };
  const oldId=process.env.PAYPAL_CLIENT_ID;
  const oldSecret=process.env.PAYPAL_CLIENT_SECRET;
  process.env.PAYPAL_CLIENT_ID='FAKE_ID';
  process.env.PAYPAL_CLIENT_SECRET='FAKE_SECRET';
  try{
    const result=await run({ollama:true,sandbox:true,ask:async()=> 'APPROVE 1.00 EUR',transport});
    assert.equal(result.captured,false);
  }finally{
    if(oldId===undefined)delete process.env.PAYPAL_CLIENT_ID;
    else process.env.PAYPAL_CLIENT_ID=oldId;
    if(oldSecret===undefined)delete process.env.PAYPAL_CLIENT_SECRET;
    else process.env.PAYPAL_CLIENT_SECRET=oldSecret;
  }
  assert.deepEqual(all,[
    'http://127.0.0.1:11434/api/generate',
    'https://api-m.sandbox.paypal.com/v1/oauth2/token',
    'https://api-m.sandbox.paypal.com/v2/checkout/orders'
  ]);
});


test('rejects malformed provider order identifiers instead of reporting success',async()=>{
  for(const malformed of [{id:'',status:'CREATED'},{id:' ',status:'CREATED'},
    {id:'X'.repeat(256),status:'CREATED'},{status:'CREATED'},null]){
    const intent=makeIntent({amount_eur:'1.00'});
    new OneUseGate(intent).approve('APPROVE 1.00 EUR',intent);
    const fake=async(url)=>url.endsWith('/token')
      ? {ok:true,json:async()=>({access_token:'FAKE'})}
      : {ok:true,json:async()=>malformed};
    await assert.rejects(
      paypalSandboxCreate(intent,{id:'FAKE',secret:'FAKE'},fake),
      /SANDBOX_ORDER_ID_MISSING/
    );
  }
});

test('rejects post-capture and voided statuses for a newly created order',async()=>{
  for(const badStatus of ['COMPLETED','VOIDED','SAVED','FAILED',null,undefined,'']){
    const intent=makeIntent({amount_eur:'1.00'});
    new OneUseGate(intent).approve('APPROVE 1.00 EUR',intent);
    const fake=async(url)=>url.endsWith('/token')
      ? {ok:true,json:async()=>({access_token:'FAKE'})}
      : {ok:true,json:async()=>({id:'SYNTHETIC_ORDER',status:badStatus})};
    await assert.rejects(
      paypalSandboxCreate(intent,{id:'FAKE',secret:'FAKE'},fake),
      /SANDBOX_ORDER_STATUS_UNEXPECTED/
    );
  }
});

test('new order response allows only nonfinal, uncaptured order states',async()=>{
  for(const status of ['CREATED','PAYER_ACTION_REQUIRED','APPROVED']){
    const intent=makeIntent({amount_eur:'1.00'});
    new OneUseGate(intent).approve('APPROVE 1.00 EUR',intent);
    const fake=async(url)=>url.endsWith('/token')
      ? {ok:true,json:async()=>({access_token:'FAKE'})}
      : {ok:true,json:async()=>({id:'SYNTHETIC_ORDER',status})};
    const result=await paypalSandboxCreate(intent,{id:'FAKE',secret:'FAKE'},fake);
    assert.equal(result.status,status);
    assert.equal(result.captured,false);
    assert.equal(result.order_id,'SYNTHETIC_ORDER');
  }
});

test('rejects blank OAuth access tokens before creating order',async()=>{
  for(const token of ['', '   ',null,undefined]){
    const intent=makeIntent({amount_eur:'1.00'});
    new OneUseGate(intent).approve('APPROVE 1.00 EUR',intent);
    const visited=[];
    const fake=async(url)=>{
      visited.push(url);
      return {ok:true,json:async()=>({access_token:token})};
    };
    await assert.rejects(
      paypalSandboxCreate(intent,{id:'FAKE',secret:'FAKE'},fake),
      /SANDBOX_TOKEN_MISSING/
    );
    assert.equal(visited.length,1);
  }
});
