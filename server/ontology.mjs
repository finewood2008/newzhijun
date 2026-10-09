import {fail,id} from './policy.mjs';
/** Closed routes. All targets use the server-resolved role agent. */
export function ontologyRoute({path,method,body,url,aid}) {
 if(!path.startsWith('/api/ontology')) return null;
 const suffix=path.slice('/api/ontology'.length),root=`/agents/${id(aid)}/ontology`;
 if(method==='GET'&&suffix==='') return {target:root};
 if(method==='GET'&&suffix==='/facts'){
  const offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||50);
  if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>100)fail(400,'INVALID_PAGE','页码不正确。');
  return {target:`${root}/facts?offset=${offset}&limit=${limit}`};
 }
 if(method==='POST'&&suffix==='/generate')return {target:root+suffix,payload:{revision:body.revision}};
 const node=suffix.match(/^\/nodes\/([\w-]+)$/);
 if(method==='POST'&&node){
  const allowed=['request_id','expected_version','action','statement','conditions','exceptions','kind','importance','affinity','valid_from','valid_until','change_mode','restore_version'];
  return {target:root+'/nodes/'+id(node[1]),payload:Object.fromEntries(allowed.filter(k=>body[k]!==undefined).map(k=>[k,body[k]]))};
 }
 const context=suffix.match(/^\/context\/([\w-]+)$/);
 if(context&&['GET','PUT'].includes(method))return {target:root+'/context/'+id(context[1]),...(method==='PUT'?{payload:{excluded:body.excluded}}:{})};
 fail(404,'NOT_FOUND','没有这个本体操作。');
}
