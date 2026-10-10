import {Bonjour} from 'bonjour-service';
import {isIP} from 'node:net';
import {execFile} from 'node:child_process';
import {lookup} from 'node:dns/promises';

// macOS's native responder sees services even when a VPN intercepts Node UDP.
async function macServices() {
  const run=args=>new Promise(resolve=>execFile('/usr/bin/dns-sd',args,{timeout:1800,maxBuffer:32768},(_error,stdout)=>resolve(String(stdout||''))));
  const listing=await run(['-B','_wanx._tcp','local.']);
  const names=[...new Set(listing.split('\n').map(line=>line.match(/\sAdd\s+\d+\s+\d+\s+local\.\s+_wanx\._tcp\.\s+(.+)$/)?.[1]?.trim()).filter(Boolean))].slice(0,12);
  const addresses=[];
  for(let i=0;i<names.length;i+=4){await Promise.all(names.slice(i,i+4).map(async name=>{
    const answer=await run(['-L',name,'_wanx._tcp','local.']);
    const match=answer.match(/can be reached at ([a-zA-Z0-9._-]+\.local\.):(\d+)/);
    if(!match)return;
    try{const records=await Promise.race([lookup(match[1],{all:true,family:4}),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('timeout')),1800);timer.unref()})]);for(const record of records){try{addresses.push(lanOrigin(`${/\btls=1\b/.test(answer)?'https':'http'}://${record.address}:${match[2]}`));}catch{}}}catch{}
  }));}
  return addresses;
}

export function lanOrigin(value) {
  const u=new URL(String(value));
  const parts=u.hostname.split('.').map(Number);
  const local=isIP(u.hostname)===4 && (parts[0]===10 || parts[0]===127 || (parts[0]===192&&parts[1]===168) || (parts[0]===172&&parts[1]>=16&&parts[1]<=31));
  if(!local || !['http:','https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash || u.pathname!=='/') throw new Error('请输入局域网 IPv4 地址，例如 http://192.168.1.10:8088');
  return u.origin;
}

export async function probeWanx(address, fetcher=fetch) {
  const endpoint=lanOrigin(address);
  async function read(path) {
    const r=await fetcher(endpoint+path,{redirect:'error',signal:AbortSignal.timeout(2500),headers:{Accept:'application/json'}});
    if(!r.ok)throw new Error('服务没有响应');
    const reader=r.body.getReader(); const chunks=[];let length=0;
    try {while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>16384)throw new Error('服务响应无效');chunks.push(value);}} finally {await reader.cancel();}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  const [health,captcha]=await Promise.all([read('/api/health'),read('/api/auth/captcha')]);
  if(health.ok!==true || typeof health.db!=='boolean' || typeof captcha.provider!=='string') throw new Error('这个地址不是兼容的 WANX 服务');
  let identity=null;try{identity=await read('/.well-known/wanx');}catch{}
  const verified=identity?.product==='wanx'&&identity?.protocol===1;
  return {endpoint,name:verified?String(identity.name).slice(0,80):'WANX 服务',version:verified?String(identity.version).slice(0,40):'',advertised:verified,ontology:verified&&identity.capabilities?.includes('role-ontology-v1'),transport:new URL(endpoint).protocol==='https:'?'https':'http'};
}

export function createLanDiscovery({seed=[],fetcher=fetch}={}) {
  const found=new Map();let pending=null;
  let bonjour;
  try {bonjour=new Bonjour(undefined,()=>{});}catch{}
  const remember=s=>{
    for(const ip of s.addresses||[]){try{const endpoint=lanOrigin(`${s.txt?.tls==='1'?'https':'http'}://${ip}:${s.port}`);if(found.size<48||found.has(endpoint))found.set(endpoint,{endpoint,at:Date.now()});}catch{}}
  };
  const browser=bonjour?.find({type:'wanx'},remember);
  return {
    scan(){
      if(pending)return pending;
      pending=(async()=>{
        browser?.update();
        const native=process.platform==='darwin'?await macServices():[];
        if(process.platform!=='darwin')await new Promise(r=>setTimeout(r,2000));
        for(const service of browser?.services||[])remember(service);
        for(const [key,value] of found)if(Date.now()-value.at>120000)found.delete(key);
        const addresses=[...new Set([...seed,...native,...found.keys()])].slice(0,24);
        const services=[];
        for(let i=0;i<addresses.length;i+=6){const results=await Promise.allSettled(addresses.slice(i,i+6).map(a=>probeWanx(a,fetcher)));for(const r of results)if(r.status==='fulfilled')services.push(r.value);}
        return {services,scope:'server-lan'};
      })().finally(()=>{pending=null;});return pending;
    },
    close(){browser?.stop();bonjour?.destroy();}
  };
}
