const test=require('node:test'),assert=require('node:assert/strict'),https=require('node:https'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process'),{once}=require('node:events');
const {WebSocketServer,WebSocket}=require('ws'),{createGateway}=require('../shell/gateway.cjs'),{tlsOptions,probe,fingerprint}=require('../shell/connection.cjs');
test('desktop bridge pins TLS, keeps cookies out of renderer and reconnects without replay', {timeout:15000},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zhijun-bridge-'));let gateway,remote;const sockets=new Set();
 t.after(async()=>{gateway?.close();for(const ws of sockets)ws.terminate();if(remote?.listening)await new Promise(r=>{remote.closeAllConnections();remote.close(r)});fs.rmSync(dir,{recursive:true,force:true})});
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(dir,'key.pem'),'-out',path.join(dir,'cert.pem'),'-days','1','-subj','/CN=fixture.local'],{stdio:'ignore'});
 const certificate=fs.readFileSync(path.join(dir,'cert.pem'),'utf8'),profile={serverId:'fixture',certificate,fingerprint:fingerprint(certificate)};let calls=0,turns=0;
 remote=https.createServer({key:fs.readFileSync(path.join(dir,'key.pem')),cert:certificate},(req,res)=>{
  if(req.url==='/identity')return res.end(JSON.stringify({serverId:'fixture',product:'zhijun',protocol:1}));
  calls++;assert.equal(req.headers.origin,'zhijun://desktop');assert.equal(req.headers['x-zhijun-client'],'desktop-v1');
  if(req.url==='/api/login'){res.setHeader('Set-Cookie','zhijun_session=secret; HttpOnly; SameSite=Strict');return res.end('{}')}
  if(req.url==='/api/connection/select'){res.setHeader('Set-Cookie',['zhijun_backend=box-b; HttpOnly','zhijun_session=; Max-Age=0','unrelated=ignored']);return res.end('{}')}
  if(req.url==='/api/revoked'){res.statusCode=401;return res.end('{}')}
  if(req.url==='/api/role-check')assert.equal(req.headers['x-zhijun-role'],'work');assert.equal(req.headers.cookie,'zhijun_session=secret');res.end('{"ready":true}');
 });const wss=new WebSocketServer({server:remote});wss.on('connection',(ws,req)=>{sockets.add(ws);assert.equal(new URL(req.url,'https://localhost').searchParams.get('role'),'work');assert.equal(req.headers.cookie,'zhijun_session=secret');ws.send('ready');ws.on('message',msg=>{turns++;ws.send(msg.toString())});});
 remote.listen(0,'127.0.0.1');await once(remote,'listening');const endpoint=`https://127.0.0.1:${remote.address().port}`;
 assert.equal(await probe(endpoint,profile),endpoint);await assert.rejects(probe(endpoint,{...profile,serverId:'wrong'}));
 const connection={endpoint,options:tlsOptions(profile),status:()=>({connected:!!connection.endpoint}),check:async()=>{}},vault={cookie:'',paired:false,save:async()=>{}};
 gateway=await createGateway({directory:dir,connection,vault});const request=(url,options={})=>fetch(gateway.origin+url,{...options,headers:{Origin:gateway.origin,...options.headers}});
 assert.equal((await request('/api/login',{method:'POST',headers:{Origin:'http://foreign.local'}})).status,403);assert.equal(calls,0);
 const badHost=await new Promise((resolve,reject)=>{http.get(gateway.origin+'/desktop/status',{headers:{Host:'foreign.local'}},r=>{r.resume();resolve(r.statusCode)}).on('error',reject)});assert.equal(badHost,403);
 const login=await request('/api/login',{method:'POST'});await login.text();assert.equal(login.headers.get('set-cookie'),null);assert.equal(vault.cookie,'zhijun_session=secret');assert.equal((await (await request('/api/me')).json()).ready,true);
 const open=async()=>{await request('/api/role-check',{headers:{'X-Zhijun-Role':'work'}});
 const ws=new WebSocket(gateway.origin.replace('http:','ws:')+'/api/chat?role=work',{origin:gateway.origin});await once(ws,'message');return ws};
 let client=await open();const echo=once(client,'message');client.send('a single turn');assert.equal(String((await echo)[0]),'a single turn');assert.equal(turns,1);
 const closed=once(client,'close');for(const ws of sockets)ws.terminate();await closed;
 client=await open();assert.equal(turns,1,'new connection must not replay previous turn');client.close();
 connection.endpoint=null;assert.equal((await request('/api/me')).status,503);connection.endpoint=endpoint;assert.equal((await (await request('/api/me')).json()).ready,true);
 assert.equal((await request('/api/revoked')).status,401);assert.equal(vault.cookie,'');
 await request('/api/connection/select',{method:'POST'});assert.equal(vault.cookie,'zhijun_backend=box-b');
 await request('/api/login',{method:'POST'});assert.equal(vault.cookie,'zhijun_backend=box-b; zhijun_session=secret');
 await request('/api/revoked');assert.equal(vault.cookie,'zhijun_backend=box-b','expired login must not silently select the default backend');
});
