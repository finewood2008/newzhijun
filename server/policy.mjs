export class ClientError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export const fail = (status, code, message) => { throw new ClientError(status, code, message); };
export function id(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(value)) fail(400, 'INVALID_ID', '请求内容不正确。');
  return value;
}
export function bindingFor(config, user) {
  const value = config.bindings[String(user.id)];
  if (!value) fail(409, 'NOT_PROVISIONED', '你的知君尚未开通，请联系服务管理员。');
  return id(value.agentId);
}
export function assertPrivateAgent(agent, user, expected) {
  if (agent.agent_id !== expected || Number(agent.user_id) !== Number(user.id) || agent.is_shared || agent.kind === 'team')
    fail(403, 'PRIVATE_SPACE_REQUIRED', '个人空间配置有误，请联系服务管理员。');
}
export function assertPrivateBase(base, user) {
  if (Number(base.owner_user_id) !== Number(user.id) || base.shared) fail(403, 'PRIVATE_LIBRARY_REQUIRED', '无法访问这份私人资料。');
  return base;
}
export function chatFrame(frame, libraries, attachments=[]) {
  if (['subscribe', 'cancel'].includes(frame.type)) return {type: frame.type, thread_id: id(frame.thread_id)};
  if (frame.type === 'ping') return {type: 'ping'};
  if (frame.type !== 'user_turn' || typeof frame.text !== 'string' || (!frame.text.trim()&&!attachments.length) || frame.text.length > 32000)
    fail(400, 'INVALID_MESSAGE', '请输入不超过 32000 字的内容。');
  // Never accept client-selected agents, model, tools, prompts or approval bypass.
  const text=frame.text.trim()||(attachments.length?'请参考这些附件。':'');
  return {type:'user_turn',text,thread_id:id(frame.thread_id),knowledge_base_ids:libraries,hitl_policy:{mode:'ask'},...(attachments.length?{extract_references:true,messages:[{role:'user',content:[{type:'text',text},...attachments.map(a=>({type:'file',workspace_path:a.path,filename:a.filename,media_type:a.mediaType}))]}]}:{})};
}
export function projectThread(t) {
  return {thread_id:t.thread_id,title:t.title || '一段新的对话',last_active:t.last_active,...(t.created_at!==undefined?{created_at:t.created_at}:{}),...(t.channel_type!==undefined?{channel_type:t.channel_type}:{})};
}
function referenceHistoryContent(m) {
  if(m.role!=='user'||!m.inbound_attachments?.length)return m.content;
  const text=typeof m.content==='string'?m.content:Array.isArray(m.content)?m.content.filter(p=>p?.type==='text').map(p=>String(p.text||'')).join('\n'):'';
  // Native extraction appends attributed source blocks to the human turn.
  // Keep those for inference, but show the original request in client history.
  const markers=m.inbound_attachments.map(a=>'\n\n[上传资料] '+a.filename+'\n来源路径：inbound/');
  const cuts=markers.map(marker=>text.indexOf(marker)).filter(index=>index>=0);
  return cuts.length?text.slice(0,Math.min(...cuts)):m.content;
}
export function projectHistory(h) {
  return {messages:(h.messages || []).filter(m => ['user','assistant'].includes(m.role)).map(m=>({...m,content:referenceHistoryContent(m),...(m.inbound_attachments?{inbound_attachments:m.inbound_attachments.map(a=>({filename:a.filename,media_type:a.media_type}))}:{})})),has_more:!!h.has_more,next_offset:(h.offset||0)+(h.messages||[]).length,next_cursor:h.next_cursor,history_loading:!!h.history_loading,turn_active:!!h.turn_active,hitl_pending:h.hitl_pending};
}
export function validateConfig(c) {
  const u = new URL(c.upstream);
  if (!['http:','https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash || u.pathname !== '/') throw new Error('upstream must be an HTTP(S) origin');
  if (!c.bindings || typeof c.bindings !== 'object' || Array.isArray(c.bindings)) throw new Error('bindings must be an object');
  const seen = new Set();
  for (const [uid, binding] of Object.entries(c.bindings)) {
    if (!/^\d+$/.test(uid)) throw new Error('binding key must be a user ID');
    id(binding.agentId);
    if (seen.has(binding.agentId)) throw new Error('Each user needs a unique private agent');
    seen.add(binding.agentId);
  }
  return c;
}
