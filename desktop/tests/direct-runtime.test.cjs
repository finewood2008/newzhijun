const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {once}=require('node:events'),{pathToFileURL}=require('node:url');
const crypto=require('node:crypto');
const {startDesktopRuntime}=require('../shell/runtime.cjs');
const {desktopSessionStore}=require('../shell/session-store.cjs');
const serverModule=pathToFileURL(path.resolve(__dirname,'../../server/connections.mjs')).href;
function secureStorage(){
 const key=crypto.randomBytes(32);
 return {isEncryptionAvailable:()=>true,encryptString(value){const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);const data=Buffer.concat([c.update(value),c.final()]);return Buffer.concat([iv,c.getAuthTag(),data]);},decryptString(value){const d=crypto.createDecipheriv('aes-256-gcm',key,value.subarray(0,12));d.setAuthTag(value.subarray(12,28));return Buffer.concat([d.update(value.subarray(28)),d.final()]).toString();}};
}
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zhijun-direct-')),calls=[];
 fs.writeFileSync(path.join(dir,'index.html'),'<html><body>新版知君登录页</body></html>');
 // Upgrade must not read or overwrite the old connection or pairing state.
 fs.writeFileSync(path.join(dir,'connection.enc'),'legacy-vault-preserved');
 fs.writeFileSync(path.join(dir,'server-profile.json'),'old-profile-not-json');
 const wanx=http.createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  const p=new URL(req.url,'http://localhost').pathname;calls.push({path:p,authorization:req.headers.authorization});
  res.setHeader('Content-Type','application/json');let value={};
  if(p==='/api/health')value={ok:true,db:true};
  else if(p==='/api/auth/captcha')value={provider:'slider'};
  else if(p==='/.well-known/wanx')value={product:'wanx',protocol:1,name:'Mock 万象WANX',version:'test',capabilities:[]};
  else if(p==='/api/auth/login'){
   if(JSON.parse(body).password!=='mock-password'){res.statusCode=401;return res.end('{}');}
   value={access_token:'private-mock-token',user:{id:7,username:'mock-user'},expires_in:3600};
  }else{
   if(req.headers.authorization!=='Bearer private-mock-token'){res.statusCode=401;return res.end('{}');}
   if(p==='/api/auth/me')value={id:7,username:'mock-user'};
   else if(p==='/api/agents')value=[{agent_id:'owned',name:'知君 · Mock',user_id:7,is_shared:false}];
   else if(p==='/api/agents/owned')value={agent_id:'owned',name:'知君 · Mock',user_id:7,is_shared:false};
   else if(p==='/api/agents/owned/threads')value=[];
  }
  res.end(JSON.stringify(value));
 });
 wanx.listen(0,'127.0.0.1');await once(wanx,'listening');const endpoint=`http://127.0.0.1:${wanx.address().port}`;
 const safeStorage=secureStorage();let runtime,scans=0;
 const start=async()=>runtime=await startDesktopRuntime({dataDir:path.join(dir,'direct-wanx'),staticDir:dir,safeStorage,serverModule,discovery:{scan:async()=>{scans++;return {services:[{endpoint,name:'Mock 万象WANX'}]};},close(){}}});
 const stop=async()=>{const closed=once(runtime.server,'close');runtime.close();await closed;};
 await start();
 t.after(async()=>{if(runtime.server.listening)await stop();wanx.closeAllConnections();await new Promise(r=>wanx.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 const request=(route,{method='GET',body,cookie='',origin=runtime.origin,headers={}}={})=>fetch(runtime.origin+route,{method,headers:{Origin:origin,Cookie:cookie,...headers,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 const select=async()=>{const r=await request('/api/connection/select',{method:'POST',body:{address:endpoint}});assert.equal(r.status,200);return r.headers.getSetCookie().find(x=>x.startsWith('zhijun_backend=')).split(';')[0];};
 return {dir,calls,endpoint,request,select,start,stop,get runtime(){return runtime;},get scans(){return scans;}};
}

test('fresh desktop serves login without contacting a fixed server; discovers WANX on the client network',async t=>{
 const f=await fixture(t);
 assert.equal(f.runtime.server.address().address,'127.0.0.1');
 assert.match(await(await f.request('/')).text(),/新版知君登录页/);
 assert.deepEqual(await(await f.request('/api/connection')).json(),{scope:'client-lan',selected:false});
 assert.equal((await(await f.request('/api/status')).json()).needsConnection,true);
 assert.equal((await(await f.request('/api/captcha')).json()).connectionRequired,true);
 assert.equal((await f.request('/api/me')).status,401);
 assert.equal((await f.request('/api/login',{method:'POST',body:{username:'mock-user',password:'mock-password'}})).status,409);
 assert.equal((await f.request('/connect')).status,404);
 assert.equal((await f.request('/desktop/remote/pair',{method:'POST',body:{code:'old-code'}})).status,405);
 assert.equal(f.calls.length,0);
 const search=await(await f.request('/api/connection/search',{method:'POST',body:{}})).json();
 assert.equal(search.scope,'client-lan');assert.equal(search.services[0].endpoint,f.endpoint);assert.equal(f.scans,1);
 assert.equal((await f.request('/api/connection/search',{method:'POST',origin:'http://untrusted.example',body:{}})).status,403);
 assert.equal(f.scans,1);
});

test('desktop connects directly to selected WANX, logs in and restores the same expert securely after restart',async t=>{
 const f=await fixture(t),backendCookie=await f.select();
 assert.ok(f.calls.every(c=>!c.authorization),'discovery must not send a token');
 assert.equal((await f.request('/api/login',{method:'POST',cookie:backendCookie,body:{username:'mock-user',password:'wrong'}})).status,401);
 const login=await f.request('/api/login',{method:'POST',cookie:backendCookie,body:{username:'mock-user',password:'mock-password'}});
 assert.equal(login.status,200);
 const session=login.headers.getSetCookie()[0].split(';')[0],cookie=backendCookie+'; '+session;
 const me=await(await f.request('/api/me',{cookie})).json();assert.equal(me.ready,true);assert.equal(me.expertId,'owned');assert.equal(me.canCreateRoles,true);
 assert.equal((await f.request('/api/threads',{cookie,headers:{'X-Zhijun-Expert':'owned'}})).status,200);
 await f.stop();await f.start();
 assert.equal((await(await f.request('/api/connection')).json()).endpoint,f.endpoint);
 assert.equal((await(await f.request('/api/me',{cookie:session})).json()).expertId,'owned');
 const files=fs.readdirSync(path.join(f.dir,'direct-wanx'),{recursive:true}).filter(x=>String(x).endsWith('sessions.enc'));
 assert.equal(files.length,1);assert.equal(fs.readFileSync(path.join(f.dir,'direct-wanx',files[0])).includes(Buffer.from('private-mock-token')),false);
 assert.equal(fs.readFileSync(path.join(f.dir,'connection.enc'),'utf8'),'legacy-vault-preserved');
 assert.equal(fs.readFileSync(path.join(f.dir,'server-profile.json'),'utf8'),'old-profile-not-json');
 await f.request('/api/logout',{method:'POST',cookie,body:{}});
 assert.equal((await f.request('/api/me',{cookie})).status,401);
});

test('no plaintext session fallback is written when OS encryption is unavailable',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zhijun-no-safe-storage-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 for(const safeStorage of [{isEncryptionAvailable:()=>false},{isEncryptionAvailable:()=>true,getSelectedStorageBackend:()=> 'basic_text'}])assert.equal(desktopSessionStore(path.join(dir,'sessions'),safeStorage),null);
 assert.deepEqual(fs.readdirSync(dir),[]);
});
