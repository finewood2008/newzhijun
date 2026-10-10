const fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict'),asar=require('@electron/asar'),PE=require('pe-library'),R=require('resedit'),path=require('node:path');
const output=path.resolve(process.argv[2]||path.join(__dirname,'../release'));
process.chdir(path.resolve(__dirname,'..'));
const packageVersion=JSON.parse(fs.readFileSync('package.json')).version;
const archive=path.join(output,'win-unpacked/resources/app.asar'),files=asar.listPackage(archive);
assert(!files.some(f=>/deployment\.json|\.env$|\.sqlite|tls\.key|identity\.json|sessions\.enc|session-key|\.pem$/.test(f)));
const legacyFiles=files.filter(f=>/server-profile\.json|renderer[/\\]connect\.(?:html|js|css)|shell[/\\](?:connection|gateway|remote)\.cjs|server[/\\]desktop-service\.mjs/.test(f));
assert.deepEqual(legacyFiles,[],'Legacy connection entry must not ship');
assert(!fs.existsSync(path.join(output,'win-unpacked/resources/bin/wanx-link-win32-amd64.exe')));
for(const f of ['shell/main.cjs','shell/runtime.cjs','shell/session-store.cjs','resources/icon.ico','renderer/index.html'])assert.deepEqual(asar.extractFile(archive,f),fs.readFileSync(f),f);
const main=asar.extractFile(archive,'shell/main.cjs').toString();
assert.match(main,/loadURL\(runtime\.origin\+'\/'\)/);
assert(!/server-profile|RemoteLink|\/connect\b|连接服务器/.test(main));
function verifyFolder(folder,prefix,filter=()=>true,relative=''){
 for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
  const rel=path.join(relative,entry.name),file=path.join(folder,entry.name);
  if(entry.isDirectory())verifyFolder(file,prefix,filter,rel);
  else if(filter(rel))assert.deepEqual(asar.extractFile(archive,prefix+'/'+rel.split(path.sep).join('/')),fs.readFileSync(file),rel);
 }
}
verifyFolder(path.resolve('../dist'),'renderer');
verifyFolder(path.resolve('../server'),'server',f=>f.endsWith('.mjs')&&!['index.mjs','desktop-service.mjs'].includes(f));
assert.equal(JSON.parse(asar.extractFile(archive,'package.json')).version,packageVersion);
function pe(file){
 const b=fs.readFileSync(file),off=b.readUInt32LE(0x3c),magic=b.readUInt16LE(off+24),dir=off+24+(magic===0x20b?112:96),certOffset=b.readUInt32LE(dir+32),certSize=b.readUInt32LE(dir+36);
 assert.equal(b.toString('ascii',off,off+4),'PE\0\0');
 return {machine:b.readUInt16LE(off+4).toString(16),signed:!!(certOffset&&certSize),bytes:b.length,sha256:crypto.createHash('sha256').update(b).digest('hex')};
}
const exeFile=path.join(output,'win-unpacked/知君.exe'),application=pe(exeFile),installer=pe(path.join(output,'Zhijun-Setup-'+packageVersion+'-x64.exe'));
assert.equal(application.machine,'8664');assert.equal(installer.signed,false);assert(installer.bytes>50*1024*1024,'Installer payload is missing');
const exe=PE.NtExecutable.from(fs.readFileSync(exeFile)),resources=PE.NtExecutableResource.from(exe),version=R.Resource.VersionInfo.fromEntries(resources.entries)[0],values=version.getStringValues(version.getAllLanguagesForStringValues()[0]);
assert.equal(values.ProductName,'知君');assert.equal(values.ProductVersion,packageVersion+'.0');assert(resources.entries.some(r=>r.type==='INTEGRITY'));assert.equal(R.Resource.IconGroupEntry.fromEntries(resources.entries).length,1);
console.log(JSON.stringify({version:packageVersion,target:'Windows x64',connectionMode:'direct-wanx',application,installer,asarFiles:files.length,legacyFiles,privateFilesFound:[],sourceMatchesArchive:true,metadata:values,realWindowsTest:false},null,2));
