import { assertPrivateAgent, bindingFor, fail, id } from './policy.mjs';

// Bindings are configured by the operator or resolved from an accessible
// WANX expert. Never accept owner, model or workspace from a browser request.
export function createProvisioner(config, upstream) {
  const inFlight = new Map();
  return async function provision(session) {
    const uid = String(session.user.id), spec = config.provisioning?.[uid];
    if (!spec) return;
    if (inFlight.has(uid)) return inFlight.get(uid);
    const operation = (async () => {
      const aid = bindingFor(config, session.user);
      try {
        const existing = await upstream(`/agents/${aid}`, session);
        assertPrivateAgent(existing, session.user, aid);
        return;
      } catch (error) {
        // Network failures and ownership errors must never create a fallback.
        if (error.status !== 404) throw error;
      }
      const source = await upstream(`/agents/${id(spec.sourceAgentId)}`, session);
      if (source.agent_id !== spec.sourceAgentId || source.kind === 'team' ||
          (!source.is_shared && source.user_id !== session.user.id))
        fail(403, 'TEMPLATE_UNAVAILABLE', '知君的能力配置暂不可用。');
      let rules=spec.rules;
      if(!rules?.trim()&&Number(source.user_id)===Number(session.user.id))
        rules=(await upstream(`/agents/${id(spec.sourceAgentId)}/workspace/file?path=AGENTS.md`,session)).content;
      if (typeof rules !== 'string' || !rules.trim() || (spec.workspaceRoot && !spec.workspaceRoot.startsWith('/')))
        fail(409, 'TEMPLATE_UNAVAILABLE', '知君的能力配置尚未准备好。');
      // The reviewed rules contain behaviour only. No source workspace,
      // profile, memory database, knowledge bases or channel credentials copy.
      await upstream('/agents/from-expert/default', session, 'POST', {
        agent_id: aid,
        name: '知君 · 私人空间',
        description: '基于统一知君能力配置的独立个人实例',
        default_model: source.default_model,
        backend: {type: 'filesystem', virtual_mode: true, ...(spec.workspaceRoot ? {root_dir: spec.workspaceRoot} : {})},
        knowledge_base_ids: [], mcp_servers: [], skill_package_ids: [],
        file_overrides: [{name: 'AGENTS.md', content: rules}],
        welcome_message: '见字如面。今天，想从哪里说起？',
      });
      const created = await upstream(`/agents/${aid}`, session);
      assertPrivateAgent(created, session.user, aid);
      await upstream(`/agents/${aid}/memory/extract-config`, session, 'PUT', {
        memory_enabled: true, extract_on_session_end: true,
        extract_trigger_mode: 'idle', extract_idle_seconds: 300,
        extract_interval_seconds: 21600,
        ...(spec.auxModel ? {aux_model: spec.auxModel} : {}),
      });
    })();
    inFlight.set(uid, operation);
    try { await operation; } finally { inFlight.delete(uid); }
  };
}
