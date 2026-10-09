const {app,BrowserWindow,Menu,safeStorage,dialog}=require('electron');const fs=require('node:fs/promises'),path=require('node:path');
const {RemoteLink}=require('./remote.cjs');
const {Connection}=require('./connection.cjs');const {createGateway}=require('./gateway.cjs');
app.setPath('userData',!app.isPackaged&&process.env.ZHIJUN_DESKTOP_USER_DATA?path.resolve(process.env.ZHIJUN_DESKTOP_USER_DATA):path.join(app.getPath('appData'),'ZhijunLAN'));
let connection,gateway,window,remote;
if(!app.requestSingleInstanceLock()){app.quit();}else{
 app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.show();window.focus()}});
 app.whenReady().then(async()=>{
  const profile=JSON.parse(await fs.readFile(path.join(__dirname,'../resources/server-profile.json'),'utf8'));
  const file=path.join(app.getPath('userData'),'connection.enc');let available=false;
  try{available=safeStorage.isAsyncEncryptionAvailable?await safeStorage.isAsyncEncryptionAvailable():safeStorage.isEncryptionAvailable()}catch{}
  const vault={cookie:'',paired:false,remote:null,lastEndpoint:'',queue:Promise.resolve(),save(){this.queue=this.queue.then(async()=>{if(!available)return;const content=JSON.stringify({serverId:profile.serverId,cookie:this.cookie,paired:this.paired,lastEndpoint:this.lastEndpoint,remote:this.remote});const buffer=safeStorage.encryptStringAsync?await safeStorage.encryptStringAsync(content):safeStorage.encryptString(content);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file+'.tmp',buffer,{mode:0o600});await fs.rename(file+'.tmp',file)}).catch(()=>{});return this.queue;}};
  if(available){try{const buffer=await fs.readFile(file);const value=JSON.parse(safeStorage.decryptStringAsync?await safeStorage.decryptStringAsync(buffer):safeStorage.decryptString(buffer));if(value.serverId===profile.serverId){vault.cookie=value.cookie||'';vault.paired=!!value.paired;vault.lastEndpoint=value.lastEndpoint||'';vault.remote=value.remote||null}}catch{}}
  connection=new Connection(profile,{onEndpoint:endpoint=>{vault.lastEndpoint=endpoint;void vault.save()}});if(vault.lastEndpoint)connection.add(vault.lastEndpoint,'上次连接');
  remote=new RemoteLink({binary:path.join(app.isPackaged?process.resourcesPath:path.join(__dirname,'../../remote-connect'),'bin','wanx-link-'+process.platform+'-'+(process.arch==='x64'?'amd64':process.arch)+(process.platform==='win32'?'.exe':'')),directory:path.join(app.getPath('userData'),'network'),profile,vault,connection,secure:available});
  gateway=await createGateway({directory:path.join(__dirname,'../renderer'),connection,vault,remote});connection.start();remote.start();
  window=new BrowserWindow({width:1280,height:860,minWidth:820,minHeight:600,title:'知君',icon:path.join(__dirname,'../resources/icon.png'),backgroundColor:'#fffcf6',autoHideMenuBar:true,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,devTools:!app.isPackaged}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',(e,url)=>{if(new URL(url).origin!==gateway.origin)e.preventDefault()});
  window.webContents.session.setPermissionRequestHandler((_web,_permission,callback)=>callback(false));
  Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'知君',submenu:[{label:'连接服务器',click:()=>window.loadURL(gateway.origin+'/connect?manage=1')},{label:'回到知君',click:()=>window.loadURL(gateway.origin)},{type:'separator'},{label:'退出知君',role:'quit'}]},{label:'编辑',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},{label:'显示',submenu:[{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{role:'togglefullscreen'}]}]));
  await window.loadURL(gateway.origin+'/connect');
  if(!available)dialog.showMessageBox(window,{type:'info',message:'系统安全存储暂不可用。',detail:'仍可登录使用；关闭客户端后需重新登录。'});
 }).catch(error=>{dialog.showErrorBox('知君未能启动','请重新安装后再试。\n'+error.message);app.quit()});
 app.on('window-all-closed',()=>app.quit());app.on('before-quit',()=>{remote?.stop();connection?.stop();gateway?.close()});
}
