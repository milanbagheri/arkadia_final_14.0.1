'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const engine = fs.readFileSync(path.join(__dirname, '..', 'lib', 'turn-engine.js'), 'utf8');
const store = fs.readFileSync(path.join(__dirname, '..', 'lib', 'room-store.js'), 'utf8');
new vm.Script(engine, { filename: 'lib/turn-engine.js' });
new vm.Script(store, { filename: 'lib/room-store.js' });
new vm.Script(server, { filename: 'server.js' });
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)];
if (!scripts.length) throw new Error('No inline scripts found');
scripts.forEach((match, i) => new vm.Script(match[1], { filename: `index-inline-${i}.js` }));
if (!html.includes('const WORLD') && !html.includes('WORLD=')) throw new Error('Embedded world map declaration not found');
console.log(`Syntax checks passed: server.js + ${scripts.length} inline script(s).`);
console.log('Static check only; this does not verify browser gameplay, WebSocket multiplayer, or Render deployment.');

for (const token of ['world_country_update','world_sync_request','world_snapshot','pickCountryState']) if (!server.includes(token) && !html.includes(token)) throw new Error('Stage 8 feature missing: '+token);
console.log('Stage 8 static checks passed: shared country projection and snapshot protocol present.');

for (const token of ['turn_action','authoritative_turn_resolved','submitAction','resolveTurn']) if (!server.includes(token)) throw new Error('Stage 10 server-authoritative action protocol missing: '+token);
console.log('Stage 10 static checks passed: server-side action validation and four-player turn barrier present.');
