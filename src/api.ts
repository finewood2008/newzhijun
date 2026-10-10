let activeRole = 'personal';
let activeExpert = '';
export const getActiveExpert = () => activeExpert;
export function setActiveExpert(expert: string) {if(expert!==activeExpert){setActiveRole('personal',true);activeExpert=expert;}}
let roleRequests = new AbortController();
export const getActiveRole = () => activeRole;
export function setActiveRole(role: string, force = false) {
  if (role === activeRole && !force) return;
  roleRequests.abort();
  roleRequests = new AbortController();
  activeRole = role;
}
export function roleRequestOptions(options: RequestInit = {}): RequestInit {
  const headers = new Headers(options.headers);
  headers.set('X-Zhijun-Role', activeRole);
  if(activeExpert)headers.set('X-Zhijun-Expert',activeExpert);
  return {...options, headers, signal: options.signal ? AbortSignal.any([options.signal, roleRequests.signal]) : roleRequests.signal};
}
export async function api<T=any>(path:string, method='GET', body?:unknown, signal?:AbortSignal):Promise<T> {
  const r=await fetch('/api'+path,roleRequestOptions({method,signal,headers:body instanceof FormData?{}:body===undefined?{}:{'Content-Type':'application/json'},body:body instanceof FormData?body:body===undefined?undefined:JSON.stringify(body)}));
  const data=await r.json();
  if(!r.ok){if(r.status===401)window.dispatchEvent(new Event('session-expired'));if(data.code==='EXPERT_CHANGED')window.dispatchEvent(new Event('expert-changed'));throw new Error(data.message||'暂时无法完成操作。');}
  return data;
}
export type Role={id:string;name:string;description:string};
export type User={id:number;name:string;ready:boolean;reason:string;expertId?:string;expertChoices?:{id:string;name:string}[];roles?:Role[];canCreateRoles?:boolean};
export type Thread={thread_id:string;title:string;last_active:number};
export function textContent(content:unknown):string {
  if(typeof content==='string') return content;
  if(Array.isArray(content)) return content.filter(x=>x?.type==='text').map(x=>String(x.text||'')).join('\n');
  return '';
}
export async function streamApproval(body:unknown,onFrame:(v:any)=>void,signal:AbortSignal){
  const r=await fetch('/api/approval',roleRequestOptions({method:'POST',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));
  if(!r.ok||!r.body)throw new Error('提交确认失败，请刷新记录后重试。');
  const reader=r.body.getReader(),decoder=new TextDecoder();let buffer='';
  while(true){const {value,done}=await reader.read();buffer+=decoder.decode(value,{stream:!done}).replace(/\r\n/g,'\n');let end;while((end=buffer.indexOf('\n\n'))>=0){const event=buffer.slice(0,end);buffer=buffer.slice(end+2);const data=event.split('\n').filter(x=>x.startsWith('data:')).map(x=>x.slice(5).trimStart()).join('\n');if(data)onFrame(JSON.parse(data));}if(done)break;}
}
