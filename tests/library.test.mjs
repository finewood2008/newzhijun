import test from 'node:test';import assert from 'node:assert/strict';import {createDefaultLibrary} from '../server/library.mjs';
const session={user:{id:4}},config={bindings:{4:{agentId:'mine'}}};
test('first use prepares exactly one private archive across simultaneous reads and turns',async()=>{let created=0;const bases=[];const calls=[];const upstream=async(path,s,method,body)=>{calls.push({path,method,body});if(method==='POST'){created++;const b={id:'new',owner_user_id:4,...body};bases.push(b);return b}return bases};const get=createDefaultLibrary(upstream,config);const result=await Promise.all([get(session),get(session),get(session)]);assert.equal(created,1);assert.ok(result.every(b=>b.id==='new'));assert.equal(result[0].shared,false);assert.equal(result[0].default_open,true);assert.equal((await get(session)).id,'new');assert.equal(created,1);});
test('existing owned material is reused and disabled archives still reference by default',async()=>{const existing={id:'existing',owner_user_id:4,shared:false,default_open:false};const calls=[];const get=createDefaultLibrary(async(path,s,method)=>{calls.push(method);return [existing,{id:'foreign',owner_user_id:5,shared:false,default_open:true},{id:'shared',owner_user_id:4,shared:true,default_open:true}]},config);assert.deepEqual(await get(session),{...existing,default_open:true});assert.deepEqual(calls,[undefined]);assert.equal(existing.default_open,false);});
test('operator binding and remembered selection cannot fall back to another private collection',async()=>{const get=createDefaultLibrary(async()=>[{id:'other',owner_user_id:4,shared:false}],{bindings:{4:{agentId:'mine',libraryId:'fixed'}}});await assert.rejects(get(session),{code:'LIBRARY_UNAVAILABLE'});});
test('an upstream creation with the wrong owner or shared visibility is rejected',async()=>{const get=createDefaultLibrary(async(path,s,method)=>method==='POST'?{id:'foreign',owner_user_id:5,shared:false}:[],config);await assert.rejects(get(session),{code:'PRIVATE_LIBRARY_REQUIRED'});});

test('expert-specific archive never borrows an existing account archive and is reused on reopen',async()=>{
 const bases=[{id:'legacy',name:'我的知识库',owner_user_id:4,shared:false,default_open:true}];let created=0;
 const upstream=async(path,s,method,body)=>{if(method==='POST'){created++;const b={id:'expert-new',owner_user_id:4,...body};bases.push(b);return b}return bases};
 const scoped={bindings:{4:{agentId:'second',libraryName:'知君 · 专家资料 · second'}}};
 assert.equal((await createDefaultLibrary(upstream,scoped)(session)).id,'expert-new');
 assert.equal((await createDefaultLibrary(upstream,scoped)(session)).id,'expert-new');assert.equal(created,1);
 assert.equal((await createDefaultLibrary(upstream,config)(session)).id,'legacy');
});
