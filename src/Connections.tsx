import {useEffect,useState,useRef} from 'react';
import {Radio,RefreshCw,Server,X} from 'lucide-react';
import {api,setActiveRole} from './api';
import './connections.css';

type Service={endpoint:string;name:string;version?:string;ontology?:boolean;advertised?:boolean;transport?:string};
export function Connections({onClose}:{onClose:()=>void}){
 const panel=useRef<HTMLElement>(null);
 const [current,setCurrent]=useState<Service|null>(null),[services,setServices]=useState<Service[]>([]),[address,setAddress]=useState(''),[searching,setSearching]=useState(false),[searched,setSearched]=useState(false),[busy,setBusy]=useState(''),[error,setError]=useState('');
 useEffect(()=>{const c=new AbortController();api<Service>('/connection','GET',undefined,c.signal).then(setCurrent).catch(e=>{if(!c.signal.aborted)setError(e.message)});return()=>c.abort()},[]);
 useEffect(()=>{const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!busy)onClose()};window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape)},[onClose,busy]);
 async function search(){setSearching(true);setError('');try{const r=await api('/connection/search','POST',{});setServices(r.services);setSearched(true)}catch(e){setError((e as Error).message)}finally{setSearching(false)}}
 async function connect(endpoint:string){setBusy(endpoint);setError('');try{await api('/connection/select','POST',{address:endpoint});setActiveRole('personal',true);try{localStorage.setItem('zhijun-backend-change',String(Date.now()))}catch{}window.dispatchEvent(new Event('session-expired'));window.location.replace('/')}catch(e){setError((e as Error).message);setBusy('')}}
 return <div className="wanx-connection-overlay"><section ref={panel} onKeyDown={e=>{if(e.key!=='Tab')return;const nodes=Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]')||[]);const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}}} className="wanx-connection-panel" role="dialog" aria-modal="true" aria-labelledby="wanx-connection-title">
  <header><div><span className="eyebrow">属于你的知君</span><h2 id="wanx-connection-title">连接 万象WANX</h2></div><button aria-label="关闭连接设置" onClick={onClose} disabled={!!busy}><X size={20}/></button></header>
  <p className="wanx-connection-intro">找到保存你对话与记忆的服务，登录后进入自己的空间。</p>
  {current&&<div className="wanx-current"><Server size={20}/><div><small>当前服务</small><strong>{current.name.replace(/(?:万象)?WANX/g,'万象WANX')}</strong><span>{current.endpoint}</span></div></div>}
  <div className="wanx-search-heading"><h3><Radio size={18}/>局域网里的服务</h3><button onClick={search} disabled={searching||!!busy}><RefreshCw size={15}/>{searching?'正在搜索…':'搜索 万象WANX'}</button></div>
  <p className="wanx-connection-hint">搜索运行知君服务的电脑所在网络。设备需在同一局域网，并开启服务发现。</p>
  <div className="wanx-service-list" aria-live="polite">{services.map(s=><div className="wanx-service" key={s.endpoint}><div><strong>{s.name.replace(/(?:万象)?WANX/g,'万象WANX')}</strong><span>{s.endpoint}</span><small>{s.version&&`v${s.version} · `}{s.advertised?'已发现 万象WANX':'兼容服务，登录后检查'}{s.ontology?' · 支持本体接口':''}</small></div><button className="primary" disabled={!!busy} onClick={()=>connect(s.endpoint)}>{busy===s.endpoint?'连接中…':'选择并登录'}</button></div>)}{searched&&!services.length&&<p className="wanx-empty">暂未发现服务。请检查网络，或在下方输入地址。</p>}</div>
  <form onSubmit={e=>{e.preventDefault();void connect(address.trim())}}><label htmlFor="wanx-address">手动输入地址</label><div className="wanx-address-row"><input id="wanx-address" type="url" autoFocus placeholder="http://192.168.1.10:8088" value={address} onChange={e=>setAddress(e.target.value)} required disabled={!!busy}/><button disabled={!!busy||!address.trim()}>连接</button></div></form>
  <p className="wanx-connection-hint">选择后会退出当前会话，使用目标 万象WANX 的账号重新登录。HTTP 地址的登录信息仅通过局域网传输；支持时请使用 HTTPS。</p>
  {error&&<p className="notice" role="alert">{error}</p>}
 </section></div>
}
