import {readFile} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {fail} from './policy.mjs';

export async function serveStatic(req,res,directory,pathname) {
  if(req.method!=='GET')fail(405,'NOT_ALLOWED','操作不支持。');
  const root=resolve(directory),file=resolve(root,pathname==='/'?'index.html':pathname.replace(/^\//,''));
  if(!file.startsWith(root+sep))fail(404,'NOT_FOUND','未找到页面。');
  let bytes;try{bytes=await readFile(file);}catch{fail(404,'NOT_FOUND','未找到页面。');}
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'})[extname(file)]||'application/octet-stream');
  res.end(bytes);
}
