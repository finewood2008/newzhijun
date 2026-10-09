import {createRoleStore} from './roles.mjs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.mjs';
import { createSessionStore } from './session-store.mjs';
const config=JSON.parse(await readFile(new URL('../deployment.json',import.meta.url),'utf8'));
if(process.env.ZHIJUN_PUBLIC_ORIGIN) config.publicOrigin=process.env.ZHIJUN_PUBLIC_ORIGIN;
const app=createApp(config,{staticDir:fileURLToPath(new URL('../dist',import.meta.url)),roleStore:createRoleStore(config.roleStore || fileURLToPath(new URL('../.runtime/roles',import.meta.url))),sessionStore:createSessionStore(fileURLToPath(new URL('../.runtime/web-sessions',import.meta.url)))});
app.listen(config.port,config.host,()=>console.log(`知君测试版已启动：${config.publicOrigin}`));
