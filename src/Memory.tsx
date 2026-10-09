import {lazy,Suspense} from 'react';
const MemoryModule=lazy(()=>import('./MemoryModule').then(m=>({default:m.Memory})));
export function Memory(props:{settingsOnly?:boolean}){return <Suspense fallback={<p className="quiet" style={{padding:32}}>正在打开记忆…</p>}><MemoryModule {...props}/></Suspense>;}
