'use strict';
const fs = require('fs');
const path = require('path');
// Render Persistent Disk can be mounted at /var/data. Keep a local fallback for development.
const FILE = process.env.ROOM_STORE_FILE || path.join(__dirname, '..', 'data', 'rooms.json');
function packRoom(room) {
  const g = room.game;
  return {
    code: room.code, created: room.created, updated: room.updated,
    players: room.players.map(({ id, name, country, ready, host, tokenHash }) => ({ id, name, country, ready, host, tokenHash })),
    game: g ? {
      state: g.state, revision: g.revision, turn: g.turn,
      playerStates: [...(g.playerStates || new Map())],
      playerRevisions: [...(g.playerRevisions || new Map())],
      playerLastActionAt: [...(g.playerLastActionAt || new Map())],
      worldCountries: g.worldCountries || {}, activeCountries: g.activeCountries || [],
      engine: g.engine ? { turn: g.engine.turn, countries: g.engine.countries, relations: g.engine.relations, wars: g.engine.wars, treaties: g.engine.treaties, pending: g.engine.pending, results: g.engine.results } : null
    } : null
  };
}
function saveRooms(rooms, file = FILE) {
  const dir = path.dirname(file); fs.mkdirSync(dir, { recursive: true });
  const payload = JSON.stringify({ version: 1, rooms: [...rooms.values()].map(packRoom) });
  const tmp = file + '.tmp'; fs.writeFileSync(tmp, payload, { mode: 0o600 }); fs.renameSync(tmp, file);
}
function loadRooms(createWorld, file = FILE) {
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (doc.version !== 1 || !Array.isArray(doc.rooms)) return new Map();
    const rooms = new Map();
    for (const r of doc.rooms) {
      if (!r || !/^[A-HJ-NP-Z2-9]{6}$/.test(r.code) || !Array.isArray(r.players) || r.players.length > 4) continue;
      const room = { code:r.code, created:Number(r.created)||Date.now(), updated:Number(r.updated)||Date.now(), players:[], game:null };
      room.players = r.players.filter(x => x && typeof x.id==='string' && Number.isInteger(x.country) && x.country>=0 && x.country<258 && typeof x.tokenHash==='string').map(x=>({...x,ws:null,ready:false}));
      if (r.game && r.game.engine && Array.isArray(r.game.engine.countries) && r.game.engine.countries.length===258) {
        const engine=createWorld(r.game.engine.countries); engine.turn=Number.isInteger(r.game.engine.turn)?r.game.engine.turn:0;
        engine.pending=r.game.engine.pending && typeof r.game.engine.pending==='object'?r.game.engine.pending:Object.create(null);
        engine.results=Array.isArray(r.game.engine.results)?r.game.engine.results.slice(-20):[];
        engine.relations=Array.isArray(r.game.engine.relations)&&r.game.engine.relations.length===258?r.game.engine.relations:engine.relations;
        engine.wars=Array.isArray(r.game.engine.wars)?r.game.engine.wars.slice(-1000):[];
        engine.treaties=Array.isArray(r.game.engine.treaties)?r.game.engine.treaties.slice(-1000):[];
        room.game={state:r.game.state,revision:Number(r.game.revision)||1,turn:Number(r.game.turn)||engine.turn,
          playerStates:new Map(r.game.playerStates||[]),playerRevisions:new Map(r.game.playerRevisions||[]),playerLastActionAt:new Map(),
          worldCountries:r.game.worldCountries||{},activeCountries:Array.isArray(r.game.activeCountries)?r.game.activeCountries:[],engine};
      }
      if(room.players.length) rooms.set(room.code,room);
    }
    return rooms;
  } catch { return new Map(); }
}
module.exports={saveRooms,loadRooms};
