const https=require('node:https');const {EventEmitter}=require('node:events');const {X509Certificate,timingSafeEqual}=require('node:crypto');const {Bonjour}=require('bonjour-service');
function fingerprint(cert){return new X509Certificate(cert).fingerprint256.replaceAll(':','').toLowerCase();}
function validEndpoint(value){const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw new Error('请输入 https://服务器地址:28733');return u.origin;}
function tlsOptions(profile){
 const expected=profile.fingerprint.replaceAll(':','').toLowerCase();if(!/^[a-f0-9]{64}$/.test(expected)||fingerprint(profile.certificate)!==expected)throw new Error('服务器身份文件无效');
 return {ca:profile.certificate,rejectUnauthorized:true,checkServerIdentity:(_host,cert)=>{const got=cert.fingerprint256?.replaceAll(':','').toLowerCase()||'';if(got.length!==expected.length||!timingSafeEqual(Buffer.from(got),Buffer.from(expected)))return new Error('服务器身份不匹配');}};
}
function probe(endpoint,profile,timeout=2000){return new Promise((resolve,reject)=>{
 let deadline;const done=(fn,value)=>{clearTimeout(deadline);fn(value)};
 const req=https.get(new URL('/identity',endpoint),{...tlsOptions(profile),timeout},res=>{let text='';res.on('data',c=>{text+=c;if(text.length>4096)req.destroy(new Error('响应无效'))});res.on('end',()=>{try{const data=JSON.parse(text);if(res.statusCode!==200||data.serverId!==profile.serverId||data.product!=='zhijun'||data.protocol!==1)throw new Error('服务器身份不匹配');done(resolve,endpoint);}catch(e){done(reject,e)}});res.on('error',e=>done(reject,e))});req.on('error',e=>done(reject,e));deadline=setTimeout(()=>req.destroy(new Error('连接超时')),timeout);deadline.unref();
 });}
class Connection extends EventEmitter{
 constructor(profile,{onEndpoint=()=>{}}={}){super();this.profile=profile;this.options=tlsOptions(profile);this.endpoint=null;this.remoteEndpoint=null;this.lastEndpoint=null;this.candidates=new Map();this.message='正在寻找你的知君…';this.onEndpoint=onEndpoint;this.running=false;this.checking=null;for(const address of profile.addresses||[])this.add(address,'备用地址');}
 add(address,source='手动地址'){try{address=validEndpoint(address);if(this.candidates.size<32||this.candidates.has(address))this.candidates.set(address,{address,source});return address;}catch{return null;}}
 start(){this.running=true;this.bonjour=new Bonjour(undefined,()=>{this.message='自动发现暂不可用，正在尝试已保存地址。'});this.browser=this.bonjour.find({type:'zhijun'},s=>{if(String(s.txt?.serverId)!==this.profile.serverId)return;for(const address of s.addresses||[]){if(address.includes(':'))continue;this.add(`https://${address}:${s.port}`,'局域网发现')}if(s.host)this.add(`https://${s.host}:${s.port}`,'局域网发现');void this.check();});this.timer=setInterval(()=>void this.check(),4000);void this.check();}
 setRemote(endpoint){const previous=this.remoteEndpoint;this.remoteEndpoint=endpoint;if(this.endpoint===previous)this.endpoint=null;void this.check();}
 async check(){if(this.checking)return this.checking;this.checking=this._check().finally(()=>{this.checking=null});return this.checking;}
 async _check(){let next=null;const candidates=[...new Set([this.endpoint,this.lastEndpoint,...this.candidates.keys()].filter(Boolean))];
  if(this.endpoint&&this.endpoint!==this.remoteEndpoint){try{next=await probe(this.endpoint,this.profile,1800)}catch{}}
  if(!next&&candidates.length){try{next=await Promise.any(candidates.filter(x=>x!==this.remoteEndpoint).slice(0,16).map(x=>probe(x,this.profile,1800)))}catch{}}
  if(!next&&this.remoteEndpoint){try{next=await probe(this.remoteEndpoint,this.profile,2500)}catch{}}
  if(!this.running)return;
  const previous=this.endpoint;this.endpoint=next;this.message=next?'已连接到你的知君':'暂时找不到服务器；会自动继续尝试。';
  if(next&&next!==this.remoteEndpoint&&next!==this.lastEndpoint){this.lastEndpoint=next;this.onEndpoint(next);}
  if(previous!==next)this.emit('change',this.status());
 }
 status(){return {connected:!!this.endpoint,name:this.profile.name,message:this.message,serverId:this.profile.serverId,endpoint:this.endpoint,mode:this.endpoint===this.remoteEndpoint&&this.endpoint?'remote':'lan',candidates:[...this.candidates.values()]};}
 stop(){this.running=false;clearInterval(this.timer);this.browser?.stop();this.bonjour?.destroy();}
}
module.exports={Connection,tlsOptions,probe,validEndpoint,fingerprint};
