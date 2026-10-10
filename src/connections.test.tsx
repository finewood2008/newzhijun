import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {Connections} from './Connections';
import {api} from './api';
vi.mock('./api',()=>({api:vi.fn(),setActiveRole:vi.fn()}));
const mocked=vi.mocked(api);
afterEach(()=>{cleanup();vi.resetAllMocks()});
describe('WANX connection selection',()=>{
 it('lists discovered services without sending credentials or automatically selecting one',async()=>{
  mocked.mockImplementation(async path=>path==='/connection'?{name:'Current',endpoint:'http://192.168.1.10:8088'}:{services:[{name:'Home WANX',endpoint:'http://192.168.1.20:8088',advertised:true}]});
  render(<Connections onClose={()=>{}}/>);fireEvent.click(screen.getByRole('button',{name:'搜索 万象WANX'}));
  expect(await screen.findByText('Home 万象WANX')).toBeVisible();expect(screen.getByRole('button',{name:'选择并登录'})).toBeEnabled();
  expect(mocked.mock.calls.some(([path])=>path==='/connection/select'||path==='/login')).toBe(false);
 });
 it('retains the manually entered address after a failed connection',async()=>{
  mocked.mockImplementation(async path=>{if(path==='/connection/select')throw new Error('服务不可用');return {name:'Current',endpoint:'http://192.168.1.10:8088'}});
  render(<Connections onClose={()=>{}}/>);fireEvent.change(screen.getByLabelText('手动输入地址'),{target:{value:'http://192.168.1.30:8088'}});fireEvent.click(screen.getByRole('button',{name:'连接'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('服务不可用');expect(screen.getByLabelText('手动输入地址')).toHaveValue('http://192.168.1.30:8088');
 });
});

it('connection settings only choose the service, never ask the user to select an expert',async()=>{
 mocked.mockResolvedValue({name:'Box',endpoint:'http://192.168.1.10:8088'});
 render(<Connections onClose={()=>{}}/>);
 expect(await screen.findByText('Box')).toBeVisible();
 expect(screen.queryByText('选择知君专家')).not.toBeInTheDocument();
 expect(mocked.mock.calls.some(([path])=>path==='/connection/agents')).toBe(false);
});
