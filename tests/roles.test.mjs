import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRoles, createRoleStore} from '../server/roles.mjs';

const config={bindings:{4:{agentId:'original',libraryId:'old-library'}},provisioning:{4:{sourceAgentId:'shared',workspaceRoot:'/test/agents/original',rules:'Reviewed common expert rules',auxModel:'native/default'}}};
const session={user:{id:4}};
const request={name:'工作',description:'工作中的我是创业者，讨论产品与团队。',requestId:'request_1234567890'};
function fixture(){
 const store=createRoleStore(),calls=[],agents=new Map(),bases=[];let failConfig=false;
 const upstream=async(path,s,method='GET',body)=>{
  calls.push({path,method,body});
  if(path==='/agents/shared')return {agent_id:'shared',is_shared:true,user_id:1,default_model:'same-model',knowledge_base_ids:['secret'],workspace:'/private'};
  if(path==='/agents/from-expert/default'){agents.set(body.agent_id,{agent_id:body.agent_id,user_id:4,is_shared:false});return agents.get(body.agent_id);}
  if(path.endsWith('/memory/extract-config')){if(failConfig)throw Object.assign(new Error('unavailable'),{status:502});return {};}
  if(path.startsWith('/agents/')){const a=agents.get(path.split('/')[2]);if(!a)throw Object.assign(new Error('missing'),{status:404});return a;}
  if(path==='/knowledge-bases'){if(method==='POST'){const b={id:'library-'+bases.length,owner_user_id:4,...body};bases.push(b);return b;}return bases;}
  if(path.startsWith('/knowledge-bases/'))return bases.find(b=>b.id===path.split('/')[2]);
  throw new Error('Unexpected path '+path);
 };
 const roles=createRoles(config,upstream,store,async()=>({id:'old-library',owner_user_id:4,shared:false}));
 return {roles,store,calls,agents,bases,setFailConfig(value){failConfig=value;}};
}
test('existing data stays in personal; internal bindings never go to the client',()=>{
 const f=fixture();assert.equal(f.roles.resolve(session.user).agentId,'original');assert.equal(f.roles.list(session.user)[0].name,'个人');assert.equal(f.roles.list(session.user)[0].agentId,undefined);
});
test('roles use the same capability template with distinct memory/workspace/library bindings',async()=>{
 const f=fixture();const work=await f.roles.create(session,{...request,agentId:'forged',workspace:'/other',model:'forged'});
 const writing=await f.roles.create(session,{...request,name:'写作',requestId:'request_other_123456'});
 const a=f.roles.resolve(session.user,work.id),b=f.roles.resolve(session.user,writing.id);
 assert.notEqual(a.agentId,b.agentId);assert.notEqual(a.libraryId,b.libraryId);assert.notEqual(a.agentId,'original');
 const creates=f.calls.filter(c=>c.path==='/agents/from-expert/default');
 for(const c of creates){assert.equal(c.body.default_model,'same-model');assert.deepEqual(c.body.knowledge_base_ids,[]);assert.deepEqual(c.body.mcp_servers,[]);assert.match(c.body.file_overrides[0].content,/Reviewed common expert rules/);assert.equal(c.body.backend.root_dir,'/test/agents/'+c.body.agent_id);assert.equal(JSON.stringify(c.body).includes('/private'),false);}
 assert.match(creates[0].body.file_overrides[0].content,/创业者/);
 assert.ok(f.bases.every(b=>b.shared===false&&b.default_open===false));
});
test('roles cannot be selected by another user or by passing an agent ID',async()=>{
 const f=fixture(),role=await f.roles.create(session,request);
 assert.throws(()=>f.roles.resolve({id:5},role.id),{code:'ROLE_NOT_FOUND'});
 assert.throws(()=>f.roles.resolve(session.user,f.roles.resolve(session.user,role.id).agentId),{code:'ROLE_NOT_FOUND'});
});
test('simultaneous retries create only one instance and reuse the same result',async()=>{
 const f=fixture();const [a,b]=await Promise.all([f.roles.create(session,request),f.roles.create(session,request)]);
 assert.equal(a.id,b.id);assert.equal(f.calls.filter(c=>c.path==='/agents/from-expert/default').length,1);assert.equal(f.bases.length,1);
 await assert.rejects(f.roles.create(session,{...request,requestId:'different_request_123'}),{code:'ROLE_NAME_EXISTS'});
 await assert.rejects(f.roles.create(session,{...request,name:'changed'}),{code:'ROLE_REQUEST_CONFLICT'});
});
test('failed preparation is hidden, then resumed without duplicating the instance or archive',async()=>{
 const f=fixture();f.setFailConfig(true);await assert.rejects(f.roles.create(session,request));assert.equal(f.roles.list(session.user).length,1);
 const pending=f.store.get(4)[0];assert.throws(()=>f.roles.resolve(session.user,pending.id),{code:'ROLE_NOT_FOUND'});
 f.setFailConfig(false);await f.roles.create(session,request);assert.equal(f.roles.list(session.user).length,2);assert.equal(f.bases.length,1);assert.equal(f.calls.filter(c=>c.path==='/agents/from-expert/default').length,1);
});
test('unconfigured users cannot provision roles and invalid definitions create nothing',async()=>{
 const f=fixture();await assert.rejects(f.roles.create({user:{id:5}},request),{code:'ROLE_CREATION_UNAVAILABLE'});
 await assert.rejects(f.roles.create(session,{...request,name:' '}),{code:'INVALID_ROLE'});
 await assert.rejects(f.roles.create(session,{...request,description:'x'.repeat(1201)}),{code:'INVALID_ROLE'});assert.equal(f.calls.length,0);
});
test('registry persists distinct per-user bindings across restarts with private permissions',()=>{
 const path=mkdtempSync(join(tmpdir(),'zhijun-roles-'));
 try{const a=createRoleStore(path);a.set(4,[{id:'role_a',agentId:'agent_a',ready:true}]);a.set(5,[{id:'role_b',agentId:'agent_b',ready:true}]);const b=createRoleStore(path);assert.equal(b.get(4)[0].agentId,'agent_a');assert.equal(b.get(5)[0].agentId,'agent_b');assert.equal(statSync(join(path,'roles.json')).mode&0o777,0o600);const copy=b.get(4);copy[0].agentId='tampered';assert.equal(b.get(4)[0].agentId,'agent_a');}finally{rmSync(path,{recursive:true,force:true});}
});

test('local web and desktop gateways read newly added roles from one shared registry',()=>{
 const path=mkdtempSync(join(tmpdir(),'zhijun-shared-roles-'));
 try{const web=createRoleStore(path),desktop=createRoleStore(path);web.set(4,[{id:'work',ready:true}]);assert.equal(desktop.get(4)[0].id,'work');desktop.set(4,[{id:'personal-project',ready:true}]);assert.deepEqual(web.get(4).map(r=>r.id),['work','personal-project']);}finally{rmSync(path,{recursive:true,force:true});}
});
