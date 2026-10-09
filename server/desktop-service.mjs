import {createRoleStore} from './roles.mjs';
import http from 'node:http';import https from 'node:https';
import {readFile} from 'node:fs/promises';import {resolve,dirname} from 'node:path';import {fileURLToPath} from 'node:url';
import {Bonjour} from 'bonjour-service';
import {createApp} from './app.mjs';import {createSessionStore} from './session-store.mjs';
const directory=process.env.ZHIJUN_SERVER_HOME||resolve(dirname(fileURLToPath(import.meta.url)),'..');
const config=JSON.parse(await readFile(resolve(directory,'deployment.json'),'utf8'));
const identity=JSON.parse(await readFile(resolve(directory,'identity.json'),'utf8'));
const internalConfig={...config,publicOrigin:'http://127.0.0.1:0'};
const app=createApp(internalConfig,{staticDir:resolve(directory,'empty'),roleStore:createRoleStore(config.roleStore || resolve(directory,'.runtime/roles')),sessionStore:createSessionStore(resolve(directory,'state'))});
await new Promise((resolve,reject)=>{app.once('error',reject);app.listen(0,'127.0.0.1',resolve)});
internalConfig.publicOrigin=`http://127.0.0.1:${app.address().port}`;
const internal=new URL(internalConfig.publicOrigin);
const tls={key:await readFile(resolve(directory,'tls.key')),cert:await readFile(resolve(directory,'tls.crt')),minVersion:'TLSv1.2'};
const allowed=req=>req.headers['x-zhijun-client']==='desktop-v1'&&req.headers.origin==='zhijun://desktop';
function headers(req){const result={...req.headers,host:internal.host,origin:internal.origin};delete result['x-zhijun-client'];delete result['proxy-authorization'];return result;}
const server=https.createServer(tls,(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.url==='/identity'&&req.method==='GET'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({serverId:identity.serverId,name:identity.name,protocol:1,product:'zhijun'}));}
 if(!req.url?.startsWith('/api/')||!allowed(req)){res.writeHead(403);return res.end();}
 const upstream=http.request({hostname:'127.0.0.1',port:internal.port,path:req.url,method:req.method,headers:headers(req)},r=>{res.writeHead(r.statusCode||502,r.headers);r.pipe(res)});
 upstream.on('error',()=>{if(!res.headersSent)res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({message:'服务正在恢复，请稍后重试。'}));});
 req.on('aborted',()=>upstream.destroy());req.pipe(upstream);
});
server.on('upgrade',(req,socket,head)=>{
 if(new URL(req.url,'https://localhost').pathname!=='/api/chat'||!allowed(req)){socket.destroy();return;}
 const upstream=http.request({hostname:'127.0.0.1',port:internal.port,path:req.url,headers:headers(req)});
 upstream.on('upgrade',(r,remote,remoteHead)=>{socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(r.headers).map(([k,v])=>`${k}: ${v}`).join('\r\n')}\r\n\r\n`);if(remoteHead.length)socket.write(remoteHead);if(head.length)remote.write(head);socket.pipe(remote).pipe(socket);socket.on('error',()=>remote.destroy());remote.on('error',()=>socket.destroy());socket.on('close',()=>remote.destroy());remote.on('close',()=>socket.destroy());});
 upstream.on('response',r=>{socket.end(`HTTP/1.1 ${r.statusCode} Connection Failed\r\nConnection: close\r\n\r\n`);r.resume()});upstream.on('error',()=>socket.destroy());upstream.end();
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.desktopPort||28733,'0.0.0.0',resolve)});
const bonjour=new Bonjour(undefined,()=>console.error('局域网广播暂不可用；可以使用备用地址连接。'));
const advertisement=bonjour.publish({name:`${identity.name}-${identity.serverId.slice(0,6)}`,type:'zhijun',port:server.address().port,txt:{serverId:identity.serverId,protocol:'1',tls:'1'}});
let stopping=false;
function stop(){if(stopping)return;stopping=true;advertisement.stop(()=>bonjour.destroy());server.close();server.closeAllConnections();app.close();app.closeAllConnections();setTimeout(()=>process.exit(0),1500).unref();}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
console.log(`知君桌面服务已启动，端口 ${server.address().port}，服务 ID ${identity.serverId}`);
