'use strict';
const assert = require('assert');
const crypto = require('crypto');
function tokenHash(token){return crypto.createHash('sha256').update(String(token)).digest('hex');}
function safeTokenMatch(storedHash, suppliedToken){
  if(typeof storedHash !== 'string' || !/^[a-f0-9]{64}$/.test(storedHash)) return false;
  if(typeof suppliedToken !== 'string' || suppliedToken.length !== 48 || !/^[a-f0-9]{48}$/.test(suppliedToken)) return false;
  return crypto.timingSafeEqual(Buffer.from(storedHash,'hex'),Buffer.from(tokenHash(suppliedToken),'hex'));
}
const token=crypto.randomBytes(24).toString('hex');
assert.equal(safeTokenMatch(tokenHash(token),token),true);
assert.equal(safeTokenMatch(tokenHash(token),'wrong-token'),false);
assert.equal(safeTokenMatch('bad-hash',token),false);
assert.equal(safeTokenMatch(tokenHash(token),null),false);
assert.equal(safeTokenMatch(tokenHash(token),token.slice(1)),false);
console.log('Stage 13 token validation tests passed.');
