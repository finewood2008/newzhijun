import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createConnectedApp} from '../server/connections.mjs';
import {lanOrigin,probeWanx} from '../server/lan-discovery.mjs';

test('manual discovery only accepts explicit LAN origins, never URLs containing secrets or metadata hosts',()=>{
 for(const address of ['http://169.254.169.254','https://example.com','http://8.8.8.8','http://192.168.1.2/api','http://u:p@192.168.1.2','file:///etc/passwd','http://192.168.1.2/?token=secret'])assert.throws(()=>lanOrigin(address));
 assert.equal(lanOrigin('http://192.168.1.2:8088/'),'http://192.168.1.2:8088');
});
test('probe sends no authorization, refuses redirects and rejects unrelated health servers',async()=>{
 const calls=[];
 const fetcher=async(url,options)=>{calls.push(options);return Response.json(url.endsWith('/api/health')?{ok:true,db:true}:url.endsWith('/api/auth/captcha')?{provider:'slider'}:{product:'wanx',protocol:1,name:'Box',version:'1',capabilities:['role-ontology-v1']});};
 const result=await probeWanx('http://192.168.1.2:8088',fetcher);assert.equal(result.ontology,true);assert.equal(result.name,'Box');assert.ok(calls.every(c=>c.redirect==='error'&&!c.headers.Authorization));
 await assert.rejects(()=>probeWanx('http://192.168.1.2',async()=>Response.json({ok:true})),/不是兼容/);
});
async function fixture(t,mapped=false,multiple=false,configuredSource=false){
 const calls=[],config={upstream:'http://192.168.1.10:8088',bindings:{4:{agentId:'original'}},publicOrigin:'http://127.0.0.1:0'};
 if(mapped)config.provisioning={4:{sourceAgentId:'shared'}};
 const fetcher=async(url,o={})=>{const u=new URL(url);calls.push({host:u.host,path:u.pathname,authorization:o.headers?.Authorization});
 let value={};
 if(u.pathname==='/api/auth/login')value={access_token:'token-'+u.hostname,expires_in:3600,user:{id:4,username:'test'}};
 else if(u.pathname==='/api/auth/me')value={id:4,username:'test'};
 else if(u.pathname==='/api/agents')value=[{agent_id:'remote',name:'知君',user_id:4,is_shared:false},{agent_id:'ordinary',name:'通用助手',user_id:4,is_shared:false},{agent_id:'foreign',name:'知君外部',user_id:5,is_shared:false},{agent_id:'shared',name:'共享知君',user_id:5,is_shared:true}];
 else if(u.pathname.startsWith('/api/agents/'))value={agent_id:u.pathname.split('/')[3],name:u.pathname.includes('ordinary')?'通用助手':'知君',user_id:u.pathname.includes('foreign')||u.pathname.includes('shared')?5:4,is_shared:u.pathname.includes('shared')};
 if(mapped&&u.pathname==='/api/agents')value=[{agent_id:'shared',name:'知君 · 人生上下文',user_id:1,is_shared:true},{agent_id:'original',name:'知君 · 私人空间',user_id:4,is_shared:false},{agent_id:'zhijun-role-4-work',name:'知君 · 工作',user_id:4,is_shared:false}];
 if(configuredSource&&u.pathname==='/api/agents')value[0].agent_id='original';
 if(multiple&&u.pathname==='/api/agents')value.push({agent_id:'second',name:'知君 · 另一个',user_id:4,is_shared:false});
 if(u.pathname.endsWith('/threads'))value=[];
 return Response.json(value);
 };
 const app=createConnectedApp(config,{fetcher},{discovery:{scan:async()=>({services:[]}),close(){}},probe:async endpoint=>({endpoint:lanOrigin(endpoint),name:'Box'})});
 app.listen(0,'127.0.0.1');await once(app,'listening');config.publicOrigin=`http://127.0.0.1:${app.address().port}`;
 t.after(()=>new Promise(resolve=>{app.closeAllConnections();app.close(resolve)}));
 const request=(path,method='GET',body,cookie='',origin=config.publicOrigin,expert)=>fetch(config.publicOrigin+path,{method,headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json',...(expert?{'X-Zhijun-Expert':expert}:{})},body:body?JSON.stringify(body):undefined});
 const login=async cookie=>{const r=await request('/api/login','POST',{username:'test',password:'test'},cookie);assert.equal(r.status,200);return r.headers.getSetCookie()[0].split(';')[0]};
 return {request,login,calls};
}
test('switching revokes the old session and never sends its token to the new host',async t=>{
 const f=await fixture(t),old=await f.login();assert.equal((await f.request('/api/me','GET',null,old)).status,200);
 const selected=await f.request('/api/connection/select','POST',{address:'http://192.168.1.20:8088'},old);assert.equal(selected.status,200);
 const target=selected.headers.getSetCookie().find(v=>v.startsWith('zhijun_backend=')).split(';')[0];
 assert.equal((await f.request('/api/me','GET',null,target+'; '+old)).status,401);
 assert.equal((await f.request('/api/me','GET',null,old)).status,401);
 const session=await f.login(target),cookie=target+'; '+session;
 const user=await(await f.request('/api/me','GET',null,cookie)).json();assert.equal(user.ready,true);assert.equal(user.expertId,'remote');
 const agents=await(await f.request('/api/connection/agents','GET',null,cookie)).json();assert.deepEqual(agents.agents.map(a=>a.id),['remote','shared']);assert.equal(agents.agents.find(a=>a.id==='shared').selectable,false);
 assert.equal((await f.request('/api/connection/agents','POST',{agentId:'foreign'},cookie)).status,403);
 assert.equal((await f.request('/api/connection/agents','POST',{agentId:'remote'},cookie)).status,200);
 assert.equal((await(await f.request('/api/me','GET',null,cookie)).json()).ready,true);
 assert.ok(!f.calls.some(c=>c.host.startsWith('192.168.1.20')&&c.authorization==='Bearer token-192.168.1.10'));
});
test('cross-origin discovery or selection cannot change a connection',async t=>{
 const f=await fixture(t);
 for(const path of ['/api/connection/search','/api/connection/select'])assert.equal((await f.request(path,'POST',{address:'http://192.168.1.20:8088'},'','http://evil.example')).status,403);
 assert.equal((await(await f.request('/api/connection')).json()).endpoint,'http://192.168.1.10:8088');
});

test('the configured box can select Zhijun experts, blocks unrelated/shared experts and rejects stale scopes',async t=>{
 const f=await fixture(t),cookie=await f.login();
 assert.equal((await f.request('/api/connection/agents')).status,401);
 const before=await(await f.request('/api/connection/agents','GET',null,cookie)).json();
 assert.equal(before.selectable,true);assert.equal(before.currentAgentId,null);
 assert.equal((await f.request('/api/connection/agents','POST',{agentId:'ordinary'},cookie)).status,400);
 assert.equal((await f.request('/api/connection/agents','POST',{agentId:'shared'},cookie)).status,403);
 assert.equal((await f.request('/api/connection/agents','POST',{agentId:'remote'},cookie)).status,200);
 const me=await(await f.request('/api/me','GET',null,cookie)).json();assert.equal(me.expertId,'remote');assert.equal(me.ready,true);
 assert.deepEqual(me.roles.map(r=>r.id),['personal']);
 assert.equal((await f.request('/api/threads','GET',null,cookie)).status,409);
 assert.equal((await f.request('/api/threads','GET',null,cookie,undefined,'remote')).status,200);
 assert.equal(f.calls.at(-1).path,'/api/agents/remote/threads');
 assert.equal((await f.request('/api/connection/agents','POST',{agentId:'original'},cookie)).status,200);
 assert.equal((await f.request('/api/threads','GET',null,cookie,undefined,'remote')).status,409);
 assert.equal((await f.request('/api/threads','GET',null,cookie)).status,200);
 assert.equal(f.calls.at(-1).path,'/api/agents/original/threads');
});

test('source expert selection hides internal roles and defaults to the shared Zhijun with isolated personal storage',async t=>{
 const f=await fixture(t,true),cookie=await f.login();
 const me=await(await f.request('/api/me','GET',null,cookie)).json();
 assert.equal(me.ready,true);assert.equal(me.expertId,'original');
 const result=await(await f.request('/api/connection/agents','GET',null,cookie)).json();
 assert.deepEqual(result.agents.map(a=>a.id),['shared']);assert.equal(result.currentAgentId,'shared');assert.equal(result.agents[0].selectable,true);
 assert.equal((await f.request('/api/connection/agents','POST',{agentId:'zhijun-role-4-work'},cookie)).status,400);
 assert.equal((await f.request('/api/connection/agents','POST',{agentId:'shared'},cookie)).status,200);
 assert.equal((await f.request('/api/threads','GET',null,cookie,undefined,'original')).status,200);
 assert.equal(f.calls.at(-1).path,'/api/agents/original/threads');
 assert.ok(!f.calls.some(c=>c.path==='/api/agents/shared/threads'));
});

test('multiple Zhijun experts block personal data until a choice, then preserve it on refresh',async t=>{
 const f=await fixture(t,false,true),cookie=await f.login();
 const first=await(await f.request('/api/me','GET',null,cookie)).json();
 assert.equal(first.ready,false);assert.deepEqual(first.expertChoices.map(a=>a.id),['remote','second']);assert.deepEqual(first.roles,[]);
 assert.equal((await f.request('/api/threads','GET',null,cookie)).status,409);
 assert.ok(!f.calls.some(c=>c.path.endsWith('/threads')));
 assert.equal((await f.request('/api/connection/agents','POST',{agentId:'second'},cookie)).status,200);
 const selected=await(await f.request('/api/me','GET',null,cookie)).json();
 assert.equal(selected.ready,true);assert.equal(selected.expertId,'second');assert.deepEqual(selected.expertChoices,[]);
 assert.equal(selected.canCreateRoles,true);
 const again=await(await f.request('/api/me','GET',null,cookie)).json();assert.equal(again.expertId,'second');
});
test('an owned source expert enables role creation without a preconfigured account binding',async t=>{
 const f=await fixture(t),cookie=await f.login();
 const me=await(await f.request('/api/me','GET',null,cookie)).json();
 assert.equal(me.ready,true);assert.equal(me.expertId,'remote');assert.equal(me.canCreateRoles,true);assert.deepEqual(me.expertChoices,[]);
});

test('an existing configured personal binding can create roles even without a provisioning whitelist',async t=>{
 const f=await fixture(t,false,false,true),cookie=await f.login();
 const me=await(await f.request('/api/me','GET',null,cookie)).json();
 assert.equal(me.ready,true);assert.equal(me.expertId,'original');assert.equal(me.canCreateRoles,true);
});
