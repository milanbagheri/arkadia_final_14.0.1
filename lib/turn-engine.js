'use strict';
const { WORLD_COUNT } = require('./validation');
const LIMITS = { cash: 1e12, army: 1e7, industry: 1e6 };
function clampNum(v,min,max,fallback){return typeof v==='number'&&Number.isFinite(v)?Math.max(min,Math.min(max,v)):fallback;}
function cleanCountry(c,id){return {
  owner:Number.isInteger(c?.owner)&&c.owner>=0&&c.owner<WORLD_COUNT?c.owner:id,
  army:clampNum(c?.army,0,LIMITS.army,100), industry:clampNum(c?.industry,0,LIMITS.industry,10),
  cash:clampNum(c?.cash,-LIMITS.cash,LIMITS.cash,100), stance:clampNum(c?.stance,0,1,.5),
  fatigue:clampNum(c?.fatigue,0,1e6,0), taxRate:clampNum(c?.taxRate,0,30,10), stability:clampNum(c?.stability,0,100,100)
};}
function createWorld(countries){
 if(!Array.isArray(countries)||countries.length!==WORLD_COUNT)throw new Error('invalid_world');
 return {turn:0,countries:countries.map((c,i)=>cleanCountry(c,i)),relations:Array.from({length:WORLD_COUNT},()=>Array(WORLD_COUNT).fill(50)),wars:[],treaties:[],pending:Object.create(null),results:[]};
}
function validateAction(a){
 if(!a||typeof a!=='object'||Array.isArray(a))return false;
 if(a.type==='invest')return Number.isInteger(a.amount)&&a.amount>=1&&a.amount<=1000;
 if(a.type==='recruit')return Number.isInteger(a.amount)&&a.amount>=1&&a.amount<=500;
 if(a.type==='stance')return typeof a.value==='number'&&Number.isFinite(a.value)&&a.value>=0&&a.value<=1;
 if(a.type==='tax')return Number.isInteger(a.rate)&&a.rate>=0&&a.rate<=30;
 if(a.type==='diplomacy')return Number.isInteger(a.target)&&a.target>=0&&a.target<WORLD_COUNT&&a.target!==a.country&&['improve','sanction','alliance','trade'].includes(a.treaty);
 if(a.type==='declare_war'||a.type==='peace')return Number.isInteger(a.target)&&a.target>=0&&a.target<WORLD_COUNT&&a.target!==a.country;
 return a.type==='pass';
}
function submitAction(world,countryId,action,expectedTurn,activeCountries){
 if(!Number.isInteger(countryId)||countryId<0||countryId>=WORLD_COUNT)throw new Error('invalid_country');
 if(expectedTurn!==world.turn)throw new Error('stale_turn');
 if(Array.isArray(activeCountries)&&!activeCountries.includes(countryId))throw new Error('not_active_player');
 if(Object.prototype.hasOwnProperty.call(world.pending,countryId))throw new Error('already_submitted');
 const normalized={...action,country:countryId};
 if(!validateAction(normalized))throw new Error('invalid_action');
 const c=world.countries[countryId];if(c.owner!==countryId)throw new Error('not_sovereign');
 if(action.type==='invest'&&c.cash<action.amount)throw new Error('insufficient_funds');
 if(action.type==='recruit'&&c.cash<action.amount*2)throw new Error('insufficient_funds');
 if(action.type==='diplomacy'&&action.treaty==='alliance'&&world.relations[countryId][action.target]<40)throw new Error('relations_too_low');
 if(action.type==='declare_war'&&world.wars.some(w=>w.active&&((w.attacker===countryId&&w.defender===action.target)||(w.attacker===action.target&&w.defender===countryId))))throw new Error('war_already_active');
 if(action.type==='peace'&&!world.wars.some(w=>w.active&&((w.attacker===countryId&&w.defender===action.target)||(w.attacker===action.target&&w.defender===countryId))))throw new Error('no_active_war');
 world.pending[countryId]=Object.freeze(normalized);
 return {ready:Object.keys(world.pending).length,required:4};
}
function resolveTurn(world,activeCountries){
 if(!Array.isArray(activeCountries)||activeCountries.length!==4||new Set(activeCountries).size!==4)throw new Error('invalid_active_players');
 if(!activeCountries.every(id=>Object.prototype.hasOwnProperty.call(world.pending,id)))throw new Error('turn_not_ready');
 const actions=activeCountries.map(id=>[id,world.pending[id]]);
 // First apply domestic economy and government decisions.
 for(const [id,a] of actions){const c=world.countries[id];
  if(a.type==='invest'){c.cash-=a.amount;c.industry=clampNum(c.industry+a.amount*.01,0,LIMITS.industry,c.industry);}
  else if(a.type==='recruit'){c.cash-=a.amount*2;c.army=clampNum(c.army+a.amount,0,LIMITS.army,c.army);}
  else if(a.type==='stance')c.stance=a.value;
  else if(a.type==='tax'){c.taxRate=a.rate;if(a.rate>=25)c.stability=Math.max(0,c.stability-2);else if(a.rate<=8)c.stability=Math.min(100,c.stability+1);}
 }
 // Then apply diplomacy so all actions in this turn are evaluated at one boundary.
 for(const [id,a] of actions){const target=a.target;if(!Number.isInteger(target))continue;
  if(a.type==='diplomacy'){
   const delta=a.treaty==='improve'?8:a.treaty==='sanction'?-15:a.treaty==='alliance'?5:3;
   world.relations[id][target]=clampNum(world.relations[id][target]+delta,0,100,50);
   world.relations[target][id]=clampNum(world.relations[target][id]+delta,0,100,50);
   if(['alliance','trade'].includes(a.treaty)){world.treaties=world.treaties.filter(t=>!(t.active&&t.type===a.treaty&&((t.a===id&&t.b===target)||(t.a===target&&t.b===id))));world.treaties.push({a:id,b:target,type:a.treaty,active:true,turn:world.turn+1});}
  } else if(a.type==='declare_war'){
   world.wars.push({attacker:id,defender:target,active:true,startedTurn:world.turn+1});
   world.relations[id][target]=world.relations[target][id]=0;
  } else if(a.type==='peace'){
   for(const w of world.wars)if(w.active&&((w.attacker===id&&w.defender===target)||(w.attacker===target&&w.defender===id)))w.active=false;
   world.relations[id][target]=world.relations[target][id]=Math.max(10,world.relations[id][target]);
  }
 }
 // Abstract campaign resolution: attrition is calculated from force size, readiness and defensive stance.
 for(const w of world.wars.filter(x=>x.active)){
  const a=world.countries[w.attacker],d=world.countries[w.defender];
  if(!a||!d)continue;
  const attack=Math.max(1,a.army*(.65+a.stance*.7)*(1-Math.min(.7,a.fatigue/1000)));
  const alliedDefense=world.treaties.some(t=>t.active&&t.type==='alliance'&&(t.a===w.defender||t.b===w.defender))?1.15:1;
  const defense=Math.max(1,d.army*(.8+d.stance*.8)*alliedDefense*(1-Math.min(.7,d.fatigue/1000)));
  const lossA=Math.min(a.army,Math.max(1,Math.round(defense*.025)));
  const lossD=Math.min(d.army,Math.max(1,Math.round(attack*.025)));
  a.army-=lossA;d.army-=lossD;a.fatigue+=2;d.fatigue+=2;
  w.lastBattleTurn=world.turn+1;w.lastLosses={attacker:lossA,defender:lossD};
  if(a.army<=0||d.army<=0)w.active=false;
 }
 // Annualized monthly revenue, affected by tax policy and public stability.
 for(const id of activeCountries){const c=world.countries[id];
  const taxMultiplier=1+(c.taxRate-10)/100;
  const stabilityMultiplier=.75+(c.stability/400);
  const tradeCount=world.treaties.filter(t=>t.active&&t.type==='trade'&&(t.a===id||t.b===id)).length;
  const tradeIncome=tradeCount*c.industry*2;
  c.cash=clampNum(c.cash+c.industry*8*taxMultiplier*stabilityMultiplier+tradeIncome,-LIMITS.cash,LIMITS.cash,c.cash);
  c.fatigue=Math.max(0,c.fatigue-1);
 }
 world.turn++;world.pending=Object.create(null);
 const affected=new Set(activeCountries);for(const w of world.wars)if(w.active||w.lastBattleTurn===world.turn){affected.add(w.attacker);affected.add(w.defender);}
 const result={turn:world.turn,countries:Object.fromEntries([...affected].map(id=>[id,{...world.countries[id]}])),relations:world.relations,wars:world.wars,treaties:world.treaties};
 world.results.push(result);if(world.results.length>20)world.results.shift();return result;
}
module.exports={createWorld,submitAction,resolveTurn,validateAction,cleanCountry};
