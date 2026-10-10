import {useEffect, useRef, useState} from 'react';
import {ArrowRight, RefreshCw} from 'lucide-react';
import CaptchaField, {CaptchaFieldHandle} from './captcha/CaptchaField';
import type {PublicCaptchaConfig} from './captcha/captchaAdapters';
import {api} from './api';
import artwork from './assets/zhijun-login-companion.png';

export function Login({onSuccess}:{onSuccess:()=>void}) {
  const [server,setServer]=useState<{name:string;endpoint:string}|null>(null);
  useEffect(()=>{const c=new AbortController();api('/connection','GET',undefined,c.signal).then(setServer).catch(()=>{});return()=>c.abort()},[]);
  const [username,setUsername]=useState(''), [password,setPassword]=useState('');
  const [captcha,setCaptcha]=useState<(PublicCaptchaConfig&{connectionRequired?:boolean})|null>(null);
  const [ready,setReady]=useState(false), [busy,setBusy]=useState(false);
  const [error,setError]=useState(''), [reset,setReset]=useState(0), [attempt,setAttempt]=useState(0);
  const [loading,setLoading]=useState(true);
  const field=useRef<CaptchaFieldHandle>(null);
  const submitting=useRef(false);
  useEffect(()=>{
    const controller=new AbortController();
    setLoading(true);setError('');setCaptcha(null);setReady(false);
    api<PublicCaptchaConfig&{connectionRequired?:boolean}>('/captcha','GET',undefined,controller.signal)
      .then(config=>{setCaptcha(config);if(!config.connectionRequired&&(config.provider==='slider'||config.provider==='none'))setReady(true)}).catch(e=>{if(!controller.signal.aborted)setError(e.message);})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[attempt]);
  return <main className="login-page">
    <section className="login-content">
      <div className="brand login-brand"><span className="seal">知</span><div><strong>知君</strong><small>CONTEXT OF ME</small></div></div>
      <div className="login-form-wrap">
        <span className="eyebrow">A PLACE TO BE YOURSELF</span>
        <h1>高山流水，<br/>有处可说。</h1>
        <p className="login-intro">回来，就从这里开始。<br/>那些还没理清的念头，我们慢慢聊。</p>
        <form aria-label="登录知君" onSubmit={async e=>{
          e.preventDefault();if(submitting.current||!ready||!username.trim()||!password)return;
          submitting.current=true;setBusy(true);setError('');
          try {
            const token=captcha?.provider==='slider'||captcha?.provider==='none'?undefined:await field.current?.getToken();
            await api('/login','POST',{username:username.trim(),password,captcha_token:token});
            setPassword('');onSuccess();
          } catch(e) {setError((e as Error).message);setReset(x=>x+1);setReady(captcha?.provider==='slider'||captcha?.provider==='none');}
          finally {submitting.current=false;setBusy(false);}
        }}>
          <label>账号<input autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)} placeholder="你的账号" required disabled={busy}/></label>
          <label>密码<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="输入密码" required disabled={busy}/></label>
          <div className={'login-verification'+(!loading&&captcha&&(captcha.provider==='slider'||captcha.provider==='none')?' is-empty':'')}>
            {loading&&<p className="quiet" role="status">正在准备登录验证…</p>}
            {captcha&&captcha.provider!=='slider'&&captcha.provider!=='none'&&<CaptchaField ref={field} config={captcha} resetKey={reset} slideHint="向右滑动，完成验证" slideVerifiedLabel="已完成验证" unsupportedLabel="当前登录验证暂不受支持，请联系服务管理员。" onReadyChange={setReady}/>}
            {!loading&&!captcha&&<button type="button" onClick={()=>setAttempt(x=>x+1)}><RefreshCw size={15}/>重新连接</button>}
          </div>
          {error&&<p className="notice" role="alert">{error}</p>}
          {captcha?.connectionRequired&&<p className="quiet">先在右下角“连接服务”中选择你的万象WANX，再登录。</p>}
          <button className="primary login-submit" disabled={busy||!ready||!username.trim()||!password}>{busy?'正在登录…':'进入知君'}<ArrowRight size={17}/></button>
        </form>
        <p className="login-privacy">属于你的对话，留在你的私人空间。</p>
      </div>
      <footer className="login-footer"><div>知己与导师 <span>始终由你定义自己</span></div>{server?.endpoint&&<small className="login-server-note" title={server.endpoint}>连接至 {server.name.replace(/(?:万象)?WANX/g,'万象WANX')}</small>}</footer>
    </section>
    <div className="login-art"><img src={artwork} alt="高山流水间，伯牙抚琴，子期静听"/><div className="login-art-caption"><span>相知，在一言一语之间。</span><small>有处可说 · 有迹可循</small></div></div>
  </main>;
}
