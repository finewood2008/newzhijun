import {cp,access,rm,mkdir,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url);
await access(new URL('dist/index.html',root));
await rm(fileURLToPath(new URL('desktop/renderer/',root)),{recursive:true,force:true});
await cp(fileURLToPath(new URL('dist/',root)),fileURLToPath(new URL('desktop/renderer/',root)),{recursive:true});
const server=fileURLToPath(new URL('desktop/server/',root));
await rm(server,{recursive:true,force:true});await mkdir(server,{recursive:true});
for(const name of await readdir(new URL('server/',root))){
 if(name.endsWith('.mjs')&&!['index.mjs','desktop-service.mjs'].includes(name))await cp(new URL('server/'+name,root),new URL('desktop/server/'+name,root));
}
console.log('Prepared the current login UI and direct WANX runtime; no legacy pairing assets are included.');
