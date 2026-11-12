'use strict';
const assert = require('node:assert/strict');
const { validGameState, pickCountryState, WORLD_COUNT } = require('../lib/validation');
function fixture(player=7) {
  return {
    version:3, player, turn:0, money:1000,
    countries:Array.from({length:WORLD_COUNT},(_,i)=>({owner:i,army:100,industry:5,cash:250,stance:0.5,fatigue:0})),
    relations:Array(WORLD_COUNT).fill(50), wars:[], seats:[120,45,45,45,45],
    groups:[60,60,60,60,60], inventory:{'0':{qty:3,level:1}}
  };
}
const good=fixture();
assert.ok(validGameState(good,7), 'accepts a valid game state');
assert.equal(validGameState(good,8), null, 'rejects a state claiming another player country');
const badArmy=fixture(); badArmy.countries[7].army=Infinity;
assert.equal(validGameState(badArmy,7), null, 'rejects non-finite army');
const badOwner=fixture(); badOwner.countries[2].owner=999;
assert.equal(validGameState(badOwner,7), null, 'rejects invalid country owner');
const badRelations=fixture(); badRelations.relations[0]=101;
assert.equal(validGameState(badRelations,7), null, 'rejects out-of-range diplomacy values');
const badSeats=fixture(); badSeats.seats=[300,300,0,0,0];
assert.equal(validGameState(badSeats,7), null, 'rejects invalid parliament totals');
const badInventory=fixture(); badInventory.inventory['2']={qty:-1,level:1};
assert.equal(validGameState(badInventory,7), null, 'rejects negative inventory');
const projection=pickCountryState(good,7);
assert.deepEqual(Object.keys(projection).sort(), ['army','cash','fatigue','industry','owner','stability','stance','taxRate']);
assert.equal(pickCountryState(good,8).owner,8);
console.log('Stage 9 validation tests passed (8 assertions groups).');
