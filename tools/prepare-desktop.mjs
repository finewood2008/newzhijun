import {cp,access,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url);
await access(new URL('dist/index.html',root));
await access(new URL('desktop/resources/server-profile.json',root));
await rm(fileURLToPath(new URL('desktop/renderer/',root)),{recursive:true,force:true});
await cp(fileURLToPath(new URL('dist/',root)),fileURLToPath(new URL('desktop/renderer/',root)),{recursive:true});
for(const name of ['connect.html','connect.js','connect.css'])await cp(fileURLToPath(new URL('desktop/resources/'+name,root)),fileURLToPath(new URL('desktop/renderer/'+name,root)));
console.log('Copied current web build into desktop renderer. Build the remote binary separately before packaging.');
