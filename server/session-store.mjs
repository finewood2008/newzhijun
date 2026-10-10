import {mkdirSync,readFileSync,writeFileSync,renameSync,existsSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
/** Persist only active login sessions; no passwords or plaintext upstream tokens on disk. */
export function createSessionStore(directory){
 mkdirSync(directory,{recursive:true,mode:0o700});chmodSync(directory,0o700);
 const keyPath=join(directory,'session-key'),dataPath=join(directory,'sessions.enc');
 if(!existsSync(keyPath))writeFileSync(keyPath,randomBytes(32),{mode:0o600,flag:'wx'});
 const key=readFileSync(keyPath);
 if(key.length!==32)throw new Error('Invalid session key');
 return {
  load(){try{const data=readFileSync(dataPath),decipher=createDecipheriv('aes-256-gcm',key,data.subarray(0,12));decipher.setAuthTag(data.subarray(12,28));const values=JSON.parse(Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]).toString());return values.filter(s=>/^[a-f0-9]{64}$/.test(s.sid)&&typeof s.token==='string'&&s.user?.id&&s.expires>Date.now());}catch{return []; }},
  save(sessions){const values=[...sessions.values()].filter(s=>s.expires>Date.now()).map(({sid,token,user,expires,agentId,sourceExpertId})=>({sid,token,user,expires,agentId,sourceExpertId}));const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);const encrypted=Buffer.concat([cipher.update(JSON.stringify(values)),cipher.final()]);writeFileSync(dataPath+'.tmp',Buffer.concat([iv,cipher.getAuthTag(),encrypted]),{mode:0o600});renameSync(dataPath+'.tmp',dataPath);}
 };
}
