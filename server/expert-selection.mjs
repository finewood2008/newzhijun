import {assertPrivateAgent,fail,id} from './policy.mjs';
import {createHash} from 'node:crypto';
import {createProvisioner} from './provision.mjs';

// WANX's Experts page uses /agents. Role instances are implementation details
// of this client, not alternative source experts for the connection picker.
export function createExpertSelection(config,upstream,roleStore) {
  const provisioners=new Map();
  const templateFor=sourceId=>Object.values(config.provisioning||{}).find(p=>p.sourceAgentId===sourceId);
  function internal(s,agentId) {
    return /^zhijun-(?:lan-user-|role-)/.test(agentId) ||
      roleStore.get(s.user.id).some(r=>r.agentId===agentId) ||
      (!!config.provisioning?.[String(s.user.id)] && config.bindings[String(s.user.id)]?.agentId===agentId);
  }
  function target(s,a) {
    const uid=String(s.user.id);
    if(config.provisioning?.[uid]?.sourceAgentId===a.agent_id)return config.bindings[uid]?.agentId;
    if(Number(a.user_id)===Number(s.user.id)&&!a.is_shared)return a.agent_id;
    if(a.is_shared&&(Number(a.user_id)===Number(s.user.id)||templateFor(a.agent_id)?.rules))
      return `zhijun-lan-user-${uid}-${createHash('sha256').update(a.agent_id).digest('hex').slice(0,12)}`;
    return null;
  }
  async function list(s) {
    const rows=await upstream('/agents?scope=mine',s);
    return (Array.isArray(rows)?rows:[]).filter(a=>a.kind!=='team'&&String(a.name||'').includes('知君')&&
      (Number(a.user_id)===Number(s.user.id)||a.is_shared)&&!internal(s,a.agent_id))
      .map(a=>({id:a.agent_id,name:a.name,selectable:!!target(s,a),
        reason:target(s,a)?'':'此专家尚未配置此账户的独立记忆空间。'}));
  }
  async function resolve(s,sourceId) {
    id(sourceId);
    const a=await upstream(`/agents/${sourceId}`,s);
    if(a.agent_id!==sourceId||a.kind==='team'||internal(s,sourceId)||!String(a.name||'').includes('知君'))
      fail(400,'NOT_ZHIJUN','请从万象“我的专家”中选择知君专家。');
    if(Number(a.user_id)!==Number(s.user.id)&&!a.is_shared)fail(403,'EXPERT_UNAVAILABLE','当前账户无法使用这个专家。');
    const agentId=target(s,a);
    if(!agentId)fail(403,'EXPERT_SPACE_REQUIRED','此专家尚未配置此账户的独立记忆空间。');
    if(agentId!==sourceId&&config.bindings[String(s.user.id)]?.agentId!==agentId) {
      const key=String(s.user.id)+':'+sourceId;
      if(!provisioners.has(key)) {
        const template=templateFor(sourceId);
        provisioners.set(key,createProvisioner({...config,bindings:{[s.user.id]:{agentId}},provisioning:{[s.user.id]:{sourceAgentId:sourceId,...(template?{rules:template.rules,auxModel:template.auxModel}:{})}}},upstream));
      }
      await provisioners.get(key)(s);
    }
    assertPrivateAgent(agentId===sourceId?a:await upstream(`/agents/${id(agentId)}`,s),s.user,agentId);
    return {sourceExpertId:sourceId,agentId};
  }
  return {list,resolve};
}

export function defaultZhijunExpert(agents) {
  const available=agents.filter(a=>a.selectable);
  return available.length===1?available[0]:null;
}
