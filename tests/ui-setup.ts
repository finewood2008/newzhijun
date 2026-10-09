import {afterEach,vi} from 'vitest';import {cleanup} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
// Recent Node versions expose an incomplete Web Storage global without a file.
// Keep browser tests independent of Node's persistent storage configuration.
if(typeof localStorage.clear!=='function'){
 const values=new Map<string,string>();
 const storage:Storage={get length(){return values.size;},clear:()=>values.clear(),getItem:key=>values.get(String(key))??null,key:index=>[...values.keys()][index]??null,removeItem:key=>{values.delete(String(key));},setItem:(key,value)=>{values.set(String(key),String(value));}};
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:storage});
 Object.defineProperty(window,'localStorage',{configurable:true,value:storage});
}
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string,fallback?:string)=>typeof fallback==='string'?fallback:key})}));
afterEach(cleanup);
Object.defineProperty(window,'matchMedia',{writable:true,value:vi.fn().mockImplementation(query=>({matches:false,media:query,addEventListener:vi.fn(),removeEventListener:vi.fn(),addListener:vi.fn(),removeListener:vi.fn()}))});
class ResizeObserver{observe(){}unobserve(){}disconnect(){}}
window.ResizeObserver=ResizeObserver;
