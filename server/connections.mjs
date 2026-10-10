import http from 'node:http';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,renameSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {createApp} from './app.mjs';
import {createRoleStore} from './roles.mjs';
import {createSessionStore} from './session-store.mjs';
import {createLanDiscovery,probeWanx} from './lan-discovery.mjs';

// Each endpoint owns a separate app, token store, role registry and binding map.
// A selection never rewrites an active app's upstream, including in-flight calls.
export function createConnectedApp(config,options={}, {directory,discovery,probe=probeWanx}={}) {
  const apps=new Map(),known=new Map();
  const hash=address=>createHash('sha256').update(address).digest('hex').slice(0,32);
  const defaultId=hash(new URL(config.upstream).origin);
  const file=directory&&join(directory,'endpoints.json');
  if(directory)mkdirSync(directory,{recursive:true,mode:0o700});
  if(file&&existsSync(file)){for(const item of JSON.parse(readFileSync(file,'utf8')))known.set(hash(item.endpoint),item);}
  known.set(defaultId,{endpoint:new URL(config.upstream).origin,name:'当前 WANX'});
  const search=discovery||createLanDiscovery({seed:[config.upstream]});
  const selected=req=>{const key=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('zhijun_backend='))?.slice(15);return key&&known.has(key)?key:defaultId;};
  function backend(key){
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
      app=createApp(isolated,{...options,roleStore:createRoleStore(root&&join(root,'roles')),sessionStore:root?createSessionStore(join(root,'sessions')):null,allowAgentSelection:true});
    }
    apps.set(key,app);return app;
  }
  const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
  const server=http.createServer(async(req,res)=>{
    try{
      if(req.headers.host!==new URL(config.publicOrigin).host)return json(res,403,{message:'请求来源无效'});
      const pathname=new URL(req.url,config.publicOrigin).pathname;
      if(pathname==='/api/connection'||pathname==='/api/connection/search'||pathname==='/api/connection/select'){
        if(req.method==='GET'&&pathname==='/api/connection')return json(res,200,{...known.get(selected(req)),scope:'server-lan'});
        if(req.method!=='POST'||req.headers.origin!==config.publicOrigin)return json(res,403,{message:'请求来源无效'});
        if(pathname==='/api/connection/search')return json(res,200,await search.scan());
        if(pathname!=='/api/connection/select')return json(res,405,{message:'操作不支持'});
        let raw='';for await(const part of req){raw+=part;if(raw.length>2048)return json(res,400,{message:'地址过长'});}
        const item=await probe(JSON.parse(raw).address);
        const key=hash(item.endpoint);
        if(known.size>=24&&!known.has(key))throw new Error('已保存的服务过多。');
        // Construct the destination successfully before revoking the old session.
        known.set(key,item);backend(key);
        if(file){writeFileSync(file+'.tmp',JSON.stringify([...known.values()]),{mode:0o600});renameSync(file+'.tmp',file);}
        backend(selected(req)).revokeSession(req);
        const secure=config.publicOrigin.startsWith('https:')?'; Secure':'';
        res.setHeader('Set-Cookie',[`zhijun_backend=${key}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${secure}`,`zhijun_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`]);
        return json(res,200,{ok:true,...item});
      }
      backend(selected(req)).emit('request',req,res);
    }catch(error){json(res,400,{message:error.message?.includes('请输入')?error.message:'无法连接这个 WANX，请检查地址、服务状态和 HTTPS 证书。'});}
  });
  server.on('upgrade',(req,socket,head)=>{try{backend(selected(req)).emit('upgrade',req,socket,head);}catch{socket.destroy();}});
  server.on('close',()=>{search.close();for(const app of apps.values())app.emit('close');});
  return server;
}
