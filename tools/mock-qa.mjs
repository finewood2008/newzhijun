// Test-only WANX fixture and the real Zhijun gateway. Never loads deployment.json.
import http from 'node:http';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {WebSocketServer} from 'ws';
import {createApp} from '../server/app.mjs';
import {createRoleStore} from '../server/roles.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const directory=resolve(root,'verification/full-mock-20261010');
await mkdir(directory,{recursive:true});
const stamp='2026-10-10T01:00:00Z';
const users={701:{id:701,username:'mock-alice',display_name:'林小满（Mock）'},702:{id:702,username:'mock-bob',display_name:'陈晨（Mock）'},703:{id:703,username:'mock-pending',display_name:'未开通测试者'}};
const agents={};const bases={};let serial=20;
const flags={offline:false,failUpload:false,failSave:false,qr:'success'};
const calls=[];const unmatched=[];
function seed(aid,uid,label,bid){
 const atoms=[['a1','我更喜欢在清晨散步。','Preference'],['a2','长期合作时，我在乎诚实表达。','Fact'],['a3','下周整理读书笔记。','Task']].map(([id,assertion,kind])=>({id,entity_id:'e1',candidate_id:'c1',assertion:label+'：'+assertion,verbatim_quote:assertion,importance:'medium',confidence:'high',deprecated_at:null,created_at:stamp,kind}));
 const entity={id:'e1',entity_type:'Person',canonical_name:label,aliases:[],atom_count:3,created_at:stamp,page:{id:'page1',entity_id:'e1',headline:label+'的生活线索',summary_markdown:'# '+label+'\n喜欢晨间散步，重视长期合作。',topics:['生活','合作'],dirty:false,summary_version:1,created_at:stamp,updated_at:stamp}};
 const evidence=[{atom_id:'a2',event_id:'raw1',quote:atoms[1].verbatim_quote,timestamp:stamp,source_type:'memory',available:true}];
 const claim={id:'claim1',version:'v1',kind:'principle',title:'诚实表达',statement:label+'：在长期合作中诚实表达。',conditions:'长期合作',exceptions:'保留他人隐私',state:'confirmed',core_status:'admitted',admitted_at:stamp,admitted_by:uid,admitted_version:'v1',evidence_valid:true,importance:2,affinity:3,evidence,history:[]};
 const doc={revision:'r1',outdated:false,claims:[claim,{...claim,id:'claim2',version:'v2',kind:'response',statement:'希望被倾听，再一起梳理问题。',state:'draft',core_status:'pending',admitted_at:'',admitted_by:null,admitted_version:''}],coverage:{read_atoms:3,eligible_sources:3,independent_events:3}};
 agents[aid]={agent_id:aid,user_id:uid,is_shared:false,name:label,atoms,entities:[entity],episodes:[{id:'ep1',occurred_at:stamp,summary:label+'在散步后感觉放松。',verbatim_quote:'散步之后轻松了一些。',emotion:'joy',intensity:3,people:[],topics:['散步'],created_at:stamp}],candidates:[{id:'c1',raw_event_ids:['raw1'],candidate_type:'Preference',status:'needs_review',title:'喜欢清晨散步',assertion:'用户喜欢清晨散步。',verbatim_quote:'我喜欢清晨散步',quote_event_id:'raw1',subject_name:label,subject_entity_type:'Person',confidence:'high',importance:'medium',recommended_action:'create',created_at:stamp}],raw_events:[{id:'raw1',host:'agent',thread_id:'t1',session_id:'s1',timestamp:stamp,event_type:'user_message',content:'我喜欢清晨散步。',payload:{role:'user',content:'我喜欢清晨散步。'}}],journal:[{id:'j1',timestamp:stamp,action:'atom_created',actor:'user',target_atom_id:'a2',target_summary:atoms[1].assertion,note:'本人主动记录'}],extract:{memory_enabled:true,extract_on_session_end:true,extract_trigger_mode:'idle',extract_idle_seconds:300,extract_interval_seconds:21600,aux_model:null},proactive:{enabled:false,active_hours_start:'09:00',active_hours_end:'22:00',min_interval_hours:5,max_interval_hours:24,episode_filter:null},channels:[],doc,excluded:{},threads:[{thread_id:'t1',title:label+'的晨间对话',last_active:Date.now()/1000,created_at:Date.now()/1000,channel_type:'web',messages:[{role:'user',content:'今天想从散步说起。'},{role:'assistant',content:'可以，我们慢慢聊。'}]}]};
 bases[bid]={id:bid,name:label+'的知识库',owner_user_id:uid,shared:false,default_open:true,created_at:stamp,documents:[{id:'d1',filename:'mock-生活笔记.md',status:'ready',byte_size:200,text:'# 生活笔记\n清晨散步让我更自在。'},{id:'d2',filename:'mock-整理失败.txt',status:'failed',byte_size:20,text:'可重试的 Mock 文档'}]};
}
seed('mock-personal-701',701,'个人','mock-base-701');seed('mock-work-701',701,'工作','mock-work-base');seed('mock-personal-702',702,'陈晨','mock-base-702');
agents.template={agent_id:'template',is_shared:true,user_id:701,default_model:'mock/model'};
const json=(res,data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
function list(items,body={}){let selected=items;if(body.query)selected=selected.filter(x=>JSON.stringify(x).includes(body.query));if(body.entity_id)selected=selected.filter(x=>x.entity_id===body.entity_id);if(body.status)selected=selected.filter(x=>x.status===body.status);if(!body.include_deprecated)selected=selected.filter(x=>!x.deprecated_at);const offset=body.offset||0,limit=body.limit||50;return {items:selected.slice(offset,offset+limit),total:selected.length,has_more:selected.length>offset+limit};}
async function bodyFor(req){const parts=[];for await(const c of req)parts.push(c);const bytes=Buffer.concat(parts);if(String(req.headers['content-type']).startsWith('multipart/'))return new Response(bytes,{headers:{'Content-Type':req.headers['content-type']}}).formData();return bytes.length?JSON.parse(bytes):{};}
const upstream=http.createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost'),p=u.pathname,method=req.method,b=await bodyFor(req);
 if(p==='/__qa/browser-login'){
  const username=u.searchParams.get('user')||'mock-alice';
  const login=await fetch(config.publicOrigin+'/api/login',{method:'POST',headers:{Origin:config.publicOrigin,'Content-Type':'application/json'},body:JSON.stringify({username,password:'mock-only-password'})});
  if(!login.ok)return json(res,{error:'Mock login setup failed'},500);
  res.writeHead(302,{'Set-Cookie':login.headers.get('set-cookie'),Location:config.publicOrigin});return res.end();
 }
 if(p==='/__qa/state')return json(res,{calls,unmatched,flags,agents,bases});
 if(p==='/__qa/flags'&&method==='POST'){Object.assign(flags,b);return json(res,flags);}
 calls.push({path:p,method});
 if(flags.offline)return json(res,{detail:'Mock offline'},503);
 if(p==='/api/auth/captcha')return json(res,{provider:'slider'});
 if(p==='/api/auth/login'){const user=Object.values(users).find(x=>x.username===b.username);if(!user||b.password!=='mock-only-password')return json(res,{},401);return json(res,{access_token:'mock-token-'+user.id,expires_in:3600,user});}
 const uid=Number(String(req.headers.authorization||'').split('mock-token-')[1]),user=users[uid];
 if(!user)return json(res,{},401);
 if(p==='/api/auth/me'){if(method==='PATCH')user.display_name=b.display_name;return json(res,user);}
 if(p==='/api/auth/logout'||p==='/api/auth/change-password')return json(res,{ok:true});
 if(p==='/api/providers/resolved')return json(res,[{provider_name:'mock',model:'mock-model',name:'Mock 模型'}]);
 if(p==='/api/settings/timezone')return json(res,{timezone:'Asia/Shanghai'});
 if(p==='/api/agents/from-expert/default'){seed(b.agent_id,uid,b.name,'temporary-'+(++serial));return json(res,{agent_id:b.agent_id});}
 if(p==='/api/knowledge-bases'){if(method==='POST'){const bid='created-base-'+(++serial);bases[bid]={id:bid,owner_user_id:uid,shared:false,...b,documents:[]};return json(res,bases[bid]);}return json(res,Object.values(bases).map(x=>({...x,doc_count:x.documents.length})));}
 let m=p.match(/^\/api\/knowledge-bases\/([\w-]+)(.*)$/);
 if(m){const base=bases[m[1]],suffix=m[2];if(!base)return json(res,{},404);if(base.owner_user_id!==uid)return json(res,{},403);
  if(!suffix){if(method==='PATCH')Object.assign(base,b);return json(res,base);}
  if(suffix==='/documents'){if(method==='POST'){const file=b.get('upload');if(flags.failUpload&&file.name.includes('fail'))return json(res,{},500);const row={id:'doc'+(++serial),filename:file.name,status:'ready',byte_size:file.size,text:await file.text()};base.documents.push(row);return json(res,row);}return json(res,base.documents);}
  const d=suffix.match(/^\/documents\/([\w-]+)(?:\/(preview|reindex))?$/);if(d){const row=base.documents.find(x=>x.id===d[1]);if(!row)return json(res,{},404);if(d[2]==='preview')return json(res,{filename:row.filename,text:row.text});if(d[2]==='reindex'){row.status='ready';return json(res,row);}if(method==='DELETE'){base.documents=base.documents.filter(x=>x.id!==row.id);return json(res,{ok:true});}}
 }
 m=p.match(/^\/api\/agents\/([\w-]+)(.*)$/);
 if(m){const a=agents[m[1]],s=m[2];if(!a)return json(res,{},404);if(!s){if(method==='PATCH')Object.assign(a,b);return json(res,a);}if(a.user_id!==uid)return json(res,{},403);
  if(s==='/threads'){if(method==='POST'){const thread={thread_id:'t'+(++serial),title:'一段 Mock 新对话',last_active:Date.now()/1000,messages:[]};a.threads.unshift(thread);return json(res,thread);}return json(res,a.threads);}
  const t=s.match(/^\/threads\/([\w-]+)(\/history)?$/);if(t){const thread=a.threads.find(x=>x.thread_id===t[1]);if(!thread)return json(res,{},404);if(t[2])return json(res,{messages:thread.messages,offset:0,has_more:false,turn_active:false});if(method==='PATCH')thread.title=b.title;if(method==='DELETE')a.threads=a.threads.filter(x=>x!==thread);return json(res,{ok:true});}
  if(s==='/upload'){const file=b.get('file');return json(res,{path:'inbound/'+Date.now()+'_'+file.name,filename:file.name,media_type:file.type||'text/plain',extraction_status:'ready',extraction_characters:file.size});}
  if(s==='/channels'){if(method==='POST'){a.channels.push({id:'wechat'+(++serial),...b,enabled:true,runtime:{status:'connected'}});}return json(res,a.channels);}
  if(s==='/channels/weixin/qrcode/generate')return json(res,{qrcode_url:'https://example.invalid/mock-qr',qrcode_token:'mock-qr'});
  if(s==='/channels/weixin/qrcode/poll')return json(res,{status:flags.qr,token:'mock-wechat-token',account_id:'mock-wechat-account'});
  if(s.startsWith('/channels/')){Object.assign(a.channels.find(x=>x.id===s.split('/')[2])||{},b);return json(res,{ok:true});}
  if(s==='/proactive-care'){if(method==='PUT')a.proactive=b;return json(res,a.proactive);}
  if(s==='/chat/hitl/resume'){res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({type:'token',content:'Mock 确认结果：'+b.decisions[0].type,thread_id:b.thread_id})+'\n\ndata: '+JSON.stringify({type:'done',thread_id:b.thread_id})+'\n\n');return;}
  if(s==='/ontology')return json(res,a.doc);
  if(s==='/ontology/facts')return json(res,{items:a.atoms.map(x=>({...x,confirmed:true,owner_confirmed:true,event_ids:['raw1'],content_hash:'mock-hash'})),has_more:false,total:a.atoms.length});
  if(s==='/ontology/generate')return json(res,{status:'ready',ontology:a.doc});
  const oc=s.match(/^\/ontology\/context\/([\w-]+)$/);if(oc){if(method==='PUT')a.excluded[oc[1]]=b.excluded;return json(res,{claims:a.doc.claims.filter(c=>c.core_status==='admitted'),excluded:a.excluded[oc[1]]||[]});}
  const on=s.match(/^\/ontology\/nodes\/([\w-]+)$/);if(on){if(flags.failSave)return json(res,{},409);let c=a.doc.claims.find(x=>x.id===on[1]);if(!c){c={...a.doc.claims[0],id:'claim'+(++serial),history:[]};a.doc.claims.push(c);}const previous=structuredClone(c);c.history.push({version:c.version,at:stamp,reason:b.action,value:previous});Object.assign(c,Object.fromEntries(['statement','conditions','exceptions','kind','importance','affinity','valid_from','valid_until'].filter(k=>k in b).map(k=>[k,b[k]])));c.version='v'+(++serial);a.doc.revision='r'+serial;
   if(['confirm','admit','edit','update','restore'].includes(b.action)){c.state='confirmed';c.core_status='admitted';c.admitted_at=stamp;c.admitted_by=uid;c.admitted_version=c.version;}
   if(['disable','dismiss','withdraw','snooze'].includes(b.action)){c.core_status=b.action==='snooze'?'snoozed':'disabled';c.state='withdrawn';}
   return json(res,{status:'ready',changed_id:c.id,ontology:a.doc});}
  if(s.startsWith('/memory/')){const mem=s.slice(8);
   if(mem==='stats/counts')return json(res,{raw_events:a.raw_events.length,atoms:a.atoms.filter(x=>!x.deprecated_at).length,entities:a.entities.length,dirty_pages:0,episodes:a.episodes.length,candidates_pending:a.candidates.filter(x=>x.status==='needs_review').length,atoms_delta_7d:3,entities_delta_7d:1,episodes_delta_7d:1,last_extract_run:{timestamp:stamp,events_extracted:1,candidates:1}});
   if(mem==='stats/atom_kinds')return json(res,{series:['Fact','Preference','Task'].map(kind=>({kind,count:1}))});
   if(mem==='stats/growth')return json(res,{series:Array.from({length:7},(_,i)=>({date:'2026-10-'+String(i+4).padStart(2,'0'),atoms:i%3,entities:i%2,episodes:i%2,turns:i+1}))});
   if(mem==='extract-config'){if(method==='PUT')a.extract=b;return json(res,a.extract);}
   if(mem==='journal/recent')return json(res,{items:a.journal});
   if(mem.startsWith('terminal/'))return json(res,{items:mem.endsWith('entities')?a.entities:mem.endsWith('recent_stories')?a.episodes:a.atoms});
   const l=mem.match(/^(atoms|entities|episodes|candidates|raw_events|journal)\/list$/);if(l)return json(res,list(a[l[1]],b));
   if(mem==='atoms'){const row={...a.atoms[0],id:'atom'+(++serial),assertion:b.assertion,kind:b.kind||'Fact'};a.atoms.push(row);return json(res,{atom:row,entity:a.entities[0],created_entity:false,status:'created'});}
   const action=mem.match(/^(atoms|candidates)\/([\w-]+):(replace|deprecate|promote|reject)$/);if(action){const row=a[action[1]].find(x=>x.id===action[2]);if(!row)return json(res,{},404);if(action[3]==='replace'){const replacement={...row,id:'atom'+(++serial),assertion:b.assertion};row.deprecated_at=stamp;a.atoms.push(replacement);return json(res,{old_atom_id:row.id,atom:replacement,status:'replaced'});}if(action[3]==='deprecate')row.deprecated_at=stamp;else row.status=action[3]==='reject'?'rejected':'promoted';return json(res,{candidate_id:row.id,status:row.status||'deprecated',promoted:1,merged:0,conflicts:0,needs_review:0,dropped:0,llm_calls:0});}
   const item=mem.match(/^(atoms|entities|episodes|candidates|raw_events)\/([\w-]+)$/);if(item)return json(res,a[item[1]].find(x=>x.id===item[2])||{},200);
   if(mem==='portable/pack'){res.writeHead(200,{'Content-Type':'application/octet-stream'});return res.end('MOCK-HMPKG-ONLY');}
   if(mem==='portable/doctor')return json(res,{all_passed:true,checks:[{name:'mock-integrity',passed:true}]});
   if(mem==='portable/adopt')return json(res,{applied:3,skipped:0,errors:0,dry_run:b.get('dry_run')==='true',already_adopted:false});
  }
 }
 unmatched.push({path:p,method});return json(res,{detail:'Missing mock route'},404);
}catch(e){json(res,{detail:String(e)},500);}});
const sockets=new WebSocketServer({server:upstream});
sockets.on('connection',(ws,req)=>{const aid=new URL(req.url,'http://localhost').pathname.split('/')[3],a=agents[aid];
 ws.on('message',raw=>{const f=JSON.parse(raw),thread=a?.threads.find(x=>x.thread_id===f.thread_id);calls.push({path:'WS:'+aid,method:f.type});if(!thread)return;const send=x=>{if(ws.readyState===1)ws.send(JSON.stringify({thread_id:f.thread_id,...x}));};
  if(f.type==='subscribe')return send({type:'turn_status',active:false});
  if(f.type==='cancel')return send({type:'done'});
  if(f.type==='user_turn'){thread.messages.push({role:'user',content:f.text,inbound_attachments:f.messages?.[0]?.content.filter(x=>x.type==='file').map(x=>({filename:x.filename}))});
   if(f.text.includes('确认操作'))return send({type:'hitl_required',request:{action_requests:[{name:'mock_action',args:{note:'仅 Mock 数据'}}]}});
   if(f.text.includes('补充问题'))return send({type:'hitl_required',request:{action_requests:[{name:'ask_user_question',args:{question:'你希望优先聊哪一部分？'}}]}});
   if(f.text.includes('模拟断线'))return ws.close(1011);
   if(f.text.includes('模拟错误'))return send({type:'error',message:'Mock upstream error'});
   const response='这是隔离 Mock 回复：'+f.text+'\n\n我们可以从你在乎的事情开始梳理。';thread.messages.push({role:'assistant',content:response});send({type:'token',content:response.slice(0,12)});setTimeout(()=>{send({type:'token',content:response.slice(12)});send({type:'done'});},120);
  }
 });
});
upstream.listen(Number(process.env.QA_UPSTREAM_PORT)||0,'127.0.0.1');await once(upstream,'listening');
const roleStore=createRoleStore(await mkdtemp(join(directory,'mock-roles-')));
roleStore.set(701,[{id:'work',name:'工作',description:'工作中的我',agentId:'mock-work-701',libraryId:'mock-work-base',ready:true}]);
const config={upstream:'http://127.0.0.1:'+upstream.address().port,publicOrigin:'http://127.0.0.1:0',bindings:{701:{agentId:'mock-personal-701',libraryId:'mock-base-701'},702:{agentId:'mock-personal-702',libraryId:'mock-base-702'}},provisioning:{701:{sourceAgentId:'template',workspaceRoot:'/mock-only/role',rules:'仅 Mock 测试'}},memoryPortableImport:true};
const app=createApp(config,{staticDir:join(root,'dist'),roleStore,sessionCookieName:'zhijun_mock_qa_session'});app.listen(Number(process.env.QA_PORT)||0,'127.0.0.1');await once(app,'listening');config.publicOrigin='http://127.0.0.1:'+app.address().port;
const info={origin:config.publicOrigin,upstream:config.upstream,scope:'Isolated mock data only; real UI, gateway and WebSocket transport'};
await writeFile(join(directory,'mock-runtime.json'),JSON.stringify(info,null,2));console.log(JSON.stringify(info));
process.on('SIGTERM',async()=>{await writeFile(join(directory,'mock-calls.json'),JSON.stringify({calls,unmatched},null,2));for(const c of sockets.clients)c.terminate();app.closeAllConnections();upstream.closeAllConnections();app.close();upstream.close();process.exit(0);});
