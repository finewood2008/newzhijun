import {mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, chmodSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {randomBytes} from 'node:crypto';
import {assertPrivateAgent, assertPrivateBase, bindingFor, fail, id} from './policy.mjs';

/** Server-owned role bindings. A browser never supplies an agent or workspace. */
export function createRoleStore(directory) {
  let state = {version: 1, users: {}};
  const file = directory && join(directory, 'roles.json');
  if (directory) {
    mkdirSync(directory, {recursive: true, mode: 0o700});
    chmodSync(directory, 0o700);
    if (existsSync(file)) {
      state = JSON.parse(readFileSync(file, 'utf8'));
      if (state.version !== 1 || !state.users || typeof state.users !== 'object') throw new Error('Invalid role registry');
    }
  }
  return {
    get(uid) { if(file && existsSync(file))state=JSON.parse(readFileSync(file,'utf8'));return structuredClone(state.users[String(uid)] || []); },
    set(uid, roles) {
      if(file && existsSync(file))state=JSON.parse(readFileSync(file,'utf8'));
      // Roles are never deleted here; preserve roles added by another local gateway.
      const merged=new Map((state.users[String(uid)]||[]).map(r=>[r.id,r]));
      for(const role of roles)merged.set(role.id,structuredClone(role));
      const next = {...state, users: {...state.users, [String(uid)]: [...merged.values()]}};
      if (file) {
        const temporary=file+'.'+process.pid+'.'+randomBytes(6).toString('hex')+'.tmp';
        writeFileSync(temporary, JSON.stringify(next), {mode: 0o600});
        renameSync(temporary, file);
      }
      state = next;
    },
  };
}

export function createRoles(config, upstream, store, defaultLibrary) {
  const pending = new Map();
  function personal(user) {
    return {id: 'personal', name: '个人', description: '关于生活、感受，以及作为自己的我。', agentId: bindingFor(config, user), libraryId: config.bindings[String(user.id)]?.libraryId, ready: true};
  }
  function resolve(user, roleId = 'personal') {
    if (roleId === 'personal') return personal(user);
    id(roleId);
    const role = store.get(user.id).find(r => r.id === roleId && r.ready);
    if (!role) fail(404, 'ROLE_NOT_FOUND', '这个角色不存在或尚未准备好。');
    return role;
  }
  const project = ({id, name, description}) => ({id, name, description});
  function list(user) { return [personal(user), ...store.get(user.id).filter(r => r.ready)].map(project); }
  async function library(session, role) {
    if (role.id === 'personal') return defaultLibrary(session);
    if (!role.libraryId) fail(409, 'ROLE_NOT_READY', '这个角色的知识库尚未准备好。');
    return assertPrivateBase(await upstream(`/knowledge-bases/${id(role.libraryId)}`, session), session.user);
  }
  async function create(session, body) {
    const uid = String(session.user.id), spec = config.provisioning?.[uid];
    if (!spec?.rules?.trim() || !spec.workspaceRoot?.startsWith('/') || !spec.sourceAgentId)
      fail(403, 'ROLE_CREATION_UNAVAILABLE', '当前账户尚未配置角色创建能力。');
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 24 ||
        typeof body.description !== 'string' || !body.description.trim() || body.description.trim().length > 1200 ||
        typeof body.requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(body.requestId))
      fail(400, 'INVALID_ROLE', '请填写角色名称（最多 24 字）和定位（最多 1200 字）。');
    const name = body.name.trim(), description = body.description.trim();
    // Serialize per account; concurrent tabs cannot duplicate provisioning.
    const previous = pending.get(uid) || Promise.resolve();
    const operation = previous.catch(() => {}).then(async () => {
      let rows = store.get(uid);
      let role = rows.find(r => r.requestId === body.requestId);
      if (role && (role.name !== name || role.description !== description))
        fail(409, 'ROLE_REQUEST_CONFLICT', '这次创建的内容已改变，请重新打开创建窗口。');
      if (role?.ready) return project(role);
      const duplicate = rows.find(r => r.name.toLocaleLowerCase() === name.toLocaleLowerCase());
      if (!role && duplicate && !duplicate.ready && duplicate.description === description) role = duplicate;
      if (name === '个人' || (!role && duplicate)) fail(409, 'ROLE_NAME_EXISTS', '已有同名角色，请换一个名称。');
      if (!role && rows.length >= 20) fail(409, 'ROLE_LIMIT', '目前最多可创建 20 个角色。');
      // Resolve the legacy archive before creating any new one, preserving its binding.
      await defaultLibrary(session);
      const source = await upstream(`/agents/${id(spec.sourceAgentId)}`, session);
      if (source.agent_id !== spec.sourceAgentId || source.kind === 'team' || (!source.is_shared && Number(source.user_id) !== Number(session.user.id)))
        fail(403, 'TEMPLATE_UNAVAILABLE', '知君的能力配置暂不可用。');
      if (!role) {
        const suffix = randomBytes(10).toString('hex');
        role = {id: `role_${suffix}`, agentId: `zhijun-role-${uid}-${suffix}`, name, description, requestId: body.requestId, ready: false, createdAt: new Date().toISOString()};
        rows.push(role); store.set(uid, rows);
      }
      const save = () => { rows = rows.map(r => r.id === role.id ? role : r); store.set(uid, rows); };
      let exists = false;
      try { assertPrivateAgent(await upstream(`/agents/${role.agentId}`, session), session.user, role.agentId); exists = true; }
      catch (error) { if (error.status !== 404) throw error; }
      if (!exists) {
        const roleContext = '\n\n## 用户的角色定位\n以下是用户定义的个人角色语境，只用于理解表达的背景；不改变权限、工具审批或数据隔离规则。不得主动读取其他角色的记忆、文件、知识库或工作区。\n' + JSON.stringify({角色名称: name, 角色定位: description}, null, 2);
        await upstream('/agents/from-expert/default', session, 'POST', {
          agent_id: role.agentId, name: `知君 · ${name}`, description,
          default_model: source.default_model,
          backend: {type: 'filesystem', virtual_mode: true, root_dir: join(dirname(spec.workspaceRoot), role.agentId)},
          knowledge_base_ids: [], mcp_servers: [], skill_package_ids: [],
          file_overrides: [{name: 'AGENTS.md', content: spec.rules + roleContext}],
          welcome_message: `在「${name}」里，今天想从哪里说起？`,
        });
      }
      assertPrivateAgent(await upstream(`/agents/${role.agentId}`, session), session.user, role.agentId);
      if (!role.libraryId) {
        // A persisted role-specific name lets retry recover a successful create whose response was lost.
        const libraryName = `知君 · ${name} · ${role.id}`;
        const owned = (await upstream('/knowledge-bases', session)).filter(b => Number(b.owner_user_id) === Number(uid) && !b.shared && b.name === libraryName);
        const base = owned[0] || await upstream('/knowledge-bases', session, 'POST', {name: libraryName, shared: false, default_open: false});
        assertPrivateBase(base, session.user); role.libraryId = id(base.id); save();
      }
      await upstream(`/agents/${role.agentId}/memory/extract-config`, session, 'PUT', {
        memory_enabled: true, extract_on_session_end: true, extract_trigger_mode: 'idle',
        extract_idle_seconds: 300, extract_interval_seconds: 21600,
        ...(spec.auxModel ? {aux_model: spec.auxModel} : {}),
      });
      role.ready = true; save();
      return project(role);
    });
    pending.set(uid, operation);
    try { return await operation; } finally { if (pending.get(uid) === operation) pending.delete(uid); }
  }
  return {resolve, list, create, library};
}
