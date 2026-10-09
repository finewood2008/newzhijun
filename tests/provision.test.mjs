import test from 'node:test';import assert from 'node:assert/strict';import {createProvisioner} from '../server/provision.mjs';
const config={bindings:{4:{agentId:'private4'}},provisioning:{4:{sourceAgentId:'shared',rules:'Reviewed behavioural rules',workspaceRoot:'/private-test/4'}}};
const session={user:{id:4}};
function fixture({existing=false,foreign=false,unreachable=false}={}) {
 const calls=[];let created=existing;
 const upstream=async(path,s,method='GET',body)=>{
  calls.push({path,method,body});
  if(path==='/agents/private4') {if(unreachable)throw Object.assign(new Error(),{status:502});if(!created)throw Object.assign(new Error(),{status:404});return {agent_id:'private4',user_id:foreign?5:4,is_shared:false};}
  if(path==='/agents/shared')return {agent_id:'shared',user_id:1,is_shared:true,default_model:'native/default',config:{workspace_dir:'PRIVATE'},knowledge_base_ids:['private']};
  if(method==='POST'){created=true;return {agent_id:'private4'};}return {};
 };
 return {calls,provision:createProvisioner(config,upstream)};
}
test('existing private binding is reused without resetting settings',async()=>{const f=fixture({existing:true});await f.provision(session);assert.equal(f.calls.length,1);});
test('first login creates a private instance with no source data or workspace paths',async()=>{const f=fixture();await f.provision(session);const c=f.calls.find(x=>x.method==='POST');assert.equal(c.path,'/agents/from-expert/default');assert.equal(c.body.default_model,'native/default');assert.deepEqual(c.body.knowledge_base_ids,[]);assert.equal(JSON.stringify(c.body).includes('PRIVATE'),false);assert.equal(c.body.file_overrides[0].content,'Reviewed behavioural rules');assert.equal(c.body.agent_id,'private4');assert.equal(c.body.backend.type,'filesystem');assert.equal(c.body.backend.root_dir,'/private-test/4');});
test('concurrent first logins create once',async()=>{const f=fixture();await Promise.all([f.provision(session),f.provision(session)]);assert.equal(f.calls.filter(x=>x.method==='POST').length,1);});
test('unconfigured account never auto provisions',async()=>{const f=fixture();await f.provision({user:{id:5}});assert.equal(f.calls.length,0);});
test('foreign preexisting instance is rejected',async()=>{const f=fixture({existing:true,foreign:true});await assert.rejects(f.provision(session));assert.equal(f.calls.some(x=>x.method==='POST'),false);});
test('unreachable server is not mistaken for missing instance',async()=>{const f=fixture({unreachable:true});await assert.rejects(f.provision(session));assert.equal(f.calls.some(x=>x.method==='POST'),false);});
