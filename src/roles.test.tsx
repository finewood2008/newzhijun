import {beforeEach, describe, it, expect, vi} from 'vitest';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {api, getActiveRole, setActiveRole, roleRequestOptions} from './api';
import {Roles} from './Roles';
import App from './App';
vi.mock('./api',async()=>{const actual=await vi.importActual<typeof import('./api')>('./api');return {...actual,api:vi.fn()};});
vi.mock('./Chat',()=>({Chat:()=> <div>chat content</div>}));
vi.mock('./Memory',()=>({Memory:()=> <div>memory content</div>}));
vi.mock('./Library',()=>({Library:()=> <div>library content</div>}));
vi.mock('./Settings',()=>({Settings:()=> <div>settings content</div>}));
const roles=[{id:'personal',name:'个人',description:'生活中的我'},{id:'work',name:'工作',description:'工作中的我'}];
const mocked=vi.mocked(api);
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();setActiveRole('personal',true);});
describe('independent personal roles',()=>{
 it('aborts earlier role requests and pins each request header to its originating role',()=>{
  const personal=roleRequestOptions();setActiveRole('work');const work=roleRequestOptions();
  expect(personal.signal?.aborted).toBe(true);expect(work.signal?.aborted).toBe(false);
  expect(new Headers(personal.headers).get('X-Zhijun-Role')).toBe('personal');
  expect(new Headers(work.headers).get('X-Zhijun-Role')).toBe('work');
 });
 it('collects a role definition and keeps the same idempotency key when creation is retried',async()=>{
  const create=vi.fn().mockRejectedValue(new Error('暂时离线'));
  render(<Roles roles={roles} activeId="personal" canCreate onSelect={()=>{}} onCreate={create} onClose={()=>{}}/>);
  fireEvent.click(screen.getByRole('button',{name:'创建新的角色'}));
  fireEvent.change(screen.getByLabelText('角色名称'),{target:{value:'创作者'}});
  fireEvent.change(screen.getByLabelText('这个角色里的你'),{target:{value:'用写作整理想法。'}});
  fireEvent.click(screen.getByRole('button',{name:'创建并进入'}));await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button',{name:'创建并进入'}));await waitFor(()=>expect(create).toHaveBeenCalledTimes(2));
  expect(create.mock.calls[0].slice(0,2)).toEqual(['创作者','用写作整理想法。']);expect(create.mock.calls[0][2]).toBe(create.mock.calls[1][2]);
 });
 it('clears the old history when switching and ignores a late response from the earlier role',async()=>{
  let finishPersonal!:(value:unknown)=>void;
  mocked.mockImplementation(async(path)=>{
   if(path==='/me')return {id:4,name:'测试者',ready:true,roles,canCreateRoles:true};
   if(path==='/status')return {connected:true,version:'test'};
   if(path==='/threads'&&getActiveRole()==='personal')return new Promise(resolve=>{finishPersonal=resolve;});
   if(path==='/threads')return [{thread_id:'work-thread',title:'工作中的对话'}];
   return {};
  });
  render(<App/>);await screen.findByRole('button',{name:'当前角色：个人，切换或创建角色'});
  await waitFor(()=>expect(finishPersonal).toBeTypeOf('function'));
  fireEvent.click(screen.getByRole('button',{name:'当前角色：个人，切换或创建角色'}));
  fireEvent.click(screen.getByRole('button',{name:/工作 工作中的我/}));
  await screen.findByRole('button',{name:'工作中的对话'});
  await act(async()=>finishPersonal([{thread_id:'private-thread',title:'个人空间里的旧对话'}]));
  expect(screen.queryByText('个人空间里的旧对话')).not.toBeInTheDocument();
  expect(localStorage.getItem('zhijun-role-4')).toBe('work');
  expect(screen.getByRole('button',{name:'当前角色：工作，切换或创建角色'})).toBeVisible();
 });
});
