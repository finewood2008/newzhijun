const http=require('node:http'),https=require('node:https');const fs=require('node:fs/promises'),path=require('node:path');const {WebSocket,WebSocketServer}=require('ws');
async function createGateway({directory,connection,vault,remote}){
 let origin='';const failure=(res,status,message)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({message}))};
 const server=http.createServer(async(req,res)=>{
 try{
  if(req.headers.host!==new URL(origin).host)return failure(res,403,'请求来源无效');
  const u=new URL(req.url,origin),mutating=!['GET','HEAD'].includes(req.method);
  if(mutating&&req.headers.origin!==origin)return failure(res,403,'请求来源无效');
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');
  if(u.pathname==='/desktop/status'&&req.method==='GET'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({...connection.status(),paired:!!vault.paired,remote:remote?.status()}));}
  if(u.pathname==='/desktop/enter'&&req.method==='POST'){if(!connection.endpoint)return failure(res,503,'服务器尚未连接');vault.paired=true;await vault.save();res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({ok:true}));}
  if(u.pathname==='/desktop/address'&&req.method==='POST'){let raw='';for await(const c of req){raw+=c;if(raw.length>2048)return failure(res,400,'地址过长')}let address;try{address=connection.add(JSON.parse(raw).address)}catch{}if(!address)return failure(res,400,'请输入完整的 HTTPS 服务地址');await connection.check();res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({...connection.status(),paired:!!vault.paired}));}
  if(req.method==='POST'&&['/desktop/remote/pair','/desktop/remote/forget'].includes(u.pathname)){
   if(!remote)return failure(res,503,'远程模块不可用');let raw='';for await(const c of req){raw+=c;if(raw.length>8192)return failure(res,400,'配对码过长')}
   try{const data=raw?JSON.parse(raw):{};const result=u.pathname.endsWith('/pair')?await remote.pair(data.code):await remote.forget();res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(result))}catch(e){return failure(res,400,e.message)}
  }
  if(u.pathname.startsWith('/api/')){
   if(!connection.endpoint)return failure(res,503,'服务器暂时离线，正在自动重新连接。');
   const headers={'x-zhijun-client':'desktop-v1',Origin:'zhijun://desktop',Accept:req.headers.accept||'application/json'};
   if(req.headers['x-zhijun-role'])headers['X-Zhijun-Role']=req.headers['x-zhijun-role'];
   if(req.headers['x-zhijun-expert'])headers['X-Zhijun-Expert']=req.headers['x-zhijun-expert'];
   if(vault.cookie)headers.Cookie=vault.cookie;if(req.headers['content-type'])headers['Content-Type']=req.headers['content-type'];
   const upstream=https.request(new URL(req.url,connection.endpoint),{...connection.options,method:req.method,headers},response=>{
    const cookies=response.headers['set-cookie'];
    if(cookies){const jar=new Map(String(vault.cookie||'').split(';').map(c=>c.trim()).filter(Boolean).map(c=>{const i=c.indexOf('=');return [c.slice(0,i),c.slice(i+1)]}));for(const cookie of cookies){const pair=cookie.split(';')[0],i=pair.indexOf('='),name=pair.slice(0,i),value=pair.slice(i+1);if(!['zhijun_session','zhijun_backend'].includes(name))continue;if(value)jar.set(name,value);else jar.delete(name);}vault.cookie=[...jar].map(([k,v])=>k+'='+v).join('; ');void vault.save();}
    if(response.statusCode===401){vault.cookie=String(vault.cookie||'').split(';').map(c=>c.trim()).filter(c=>c.startsWith('zhijun_backend=')).join('; ');void vault.save();}
    const out={...response.headers};delete out['set-cookie'];delete out['content-security-policy'];delete out['access-control-allow-origin'];res.writeHead(response.statusCode||502,out);response.pipe(res);
   });
   upstream.setTimeout(300000,()=>upstream.destroy());upstream.on('error',()=>{if(!res.headersSent)failure(res,503,'连接暂时中断，正在自动重新连接。');else res.end();void connection.check()});req.on('aborted',()=>upstream.destroy());req.pipe(upstream);return;
  }
  if(req.method!=='GET')return failure(res,405,'操作不支持');
  const pathname=u.pathname==='/'?'index.html':u.pathname==='/connect'?'connect.html':u.pathname.slice(1);const file=path.resolve(directory,pathname);
  if(!file.startsWith(path.resolve(directory)+path.sep))return failure(res,404,'未找到页面');
  let bytes;try{bytes=await fs.readFile(file)}catch{return failure(res,404,'未找到页面')}
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws://127.0.0.1:*; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'self'");
  res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'})[path.extname(file)]||'application/octet-stream');res.end(bytes);
 }catch{if(!res.headersSent)failure(res,500,'暂时无法完成此操作');else res.end()}
 });
 const wss=new WebSocketServer({noServer:true,maxPayload:128*1024});
 server.on('upgrade',(req,socket,head)=>{
  if(new URL(req.url,origin).pathname!=='/api/chat'||req.headers.origin!==origin||req.headers.host!==new URL(origin).host||!connection.endpoint){socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');return;}
  wss.handleUpgrade(req,socket,head,client=>{
   const target=new URL(req.url,connection.endpoint);target.protocol='wss:';
   const remote=new WebSocket(target,{...connection.options,headers:{Cookie:vault.cookie||'','x-zhijun-client':'desktop-v1',Origin:'zhijun://desktop'},handshakeTimeout:10000,maxPayload:4*1024*1024});
   let pong=true;const heartbeat=setInterval(()=>{if(!pong){remote.terminate();return;}pong=false;if(remote.readyState===WebSocket.OPEN)remote.ping();},15000);
   remote.on('pong',()=>{pong=true});remote.on('message',data=>{if(client.readyState===WebSocket.OPEN)client.send(data.toString())});
   client.on('message',data=>{if(remote.readyState===WebSocket.OPEN)remote.send(data.toString())});
   const close=()=>{clearInterval(heartbeat);client.close(1012);remote.close();};remote.on('close',close);remote.on('error',close);client.on('close',close);client.on('error',close);
  });
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});origin=`http://127.0.0.1:${server.address().port}`;
 return {origin,server,close(){for(const ws of wss.clients)ws.terminate();wss.close();server.close();server.closeAllConnections()}};
}
module.exports={createGateway};
