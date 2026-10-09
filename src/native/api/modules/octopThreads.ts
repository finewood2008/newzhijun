import {request} from '../request';
export const CHAT_HISTORY_PAGE_SIZE=50;
export interface OctopThread{thread_id:string;title:string|null;channel_type:string;last_active:number;created_at:number;}
export const octopThreadsApi={
 list:(_aid:string,_limit?:number)=>request<OctopThread[]>('/threads'),
 history:(_aid:string,tid:string,opts:{limit?:number;offset?:number}={})=>request<{messages:Array<{role:string;content:unknown;id?:string;timestamp?:number}>;has_more?:boolean}>(`/threads/${encodeURIComponent(tid)}/history?offset=${opts.offset||0}`),
 delete:(_aid:string,tid:string)=>request<void>(`/threads/${encodeURIComponent(tid)}`,{method:'DELETE'})};
