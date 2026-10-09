import {mkdir,readFile,writeFile,copyFile,cp,chmod,stat} from 'node:fs/promises';import {resolve,join} from 'node:path';import {homedir,networkInterfaces} from 'node:os';import {randomUUID,X509Certificate} from 'node:crypto';import {execFileSync} from 'node:child_process';
const source=resolve('.'),destination=join(homedir(),'Library/Application Support/ZhijunServer');await mkdir(destination,{recursive:true,mode:0o700});await chmod(destination,0o700);
await cp(join(source,'server'),join(destination,'server'),{recursive:true});
const config=JSON.parse(await readFile(join(source,'deployment.json'),'utf8'));config.upstream='http://127.0.0.1:8088';config.desktopPort=28733;await writeFile(join(destination,'deployment.json'),JSON.stringify(config,null,2),{mode:0o600});
let identity;try{identity=JSON.parse(await readFile(join(destination,'identity.json'),'utf8'))}catch{identity={serverId:randomUUID(),name:'家里的知君'};await writeFile(join(destination,'identity.json'),JSON.stringify(identity),{mode:0o600})}
const hostname=execFileSync('/usr/sbin/scutil',['--get','LocalHostName'],{encoding:'utf8'}).trim()+'.local';
try{await stat(join(destination,'tls.key'));await stat(join(destination,'tls.crt'))}catch{execFileSync('/opt/homebrew/bin/openssl',['req','-x509','-newkey','rsa:3072','-nodes','-days','3650','-subj',`/CN=Zhijun-${identity.serverId}`,'-addext',`subjectAltName=DNS:${hostname}`,'-keyout',join(destination,'tls.key'),'-out',join(destination,'tls.crt')],{stdio:'ignore'});await chmod(join(destination,'tls.key'),0o600)}
const certificate=await readFile(join(destination,'tls.crt'),'utf8');const fingerprint=new X509Certificate(certificate).fingerprint256.replaceAll(':','').toLowerCase();
const addresses=[`https://${hostname}:28733`,...Object.entries(networkInterfaces()).filter(([name])=>/^en\d+$/.test(name)).flatMap(([,list])=>list.filter(x=>x.family==='IPv4'&&!x.internal).map(x=>`https://${x.address}:28733`))];
const profile={serverId:identity.serverId,name:identity.name,certificate,fingerprint,addresses};await writeFile(join(source,'desktop/resources/server-profile.json'),JSON.stringify(profile,null,2)+'\n');
await writeFile(join(destination,'package.json'),JSON.stringify({private:true,type:'module',dependencies:{'ws':'8.22.0','bonjour-service':'1.4.4'}},null,2));
await mkdir(join(destination,'logs'),{recursive:true,mode:0o700});
console.log(JSON.stringify({directory:destination,serverId:identity.serverId,hostname,addresses}));
