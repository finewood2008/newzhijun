const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {desktopSessionStore}=require('./session-store.cjs');

async function startDesktopRuntime({dataDir,staticDir,safeStorage,serverModule=pathToFileURL(path.join(__dirname,'../server/connections.mjs')).href,discovery,probe,fetcher}){
 const {createConnectedApp}=await import(serverModule);
 const config={publicOrigin:'http://127.0.0.1:0',bindings:{},provisioning:{},memoryPortableImport:false};
 const server=createConnectedApp(config,{staticDir,...(fetcher?{fetcher}:{})},{directory:dataDir,scope:'client-lan',rememberSelection:true,sessionStoreFactory:directory=>desktopSessionStore(directory,safeStorage),discovery,probe});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 config.publicOrigin=`http://127.0.0.1:${server.address().port}`;
 return {origin:config.publicOrigin,server,close(){server.close();server.closeAllConnections();}};
}
module.exports={startDesktopRuntime};
