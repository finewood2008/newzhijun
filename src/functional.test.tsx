import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {Chat} from './Chat';
import {Library} from './Library';
import {Settings} from './Settings';
import {api,streamApproval} from './api';
vi.mock('./api',async()=>({...await vi.importActual<typeof import('./api')>('./api'),api:vi.fn(),streamApproval:vi.fn()}));
const mocked=vi.mocked(api);
class MockSocket{
 static OPEN=1;static instances:MockSocket[]=[];
 readyState=1;onmessage:any;onclose:any;onerror:any;frames:any[]=[];failSend=false;
 constructor(public url:string){MockSocket.instances.push(this);}
 send(raw:string){if(this.failSend)throw Error('socket closed');this.frames.push(JSON.parse(raw));}
 close(){this.readyState=3;}
 frame(value:unknown){this.onmessage?.({data:JSON.stringify(value)});}
}
const history={messages:[{role:'assistant',content:'Mock 历史消息'}],has_more:false,next_offset:1,turn_active:false};
beforeEach(()=>{
 vi.clearAllMocks();MockSocket.instances=[];vi.stubGlobal('WebSocket',MockSocket);
 Element.prototype.scrollIntoView=vi.fn();
 mocked.mockImplementation(async p=>p.includes('/history')?history:p.startsWith('/ontology/context')?{claims:[]}:{} as any);
 vi.spyOn(window,'confirm').mockReturnValue(true);
});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();vi.useRealTimers();});
async function chat(){render(<Chat thread="mock-thread" onChanged={()=>{}}/>);await screen.findByText('Mock 历史消息');const ws=MockSocket.instances[0];act(()=>ws.frame({type:'ready'}));return ws;}
it('immediately displays an outgoing message and blocks duplicate sends while streaming',async()=>{
 const ws=await chat();fireEvent.change(screen.getByLabelText('和知君说说'),{target:{value:'新的 Mock 消息'}});
 fireEvent.click(screen.getByRole('button',{name:'发送'}));expect(screen.getByText('新的 Mock 消息')).toBeVisible();expect(screen.getByLabelText('和知君说说')).toHaveValue('');
 fireEvent.keyDown(screen.getByLabelText('和知君说说'),{key:'Enter'});expect(ws.frames.filter(f=>f.type==='user_turn')).toHaveLength(1);
 act(()=>{ws.frame({type:'token',content:'第一段',thread_id:'mock-thread'});ws.frame({type:'token',content:'第二段',thread_id:'mock-thread'});ws.frame({type:'done',thread_id:'mock-thread'});});
 expect(screen.getByText('第一段第二段')).toBeVisible();expect(screen.queryByText('知君正在回应…')).not.toBeInTheDocument();
});
it('restores a draft when the socket rejects sending synchronously',async()=>{
 const ws=await chat();ws.failSend=true;fireEvent.change(screen.getByLabelText('和知君说说'),{target:{value:'不能丢失的草稿'}});fireEvent.click(screen.getByRole('button',{name:'发送'}));
 expect(screen.getByLabelText('和知君说说')).toHaveValue('不能丢失的草稿');expect(screen.getByRole('alert')).toHaveTextContent('内容和附件已保留');
});
it('does not send on Shift Enter or input method composition, and ignores other threads',async()=>{
 const ws=await chat();fireEvent.change(screen.getByLabelText('和知君说说'),{target:{value:'中文输入'}});
 fireEvent.keyDown(screen.getByLabelText('和知君说说'),{key:'Enter',shiftKey:true});fireEvent.keyDown(screen.getByLabelText('和知君说说'),{key:'Enter',isComposing:true});
 expect(ws.frames.filter(f=>f.type==='user_turn')).toHaveLength(0);act(()=>ws.frame({type:'token',thread_id:'another-thread',content:'其他角色的内容'}));expect(screen.queryByText('其他角色的内容')).not.toBeInTheDocument();
});
it('cancels an active reply without resending the user message',async()=>{
 const ws=await chat();fireEvent.change(screen.getByLabelText('和知君说说'),{target:{value:'Mock 停止测试'}});fireEvent.click(screen.getByRole('button',{name:'发送'}));fireEvent.click(screen.getByRole('button',{name:'停止回复'}));
 expect(ws.frames.at(-1)).toEqual({type:'cancel',thread_id:'mock-thread'});expect(ws.frames.filter(f=>f.type==='user_turn')).toHaveLength(1);
});
it('reconnects and reconciles saved history without replaying a sent message',async()=>{
 const ws=await chat();fireEvent.change(screen.getByLabelText('和知君说说'),{target:{value:'只发送一次的 Mock 消息'}});fireEvent.click(screen.getByRole('button',{name:'发送'}));
 vi.useFakeTimers();act(()=>ws.onclose());expect(screen.getByRole('alert')).toHaveTextContent('不会重复发送');
 mocked.mockImplementation(async p=>p.includes('/history')?{...history,messages:[{role:'user',content:'只发送一次的 Mock 消息'},{role:'assistant',content:'服务器已保存的 Mock 回复'}]}:{claims:[]} as any);
 await act(async()=>{await vi.advanceTimersByTimeAsync(1600);});vi.useRealTimers();
 expect(MockSocket.instances).toHaveLength(2);act(()=>MockSocket.instances[1].frame({type:'ready'}));expect(await screen.findByText('服务器已保存的 Mock 回复')).toBeVisible();expect(ws.frames.filter(f=>f.type==='user_turn')).toHaveLength(1);expect(MockSocket.instances[1].frames.filter(f=>f.type==='user_turn')).toHaveLength(0);
});
it('loads an older page before current messages without altering the conversation',async()=>{
 mocked.mockImplementation(async p=>p.includes('offset=')?{...history,messages:[{role:'user',content:'更早的 Mock 对话'}]}:p.includes('/history')?{...history,has_more:true,next_cursor:'cursor1'}:{claims:[]} as any);
 await chat();fireEvent.click(screen.getByRole('button',{name:'更早的对话'}));expect(await screen.findByText('更早的 Mock 对话')).toBeVisible();expect(mocked).toHaveBeenCalledWith('/threads/mock-thread/history?offset=1&cursor=cursor1');expect(screen.getByText('Mock 历史消息')).toBeVisible();
});
it('handles malformed socket frames without crashing the conversation',async()=>{
 const ws=await chat();expect(()=>act(()=>ws.onmessage({data:'not-json'}))).not.toThrow();expect(screen.getByRole('alert')).toHaveTextContent('回复格式异常');
});
it('keeps sending disabled when history failed, until records are reconciled',async()=>{
 mocked.mockImplementation(async p=>{if(p.includes('/history'))throw Error('历史读取失败');return {claims:[]} as any;});render(<Chat thread="mock-thread" onChanged={()=>{}}/>);await screen.findByText('历史读取失败');
 act(()=>MockSocket.instances[0].frame({type:'ready'}));fireEvent.change(screen.getByLabelText('和知君说说'),{target:{value:'不应发送'}});expect(screen.getByRole('button',{name:'发送'})).toBeDisabled();
});
it('shows approval requests and sends a single explicit response',async()=>{
 const ws=await chat();vi.mocked(streamApproval).mockImplementation(async(_body,cb)=>{cb({type:'token',content:'已按补充继续'});cb({type:'done'});});
 act(()=>ws.frame({type:'hitl_required',request:{action_requests:[{name:'ask_user_question',args:{question:'Mock 问题'}}]}}));
 fireEvent.change(screen.getByLabelText('你的补充'),{target:{value:'Mock 补充'}});fireEvent.click(screen.getByRole('button',{name:'提交补充'}));await screen.findByText('已按补充继续');
 expect(streamApproval).toHaveBeenCalledWith({thread_id:'mock-thread',decisions:[{type:'respond',message:'Mock 补充'}]},expect.any(Function),expect.any(AbortSignal));
});
it('uploads multiple library files independently, retries only the failed item and previews safely',async()=>{
 let failed=true;const seen:string[]=[];
 mocked.mockImplementation(async(p,method,body)=>{
  if(p==='/libraries')return [{id:'mock-base',name:'Mock 私人库'}] as any;
  if(p.endsWith('/preview'))return {filename:'note.txt',text:'<script>Mock 文本</script>'} as any;
  if(p.endsWith('/documents')&&method==='POST'){const file=(body as FormData).get('upload') as File;seen.push(file.name);if(file.name==='fail.txt'&&failed)throw Error('Mock 上传失败');return {} as any;}
  return [{id:'d1',filename:'note.txt',status:'ready',byte_size:30}] as any;
 });
 const {container}=render(<Library/>);await screen.findByText('note.txt');const input=container.querySelector('input[type=file]')!;expect(input).toHaveAttribute('multiple');
 fireEvent.change(input,{target:{files:[new File(['a'],'ok.txt'),new File(['b'],'fail.txt'),new File(['c'],'later.txt')]}});
 await screen.findByText('本次上传 · 2/3 已上传');expect(seen).toEqual(['ok.txt','fail.txt','later.txt']);failed=false;fireEvent.click(screen.getByRole('button',{name:'重试上传'}));await screen.findByText('本次上传 · 3/3 已上传');expect(seen).toEqual(['ok.txt','fail.txt','later.txt','fail.txt']);
 fireEvent.click(screen.getByRole('button',{name:'阅读'}));expect(await screen.findByRole('dialog')).toHaveTextContent('<script>Mock 文本</script>');expect(container.querySelector('script')).toBeNull();
});
it('rejects one oversized document without blocking a valid upload',async()=>{
 const uploaded:string[]=[];mocked.mockImplementation(async(p,m,b)=>p==='/libraries'?[{id:'b',name:'Mock'}]:m==='POST'?(uploaded.push(((b as FormData).get('upload') as File).name),{}):[] as any);
 const {container}=render(<Library/>);await screen.findByRole('button',{name:'上传资料（可多选）'});
 const big=new File(['mock'],'large.txt');Object.defineProperty(big,'size',{value:33*1024*1024});fireEvent.change(container.querySelector('input[type=file]')!,{target:{files:[big,new File(['text'],'valid.txt')]}});
 await screen.findByText('本次上传 · 1/2 已上传');expect(uploaded).toEqual(['valid.txt']);expect(screen.getByRole('button',{name:'重试上传'})).toBeDisabled();
});
it('does not show a late preview from an unmounted library',async()=>{
 let finish!:(v:any)=>void;mocked.mockImplementation(async p=>p==='/libraries'?[{id:'b',name:'Mock'}]:p.endsWith('/preview')?new Promise(r=>{finish=r;}):[{id:'d1',filename:'Mock 文档',status:'ready',byte_size:2}] as any);
 const view=render(<Library/>);fireEvent.click(await screen.findByRole('button',{name:'阅读'}));view.unmount();await act(async()=>finish({filename:'Mock',text:'late'}));expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
const user={id:701,name:'Mock 用户',ready:true,reason:''};
it('finishes mock WeChat pairing, refreshes its status and toggles a channel',async()=>{
 let linked=false;mocked.mockImplementation(async(p,m)=>{if(p==='/wechat')return linked?[{id:'ch1',enabled:true,status:'connected'}]:[];if(p==='/wechat/qr')return {url:'https://example.invalid/mock-qr'};if(p==='/wechat/poll'){linked=true;return {status:'success'};}return {} as any;});
 render(<Settings user={user} roleName="个人" onUser={()=>{}} onLogout={()=>{}}/>);fireEvent.click(screen.getByRole('button',{name:'微信连接'}));fireEvent.click(await screen.findByRole('button',{name:'扫码连接微信'}));
 expect(await screen.findByRole('status')).toHaveTextContent('微信已连接');fireEvent.click(await screen.findByRole('button',{name:'暂停'}));await waitFor(()=>expect(mocked).toHaveBeenCalledWith('/wechat/ch1','PATCH',{enabled:false}));
});
it('reports expired mock WeChat codes and permits a new attempt',async()=>{
 mocked.mockImplementation(async p=>p==='/wechat'?[]:p==='/wechat/qr'?{url:'https://example.invalid/mock-qr'}:p==='/wechat/poll'?{status:'expired'}:{} as any);
 render(<Settings user={user} roleName="个人" onUser={()=>{}} onLogout={()=>{}}/>);fireEvent.click(screen.getByRole('button',{name:'微信连接'}));fireEvent.click(await screen.findByRole('button',{name:'扫码连接微信'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('重新获取二维码');expect(screen.getByRole('button',{name:'扫码连接微信'})).toBeEnabled();
});
it('shows account save failures, preserves the edited name, and never claims success',async()=>{
 mocked.mockRejectedValue(new Error('Mock 保存失败'));render(<Settings user={user} roleName="个人" onUser={()=>{}} onLogout={()=>{}}/>);fireEvent.change(screen.getByLabelText('怎么称呼你'),{target:{value:'新的 Mock 名称'}});fireEvent.click(screen.getByRole('button',{name:'保存称呼'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Mock 保存失败');expect(screen.getByLabelText('怎么称呼你')).toHaveValue('新的 Mock 名称');expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
it('a mock password update invalidates the client session only after success',async()=>{
 const logout=vi.fn();mocked.mockResolvedValue({ok:true});render(<Settings user={user} roleName="个人" onUser={()=>{}} onLogout={logout}/>);
 fireEvent.change(screen.getByLabelText('当前密码'),{target:{value:'mock-old'}});fireEvent.change(screen.getByLabelText('新密码'),{target:{value:'mock-new'}});fireEvent.click(screen.getByRole('button',{name:'更改密码并重新登录'}));
 await waitFor(()=>expect(logout).toHaveBeenCalledOnce());expect(mocked).toHaveBeenCalledWith('/password','POST',{old_password:'mock-old',new_password:'mock-new'});
});
