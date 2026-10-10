import test from 'node:test';
import assert from 'node:assert/strict';
import {createExpertSelection,defaultZhijunExpert} from '../server/expert-selection.mjs';
const expert=(id,name,selectable=true)=>({id,name,selectable});
test('only one available Zhijun is automatic; every multiple-match case requires a choice',()=>{
 assert.equal(defaultZhijunExpert([expert('b','知君 · 人生上下文'),expert('a','知君')]),null);
 assert.equal(defaultZhijunExpert([expert('b','知君 · 人生上下文')]).id,'b');
 assert.equal(defaultZhijunExpert([expert('a','知君'),expert('b','知君')]),null);
 assert.equal(defaultZhijunExpert([expert('a','知君',false)]),null);
 assert.equal(defaultZhijunExpert([]),null);
});

test('shared owned Zhijun automatically gets one stable private instance without copying memory',async()=>{
 const source={agent_id:'source',name:'知君',user_id:1,is_shared:true,default_model:'model'},session={user:{id:1}},agents=new Map(),calls=[];
 const config={bindings:{},provisioning:{}};
 const upstream=async(path,s,method='GET',body)=>{
  calls.push({path,method,body});
  if(path==='/agents?scope=mine')return [source,...agents.values()];
  if(path==='/agents/source')return source;
  if(path==='/agents/source/workspace/file?path=AGENTS.md')return {content:'Shared expert behaviour'};
  if(path==='/agents/from-expert/default'){const a={agent_id:body.agent_id,name:body.name,user_id:1,is_shared:false};agents.set(a.agent_id,a);return a;}
  if(path.endsWith('/memory/extract-config'))return {};
  const a=agents.get(path.split('/')[2]);if(a)return a;
  throw Object.assign(new Error('missing'),{status:404});
 };
 const store={get:()=>[]},picker=createExpertSelection(config,upstream,store);
 assert.equal((await picker.list(session))[0].selectable,true);
 const [first,second]=await Promise.all([picker.resolve(session,'source'),picker.resolve(session,'source')]);
 assert.deepEqual(first,second);assert.notEqual(first.agentId,'source');
 assert.equal(calls.filter(c=>c.path==='/agents/from-expert/default').length,1);
 const create=calls.find(c=>c.path==='/agents/from-expert/default').body;
 assert.deepEqual(create.backend,{type:'filesystem',virtual_mode:true});assert.deepEqual(create.knowledge_base_ids,[]);assert.deepEqual(create.mcp_servers,[]);
 assert.equal(create.file_overrides[0].content,'Shared expert behaviour');
 const reloaded=createExpertSelection(config,upstream,store);assert.deepEqual(await reloaded.resolve(session,'source'),first);
 assert.equal(calls.filter(c=>c.path==='/agents/from-expert/default').length,1);
 assert.deepEqual((await picker.list(session)).map(a=>a.id),['source']);
 assert.equal(calls.some(c=>c.path.includes('/source/memory')||c.path.includes('/source/threads')),false);
});
