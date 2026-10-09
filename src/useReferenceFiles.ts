import {useEffect,useRef,useState} from 'react';import {api} from './api';
export type ReferenceItem={key:string;file:File;filename:string;state:'uploading'|'ready'|'failed';id?:string;truncated?:boolean;error?:string};
export function useReferenceFiles(thread:string){
 const [items,setItems]=useState<ReferenceItem[]>([]),[error,setError]=useState('');
 const active=useRef(true),controller=useRef<AbortController|null>(null),itemsRef=useRef(items);itemsRef.current=items;
 useEffect(()=>{active.current=true;setItems([]);setError('');return()=>{active.current=false;controller.current?.abort()}},[thread]);
 async function upload(selected:ReferenceItem[]){
  if(controller.current)return;
  const c=new AbortController();controller.current=c;
  try{for(const item of selected){
   if(c.signal.aborted)break;
   setItems(previous=>previous.map(x=>x.key===item.key?{...x,state:'uploading',error:undefined}:x));
   try{
    const body=new FormData();body.append('file',item.file);
    const result=await api(`/threads/${encodeURIComponent(thread)}/attachments`,'POST',body,c.signal);
    if(!active.current||c.signal.aborted)break;
    const ready=result.status==='ready'&&typeof result.id==='string';
    setItems(previous=>previous.map(x=>x.key===item.key?{...x,id:ready?result.id:undefined,state:ready?'ready':'failed',truncated:!!result.truncated,error:ready?undefined:({unsupported:'这份附件暂时无法提取文字。图片或扫描件需要服务端支持识别。',empty:'没有读到可参考的文字，请换一份文件。',failed:'附件整理失败，请重试或移除。'} as Record<string,string>)[result.status]||'附件暂时无法使用。'}:x));
   }catch(e){if(!c.signal.aborted&&active.current)setItems(previous=>previous.map(x=>x.key===item.key?{...x,state:'failed',error:(e as Error).message}:x))}
  }}finally{controller.current=null}
 }
 function choose(files:FileList|File[]){
  setError('');if(controller.current)return;
  const incoming=Array.from(files);
  if(itemsRef.current.length+incoming.length>8){setError('每次最多参考 8 个附件。');return}
  if(incoming.some(f=>f.size>10*1024*1024)){setError('参考附件单个最多 10 MB，请缩小文件后重试。');return}
  const next=incoming.map(file=>({key:crypto.randomUUID(),file,filename:file.name,state:'uploading' as const}));
  itemsRef.current=[...itemsRef.current,...next];setItems(itemsRef.current);void upload(next);
 }
 function remove(key:string){setItems(previous=>previous.filter(x=>x.key!==key));setError('')}
 return {items,error,choose,remove,retry:(item:ReferenceItem)=>void upload([item]),clear:()=>setItems([]),restore:setItems,uploading:items.some(x=>x.state==='uploading'),blocked:items.some(x=>x.state!=='ready')};
}
