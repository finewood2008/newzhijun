import http from 'node:http';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,renameSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createApp} from './app.mjs';
import {createRoleStore} from './roles.mjs';
import {createSessionStore} from './session-store.mjs';
import {createLanDiscovery,probeWanx,lanOrigin} from './lan-discovery.mjs';
import {serveStatic} from './static.mjs';
import {ClientError} from './policy.mjs';
const {version}=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));

// Each endpoint owns a separate app, token store, role registry and binding map.
// A selection never rewrites an active app's upstream, including in-flight calls.
export function createConnectedApp(config,options={}, {directory,discovery,probe=probeWanx,rememberSelection=false,scope='server-lan',sessionStoreFactory=createSessionStore}={}) {
  const apps=new Map(),known=new Map();
  const hash=address=>createHash('sha256').update(address).digest('hex').slice(0,32);
  const defaultId=config.upstream?hash(new URL(config.upstream).origin):null;
  const file=directory&&join(directory,'endpoints.json');
  const selectionFile=rememberSelection&&directory&&join(directory,'selected-endpoint');
  let rememberedId=null;
  if(directory)mkdirSync(directory,{recursive:true,mode:0o700});
  if(file&&existsSync(file)){try{for(const item of JSON.parse(readFileSync(file,'utf8')).slice(0,24)){try{const endpoint=lanOrigin(item.endpoint);known.set(hash(endpoint),{...item,endpoint});}catch{}}}catch{}}
  if(defaultId)known.set(defaultId,{endpoint:new URL(config.upstream).origin,name:'当前 WANX'});
  if(selectionFile&&existsSync(selectionFile)){const saved=readFileSync(selectionFile,'utf8').trim();if(known.has(saved))rememberedId=saved;}
  const search=discovery||createLanDiscovery({seed:[...known.values()].map(item=>item.endpoint)});
  const selected=req=>{const key=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('zhijun_backend='))?.slice(15);return key&&known.has(key)?key:rememberedId||defaultId;};
  function backend(key){
    if(!key||!known.has(key))return null;
    if(apps.has(key))return apps.get(key);
    if(apps.size>=24)throw new Error('已连接的服务过多，请重启知君后重试。');
    const current=known.get(key);let app;
    if(key===defaultId)app=createApp(config,{...options,allowAgentSelection:true});
    else {
      const root=directory&&join(directory,key), bindingFile=root&&join(root,'bindings.json');
      if(root)mkdirSync(root,{recursive:true,mode:0o700});
      const bindings=bindingFile&&existsSync(bindingFile)?JSON.parse(readFileSync(bindingFile,'utf8')):{};
      const isolated={...config,upstream:current.endpoint,bindings,provisioning:{},memoryPortableImport:false};
      // publicOrigin is finalized after listen() by the desktop HTTPS gateway.
      Object.defineProperty(isolated,'publicOrigin',{get:()=>config.publicOrigin});
      app=createApp(isolated,{...options,roleStore:createRoleStore(root&&join(root,'roles')),sessionStore:root?sessionStoreFactory(join(root,'sessions')):null,allowAgentSelection:true});
    }
    apps.set(key,app);return app;
  }
  const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
    try{
      if(req.headers.host!==new URL(config.publicOrigin).host)return json(res,403,{message:'请求来源无效'});
      const pathname=new URL(req.url,config.publicOrigin).pathname;
      if(pathname==='/api/connection'||pathname==='/api/connection/search'||pathname==='/api/connection/select'){
        if(req.method==='GET'&&pathname==='/api/connection')return json(res,200,{...known.get(selected(req)),scope,selected:!!selected(req)});
        if(req.method!=='POST'||req.headers.origin!==config.publicOrigin)return json(res,403,{message:'请求来源无效'});
        if(pathname==='/api/connection/search')return json(res,200,{...await search.scan(),scope});
        if(pathname!=='/api/connection/select')return json(res,405,{message:'操作不支持'});
        let raw='';for await(const part of req){raw+=part;if(raw.length>2048)return json(res,400,{message:'地址过长'});}
        const item=await probe(JSON.parse(raw).address);
        const key=hash(item.endpoint);
        if(known.size>=24&&!known.has(key))throw new Error('已保存的服务过多。');
        // Construct the destination successfully before revoking the old session.
        known.set(key,item);backend(key);
        if(file){writeFileSync(file+'.tmp',JSON.stringify([...known.values()]),{mode:0o600});renameSync(file+'.tmp',file);}
        backend(selected(req))?.revokeSession(req);
        if(selectionFile){writeFileSync(selectionFile+'.tmp',key,{mode:0o600});renameSync(selectionFile+'.tmp',selectionFile);rememberedId=key;}
        const secure=config.publicOrigin.startsWith('https:')?'; Secure':'';
        res.setHeader('Set-Cookie',[`zhijun_backend=${key}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${secure}`,`zhijun_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`]);
        return json(res,200,{ok:true,...item});
      }
      const app=backend(selected(req));
      if(app)return app.emit('request',req,res);
      if(pathname.startsWith('/api/')){
        if(req.method!=='GET'&&req.headers.origin!==config.publicOrigin)return json(res,403,{message:'请求来源无效'});
        if(pathname==='/api/status'&&req.method==='GET')return json(res,200,{connected:false,version,needsConnection:true});
        if(pathname==='/api/captcha'&&req.method==='GET')return json(res,200,{provider:'none',connectionRequired:true});
        if(pathname==='/api/me'&&req.method==='GET')return json(res,401,{code:'LOGIN_REQUIRED',message:'请先连接万象WANX并登录。'});
        return json(res,409,{code:'CONNECTION_REQUIRED',message:'请先通过右下角的“连接服务”选择万象WANX。'});
      }
      await serveStatic(req,res,options.staticDir||resolve('dist'),pathname);
    }catch(error){json(res,error instanceof ClientError?error.status:400,{code:error instanceof ClientError?error.code:'CONNECTION_FAILED',message:error instanceof ClientError||error.message?.includes('请输入')?error.message:'无法连接这个 WANX，请检查地址、服务状态和 HTTPS 证书。'});}
  });
  server.on('upgrade',(req,socket,head)=>{try{const app=backend(selected(req));if(app)app.emit('upgrade',req,socket,head);else socket.end('HTTP/1.1 409 Connection Required\r\nConnection: close\r\n\r\n');}catch{socket.destroy();}});
  server.on('close',()=>{search.close();for(const app of apps.values())app.emit('close');});
  return server;
}
