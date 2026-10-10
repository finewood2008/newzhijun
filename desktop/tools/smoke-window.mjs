// Exercise the real Electron entry point in an isolated test process. The
// loopback debugging port exists only for this test, never in the installer.
import {spawn} from 'node:child_process';
import net from 'node:net';
import {once} from 'node:events';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {WebSocket} from 'ws';

const executable=process.argv[2];
assert(executable,'Pass the Electron/application executable, followed by optional app arguments');
if(process.platform==='win32')assert(process.env.CI==='true','Run the packaged Windows smoke test on an isolated CI runner');
const output=resolve(process.env.ZHIJUN_SMOKE_OUTPUT||'verification/desktop-direct');await mkdir(output,{recursive:true});
const userData=await mkdtemp(join(tmpdir(),'zhijun-window-test-'));
const listener=net.createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const port=listener.address().port;await new Promise(r=>listener.close(r));
const child=spawn(executable,[...process.argv.slice(3),'--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${port}`,'--disable-gpu'],{env:{...process.env,ZHIJUN_DESKTOP_USER_DATA:userData},stdio:['ignore','pipe','pipe']});
let log='',ws;child.stdout.on('data',c=>log+=c);child.stderr.on('data',c=>log+=c);
const pending=new Map();let serial=0;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){const end=Date.now()+45000;while(Date.now()<end){if(child.exitCode!==null)throw new Error('Application exited: '+child.exitCode);const result=await fn();if(result)return result;await pause(200);}throw new Error('Window startup timed out');}
try{
 const page=await until(async()=>{try{return(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(p=>p.type==='page'&&p.url.startsWith('http://127.0.0.1:'));}catch{return null;}});
 ws=new WebSocket(page.webSocketDebuggerUrl);await once(ws,'open');
 ws.on('message',raw=>{const message=JSON.parse(raw);const p=pending.get(message.id);if(p){pending.delete(message.id);clearTimeout(p.timer);message.error?p.reject(new Error(message.error.message)):p.resolve(message.result);}});
 const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout: '+method));},10000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 await until(()=>evaluate(`!!document.querySelector('form[aria-label="登录知君"]') && !!document.querySelector('.network-corner') && document.querySelector('.login-art img')?.naturalWidth>0`));
 const state=await evaluate(`({url:location.href,text:document.body.innerText,requiresConnection:document.querySelector('.login-submit').disabled,hasNode:typeof require!=='undefined'})`);
 assert.equal(new URL(state.url).pathname,'/');assert.equal(state.hasNode,false);assert.equal(state.requiresConnection,true);
 assert.match(state.text,/高山流水/);assert(!/家里的知君|配对码|在外也能连接|你的知君，就在这里/.test(state.text));
 const screenshot=async name=>{const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile(join(output,name),Buffer.from(shot.data,'base64'));};
 await screenshot('login.png');
 await evaluate(`document.querySelector('.network-corner').click();true`);
 await until(()=>evaluate(`!!document.querySelector('input#wanx-address') && document.body.innerText.includes('搜索这台电脑所在的局域网')`));
 const panel=await evaluate(`document.body.innerText`);assert.match(panel,/搜索 万象WANX/);assert.match(panel,/手动输入地址/);assert(!panel.includes('配对码'));
 await screenshot('connections.png');
 const report={platform:process.platform,arch:process.arch,realApplicationEntry:true,loginPage:true,clientLanDiscovery:true,manualAddress:true,legacyConnectionVisible:false,rendererNodeIntegration:false,installerExecution:false};
 await writeFile(join(output,'window-check.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{
 for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('Test ended'));}
 ws?.close();child.kill();await writeFile(join(output,'electron.log'),log);
}
