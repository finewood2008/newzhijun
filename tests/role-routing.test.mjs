import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import http from 'node:http';
import {WebSocket,WebSocketServer} from 'ws';
import {createApp} from '../server/app.mjs';
import {createRoleStore} from '../server/roles.mjs';

async function fixture(t){
 const socketPaths=[],frames=[];
 const remote=http.createServer(),wss=new WebSocketServer({server:remote});
 wss.on('connection',(ws,req)=>{socketPaths.push(new URL(req.url,'http://localhost').pathname);ws.on('message',data=>{frames.push(JSON.parse(data));ws.send(JSON.stringify({type:'done'}));});});
 remote.listen(0,'127.0.0.1');await once(remote,'listening');
 const config={upstream:`http://127.0.0.1:${remote.address().port}`,publicOrigin:'http://127.0.0.1:0',bindings:{4:{agentId:'personal-agent',libraryId:'personal-library'}}};
 const store=createRoleStore();store.set(4,[{id:'work',name:'工作',description:'工作中的我',agentId:'work-agent',libraryId:'work-library',ready:true}]);store.set(5,[{id:'foreign',name:'他人',agentId:'foreign-agent',ready:true}]);
 const calls=[];
 const fetcher=async(url,options={})=>{
  const path=new URL(url).pathname,body=options.body?JSON.parse(options.body):undefined;calls.push({path,body,method:options.method});let data={};
  if(path==='/api/auth/login')data={access_token:'fixture-token',expires_in:3600,user:{id:4,username:'test'}};
  else if(path==='/api/auth/me')data={id:4,username:'test'};
  else if(/^\/api\/agents\/[^/]+$/.test(path))data={agent_id:path.split('/')[3],user_id:4,is_shared:false};
  else if(path==='/api/knowledge-bases')data=[{id:'personal-library',owner_user_id:4,shared:false}];
  else if(path.startsWith('/api/knowledge-bases/'))data={id:path.split('/')[3],owner_user_id:4,shared:false};
  else if(path.endsWith('/threads'))data=[{thread_id:path.includes('work-agent')?'work-thread':'personal-thread',title:'record'}];
  else if(path.includes('/memory/'))data={items:[{id:path.includes('work-agent')?'work-memory':'personal-memory'}]};
  return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
 };
 const app=createApp(config,{fetcher,roleStore:store});app.listen(0,'127.0.0.1');await once(app,'listening');config.publicOrigin=`http://127.0.0.1:${app.address().port}`;
 let cookie='';
 const request=(path,role='personal',method='GET',body)=>fetch(config.publicOrigin+path,{method,headers:{Origin:config.publicOrigin,Cookie:cookie,'X-Zhijun-Role':role,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 const login=await request('/api/login','personal','POST',{username:'test',password:'dummy'});cookie=login.headers.get('set-cookie').split(';')[0];
 t.after(async()=>{for(const client of wss.clients)client.terminate();app.closeAllConnections();await new Promise(r=>app.close(r));wss.close();await new Promise(r=>remote.close(r));});
 return {request,calls,socketPaths,frames,config,cookie};
}
test('each HTTP request selects its own role; parallel tabs do not share a mutable active role',async t=>{
 const f=await fixture(t);const [personal,work]=await Promise.all([f.request('/api/threads'),f.request('/api/threads','work')]);
 assert.equal((await personal.json())[0].thread_id,'personal-thread');assert.equal((await work.json())[0].thread_id,'work-thread');
 await f.request('/api/native-memory/atoms/list','work','POST',{agent_id:'personal-agent',namespace:'personal'});
 assert.equal(f.calls.at(-1).path,'/api/agents/work-agent/memory/atoms/list');assert.equal(f.calls.at(-1).body.agent_id,undefined);
});
test('role selection rejects foreign and forged bindings before memory access',async t=>{
 const f=await fixture(t);const before=f.calls.length;
 assert.equal((await f.request('/api/native-memory/stats/counts','foreign')).status,404);
 assert.equal((await f.request('/api/native-memory/stats/counts','work-agent')).status,404);
 assert.equal(f.calls.length,before);
});
test('same-owner libraries from a different role are also denied',async t=>{
 const f=await fixture(t);assert.equal((await f.request('/api/libraries/personal-library/documents','work')).status,403);
 assert.equal(f.calls.some(c=>c.path.endsWith('/personal-library/documents')),false);
 assert.equal((await (await f.request('/api/libraries','work')).json())[0].id,'work-library');
});
test('WebSocket chat and its selected knowledge archive remain pinned to the connecting role',async t=>{
 const f=await fixture(t);const ws=new WebSocket(f.config.publicOrigin.replace('http:','ws:')+'/api/chat?role=work',{headers:{Origin:f.config.publicOrigin,Cookie:f.cookie}});
 t.after(()=>ws.terminate());
 await new Promise((resolve,reject)=>{ws.on('error',reject);ws.on('message',data=>{if(JSON.parse(data).type==='ready')resolve();});});
 const reply=once(ws,'message');ws.send(JSON.stringify({type:'user_turn',text:'hello',thread_id:'work-thread',agent_id:'personal-agent',knowledge_base_ids:['personal-library']}));await reply;
 assert.deepEqual(f.socketPaths,['/api/agents/work-agent/chat/ws']);assert.deepEqual(f.frames[0].knowledge_base_ids,['work-library']);assert.equal(f.frames[0].agent_id,undefined);
 ws.close();
});
