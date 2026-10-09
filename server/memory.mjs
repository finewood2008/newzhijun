import {fail} from './policy.mjs';
const pick=(body,keys)=>Object.fromEntries(keys.filter(k=>Object.hasOwn(body,k)).map(k=>[k,body[k]]));
const listFields={
 atoms:['entity_id','candidate_type','importance_min','include_deprecated','query','order_by','order'],
 entities:['entity_type','query','order_by','order'],
 episodes:['emotion','intensity_min','date_from','date_to','topic','query'],
 journal:['action','target_type','actor','time_from','time_to','target_entity_id','target_atom_id','target_candidate_id'],
 candidates:['status','candidate_type','session_id','target_entity_id','time_from','time_to','query'],
 raw_events:['session_id','thread_id','event_type','query']
};
function integer(value, fallback,min,max){const n=Number(value??fallback);if(!Number.isInteger(n)||n<min||n>max)fail(400,'INVALID_RANGE','数值超出允许范围。');return n;}
function assertText(value){if(typeof value!=='string'||!value.trim()||value.length>20000)fail(400,'INVALID_MEMORY','请填写有效的记忆内容。');}
/** Build a closed, per-user memory route. Never accept agent IDs, namespaces or db paths from clients. */
export async function memoryRoute({path,method,body={},url,aid,contentType,portableImport=false}) {
 if(!path.startsWith('/api/native-memory/'))return null;
 const suffix=path.slice('/api/native-memory'.length),root=`/agents/${aid}/memory`;
 let target=root+suffix,payload,format='json';
 if(suffix==='/models'&&method==='GET')return {target:'/providers/resolved',format:'models'};
 if(suffix==='/timezone'&&method==='GET')return {target:'/settings/timezone',format:'timezone'};
 if(suffix==='/proactive'&&['GET','PUT'].includes(method)) {
  target=`/agents/${aid}/proactive-care`;
  if(method==='PUT'){
   payload=pick(body,['enabled','active_hours_start','active_hours_end','min_interval_hours','max_interval_hours','episode_filter']);
   if(typeof payload.enabled!=='boolean'||![payload.active_hours_start,payload.active_hours_end].every(v=>typeof v==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(v))||payload.active_hours_start>=payload.active_hours_end)fail(400,'INVALID_HOURS','请设置有效的关心时段。');
   payload.min_interval_hours=integer(payload.min_interval_hours,5,1,168);payload.max_interval_hours=integer(payload.max_interval_hours,24,payload.min_interval_hours,168);
  }
  return {target,payload,format};
 }
 let match=suffix.match(/^\/(atoms|entities|episodes|journal|candidates|raw_events)\/list$/);
 if(match&&method==='POST')payload={...pick(body,listFields[match[1]]),offset:integer(body.offset,0,0,1000000),limit:integer(body.limit,50,1,200)};
 else if(method==='GET'&&/^\/(atoms|entities|episodes|raw_events|candidates)\/[\w-]+$/.test(suffix)){}
 else if(method==='GET'&&['/stats/counts','/stats/atom_kinds'].includes(suffix)){}
 else if(method==='GET'&&suffix==='/stats/growth')target+=`?days=${integer(url.searchParams.get('days'),7,1,366)}`;
 else if(method==='GET'&&(suffix==='/journal/recent'||/^\/terminal\/(about_me|current_focus|things_you_told_me|recent_stories|entities)$/.test(suffix)))target+=`?limit=${integer(url.searchParams.get('limit'),5,1,200)}`;
 else if(method==='POST'&&(match=suffix.match(/^\/(atoms|candidates)\/[\w-]+:(promote|reject|replace|deprecate)$/))){
  if((match[1]==='atoms'&&!['replace','deprecate'].includes(match[2]))||(match[1]==='candidates'&&!['promote','reject'].includes(match[2])))fail(404,'NOT_FOUND','此功能暂不可用。');
  payload=pick(body,['reason',...(match[2]==='replace'?['assertion']:[])]);
  if(match[2]==='replace')assertText(payload.assertion);
  if(['reject','deprecate'].includes(match[2]))payload.actor='user';
 }
 else if(method==='POST'&&suffix==='/atoms'){payload=pick(body,['assertion','entity_id','entity_name','entity_type','kind','importance','confidence','reason']);assertText(payload.assertion);}
 else if(suffix==='/extract-config'&&['GET','PUT'].includes(method)){
  if(method==='PUT'){
   payload=pick(body,['memory_enabled','extract_on_session_end','extract_trigger_mode','extract_idle_seconds','extract_interval_seconds','aux_model']);
   for(const k of ['memory_enabled','extract_on_session_end'])if(k in payload&&typeof payload[k]!=='boolean')fail(400,'INVALID_CONFIG','记忆设置无效。');
   if(!['idle','interval'].includes(payload.extract_trigger_mode))fail(400,'INVALID_CONFIG','整理方式无效。');
   payload.extract_idle_seconds=integer(payload.extract_idle_seconds,300,60,604800);payload.extract_interval_seconds=integer(payload.extract_interval_seconds,21600,360,604800);
   if('aux_model'in payload&&typeof payload.aux_model!=='string')fail(400,'INVALID_CONFIG','提取模型无效。');
  }
 }
 else if(suffix==='/portable/pack'&&method==='POST'){format='blob';}
 else if(method==='POST'&&['/portable/adopt','/portable/doctor'].includes(suffix)){
  if(!Buffer.isBuffer(body)||!contentType?.startsWith('multipart/form-data'))fail(400,'INVALID_FILE','请选择记忆包。');
  let input;try{input=await new Response(body,{headers:{'Content-Type':contentType}}).formData();}catch{fail(400,'INVALID_FILE','文件格式无效。');}
  const form=new FormData(),adopt=suffix.endsWith('/adopt'),field=adopt?'pkg_file':'compare_pkg',file=input.get(field);
  if(adopt&&(!file||typeof file==='string'))fail(400,'INVALID_FILE','请选择记忆包。');
  if(file&&typeof file!=='string')form.set(field,file,'memory.hmpkg');
  if(adopt){
   // Requires the supplied native portable-route patch: actual private SQLite path + normalized namespace.
   if(!portableImport)fail(409,'IMPORT_NOT_CONFIGURED','此服务尚未启用记忆包导入，请联系管理员确认存储配置。');
   form.set('target_host','agent');form.set('target_namespace',`agent_${aid}`);
   form.set('on_conflict',input.get('on_conflict')==='replace'?'replace':'skip');form.set('host_rewrite',input.get('host_rewrite')==='target'?'target':'keep');form.set('dry_run',input.get('dry_run')==='false'?'false':'true');
  }else form.set('host_spec',`agent:agent_${aid}`);
  payload=form;format=adopt?'adopt':'doctor';
 }
 else fail(404,'NOT_FOUND','此功能暂不可用。');
 return {target,payload,format};
}
export function memoryResult(result,format){
 if(format==='models')return result.map(m=>pick(m,['provider_name','model','name']));
 if(format==='timezone')return {timezone:result.timezone};
 if(format==='adopt')return {...pick(result,['applied','skipped','errors','dry_run','already_adopted','already_adopted_at','applied_by_table','skipped_by_table']),target_namespace:'我的知君私人空间'};
 if(format==='doctor')return {...pick(result,['all_passed','row_count_diff']),checks:(result.checks||[]).map(c=>({name:c.name,passed:c.passed,message:c.passed?'检查通过':'检查未通过，请联系管理员查看服务诊断。'}))};
 return result;
}
