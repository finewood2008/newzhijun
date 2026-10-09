import {assertPrivateBase,fail} from './policy.mjs';
/** One default archive per owner; serialize first-use creation in this service. */
export function createDefaultLibrary(upstream,config){
 const pending=new Map(),chosen=new Map();
 return async function defaultLibrary(session){
  const uid=String(session.user.id);
  if(pending.has(uid))return pending.get(uid);
  const operation=(async()=>{
   const owned=(await upstream('/knowledge-bases',session)).filter(b=>Number(b.owner_user_id)===Number(uid)&&!b.shared);
   const configured=config.bindings[uid]?.libraryId;
   const remembered=configured||chosen.get(uid);
   let base=remembered?owned.find(b=>b.id===remembered):null;
   if(remembered&&!base)fail(409,'LIBRARY_UNAVAILABLE','默认知识库暂不可用，请联系管理员。');
   if(!base)base=[...owned].sort((a,b)=>Number(!!b.default_open)-Number(!!a.default_open)||String(a.created_at||'').localeCompare(String(b.created_at||''))||String(a.id).localeCompare(String(b.id)))[0];
   if(!base)base=await upstream('/knowledge-bases',session,'POST',{name:'我的知识库',shared:false,default_open:true});
   assertPrivateBase(base,session.user);chosen.set(uid,base.id);
   return {...base,default_open:true};
  })();
  pending.set(uid,operation);try{return await operation}finally{pending.delete(uid)}
 };
}
