'use strict';
const assert=require('node:assert/strict');
const {createWorld,submitAction,resolveTurn,validateAction}=require('../lib/turn-engine');
const countries=Array.from({length:258},(_,i)=>({owner:i,army:200,industry:10,cash:1000,stance:.5,fatigue:0}));
const active=[0,1,2,3];
function cycle(world,actions){for(let i=0;i<4;i++)submitAction(world,active[i],actions[i]||{type:'pass'},world.turn,active);return resolveTurn(world,active);}
const w=createWorld(countries);
assert.equal(w.relations[0][1],50);
let result=cycle(w,[{type:'tax',rate:20},{type:'diplomacy',target:10,treaty:'improve'},{type:'diplomacy',target:11,treaty:'trade'},{type:'pass'}]);
assert.equal(w.turn,1);assert.equal(w.countries[0].taxRate,20);assert.ok(w.countries[0].cash>1000);assert.equal(w.relations[1][10],58);assert.ok(w.treaties.some(t=>t.a===2&&t.b===11&&t.type==='trade'));assert.equal(w.countries[2].cash,1100,'active trade pact adds revenue');
result=cycle(w,[{type:'diplomacy',target:1,treaty:'improve'},{type:'pass'},{type:'pass'},{type:'pass'}]);
assert.equal(w.relations[0][1],58);
// A country can start an abstract campaign; losses are resolved at the shared turn boundary.
const beforeA=w.countries[0].army,beforeB=w.countries[20].army;
cycle(w,[{type:'declare_war',target:20},{type:'pass'},{type:'pass'},{type:'pass'}]);
assert.ok(w.wars.some(x=>x.active&&x.attacker===0&&x.defender===20));
assert.ok(w.countries[0].army<beforeA);assert.ok(w.countries[20].army<beforeB);
cycle(w,[{type:'peace',target:20},{type:'pass'},{type:'pass'},{type:'pass'}]);
assert.ok(!w.wars.some(x=>x.active&&x.attacker===0&&x.defender===20));
assert.equal(validateAction({type:'tax',rate:31}),false);
assert.equal(validateAction({type:'declare_war',target:258,country:0}),false);
assert.equal(validateAction({type:'diplomacy',target:0,country:0,treaty:'alliance'}),false);
console.log('Stage 14 economy, policy, diplomacy, trade, war and peace tests passed.');
