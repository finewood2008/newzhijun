import {OntologyContext} from './OntologyContext';
import {useReferenceFiles} from './useReferenceFiles';
import {useEffect,useRef,useState} from 'react';
import {ArrowUp,Square,RefreshCw,Paperclip,X,FileText} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {api,textContent,streamApproval,getActiveRole} from './api';
type Message={role:string;content:unknown;inbound_attachments?:{filename:string;media_type?:string}[]};
export function Chat({thread,onChanged}:{thread:string;onChanged:()=>void}){
 const [contextRevision,setContextRevision]=useState(0);
 const references=useReferenceFiles(thread),referenceInput=useRef<HTMLInputElement>(null);
 const [messages,setMessages]=useState<Message[]>([]),[draft,setDraft]=useState(''),[busy,setBusy]=useState(false),[ready,setReady]=useState(false),[error,setError]=useState(''),[pending,setPending]=useState<any>(null),[reply,setReply]=useState(''),[more,setMore]=useState(false),[loading,setLoading]=useState(true),[revision,setRevision]=useState(0);
 const wsRef=useRef<WebSocket|null>(null),bottom=useRef<HTMLDivElement>(null),streaming=useRef(false),hasToken=useRef(false),cursor=useRef<string|null>(null),count=useRef(0),approval=useRef<AbortController|null>(null),busyRef=useRef(false),current=useRef(thread),reconnectAttempt=useRef(0),retryTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 current.current=thread;
 function apply(f:any){
  if(f.thread_id&&f.thread_id!==thread)return;
  if(f.type==='token'){if(!hasToken.current){hasToken.current=true;setMessages(m=>[...m,{role:'assistant',content:String(f.content||'')}]);}else setMessages(m=>m.map((v,i)=>i===m.length-1?{...v,content:textContent(v.content)+String(f.content||'')}:v));}
  if(f.type==='hitl_required'){setPending(f.request);setBusy(false);busyRef.current=false;streaming.current=false;}
  if(f.type==='error'){setError(f.message||'回复暂时未能完成，请刷新记录确认发送结果。');setBusy(false);busyRef.current=false;streaming.current=false;}
  if(f.type==='done'){setContextRevision(n=>n+1);setBusy(false);busyRef.current=false;streaming.current=false;hasToken.current=false;onChanged();}
  if(f.type==='turn_status'){setBusy(!!f.active);busyRef.current=!!f.active;streaming.current=!!f.active;}
 }
 useEffect(()=>{
  let alive=true;const abort=new AbortController();let retry:ReturnType<typeof setTimeout>;
  setError('');setPending(null);setReady(false);setBusy(false);busyRef.current=false;setLoading(true);hasToken.current=false;streaming.current=false;
  const socket=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/api/chat?role=${encodeURIComponent(getActiveRole())}`);wsRef.current=socket;
  let socketReady=false,historyReady=false;
  const subscribe=()=>{if(socketReady&&historyReady)socket.send(JSON.stringify({type:'subscribe',thread_id:thread}));};
  async function history(){try{const h=await api('/threads/'+encodeURIComponent(thread)+'/history','GET',undefined,abort.signal);if(!alive)return;if(h.history_loading){retry=setTimeout(history,1500);return;}setMessages(h.messages);setMore(h.has_more);cursor.current=h.next_cursor;count.current=h.next_offset;setPending(h.hitl_pending?.request||h.hitl_pending);setBusy(h.turn_active);busyRef.current=!!h.turn_active;streaming.current=!!h.turn_active;hasToken.current=!!h.turn_active&&h.messages.at(-1)?.role==='assistant';setLoading(false);historyReady=true;subscribe();}catch(e){if(alive){setLoading(false);setError((e as Error).message);}}}
  void history();
  socket.onmessage=e=>{if(!alive)return;const f=JSON.parse(e.data);if(f.type==='ready'){socketReady=true;reconnectAttempt.current=0;setReady(true);subscribe();}else apply(f);};
  socket.onclose=()=>{if(alive){setReady(false);setBusy(false);busyRef.current=false;setError('连接已断开，正在自动重连。恢复后会核对已保存记录，不会重复发送。');const delay=Math.min(30000,1000*2**Math.min(reconnectAttempt.current++,5))+Math.random()*500;retryTimer.current=setTimeout(()=>{if(alive)setRevision(x=>x+1)},delay);}};
  socket.onerror=()=>{if(alive)setError('暂时连接不上对话服务。');};
  const online=()=>{if(alive)setRevision(x=>x+1)};window.addEventListener('online',online);return()=>{alive=false;if(retryTimer.current)clearTimeout(retryTimer.current);window.removeEventListener('online',online);abort.abort();clearTimeout(retry);approval.current?.abort();socket.close();wsRef.current=null;};
 },[thread,revision]);
 useEffect(()=>{bottom.current?.scrollIntoView({behavior:'smooth',block:'end'});},[messages,busy,pending]);
 async function older(){const captured=thread;try{const h=await api(`/threads/${thread}/history?offset=${count.current}${cursor.current?'&cursor='+encodeURIComponent(cursor.current):''}`);if(current.current!==captured)return;setMessages(m=>[...h.messages,...m]);setMore(h.has_more);cursor.current=h.next_cursor;count.current=h.next_offset;}catch(e){setError((e as Error).message);}}
 function send(){
  const text=draft.trim(),selected=references.items.filter(a=>a.state==='ready');
  if((!text&&!selected.length)||references.blocked||busyRef.current||!ready||loading||pending)return;
  const socket=wsRef.current;if(socket?.readyState!==WebSocket.OPEN)return;
  const oldItems=references.items;
  busyRef.current=true;streaming.current=true;hasToken.current=false;setBusy(true);setError('');
  setMessages(m=>[...m,{role:'user',content:text||'请参考这些附件。',inbound_attachments:selected.map(a=>({filename:a.filename}))}]);setDraft('');references.clear();
  try{socket.send(JSON.stringify({type:'user_turn',text,thread_id:thread,...(selected.length?{attachment_ids:selected.map(a=>a.id)}:{})}));}
  catch{setDraft(text);references.restore(oldItems);setMessages(m=>m.slice(0,-1));setBusy(false);busyRef.current=false;setError('未能发送，内容和附件已保留。');}
 }

 async function decide(type:'approve'|'reject'|'respond'){
  const actions=pending?.action_requests||[];if(!actions.length)return;
  const a=new AbortController();approval.current=a;const captured=thread;
  setBusy(true);busyRef.current=true;hasToken.current=false;setError('');
  try{await streamApproval({thread_id:thread,decisions:actions.map(()=>({type,...(type==='respond'?{message:reply}:{})}))},f=>{if(current.current===captured){setPending(null);apply(f);}},a.signal);}catch(e){if(!a.signal.aborted)setError((e as Error).message);}finally{if(current.current===captured){setBusy(false);busyRef.current=false;}}
 }
 const actions=pending?.action_requests||[];const asks=actions.some((x:any)=>x.name==='ask_user_question');
 return <div className="chat"><div className="messages" aria-live="polite">{loading?<p className="quiet">正在读取这段对话…</p>:messages.length===0?<div className="conversation-start"><span className="seal">知</span><h2>这一刻，你想说些什么？</h2><p>从一句话开始，不必想好怎么说。</p></div>:null}{more&&<button className="text-button" onClick={older}>更早的对话</button>}{messages.map((m,i)=><article key={i} className={'message '+m.role}><span className="speaker">{m.role==='user'?'我':'知君'}</span><div><ReactMarkdown remarkPlugins={[remarkGfm]}>{textContent(m.content)}</ReactMarkdown>{!!m.inbound_attachments?.length&&<div className="message-attachments">{m.inbound_attachments.map((a,i)=><span key={i}><FileText size={14}/>{a.filename}</span>)}</div>}</div></article>)}{busy&&<p className="quiet breathe">知君正在回应…</p>}{pending&&<section className="approval"><h3>这一步需要你确认</h3>{actions.map((a:any,i:number)=><details key={i} open><summary>{a.name==='ask_user_question'?'知君想进一步了解':a.name}</summary><pre>{JSON.stringify(a.args,null,2)}</pre></details>)}{asks?<><textarea aria-label="你的补充" value={reply} onChange={e=>setReply(e.target.value)}/><button disabled={busy||!reply.trim()} onClick={()=>decide('respond')}>提交补充</button></>:<button disabled={busy||!actions.length} onClick={()=>decide('approve')}>同意本次操作</button>}<button disabled={busy||!actions.length} onClick={()=>decide('reject')}>拒绝</button></section>}{error&&<div className="notice" role="alert">{error}<button onClick={()=>setRevision(x=>x+1)}><RefreshCw size={14}/>刷新记录并重连</button></div>}<OntologyContext thread={thread} revision={contextRevision}/><div ref={bottom}/></div><div className="composer">{references.error&&<p className="notice" role="alert">{references.error}</p>}{references.items.length>0&&<div className="reference-files" aria-label="本次参考附件">{references.items.map(item=><div className={'reference-file '+item.state} key={item.key}><FileText size={17}/><div><strong>{item.filename}</strong><small>{item.state==='uploading'?'正在整理…':item.state==='ready'?(item.truncated?'已就绪 · 部分内容参考':'已就绪 · 仅本对话'):item.error}</small></div>{item.state==='failed'&&<button disabled={references.uploading} onClick={()=>references.retry(item)}>重试</button>}<button aria-label={'移除附件 '+item.filename} onClick={()=>references.remove(item.key)}><X size={15}/></button></div>)}</div>}<textarea aria-label="和知君说说" placeholder="慢慢说，我在听。" value={draft} maxLength={32000} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();send();}}}/><div className="composer-bottom"><button className="attach-button" aria-label="添加参考附件" title="仅用于当前对话；单个最多 10 MB，每次最多 8 个" disabled={busy||references.uploading} onClick={()=>referenceInput.current?.click()}><Paperclip size={18}/><span>附件</span></button><input ref={referenceInput} type="file" hidden multiple onChange={e=>{if(e.target.files)references.choose(e.target.files);e.target.value='';}}/><span>{ready?'Enter 发送 · Shift + Enter 换行':'连接中'}</span>{busy?<button className="send" aria-label="停止回复" onClick={()=>wsRef.current?.send(JSON.stringify({type:'cancel',thread_id:thread}))}><Square size={15}/></button>:<button className="send" aria-label="发送" disabled={!ready||loading||(!draft.trim()&&!references.items.some(a=>a.state==='ready'))||references.blocked||!!pending} onClick={send}><ArrowUp size={21}/></button>}</div></div><p className="footnote">默认参考知识库 · 附件仅用于这段对话 · 理解可以被修正</p></div>;
}
