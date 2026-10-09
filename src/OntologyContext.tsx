import {useEffect,useState} from 'react';
import {api} from './api';
import {saveNode,type Claim} from './ontology';
import './ontology.css';
export function OntologyContext({thread,revision}:{thread:string;revision:number}){
 const [claims,setClaims]=useState<Claim[]>([]),[excluded,setExcluded]=useState<string[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{let alive=true;setClaims([]);setExcluded([]);api('/ontology/context/'+encodeURIComponent(thread)).then(r=>{if(alive)setClaims(r.claims||[]);}).catch(()=>{});return()=>{alive=false;};},[thread,revision]);
 async function exclude(id:string){if(busy)return;const next=excluded.includes(id)?excluded.filter(c=>c!==id):[...excluded,id];setBusy(true);setError('');try{await api('/ontology/context/'+encodeURIComponent(thread),'PUT',{excluded:next});setExcluded(next);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function disable(c:Claim){setBusy(true);setError('');try{await saveNode(c.id,{action:'disable',expected_version:c.version,request_id:crypto.randomUUID()});setClaims(cs=>cs.filter(x=>x.id!==c.id));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 if(!claims.length&&!error)return null;
 return <details className="ontology-chat-context"><summary>本次参考了哪些理解 · {claims.length} 项</summary><p>取消勾选可让下一次回复不参考这项理解，也可以停止以后使用。</p>{claims.map(c=><article key={c.id}><label><input type="checkbox" checked={!excluded.includes(c.id)} disabled={busy} onChange={()=>exclude(c.id)}/><span>{c.statement}{c.conditions&&<small> · {c.conditions}</small>}</span></label><button disabled={busy} onClick={()=>disable(c)}>停止以后使用</button><details><summary>查看依据</summary>{c.evidence?.map((e,i)=><blockquote key={i}>{e.quote}</blockquote>)}</details></article>)}{error&&<p role="alert">{error}</p>}</details>;
}
