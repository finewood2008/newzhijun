import {beforeEach,expect,it,vi} from 'vitest';
import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {forwardRef,useEffect,useImperativeHandle} from 'react';
import App from './App';
import {Login} from './Login';
import {Settings} from './Settings';
import {api,setActiveRole} from './api';
vi.mock('./api',async()=>({...await vi.importActual<typeof import('./api')>('./api'),api:vi.fn()}));
vi.mock('./Chat',()=>({Chat:()=> <div>对话内容</div>}));
vi.mock('./Memory',()=>({Memory:()=> <div>原生记忆设置</div>}));
vi.mock('./Library',()=>({Library:()=> <div>资料内容</div>}));
vi.mock('./captcha/CaptchaField',()=>({default:forwardRef(function TestCaptcha({onReadyChange,resetKey}:any,ref){
  useImperativeHandle(ref,()=>({getToken:async()=> 'test-token'}));
  useEffect(()=>onReadyChange(false),[resetKey,onReadyChange]);
  return <button type="button" onClick={()=>onReadyChange(true)}>完成测试验证</button>;
})}));
const mocked=vi.mocked(api);
const user={id:8,name:'测试者',ready:true,reason:'',roles:[{id:'personal',name:'个人',description:'生活中的我'}]};
beforeEach(()=>{vi.resetAllMocks();localStorage.clear();setActiveRole('personal',true);mocked.mockImplementation(async path=>path==='/me'?user:path==='/threads'?[]:path==='/captcha'?{provider:'slider'}:{connected:true});});

it('only asks about experts when there are multiple, then enters the chosen space',async()=>{
 let selected=false;
 mocked.mockImplementation(async(path,method)=>{
  if(path==='/me')return selected?{...user,expertId:'second'}:{...user,ready:false,roles:[],expertChoices:[{id:'first',name:'知君'},{id:'second',name:'知君 · 人生上下文'}]};
  if(path==='/connection/agents'&&method==='POST'){selected=true;return {ok:true};}
  return path==='/threads'?[]:{connected:true};
 });
 render(<App/>);
 expect(await screen.findByRole('dialog',{name:'想连接哪一位知君？'})).toBeVisible();
 expect(mocked.mock.calls.some(([path])=>path==='/threads')).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:/知君 · 人生上下文/}));
 expect(await screen.findByRole('button',{name:'测试者，设置中心'})).toBeVisible();
 expect(mocked).toHaveBeenCalledWith('/connection/agents','POST',{agentId:'second'});
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('enters a single automatically matched expert with no expert picker',async()=>{
 render(<App/>);
 expect(await screen.findByRole('button',{name:'测试者，设置中心'})).toBeVisible();
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
 expect(screen.queryByText('选择我的知君实例')).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'连接服务，搜索或切换 万象WANX'})).not.toBeInTheDocument();
});

it('shows the new login and corner connection entry on a fresh desktop, with no legacy pairing screen',async()=>{
 mocked.mockImplementation(async path=>{
  if(path==='/me'){await Promise.resolve();window.dispatchEvent(new Event('session-expired'));throw new Error('请登录');}
  if(path==='/captcha')return {provider:'none',connectionRequired:true};
  if(path==='/connection')return {scope:'client-lan',selected:false};
  return {connected:false,needsConnection:true};
 });
 render(<App/>);
 expect(await screen.findByRole('form',{name:'登录知君'})).toBeVisible();
 expect(await screen.findByText('先在右下角“连接服务”中选择你的万象WANX，再登录。')).toBeVisible();
 expect(screen.getByRole('button',{name:'进入知君'})).toBeDisabled();
 expect(screen.queryByText('家里的知君')).not.toBeInTheDocument();
 expect(screen.queryByText('配对码')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'连接服务，搜索或切换 万象WANX'}));
 expect(await screen.findByText(/搜索这台电脑所在的局域网/)).toBeVisible();
 expect(screen.getByRole('button',{name:'搜索 万象WANX'})).toBeVisible();
 expect(screen.getByLabelText('手动输入地址')).toBeVisible();
});

it('keeps the login form hidden while restoring an existing session',async()=>{
  let finish!:(v:unknown)=>void;
  mocked.mockImplementation(async path=>path==='/me'?new Promise(resolve=>{finish=resolve;}):path==='/threads'?[]:{connected:true});
  render(<App/>);expect(screen.getByRole('status')).toHaveTextContent('正在回到');
  expect(screen.queryByRole('form',{name:'登录知君'})).not.toBeInTheDocument();
  await act(async()=>finish(user));expect(await screen.findByRole('button',{name:'测试者，设置中心'})).toBeVisible();
});
it('offers connection retry rather than login when session lookup fails offline',async()=>{
  let offline=true;
  mocked.mockImplementation(async path=>{if(path==='/me'){if(offline)throw new Error('网络中断');return user;}return path==='/threads'?[]:{connected:true};});
  render(<App/>);expect(await screen.findByRole('alert')).toHaveTextContent('网络中断');
  expect(screen.queryByLabelText('账号')).not.toBeInTheDocument();
  offline=false;fireEvent.click(screen.getByRole('button',{name:'重新连接'}));
  expect(await screen.findByRole('button',{name:'测试者，设置中心'})).toBeVisible();
});
it('opens settings through the avatar and clears private content on session expiry',async()=>{
  render(<App/>);fireEvent.click(await screen.findByRole('button',{name:'测试者，设置中心'}));
  expect(screen.queryByRole('button',{name:'设置'})).not.toBeInTheDocument();
  expect(screen.getByRole('heading',{name:'设置中心'})).toBeVisible();
  expect(screen.getAllByRole('button',{name:'当前角色：个人，切换或创建角色'})).toHaveLength(1);
  act(()=>window.dispatchEvent(new Event('session-expired')));
  expect(await screen.findByRole('form',{name:'登录知君'})).toBeVisible();
  expect(screen.queryByRole('button',{name:'测试者，设置中心'})).not.toBeInTheDocument();
});
it('separates account and role settings and saves an account name with feedback',async()=>{
  const refresh=vi.fn();render(<Settings user={user} roleName="工作" onUser={refresh} onLogout={()=>{}}/>);
  fireEvent.change(screen.getByLabelText('怎么称呼你'),{target:{value:'新的称呼'}});
  fireEvent.click(screen.getByRole('button',{name:'保存称呼'}));
  expect(await screen.findByRole('status')).toHaveTextContent('已保存');expect(mocked).toHaveBeenCalledWith('/account','PATCH',{name:'新的称呼'});
  expect(refresh).toHaveBeenCalledOnce();fireEvent.click(screen.getByRole('button',{name:'记忆整理'}));
  expect(screen.getByText('当前角色：工作')).toBeVisible();expect(screen.getByText('原生记忆设置')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'阅读偏好'}));expect(screen.queryByText('当前角色：工作')).not.toBeInTheDocument();
  fireEvent.click(within(screen.getByRole('group',{name:'对话字号'})).getByRole('button',{name:'字 更大'}));
  expect(localStorage.getItem('zhijun-reading-size')).toBe('21');expect(document.documentElement.style.getPropertyValue('--reading-size')).toBe('21px');
});
it('aborts pending WeChat connection polling when leaving its settings',async()=>{
  let signal:AbortSignal|undefined;
  mocked.mockImplementation(async(path,_method,_body,s)=>{if(path==='/wechat')return [];if(path==='/wechat/qr')return {url:'https://example.invalid/qr'};if(path==='/wechat/poll'){signal=s;return new Promise((_resolve,reject)=>s?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))));}return {};});
  render(<Settings user={user} roleName="个人" onUser={()=>{}} onLogout={()=>{}}/>);
  fireEvent.click(screen.getByRole('button',{name:'微信连接'}));fireEvent.click(await screen.findByRole('button',{name:'扫码连接微信'}));
  await waitFor(()=>expect(signal).toBeDefined());fireEvent.click(screen.getByRole('button',{name:'账户'}));
  await waitFor(()=>expect(signal?.aborted).toBe(true));expect(screen.queryByText('请使用微信扫描，并在手机上确认。')).not.toBeInTheDocument();
});
it('requires verification, prevents duplicate login, and passes the captcha token',async()=>{
  let finish!:(v:unknown)=>void;const success=vi.fn();
  mocked.mockImplementation(async path=>path==='/login'?new Promise(resolve=>{finish=resolve;}):{provider:'turnstile'});
  render(<Login onSuccess={success}/>);
  fireEvent.change(screen.getByLabelText('账号'),{target:{value:' test '}});fireEvent.change(screen.getByLabelText('密码'),{target:{value:'test-password'}});
  expect(screen.getByRole('button',{name:'进入知君'})).toBeDisabled();
  fireEvent.click(await screen.findByRole('button',{name:'完成测试验证'}));
  fireEvent.submit(screen.getByRole('form',{name:'登录知君'}));fireEvent.submit(screen.getByRole('form',{name:'登录知君'}));
  await waitFor(()=>expect(finish).toBeDefined());expect(mocked.mock.calls.filter(c=>c[0]==='/login')).toHaveLength(1);
  expect(mocked).toHaveBeenCalledWith('/login','POST',{username:'test',password:'test-password',captcha_token:'test-token'});
  await act(async()=>finish({}));expect(success).toHaveBeenCalledOnce();expect(screen.getByLabelText('密码')).toHaveValue('');
});
it('resets verification after a rejected login and can retry loading verification offline',async()=>{
  let online=false;
  mocked.mockImplementation(async path=>{if(path==='/captcha'){if(!online)throw new Error('暂时离线');return {provider:'turnstile'};}throw new Error('账号或密码有误');});
  render(<Login onSuccess={()=>{}}/>);await screen.findByText('暂时离线');online=true;
  fireEvent.click(screen.getByRole('button',{name:'重新连接'}));fireEvent.click(await screen.findByRole('button',{name:'完成测试验证'}));
  fireEvent.change(screen.getByLabelText('账号'),{target:{value:'test'}});fireEvent.change(screen.getByLabelText('密码'),{target:{value:'wrong'}});
  fireEvent.click(screen.getByRole('button',{name:'进入知君'}));expect(await screen.findByRole('alert')).toHaveTextContent('账号或密码有误');
  expect(screen.getByRole('button',{name:'进入知君'})).toBeDisabled();
});

it('logs in without the local slider and permits retry after a wrong password',async()=>{
  let reject=true;const success=vi.fn();
  mocked.mockImplementation(async path=>{if(path==='/captcha')return {provider:'slider'};if(path==='/login'){if(reject)throw new Error('账号或密码有误');return {ok:true}}return {name:'WANX',endpoint:'http://192.168.1.10:8088'}});
  render(<Login onSuccess={success}/>);
  fireEvent.change(screen.getByLabelText('账号'),{target:{value:'test'}});fireEvent.change(screen.getByLabelText('密码'),{target:{value:'password'}});
  await waitFor(()=>expect(screen.getByRole('button',{name:'进入知君'})).toBeEnabled());expect(screen.queryByRole('button',{name:'完成测试验证'})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'进入知君'}));expect(await screen.findByRole('alert')).toHaveTextContent('账号或密码有误');expect(screen.getByRole('button',{name:'进入知君'})).toBeEnabled();
  reject=false;fireEvent.click(screen.getByRole('button',{name:'进入知君'}));await waitFor(()=>expect(success).toHaveBeenCalledOnce());
  expect(mocked).toHaveBeenCalledWith('/login','POST',{username:'test',password:'password',captcha_token:undefined});
});

it('refreshes incoming channel conversations on focus without changing the open conversation',async()=>{
 let rows=[{thread_id:'web',title:'已有对话'}];
 mocked.mockImplementation(async path=>path==='/me'?user:path==='/threads'?rows:{connected:true});
 render(<App/>);fireEvent.click(await screen.findByRole('button',{name:'已有对话'}));
 expect(await screen.findByText('对话内容')).toBeVisible();
 rows=[{thread_id:'wx',title:'微信新消息'},...rows];
 fireEvent(window,new Event('focus'));
 expect(await screen.findByRole('button',{name:'微信新消息'})).toBeVisible();
 expect(screen.getByText('对话内容')).toBeVisible();
});

it('polls visible conversation lists and stops polling when unmounted',async()=>{
 const {unmount}=render(<App/>);await screen.findByRole('button',{name:'测试者，设置中心'});
 vi.useFakeTimers();
 // Remount while fake timers are active so the recurring timers are controlled.
 unmount();const mounted=render(<App/>);
 try{
  await act(async()=>{await Promise.resolve();await Promise.resolve();});
  const before=mocked.mock.calls.filter(([p])=>p==='/threads').length;
  await act(async()=>{await vi.advanceTimersByTimeAsync(5001);});
  expect(mocked.mock.calls.filter(([p])=>p==='/threads').length).toBeGreaterThan(before);
  mounted.unmount();const after=mocked.mock.calls.length;
  await act(async()=>{await vi.advanceTimersByTimeAsync(10000);});
  expect(mocked.mock.calls.length).toBe(after);
 }finally{vi.useRealTimers();}
});

it('discards a late personal refresh after switching to work',async()=>{
 let delayed=false,finish:(value:unknown)=>void=()=>{};
 const both={...user,roles:[...user.roles,{id:'work',name:'工作',description:'工作语境'}]};
 const {getActiveRole}=await import('./api');
 mocked.mockImplementation(async path=>{
  if(path==='/me')return both;
  if(path==='/threads'){
   if(getActiveRole()==='work')return [{thread_id:'work-thread',title:'工作微信会话'}];
   if(delayed)return new Promise(resolve=>{finish=resolve;});
   return [{thread_id:'personal-thread',title:'个人会话'}];
  }
  return {connected:true};
 });
 render(<App/>);await screen.findByRole('button',{name:'个人会话'});
 delayed=true;fireEvent(window,new Event('focus'));
 fireEvent.click(screen.getByRole('button',{name:'当前角色：个人，切换或创建角色'}));
 fireEvent.click(within(screen.getByRole('dialog',{name:'我的角色'})).getByRole('button',{name:/工作语境/}));
 await screen.findByRole('button',{name:'工作微信会话'});
 await act(async()=>finish([{thread_id:'late',title:'迟到的个人微信'}]));
 expect(screen.queryByRole('button',{name:'迟到的个人微信'})).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'工作微信会话'})).toBeVisible();
});

it('shows channel provenance in the history list and active conversation',async()=>{
 mocked.mockImplementation(async path=>path==='/me'?user:path==='/threads'?[{thread_id:'wx',title:'来自手机',channel_type:'weixin'},{thread_id:'web',title:'本机交流',channel_type:'dashboard'}]:{connected:true});
 render(<App/>);
 const wx=await screen.findByRole('button',{name:'来自手机'});
 expect(screen.getByRole('button',{name:'本机交流'})).toBeVisible();
 fireEvent.click(wx);
 expect(screen.getAllByTitle('对话来源：微信')).toHaveLength(2);
});
it('loads existing care preference without writing, then saves a selected level',async()=>{
 const config={enabled:true,active_hours_start:'09:00',active_hours_end:'22:00',min_interval_hours:5,max_interval_hours:24};
 mocked.mockImplementation(async(path,method)=>path==='/wechat'?[]:path==='/wechat/care'?method==='PUT'?{...config,min_interval_hours:48,max_interval_hours:72}:config:{});
 render(<Settings user={user} roleName="工作" onUser={()=>{}} onLogout={()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:'微信连接'}));
 expect(await screen.findByText(/沿用现有设置/)).toBeVisible();
 expect(mocked.mock.calls.some(([,method])=>method==='PUT')).toBe(false);
 fireEvent.click(screen.getByRole('radio',{name:/偶尔关心/}));
 fireEvent.click(screen.getByRole('button',{name:'保存联系偏好'}));
 expect(await screen.findByText('已保存，当前角色的主动关心安排已更新。')).toBeVisible();
 expect(mocked).toHaveBeenCalledWith('/wechat/care','PUT',{level:'gentle',start:'09:00',end:'22:00'});
});
