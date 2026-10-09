import {beforeEach,describe,it,expect,vi} from 'vitest';import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';import {useReferenceFiles} from './useReferenceFiles';import {Chat} from './Chat';import {api} from './api';
vi.mock('./api',async()=>{const actual=await vi.importActual<typeof import('./api')>('./api');return {...actual,api:vi.fn()}});
const mocked=vi.mocked(api);
function Harness(){const r=useReferenceFiles('t1');return <><input aria-label="files" type="file" multiple onChange={e=>r.choose(e.target.files!)}/>{r.items.map(x=><div key={x.key}>{x.filename}:{x.state}<button onClick={()=>r.remove(x.key)}>remove {x.filename}</button></div>)}<span>{r.error}</span><button disabled={r.blocked}>send</button></>}
beforeEach(()=>{vi.clearAllMocks();Element.prototype.scrollIntoView=vi.fn()});
describe('current-conversation references',()=>{
 it('keeps successful files when another file fails and requires failed references to be removed',async()=>{
  mocked.mockImplementation(async path=>{if(path.includes('attachments')&&mocked.mock.calls.filter(c=>c[0].includes('attachments')).length===1)return {id:'opaque',status:'ready'};throw new Error('upload failed')});
  render(<Harness/>);fireEvent.change(screen.getByLabelText('files'),{target:{files:[new File(['one'],'a.txt'),new File(['two'],'b.txt')]}});
  await screen.findByText('b.txt:failed');expect(screen.getByText('a.txt:ready')).toBeVisible();expect(screen.getByRole('button',{name:'send'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'remove b.txt'}));expect(screen.getByRole('button',{name:'send'})).toBeEnabled();
 });
 it('rejects oversized and over-count selections before sending any upload',()=>{
  render(<Harness/>);const large=new File(['x'],'large.txt');Object.defineProperty(large,'size',{value:10*1024*1024+1});fireEvent.change(screen.getByLabelText('files'),{target:{files:[large]}});expect(screen.getByText(/10 MB/)).toBeVisible();fireEvent.change(screen.getByLabelText('files'),{target:{files:Array.from({length:9},(_,i)=>new File(['x'],`${i}.txt`))}});expect(screen.getByText(/最多参考 8/)).toBeVisible();expect(mocked).not.toHaveBeenCalled();
 });
 it('reports unreadable extraction separately from ready-to-reference files',async()=>{
  mocked.mockResolvedValue({id:null,status:'unsupported'});render(<Harness/>);fireEvent.change(screen.getByLabelText('files'),{target:{files:[new File(['x'],'scan.pdf')]}});await screen.findByText('scan.pdf:failed');expect(screen.getByRole('button',{name:'send'})).toBeDisabled();
 });
 it('echoes an outgoing reference immediately and restores draft plus reference on immediate send failure',async()=>{
  const sockets:any[]=[];class Socket{static OPEN=1;readyState=1;onmessage:any;onclose:any;onerror:any;send=vi.fn((body:string)=>{if(JSON.parse(body).type==='user_turn')throw new Error('offline')});close=vi.fn();constructor(){sockets.push(this)}}
  vi.stubGlobal('WebSocket',Socket);mocked.mockImplementation(async path=>path.endsWith('/history')?{messages:[],has_more:false,next_offset:0}:path.endsWith('/attachments')?{id:'opaque',status:'ready'}:{});
  const view=render(<Chat thread="t1" onChanged={()=>{}}/>);await waitFor(()=>expect(screen.queryByText('正在读取这段对话…')).not.toBeInTheDocument());await act(async()=>{sockets[0].onmessage({data:JSON.stringify({type:'ready'})})});
  fireEvent.change(view.container.querySelector('input[type="file"]')!,{target:{files:[new File(['reference'],'note.txt')]}});await screen.findByText('已就绪 · 仅本对话');fireEvent.change(screen.getByRole('textbox',{name:'和知君说说'}),{target:{value:'请参考附件'}});fireEvent.click(screen.getByRole('button',{name:'发送'}));
  expect(screen.getByRole('textbox',{name:'和知君说说'})).toHaveValue('请参考附件');expect(screen.getByText('note.txt')).toBeVisible();expect(screen.getByText('未能发送，内容和附件已保留。')).toBeVisible();
  const turn=sockets[0].send.mock.calls.map((c:any)=>JSON.parse(c[0])).find((f:any)=>f.type==='user_turn');expect(turn.attachment_ids).toEqual(['opaque']);expect(turn.messages).toBeUndefined();view.unmount();vi.unstubAllGlobals();
 });
});
