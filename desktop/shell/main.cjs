const {app,BrowserWindow,Menu,safeStorage}=require('electron');
const path=require('node:path');
const {startDesktopRuntime}=require('./runtime.cjs');

// Preserve old user data; direct WANX uses its own state and cookie partition.
app.setPath('userData',!app.isPackaged&&process.env.ZHIJUN_DESKTOP_USER_DATA?path.resolve(process.env.ZHIJUN_DESKTOP_USER_DATA):path.join(app.getPath('appData'),'ZhijunLAN'));
let runtime,window;
if(!app.requestSingleInstanceLock())app.quit();
else{
 app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.show();window.focus();}});
 app.whenReady().then(async()=>{
  runtime=await startDesktopRuntime({dataDir:path.join(app.getPath('userData'),'direct-wanx'),staticDir:path.join(__dirname,'../renderer'),safeStorage});
  window=new BrowserWindow({width:1280,height:860,minWidth:820,minHeight:600,title:'知君',icon:path.join(__dirname,'../resources/icon.png'),backgroundColor:'#fffcf6',autoHideMenuBar:true,webPreferences:{partition:'persist:zhijun-direct-wanx',nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,devTools:!app.isPackaged}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',(e,url)=>{if(new URL(url).origin!==runtime.origin)e.preventDefault();});
  window.webContents.session.setPermissionRequestHandler((_web,_permission,callback)=>callback(false));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
   {label:'知君',submenu:[{label:'退出知君',role:'quit'}]},
   {label:'编辑',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
   {label:'显示',submenu:[{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{role:'togglefullscreen'}]}
  ]));
  await window.loadURL(runtime.origin+'/');
 }).catch(error=>{require('electron').dialog.showErrorBox('知君未能启动','请重新打开知君。\n'+error.message);app.quit();});
 app.on('window-all-closed',()=>app.quit());
 app.on('before-quit',()=>{if(window&&!window.isDestroyed())window.webContents.session.flushStorageData();runtime?.close();});
}
