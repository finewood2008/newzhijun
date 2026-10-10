const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {RemoteLink}=require('../shell/remote.cjs');
const code='ZJ1.'+Buffer.from(JSON.stringify({version:1,serverId:'mock-server',controlURL:'https://connect.example.invalid',target:'100.64.0.1',authKey:'mock-one-time-key-123456789',expiresAt:Date.now()+900000})).toString('base64url');
async function waitFor(fn){const end=Date.now()+6500;while(!fn()){if(Date.now()>end)throw Error('Lifecycle timeout');await new Promise(r=>setTimeout(r,30));}}
async function fixture(t,restart=false){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'zhijun-remote-mock-'));
 const binary=path.join(dir,'mock-native');await fs.writeFile(binary,`#!/usr/bin/env node\nconst fs=require('node:fs'),path=require('node:path');let text='';process.stdin.on('data',c=>text+=c);process.stdin.on('end',()=>{const c=JSON.parse(text);fs.mkdirSync(c.stateDir,{recursive:true});const file=path.join(c.stateDir,'calls.json');let calls=[];try{calls=JSON.parse(fs.readFileSync(file))}catch{}calls.push(c);fs.writeFileSync(file,JSON.stringify(calls));process.stdout.write(JSON.stringify({state:'running',endpoint:'https://127.0.0.1:12345'})+'\\n');${restart?"if(calls.length===1)setTimeout(()=>process.exit(1),60);":''}setInterval(()=>{},1000);});`,{mode:0o700});
 const vault={remote:null,saves:0,async save(){this.saves++;}},endpoints=[];
 const connection={setRemote(e){endpoints.push(e);}};
 const link=new RemoteLink({binary,directory:dir,profile:{serverId:'mock-server'},vault,connection,secure:true});
 t.after(async()=>{const child=link.child;link.stop();if(child&&child.exitCode===null)await new Promise(r=>child.once('close',r));await fs.rm(dir,{recursive:true,force:true});});
 return {dir,link,vault,endpoints};
}
test('remote pairing passes credentials on stdin, clears the one-time key and can be forgotten',async t=>{
 const f=await fixture(t);await f.link.pair(code);await waitFor(()=>f.link.state==='running');
 assert.equal(f.endpoints.at(-1),'https://127.0.0.1:12345');assert.equal(f.vault.remote.authKey,'');
 const calls=JSON.parse(await fs.readFile(path.join(f.dir,f.vault.remote.instance,'calls.json')));assert.equal(calls[0].target,'100.64.0.1');assert.equal(calls[0].mode,'client');assert.equal(calls[0].authKey,'mock-one-time-key-123456789');
 await f.link.forget();assert.equal(f.vault.remote,null);assert.equal(f.link.status().state,'unpaired');assert.equal(f.endpoints.at(-1),null);
});
test('a crashed mock network process reconnects using its existing state and no reusable key',{timeout:9000},async t=>{
 const f=await fixture(t,true);await f.link.pair(code);const instance=f.vault.remote.instance;await waitFor(()=>f.link.state==='reconnecting');await waitFor(()=>f.link.state==='running');
 const calls=JSON.parse(await fs.readFile(path.join(f.dir,instance,'calls.json')));assert.equal(calls.length,2);assert.equal(calls[1].authKey,'');assert.equal(calls[0].stateDir,calls[1].stateDir);
});
test('pairing cannot persist credentials when secure storage is unavailable',async t=>{const f=await fixture(t);f.link.secure=false;await assert.rejects(f.link.pair(code),/安全存储/);assert.equal(f.vault.remote,null);assert.equal(f.vault.saves,0);});
test('a pairing code for a different server does not replace existing settings',async t=>{const f=await fixture(t);await f.link.pair(code);await waitFor(()=>f.link.state==='running');const old=f.vault.remote;await assert.rejects(f.link.pair(code.replace('ZJ1.','invalid.')));assert.equal(f.vault.remote,old);assert.equal(f.link.state,'running');});
