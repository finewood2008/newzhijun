import {api,roleRequestOptions} from '../../api';
export function request<T>(path:string, options:RequestInit={}):Promise<T> {
 return api<T>(path,options.method||'GET',typeof options.body==='string'?JSON.parse(options.body):undefined,options.signal||undefined);
}
export function requestUpload<T>(path:string, form:FormData):Promise<T>{return api<T>(path,'POST',form);}
export async function requestBlob(path:string,options:RequestInit={}):Promise<Blob>{
 const r=await fetch('/api'+path,roleRequestOptions(options));
 if(!r.ok){if(r.status===401)window.dispatchEvent(new Event('session-expired'));const d=await r.json();throw new Error(d.message||'下载失败');}
 return r.blob();
}
