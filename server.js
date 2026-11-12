'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');
const { validGameState, pickCountryState, WORLD_COUNT } = require('./lib/validation');
const { createWorld, submitAction, resolveTurn } = require('./lib/turn-engine');
const { saveRooms, loadRooms } = require('./lib/room-store');
const crypto = require('crypto');
const PORT = Number(process.env.PORT || 3000);
const ROOM_IDLE_MS = 30 * 60 * 1000;
const MAX_ROOMS = 500;
const MESSAGE_WINDOW_MS = 10_000;
const MESSAGE_LIMIT = 80;
const MAX_RESUME_TOKEN_LENGTH = 128;
const ROOT = path.join(__dirname, 'public');
const rooms = loadRooms(createWorld);
function persist(){ try { saveRooms(rooms); } catch(err) { console.error("Room persistence failed:", err.message); } }
function tokenHash(token){ return crypto.createHash("sha256").update(String(token)).digest("hex"); }
function safeTokenMatch(storedHash, suppliedToken){
  if(typeof storedHash !== 'string' || !/^[a-f0-9]{64}$/.test(storedHash)) return false;
  if(typeof suppliedToken !== 'string' || suppliedToken.length !== 48 || !/^[a-f0-9]{48}$/.test(suppliedToken)) return false;
  const expected = Buffer.from(storedHash, 'hex');
  const actual = Buffer.from(tokenHash(suppliedToken), 'hex');
  return crypto.timingSafeEqual(expected, actual);
}
const server = http.createServer((req, res) => {
  const pathname = (req.url || '/').split('?')[0];
  if (pathname === '/healthz') { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(JSON.stringify({ ok: true, rooms: rooms.size })); }
  const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.resolve(ROOT, requested);
  if (!file.startsWith(ROOT + path.sep) && file !== path.join(ROOT, 'index.html')) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(file).toLowerCase();
    const types = { '.html':'text/html; charset=utf-8', '.webp':'image/webp', '.css':'text/css', '.js':'text/javascript' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600' });
    res.end(data);
  });
});
const wss = new WebSocketServer({ server, path: '/ws', perMessageDeflate: false, maxPayload: 256 * 1024 });
function code(){const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let s='';for(let i=0;i<6;i++)s+=chars[require('crypto').randomInt(chars.length)];return s;}
function send(ws, obj){if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(obj));}
function snapshot(room){return {code:room.code,players:room.players.map(p=>({id:p.id,name:p.name,country:p.country,ready:p.ready,host:p.host,online:!!p.ws})),game:room.game?{started:true,revision:room.game.revision,turn:room.game.turn}:null};}
function broadcast(room,obj){const payload=JSON.stringify(obj);for(const p of room.players)if(p.ws&&p.ws.readyState===WebSocket.OPEN)p.ws.send(payload);}
function leave(ws){const room=ws.room,p=ws.player;if(!room||!p)return;p.ws=null;p.ready=false;ws.room=null;ws.player=null;room.updated=Date.now();persist();broadcast(room,{type:'player_left',room:snapshot(room)});}
function removePlayer(ws){const room=ws.room,p=ws.player;if(!room||!p)return;room.players=room.players.filter(x=>x!==p);ws.room=null;ws.player=null;if(!room.players.length){rooms.delete(room.code);}else{if(!room.players.some(x=>x.host)){room.players[0].host=true;room.players[0].ready=false;}room.updated=Date.now();broadcast(room,{type:'player_left',room:snapshot(room)});}persist();}
wss.on('connection',(ws)=>{
  ws.isAlive=true; ws.rateWindow=Date.now(); ws.rateCount=0;
  ws.on('pong',()=>{ws.isAlive=true;});
  ws.on('message',(raw)=>{
    const now=Date.now(); if(now-ws.rateWindow>=MESSAGE_WINDOW_MS){ws.rateWindow=now;ws.rateCount=0;}
    if(++ws.rateCount>MESSAGE_LIMIT){send(ws,{type:'error',message:'تعداد درخواست‌ها بیش از حد است؛ اتصال بسته شد.'});ws.close(1008,'rate limit exceeded');return;}
    if(raw.length>256*1024){send(ws,{type:'error',message:'اندازه پیام بیش از حد مجاز است.'});return;}
    let msg;try{msg=JSON.parse(raw.toString())}catch{return send(ws,{type:'error',message:'پیام نامعتبر است.'})}
    if(!msg||typeof msg.type!=='string')return;
    if(msg.type==='create_room'){
      if(ws.room)return send(ws,{type:'error',message:'ابتدا از اتاق فعلی خارج شو.'});
      const country=Number(msg.country);if(!Number.isInteger(country)||country<0||country>=WORLD_COUNT)return send(ws,{type:'error',message:'کشور انتخابی معتبر نیست.'});
      if(rooms.size>=MAX_ROOMS)return send(ws,{type:'error',message:'ظرفیت سرور برای ساخت اتاق جدید تکمیل است.'});
      let c;do{c=code()}while(rooms.has(c));const room={code:c,players:[],created:Date.now(),updated:Date.now(),game:null};rooms.set(c,room);
      const resumeToken=crypto.randomBytes(24).toString('hex');const p={id:cryptoId(),ws,name:safeName(msg.name),country,ready:false,host:true,tokenHash:tokenHash(resumeToken)};room.players.push(p);room.updated=Date.now();ws.room=room;ws.player=p;persist();
      return send(ws,{type:'room_created',playerId:p.id,resumeToken,host:true,room:snapshot(room)});
    }
    if(msg.type==='resume_room'){
      if(ws.room)return send(ws,{type:'error',message:'ابتدا از اتاق فعلی خارج شو.'});
      const room=rooms.get(String(msg.code||'').toUpperCase());if(!room)return send(ws,{type:'error',message:'اتاق ذخیره‌شده پیدا نشد.'});
      const p=room.players.find(x=>safeTokenMatch(x.tokenHash,msg.resumeToken));
      if(!p)return send(ws,{type:'error',message:'کد بازیابی معتبر نیست.'});
      if(p.ws&&p.ws.readyState===WebSocket.OPEN)return send(ws,{type:'error',message:'این بازیکن هنوز متصل است.'});
      p.ws=ws;p.ready=false;ws.room=room;ws.player=p;room.updated=Date.now();persist();
      send(ws,{type:'room_resumed',playerId:p.id,resumeToken:msg.resumeToken,host:p.host,room:snapshot(room),game:room.game?{turn:room.game.turn,revision:room.game.revision,worldCountries:room.game.worldCountries,state:room.game.playerStates?.get(p.id)||room.game.state,playerRevision:room.game.playerRevisions?.get(p.id)||0,relations:room.game.engine?.relations,wars:room.game.engine?.wars,treaties:room.game.engine?.treaties}:null});
      broadcast(room,{type:'lobby_update',room:snapshot(room)});return;
    }
    if(msg.type==='join_room'){
      if(ws.room)return send(ws,{type:'error',message:'ابتدا از اتاق فعلی خارج شو.'});
      const room=rooms.get(String(msg.code||'').toUpperCase());if(!room)return send(ws,{type:'error',message:'اتاق پیدا نشد.'});
      if(room.players.length>=4)return send(ws,{type:'error',message:'ظرفیت اتاق تکمیل است.'});
      const country=Number(msg.country);if(!Number.isInteger(country)||country<0||country>=WORLD_COUNT)return send(ws,{type:'error',message:'کشور انتخابی معتبر نیست.'});
      if(room.players.some(p=>p.country===country))return send(ws,{type:'error',message:'این کشور را بازیکن دیگری انتخاب کرده است.'});
      const resumeToken=crypto.randomBytes(24).toString('hex');const p={id:cryptoId(),ws,name:safeName(msg.name),country,ready:false,host:false,tokenHash:tokenHash(resumeToken)};room.players.push(p);room.updated=Date.now();ws.room=room;ws.player=p;persist();
      send(ws,{type:'room_joined',playerId:p.id,resumeToken,host:false,room:snapshot(room)});broadcast(room,{type:'lobby_update',room:snapshot(room)});return;
    }
    const room=ws.room,p=ws.player;if(!room||!p)return send(ws,{type:'error',message:'ابتدا وارد یک اتاق شو.'});
    if(msg.type==='ready'){
      p.ready=!!msg.ready; room.updated=Date.now();persist();
      broadcast(room,{type:'lobby_update',room:snapshot(room)});
      if(room.players.length===4&&room.players.every(x=>x.ready))broadcast(room,{type:'match_ready',room:snapshot(room)});
    } else if(msg.type==='game_start'){
      if(!p.host)return send(ws,{type:'error',message:'فقط سازنده اتاق می‌تواند مسابقه را شروع کند.'});
      if(room.players.length!==4||!room.players.every(x=>x.ready))return send(ws,{type:'error',message:'هر چهار بازیکن باید آماده باشند.'});
      if(room.game)return send(ws,{type:'error',message:'مسابقه قبلاً شروع شده است.'});
      const state=validGameState(msg.state,p.country);if(!state)return send(ws,{type:'error',message:'وضعیت اولیه بازی معتبر نیست.'});
      room.game={state,revision:1,turn:0,lastActionAt:Date.now(),playerStates:new Map(),playerRevisions:new Map(),playerLastActionAt:new Map(),worldCountries:{},engine:createWorld(state.countries),activeCountries:room.players.map(x=>x.country)};
      room.game.playerStates.set(p.id,state); room.game.playerRevisions.set(p.id,1);
      room.game.worldCountries[String(p.country)]=pickCountryState(state,p.country); room.updated=Date.now();
      persist();broadcast(room,{type:'game_started',state:room.game.state,revision:1,playerRevisions:Object.fromEntries(room.game.playerRevisions),worldCountries:room.game.worldCountries,relations:room.game.engine.relations,wars:room.game.engine.wars,treaties:room.game.engine.treaties});
    } else if(msg.type==='player_state_sync'){
      if(!room.game)return send(ws,{type:'error',message:'مسابقه هنوز شروع نشده است.'});
      const state=validGameState(msg.state,p.country);if(!state)return send(ws,{type:'error',message:'وضعیت اختصاصی کشور معتبر نیست.'});
      const current=room.game.playerRevisions.get(p.id)||0;
      if(Number(msg.baseRevision)!==current)return send(ws,{type:'player_state_conflict',playerRevision:current,country:p.country});
      const now=Date.now(),last=room.game.playerLastActionAt?.get(p.id)||0;
      if(now-last<60)return send(ws,{type:'error',message:'درخواست‌های این بازیکن بیش از حد سریع است.'});
      if(!room.game.playerLastActionAt)room.game.playerLastActionAt=new Map();
      const next=current+1;room.game.playerStates.set(p.id,state);room.game.playerRevisions.set(p.id,next);room.game.playerLastActionAt.set(p.id,now);room.updated=now;
      const countryState=pickCountryState(state,p.country);
      if(!countryState)return send(ws,{type:'error',message:'اطلاعات کشور برای انتشار معتبر نیست.'});
      room.game.worldCountries[String(p.country)]=countryState;
      // Publish only this player's selected country into the shared world; private cabinet/economy stays private.
      persist();broadcast(room,{type:'world_country_update',by:p.id,country:p.country,playerRevision:next,countryState});
      send(ws,{type:'player_state_ack',playerRevision:next,country:p.country});
    } else if(msg.type==='world_sync_request'){
      if(!room.game)return send(ws,{type:'error',message:'مسابقه هنوز شروع نشده است.'});
      return send(ws,{type:'world_snapshot',worldCountries:room.game.worldCountries||{},turn:room.game.turn,relations:room.game.engine?.relations,wars:room.game.engine?.wars,treaties:room.game.engine?.treaties});
    } else if(msg.type==='turn_action'){
      if(!room.game)return send(ws,{type:'error',message:'مسابقه هنوز شروع نشده است.'});
      const g=room.game;
      try {
        const status=submitAction(g.engine,p.country,msg.action,msg.turn,g.activeCountries);
        if(status.ready===4){
          const result=resolveTurn(g.engine,g.activeCountries);
          g.turn=result.turn;
          for(const [id,c] of Object.entries(result.countries))g.worldCountries[id]=c;
          persist();broadcast(room,{type:'authoritative_turn_resolved',turn:g.turn,countries:result.countries,relations:result.relations,wars:result.wars,treaties:result.treaties});
        } else {
          send(ws,{type:'turn_action_ack',turn:g.turn,submitted:true,ready:status.ready,required:status.required});
          broadcast(room,{type:'turn_waiting',turn:g.turn,ready:status.ready,required:status.required});
        }
        room.updated=Date.now();persist();
      } catch(err) {
        const messages={invalid_country:'کشور نامعتبر است.',stale_turn:'این نوبت منقضی شده است.',already_submitted:'اقدام این نوبت قبلاً ثبت شده است.',invalid_action:'اقدام نامعتبر است.',not_sovereign:'این کشور مستقل تحت کنترل شما نیست.',not_active_player:'کشور شما جزو کشورهای فعال این مسابقه نیست.',insufficient_funds:'خزانه برای این اقدام کافی نیست.',invalid_active_players:'چهار کشور فعال معتبر نیستند.',turn_not_ready:'هنوز همه بازیکنان اقدام نکرده‌اند.'};
        send(ws,{type:'error',message:messages[err.message]||'اقدام پذیرفته نشد.'});
      }
    } else if(msg.type==='state_sync'){
      // Legacy whole-room snapshots let any participant overwrite everyone else's state.
      // Stage 9 rejects this obsolete protocol; use player_state_sync + world projections.
      return send(ws,{type:'error',message:'ارسال وضعیت مشترک قدیمی غیرفعال است؛ از کانال اختصاصی کشور استفاده کن.'});
    } else if(msg.type==='leave_room'){removePlayer(ws);send(ws,{type:'left'});}
  });
  ws.on('close',()=>leave(ws));
  ws.on('error',()=>leave(ws));
});
function cryptoId(){return require('crypto').randomBytes(8).toString('hex');}
function safeName(v){return String(v||'بازیکن').replace(/[<>\u0000-\u001f]/g,'').trim().slice(0,24)||'بازیکن';}
// Keep dead sockets from occupying lobby slots and expire only genuinely idle rooms.
setInterval(()=>{for(const ws of wss.clients){if(!ws.isAlive){leave(ws);ws.terminate();continue;}ws.isAlive=false;ws.ping();}},25_000).unref();
setInterval(()=>{const now=Date.now();for(const [k,r] of rooms)if(now-(r.updated||r.created)>ROOM_IDLE_MS){for(const p of r.players){if(p.ws){p.ws.room=null;p.ws.player=null;send(p.ws,{type:'room_expired'});}}rooms.delete(k);persist();}},60_000).unref();
server.listen(PORT,'0.0.0.0',()=>console.log(`ARCADIA server listening on ${PORT}`));

