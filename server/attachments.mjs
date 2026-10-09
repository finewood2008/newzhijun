import {createHash,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';import {fail} from './policy.mjs';
const key=session=>createHash('sha256').update(session.token).digest();
export function sealAttachment(record,session){
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(session),iv);
 const payload={...record,userId:session.user.id,expires:session.expires};
 const encrypted=Buffer.concat([cipher.update(JSON.stringify(payload)),cipher.final()]);
 return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');
}
export function resolveAttachments(ids,session,aid,threadId){
 if(ids===undefined)return [];
 if(!Array.isArray(ids)||ids.length>8||new Set(ids).size!==ids.length)fail(400,'INVALID_ATTACHMENTS','每次最多参考 8 个附件。');
 return ids.map(token=>{
  try{
   if(typeof token!=='string'||token.length>4096)throw new Error();
   const bytes=Buffer.from(token,'base64url'),decipher=createDecipheriv('aes-256-gcm',key(session),bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(12,28));
   const a=JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString());
   if(Number(a.userId)!==Number(session.user.id)||a.agentId!==aid||a.threadId!==threadId||a.expires<=Date.now()||a.status!=='ready'||!/^inbound\/[0-9]{10,}_[^/\\\x00-\x1f\x7f]+$/.test(a.path))throw new Error();
   return a;
  }catch{fail(400,'ATTACHMENT_UNAVAILABLE','附件已失效或不属于这段对话，请重新上传。');}
 });
}
export async function singleUpload(body,contentType,field,maxBytes){
 if(!Buffer.isBuffer(body)||!contentType?.startsWith('multipart/form-data'))fail(400,'INVALID_FILE','请选择文件。');
 let input;try{input=await new Response(body,{headers:{'Content-Type':contentType}}).formData()}catch{fail(400,'INVALID_FILE','文件格式无效。')}
 const files=input.getAll(field),file=files[0];
 if(files.length!==1||!file||typeof file==='string')fail(400,'INVALID_FILE','请逐个上传文件。');
 if(file.size>maxBytes)fail(413,'FILE_TOO_LARGE',`单个文件最多 ${maxBytes/1024/1024} MB。`);
 const form=new FormData();form.set(field,file,file.name);return form;
}
