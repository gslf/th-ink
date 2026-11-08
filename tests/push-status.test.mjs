import test from 'node:test';
import assert from 'node:assert/strict';
import {pushStatusText,samePushKey,deliveryStatusText} from '../dist/js/push-status.js';
test('push outcomes distinguish provider acceptance from device display and queued tests',()=>{
 assert.match(pushStatusText({status:'accepted'}),/Display on the device is not confirmed/);
 assert.match(pushStatusText({status:'queued'}),/queued/);
 assert.match(pushStatusText({status:'expired'},'it'),/scaduta/);
 assert.match(pushStatusText({status:'retrying',pushStatus:{state:'authorization',http:403}}),/rejected the keys.*403/);
});
test('a changed VAPID key requires renewing the browser subscription',()=>{
 assert(samePushKey({options:{applicationServerKey:new Uint8Array([1,2]).buffer}},new Uint8Array([1,2])));
 assert(!samePushKey({options:{applicationServerKey:new Uint8Array([1,2]).buffer}},new Uint8Array([1,3])));
});

test('partial deliveries report both successes and errors without exposing endpoints',()=>{
 const batch={sent:1,retrying:1,expired:0,outcomes:{accepted:1,authorization:1}};
 const en=deliveryStatusText(batch,'en'),it=deliveryStatusText(batch,'it');
 assert.match(en,/1 accepted, 1 unsuccessful/);assert.match(en,/rejected the keys/);
 assert.match(it,/1 accettati, 1 tentativi non riusciti/);assert.match(it,/rifiuta le chiavi/);
});
