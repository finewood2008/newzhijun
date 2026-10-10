const fs=require('node:fs'),path=require('node:path');

// Windows uses DPAPI. Without secure storage, sessions remain memory-only.
function desktopSessionStore(directory,safeStorage){
 let available=false;
 try{available=!!safeStorage?.isEncryptionAvailable()&&safeStorage.getSelectedStorageBackend?.()!=='basic_text';}catch{}
 if(!available)return null;
 fs.mkdirSync(directory,{recursive:true,mode:0o700});
 const file=path.join(directory,'sessions.enc');
 return {
  load(){try{return JSON.parse(safeStorage.decryptString(fs.readFileSync(file))).filter(s=>/^[a-f0-9]{64}$/.test(s.sid)&&typeof s.token==='string'&&s.user?.id&&s.expires>Date.now());}catch{return []; }},
  save(sessions){const values=[...sessions.values()].filter(s=>s.expires>Date.now()).map(({sid,token,user,expires,agentId,sourceExpertId})=>({sid,token,user,expires,agentId,sourceExpertId}));fs.writeFileSync(file+'.tmp',safeStorage.encryptString(JSON.stringify(values)),{mode:0o600});fs.renameSync(file+'.tmp',file);}
 };
}
module.exports={desktopSessionStore};
