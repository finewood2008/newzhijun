import {readFileSync} from 'node:fs';
const {version}=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
import {createRoles, createRoleStore} from './roles.mjs';
import {createExpertSelection,defaultZhijunExpert} from './expert-selection.mjs';
import {createDefaultLibrary} from './library.mjs';
import {singleUpload,sealAttachment,resolveAttachments} from './attachments.mjs';
import {memoryRoute,memoryResult} from './memory.mjs';
import {ontologyRoute} from './ontology.mjs';
import http from 'node:http';
import { createProvisioner } from './provision.mjs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import {serveStatic} from './static.mjs';
import { WebSocketServer, WebSocket } from 'ws';
import { ClientError, fail, id, bindingFor, assertPrivateAgent, assertPrivateBase, chatFrame, projectThread, projectHistory, validateConfig } from './policy.mjs';

export function createApp(rawConfig, {fetcher = fetch, staticDir = resolve('dist'), sessionStore = null, roleStore = createRoleStore(), sessionCookieName = 'zhijun_session', allowAgentSelection = false} = {}) {
  const config = validateConfig(rawConfig), sessions = new Map();
  for(const s of sessionStore?.load()||[])sessions.set(s.sid,{...s,sockets:new Set(),qr:null,qrBusy:false});
  const saveSessions=()=>sessionStore?.save(sessions);
  if(!/^[A-Za-z0-9_]{1,64}$/.test(sessionCookieName))throw new Error('Invalid session cookie name');
  const cookieName = sessionCookieName;
  function drop(s) { for (const ws of s.sockets) ws.close(4001, '会话已结束'); sessions.delete(s.sid); saveSessions(); }
  async function upstream(path, session, method='GET', body, contentType='application/json', responseFormat='json') {
    let r;
    try { r = await fetcher(`${config.upstream.replace(/\/$/,'')}/api${path}`, {method, headers:{Accept:'application/json','Accept-Language':'zh-CN',...(session ? {Authorization:`Bearer ${session.token}`} : {}), ...(body !== undefined && !(body instanceof FormData) ? {'Content-Type':contentType}: {})}, body: body === undefined ? undefined : Buffer.isBuffer(body) || body instanceof FormData ? body : JSON.stringify(body), signal:AbortSignal.timeout(55000), redirect:'error'}); }
    catch { fail(502,'SERVICE_UNAVAILABLE','暂时连接不上知君服务，请检查网络后重试。'); }
    if (!r.ok) {
      if (r.status === 401 && session) drop(session);
      fail(r.status,[401,403,409,413,429].includes(r.status)?`HTTP_${r.status}`:'SERVICE_ERROR',({401:'登录已失效或账号密码不正确，请重新登录。',403:'当前账户没有此操作权限。',409:'当前操作暂时无法完成，请刷新后重试。',413:'文件超过服务允许的大小。',429:'操作过于频繁，请稍后重试。'})[r.status] || '服务暂时无法完成此操作，请稍后重试。');
    }
    if (r.status === 204) return null;
    return responseFormat==='blob'?Buffer.from(await r.arrayBuffer()):await r.json();
  }
  const provision = createProvisioner(config, upstream);
  function getSession(req) {
    const sid = String(req.headers.cookie || '').split(';').map(x=>x.trim()).find(x=>x.startsWith(`${cookieName}=`))?.slice(cookieName.length+1);
    const s = sessions.get(sid);
    if (!s || Date.now() >= s.expires) { if(s) drop(s); fail(401,'LOGIN_REQUIRED','请先登录知君。'); }
    return s;
  }
  async function privateAgent(s, roleId = "personal") {
    const user = await upstream('/auth/me',s);
    if (user.id !== s.user.id) { drop(s); fail(401,'LOGIN_REQUIRED','请重新登录。'); }
    const aid = rolesFor(s).resolve(user, roleId).agentId, agent = await upstream(`/agents/${aid}`,s);
    assertPrivateAgent(agent,user,aid);
    return aid;
  }
  const basePath = b => `/knowledge-bases/${id(b)}`;
  async function privateBase(s, bid, role) {
    if ((await rolesFor(s).library(s, role)).id !== bid) fail(403, 'ROLE_LIBRARY_REQUIRED', '这份资料不属于当前角色。');
    return assertPrivateBase(await upstream(basePath(bid),s),s.user);
  }
  const defaultLibrary=createDefaultLibrary(upstream,config);
  const roles = createRoles(config, upstream, roleStore, defaultLibrary);
  const expertContexts = new Map();
  const experts=createExpertSelection(config,upstream,roleStore);
  function selectExpert(s,selection) {
    for(const ws of s.sockets)ws.close(4002,'已切换知君专家');
    const next={...s,...selection,sockets:new Set(),qr:null,qrBusy:false};
    sessions.set(s.sid,next);saveSessions();return next;
  }
  const expertId = s => s.agentId || config.bindings[String(s.user.id)]?.agentId || null;
  function rolesFor(s) {
    const uid=String(s.user.id), aid=expertId(s);
    const configured=aid===config.bindings[uid]?.agentId;
    if(!aid || configured&&(config.provisioning?.[uid]||!s.sourceExpertId))return roles;
    const key=uid+':'+aid;
    if(!expertContexts.has(key)) {
      const existingRole=roleStore.get(uid).find(r=>r.agentId===aid&&r.ready);
      const sourceAgentId=s.sourceExpertId||aid;
      const template=Object.values(config.provisioning||{}).find(p=>p.sourceAgentId===sourceAgentId);
      const scoped={...config,bindings:{[uid]:configured?config.bindings[uid]:{agentId:aid,...(existingRole?.libraryId?{libraryId:existingRole.libraryId}:{libraryName:'知君 · 专家资料 · '+aid})}},provisioning:{[uid]:{sourceAgentId,...(template?{rules:template.rules,auxModel:template.auxModel}:{})}}};
      const storeKey=configured?uid:key;
      const store={get:()=>roleStore.get(storeKey),set:(_,rows)=>roleStore.set(storeKey,rows)};
      expertContexts.set(key,createRoles(scoped,upstream,store,createDefaultLibrary(upstream,scoped)));
    }
    return expertContexts.get(key);
  }
  function assertExpertScope(s, supplied) {
    const requested=supplied||config.bindings[String(s.user.id)]?.agentId||null;
    if(requested!==expertId(s))fail(409,'EXPERT_CHANGED','已切换知君专家，正在刷新当前空间。');
  }
  async function libraries(s, role) {
    const base = await rolesFor(s).library(s, role);
    return [{...base, ...(role.id === 'personal' ? {} : {name: role.name + '的知识库'}), default_open: true}];
  }
  function sameOrigin(req) { return req.headers.origin === config.publicOrigin; }
  async function readBody(req) {
    const chunks=[]; let size=0;
    for await(const c of req) { size+=c.length; if(size>33*1024*1024) fail(413,'FILE_TOO_LARGE','文件不能超过 32 MB。'); chunks.push(c); }
    const b=Buffer.concat(chunks);
    if(String(req.headers['content-type']).startsWith('multipart/form-data')) return b;
    try { return b.length ? JSON.parse(b.toString()) : {}; } catch { fail(400,'INVALID_JSON','请求格式不正确。'); }
  }
  const json = (res, data, status=200) => {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(data));};
  const server = http.createServer(async (req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','no-referrer'); res.setHeader('X-Frame-Options','DENY');
    try {
      // Reject unknown Host values, including DNS rebinding to this local gateway.
      if (req.headers.host !== new URL(config.publicOrigin).host) fail(403,'ORIGIN_REQUIRED','请求来源无效。');
      const url=new URL(req.url,config.publicOrigin), path=url.pathname, method=req.method;
      if (path.startsWith('/api/')) {
        if (method !== 'GET' && !sameOrigin(req)) fail(403,'ORIGIN_REQUIRED','请求来源无效，请刷新页面。');
        const body = method==='GET' ? {} : await readBody(req);
        if(path==='/api/status' && method==='GET') {
          let connected=false; try {await upstream('/auth/captcha'); connected=true;} catch{}
          return json(res,{connected,version,provisioned:Object.keys(config.bindings).length>0});
        }
        if(path==='/api/captcha' && method==='GET') return json(res,await upstream('/auth/captcha'));
        if(path==='/api/login' && method==='POST') {
          const result=await upstream('/auth/login',null,'POST',{username:String(body.username||''),password:String(body.password||''),...(body.captcha_token?{captcha_token:String(body.captcha_token)}:{})});
          const sid=randomBytes(32).toString('hex'), ttl=Math.min(Number(result.expires_in)||3600,28800);
          const s={sid,token:result.access_token,user:result.user,expires:Date.now()+ttl*1000,sockets:new Set(),qr:null,qrBusy:false};
          await provision(s);
          try { drop(getSession(req)); } catch {}
          sessions.set(sid,s);saveSessions();
          res.setHeader('Set-Cookie',`${cookieName}=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${ttl}${config.publicOrigin.startsWith('https:')?'; Secure':''}`);
          return json(res,{ok:true});
        }
        let s=getSession(req);
        if(path==='/api/logout' && method==='POST') { try { await upstream('/auth/logout',s,'POST',{}); } catch {} drop(s);res.setHeader('Set-Cookie',`${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);return json(res,{ok:true}); }
        if(path==='/api/connection/agents' && method==='GET') {
          const candidates=await experts.list(s);
          return json(res,{selectable:allowAgentSelection,currentAgentId:s.sourceExpertId||null,defaultAgentId:defaultZhijunExpert(candidates)?.id||null,agents:candidates});
        }
        if(path==='/api/connection/agents' && method==='POST') {
          if(!allowAgentSelection)fail(403,'CONFIGURED_BINDING','当前服务由管理员配置个人实例。');
          const selection=await experts.resolve(s,id(body.agentId));
          selectExpert(s,selection);
          return json(res,{ok:true,agentId:selection.sourceExpertId});
        }
        if(path==='/api/me' && method==='GET') {
          let expertChoices=[],selectionReason='';
          if(allowAgentSelection) {
            const candidates=await experts.list(s);
            const chosen=candidates.find(a=>a.id===s.sourceExpertId&&a.selectable)||defaultZhijunExpert(candidates);
            if(chosen) {
              const selection=await experts.resolve(s,chosen.id);
              if(s.sourceExpertId!==selection.sourceExpertId||s.agentId!==selection.agentId)s=selectExpert(s,selection);
            } else {
              if(s.sourceExpertId||s.agentId)s=selectExpert(s,{sourceExpertId:null,agentId:null});
              expertChoices=candidates.filter(a=>a.selectable);
              selectionReason=expertChoices.length?'请选择要使用的知君。':'未找到可用的知君专家，请在万象「专家 → 我的专家」中检查名称和访问权限。';
            }
          }
          const u=await upstream('/auth/me',s); let ready=false,reason='';
          if(selectionReason)reason=selectionReason;
          else try {await privateAgent(s);ready=true;} catch(e) {if(e.status===401) throw e;reason=e.message;}
          return json(res,{id:u.id,name:u.display_name||u.username,ready,reason,expertId:ready?expertId(s):null,expertChoices,roles:ready?rolesFor(s).list(u):[],canCreateRoles:ready&&rolesFor(s).canCreate(u)});
        }
        if(path==='/api/account' && method==='PATCH') {await upstream('/auth/me',s,'PATCH',{display_name:String(body.name||'').slice(0,100)});return json(res,{ok:true});}
        if(path==='/api/password' && method==='POST') {await upstream('/auth/change-password',s,'POST',{old_password:body.old_password,new_password:body.new_password});drop(s);return json(res,{ok:true});}
        if(allowAgentSelection&&!s.sourceExpertId)fail(409,'EXPERT_REQUIRED','请先完成知君连接。');
        if (path === '/api/roles' && method === 'POST') {
          assertExpertScope(s,req.headers['x-zhijun-expert']);
          await privateAgent(s);
          return json(res, await rolesFor(s).create(s, body), 201);
        }
        assertExpertScope(s,req.headers['x-zhijun-expert']);
        const role = rolesFor(s).resolve(s.user, req.headers['x-zhijun-role'] || 'personal');
        const aid=await privateAgent(s, role.id), root=`/agents/${aid}`;
        const ontology=ontologyRoute({path,method,body,url,aid});
        if(ontology) return json(res,await upstream(ontology.target,s,method,ontology.payload));
        const memory=await memoryRoute({path,method,body,url,aid,contentType:req.headers['content-type'],portableImport:config.memoryPortableImport===true});
        if(memory){
          const result=await upstream(memory.target,s,method,memory.payload,'application/json',memory.format);
          if(memory.format==='blob'){res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="zhijun-memory.hmpkg"','Cache-Control':'no-store'});return res.end(result);}
          return json(res,memoryResult(result,memory.format));
        }
        if(path==='/api/threads' && method==='GET') return json(res,(await upstream(`${root}/threads`,s)).map(projectThread));
        if(path==='/api/threads' && method==='POST') {const t=await upstream(`${root}/threads`,s,'POST',{});return json(res,{thread_id:t.thread_id});}
        let m=path.match(/^\/api\/threads\/([\w-]+)\/history$/);
        if(m && method==='GET') {
          const cursor=url.searchParams.get('cursor'); const offset=Number(url.searchParams.get('offset')||0);
          return json(res,projectHistory(await upstream(`${root}/threads/${id(m[1])}/history?limit=50&offset=${Math.max(0,offset)}${cursor?'&cursor='+encodeURIComponent(cursor):''}`,s)));
        }
        m=path.match(/^\/api\/threads\/([\w-]+)$/);
        if(m && ['PATCH','DELETE'].includes(method)) return json(res,await upstream(`${root}/threads/${id(m[1])}`,s,method,method==='PATCH'?{title:String(body.title||'').slice(0,100)}:undefined));
        m=path.match(/^\/api\/threads\/([\w-]+)\/attachments$/);
        if(m&&method==='POST'){
          const tid=id(m[1]);await upstream(`${root}/threads/${tid}/history?limit=1`,s);
          const form=await singleUpload(body,req.headers['content-type'],'file',10*1024*1024);form.set('extract_text','true');
          const a=await upstream(`${root}/upload`,s,'POST',form);
          if(!/^inbound\/[0-9]{10,}_[^/\\\x00-\x1f\x7f]+$/.test(a.path||''))fail(502,'UPLOAD_FAILED','附件上传暂时无法完成。');
          const status=a.extraction_status||'unsupported';
          const attachment={agentId:aid,threadId:tid,path:a.path,filename:a.filename,mediaType:a.media_type,status};
          return json(res,{id:status==='ready'?sealAttachment(attachment,s):null,filename:a.filename,media_type:a.media_type,status,truncated:!!a.extraction_truncated,characters:a.extraction_characters||0});
        }
        if(path==='/api/approval' && method==='POST') {
          const decisions=body.decisions;
          if(!Array.isArray(decisions)||!decisions.length||decisions.length>16||decisions.some(d=>!['approve','reject','respond'].includes(d.type))) fail(400,'INVALID_DECISION','确认内容无效。');
          // The native service executes and persists the resumed turn. SSE reaches the client unchanged.
          const r=await fetcher(`${config.upstream}/api${root}/chat/hitl/resume`,{method:'POST',headers:{Authorization:`Bearer ${s.token}`,'Content-Type':'application/json'},body:JSON.stringify({thread_id:id(body.thread_id),decisions}),signal:AbortSignal.timeout(300000)});
          if(!r.ok) fail(r.status,'APPROVAL_FAILED','暂时无法提交确认。');
          res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store'});
          for await(const chunk of r.body) { if(!res.destroyed) res.write(chunk); } return res.end();
        }
        if(path==='/api/memory' && method==='POST') return json(res,await upstream(`${root}/memory/atoms/list`,s,'POST',{query:String(body.query||''),limit:40,offset:Math.max(0,Number(body.offset)||0),include_deprecated:false}));
        if(path==='/api/memory/add' && method==='POST') return json(res,await upstream(`${root}/memory/atoms`,s,'POST',{assertion:String(body.assertion||''),kind:'Fact',reason:'用户主动记录'}));
        m=path.match(/^\/api\/memory\/([\w-]+)\/(replace|deprecate)$/);
        if(m && method==='POST') return json(res,await upstream(`${root}/memory/atoms/${id(m[1])}:${m[2]}`,s,'POST',m[2]==='replace'?{assertion:body.assertion,reason:'用户修正',actor:'user'}:{reason:'用户撤回',actor:'user'}));
        if(path==='/api/memory/settings' && ['GET','PUT'].includes(method)) {
          const b=method==='GET'?undefined:{memory_enabled:!!body.memory_enabled,extract_on_session_end:!!body.extract_on_session_end,extract_trigger_mode:body.extract_trigger_mode==='interval'?'interval':'idle',extract_idle_seconds:Math.max(60,Number(body.extract_idle_seconds)||300),extract_interval_seconds:Math.max(300,Number(body.extract_interval_seconds)||21600)};
          const c=await upstream(`${root}/memory/extract-config`,s,method,b); delete c.aux_model;return json(res,c);
        }
        if(path==='/api/libraries' && method==='GET') return json(res,await libraries(s,role));
        if(path==='/api/libraries' && method==='POST') return json(res,(await libraries(s,role))[0]);
        m=path.match(/^\/api\/libraries\/([\w-]+)(?:\/(.*))?$/);
        if(m) {
          const bid=id(m[1]), suffix=m[2]||'';await privateBase(s,bid,role);
          if(!suffix && method==='PATCH') return json(res,await upstream(basePath(bid),s,'PATCH',{name:String(body.name||'我的知识库'),default_open:true,shared:false}));
          if(suffix==='documents' && method==='GET') return json(res,await upstream(`${basePath(bid)}/documents`,s));
          if(suffix==='documents' && method==='POST') return json(res,await upstream(`${basePath(bid)}/documents`,s,'POST',await singleUpload(body,req.headers['content-type'],'upload',32*1024*1024)));
          const d=suffix.match(/^documents\/([\w-]+)(?:\/(preview|reindex))?$/);
          if(d && ((method==='GET'&&d[2]==='preview')||(method==='POST'&&d[2]==='reindex')||(method==='DELETE'&&!d[2]))) return json(res,await upstream(`${basePath(bid)}/documents/${id(d[1])}${d[2]?'/'+d[2]:''}`,s,method,method==='POST'?{}:undefined));
        }
        if(path==='/api/wechat/care' && ['GET','PUT'].includes(method)) {
          let value;
          if(method==='PUT') {
            const presets={off:[5,24],gentle:[48,72],balanced:[12,24],close:[5,12]};
            if(!Object.hasOwn(presets,body.level))fail(400,'INVALID_CARE','请选择主动联系程度。');
            const validTime=x=>typeof x==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(x);
            if(!validTime(body.start)||!validTime(body.end)||body.start>=body.end)fail(400,'INVALID_HOURS','联系时段的结束时间需晚于开始时间。');
            const [min,max]=presets[body.level];
            value={enabled:body.level!=='off',active_hours_start:body.start,active_hours_end:body.end,min_interval_hours:min,max_interval_hours:max};
          }
          return json(res,await upstream(`${root}/proactive-care`,s,method,value));
        }
        if(path==='/api/wechat' && method==='GET') {
          const c=await upstream(`${root}/channels`,s);
          return json(res,c.filter(c=>c.kind==='weixin').map(c=>({id:c.id,enabled:c.enabled,status:c.runtime?.status||'unknown',ownerVerified:c.owner_verified===true})));
        }
        if(path==='/api/wechat/qr' && method==='POST') {
          const q=await upstream(`${root}/channels/weixin/qrcode/generate`,s,'POST',{});
          s.qr={agentId:aid,token:q.qrcode_token,expires:Date.now()+300000,bound:false};return json(res,{url:q.qrcode_url});
        }
        if(path==='/api/wechat/poll' && method==='POST') {
          if(!s.qr||s.qr.agentId!==aid||Date.now()>s.qr.expires) fail(409,'QR_EXPIRED','二维码已过期，请重新获取。');
          if(s.qr.bound) return json(res,{status:'success'});
          if(s.qrBusy) return json(res,{status:'wait'});
          s.qrBusy=true;
          try {
            const q=await upstream(`${root}/channels/weixin/qrcode/poll`,s,'POST',{qrcode_token:s.qr.token});
            if(q.status==='success') {
              if(!q.channel_id) fail(409,'WECHAT_OWNER_UNVERIFIED','万象尚未完成微信本人身份绑定，请更新后端后重新扫码。');
              const bound=(await upstream(`${root}/channels`,s)).find(c=>c.id===q.channel_id&&c.kind==='weixin'&&c.owner_verified===true);
              if(!bound) fail(409,'WECHAT_OWNER_UNVERIFIED','未确认当前角色的微信本人身份，请重新扫码。');
              s.qr.bound=true;
            }
            return json(res,{status:q.status,...(q.status==='error'?{message:q.message||'微信绑定未完成，请重新扫码。'}:{})});
          } finally {s.qrBusy=false;}
        }
        m=path.match(/^\/api\/wechat\/([\w-]+)$/);
        if(m&&method==='PATCH') {
          const c=(await upstream(`${root}/channels`,s)).find(c=>c.id===m[1]&&c.kind==='weixin');
          if(!c) fail(404,'NOT_FOUND','未找到微信连接。');
          if(body.enabled&&c.owner_verified!==true)fail(409,'WECHAT_OWNER_UNVERIFIED','请重新扫码确认本人身份后启用微信。');
          await upstream(`${root}/channels/${id(m[1])}`,s,'PATCH',{enabled:!!body.enabled});return json(res,{ok:true});
        }
        fail(404,'NOT_FOUND','此功能暂不可用。');
      }
      await serveStatic(req,res,staticDir,path);
    } catch(e) { if(!res.headersSent) json(res,{code:e instanceof ClientError?e.code:'SERVICE_ERROR',message:e instanceof ClientError?e.message:'服务暂时不可用，请稍后重试。'},e instanceof ClientError?e.status:500);else res.end(); }
  });
  const wss=new WebSocketServer({noServer:true,maxPayload:128*1024});
  server.on('upgrade',async(req,socket,head)=>{
    try {
      const chatUrl = new URL(req.url, config.publicOrigin);
      if(chatUrl.pathname!=='/api/chat'||!sameOrigin(req)||req.headers.host!==new URL(config.publicOrigin).host) fail(403,'ORIGIN','');
      const s=getSession(req);if(allowAgentSelection&&!s.sourceExpertId)fail(409,'EXPERT_REQUIRED','请先完成知君连接。');assertExpertScope(s,chatUrl.searchParams.get('expert'));
      const role=rolesFor(s).resolve(s.user,chatUrl.searchParams.get('role')||'personal'),aid=await privateAgent(s,role.id);
      wss.handleUpgrade(req,socket,head,client=>{
        s.sockets.add(client);
        const u=new URL(`/api/agents/${aid}/chat/ws`,config.upstream);u.protocol=u.protocol==='https:'?'wss:':'ws:';u.searchParams.set('token',s.token);
        const remote=new WebSocket(u,{maxPayload:4*1024*1024,handshakeTimeout:15000});
        const expire=setTimeout(()=>client.close(4001,'请重新登录'),Math.max(1,s.expires-Date.now()));
        const send=data=>{if(client.readyState===WebSocket.OPEN) client.send(JSON.stringify(data));};
        remote.on('open',()=>send({type:'ready'}));
        remote.on('message',raw=>{try{const f=JSON.parse(raw.toString());if(f.type==='error') f.message='对话暂时未能完成，请查看记录后再试。';send(f);}catch{send({type:'error',message:'回复格式异常。'});}});
        remote.on('error',()=>{send({type:'error',message:'对话连接已中断，请重新打开这段对话。'});client.close(1011);});
        remote.on('close',()=>client.close(1000));
        let queue=Promise.resolve();
        client.on('message',raw=>{
          queue=queue.then(async()=>{
            try {
              if(remote.readyState!==WebSocket.OPEN) fail(409,'NOT_READY','正在连接，请稍后重试。');
              if(getSession(req)!==s||await privateAgent(s,role.id)!==aid) fail(401,'EXPIRED','请重新登录。');
              const frame=JSON.parse(raw.toString());
              const selected=frame.type==='user_turn'?(await libraries(s,role)).map(b=>b.id):[];
              const attachments=frame.type==='user_turn'?resolveAttachments(frame.attachment_ids,s,aid,id(frame.thread_id)):[];
              remote.send(JSON.stringify(chatFrame(frame,selected,attachments)));
            }catch(e){send({type:'error',message:e instanceof ClientError?e.message:'请求无法处理。'});}
          });
        });
        client.on('close',()=>{clearTimeout(expire);s.sockets.delete(client);remote.close();});
      });
    }catch{socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');}
  });
  const cleanup=setInterval(()=>{for(const s of sessions.values())if(Date.now()>=s.expires)drop(s);},60000);cleanup.unref();
  server.on('close',()=>{clearInterval(cleanup);saveSessions();for(const s of sessions.values())for(const ws of s.sockets)ws.close(1012,'服务正在重启');wss.close();});
  server.revokeSession=req=>{try{drop(getSession(req));}catch{}};
  return server;
}
