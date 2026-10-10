import {useEffect,useRef,useState} from 'react';
import {ArrowRight} from 'lucide-react';

export function ExpertChoice({choices,onSelect,onLogout}:{choices:{id:string;name:string}[];onSelect:(id:string)=>Promise<void>;onLogout:()=>void}) {
 const dialog=useRef<HTMLElement>(null),[busy,setBusy]=useState(''),[error,setError]=useState('');
 useEffect(()=>{dialog.current?.focus()},[]);
 return <div className="modal-backdrop"><section className="modal expert-choice-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="expert-choice-title" tabIndex={-1} onKeyDown={e=>{
  if(e.key!=='Tab')return;
  const items=[...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled)')||[])],first=items[0],last=items.at(-1);
  if(e.shiftKey&&(document.activeElement===first||document.activeElement===dialog.current)){e.preventDefault();last?.focus()}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}
 }}>
  <span className="eyebrow">与你相伴的知君</span><h2 id="expert-choice-title">想连接哪一位知君？</h2>
  <p>这个万象里有多个知君，请选择一个。我们会记住这次选择。</p>
  <div className="expert-choice-list">{choices.map(choice=><button key={choice.id} disabled={!!busy} onClick={async()=>{setBusy(choice.id);setError('');try{await onSelect(choice.id)}catch(e){setError((e as Error).message)}finally{setBusy('')}}}>
   <span><strong>{choice.name}</strong><small>专家 ID · {choice.id}</small></span>{busy===choice.id?<small role="status">正在连接…</small>:<ArrowRight size={17}/>}
  </button>)}</div>
  {error&&<p className="notice" role="alert">{error}</p>}
  <button className="expert-choice-exit" disabled={!!busy} onClick={onLogout}>退出登录</button>
 </section></div>
}
