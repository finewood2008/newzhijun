import {useEffect, useRef, useState} from 'react';
import {ArrowRight, Check, Plus, X, Layers} from 'lucide-react';
import type {Role} from './api';

export function Roles({roles, activeId, canCreate, onSelect, onCreate, onClose}: {
  roles: Role[]; activeId: string; canCreate: boolean;
  onSelect: (role: Role) => void;
  onCreate: (name: string, description: string, requestId: string) => Promise<void>;
  onClose: () => void;
}) {
  const [creating, setCreating] = useState(false), [name, setName] = useState(''), [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const requestId = useRef(crypto.randomUUID());
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => previous?.focus();
  }, []);
  function begin() { requestId.current = crypto.randomUUID(); setCreating(true); setError(''); }
  return <div className="modal-backdrop" onClick={e => {if (e.target === e.currentTarget && !busy) onClose();}}>
    <div className="modal role-dialog" ref={dialog} role="dialog" aria-modal="true" aria-label="我的角色" tabIndex={-1}
      onKeyDown={e => {
        if (e.key === 'Escape' && !busy) {e.stopPropagation(); onClose();}
        if (e.key === 'Tab') {
          const items = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea, [tabindex="0"]') || [])];
          const first = items[0], last = items.at(-1);
          if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {e.preventDefault(); last?.focus();}
          else if (!e.shiftKey && document.activeElement === last) {e.preventDefault(); first?.focus();}
        }
      }}>
      <header className="role-dialog-heading"><div><span className="eyebrow">THE DIFFERENT SIDES OF YOU</span><h2>{creating ? '给自己一个新的角色。' : '在不同的角色里，做自己。'}</h2></div><button aria-label="关闭角色窗口" disabled={busy} onClick={onClose}><X size={19}/></button></header>
      <p className="role-explanation">每个角色都有独立的对话、记忆和知识库。切换角色，回到相应的表达空间。</p>
      {creating ? <form onSubmit={async e => {
        e.preventDefault(); if (busy) return; setBusy(true); setError('');
        try {await onCreate(name.trim(), description.trim(), requestId.current);}
        catch (e) {setError((e as Error).message); setBusy(false);}
      }}>
        <label>角色名称<input autoFocus required maxLength={24} placeholder="例如：工作、个人、创作者" value={name} disabled={busy} onChange={e => setName(e.target.value)}/></label>
        <label>这个角色里的你<textarea required maxLength={1200} rows={4} placeholder="例如：工作中的我是一名创业者。在这里，我想讨论产品、团队和经营上的判断。" value={description} disabled={busy} onChange={e => setDescription(e.target.value)}/></label>
        <p className="role-private-note"><Layers size={15}/>新角色从空白记忆开始，现有内容保留在原角色。</p>
        {error && <p className="notice" role="alert">{error}</p>}
        <div className="actions"><button type="button" disabled={busy} onClick={() => {setCreating(false); setError('');}}>返回角色列表</button><button className="primary" disabled={busy || !name.trim() || !description.trim()}>{busy ? '正在准备独立空间…' : '创建并进入'}<ArrowRight size={16}/></button></div>
      </form> : <><div className="role-list">{roles.map(role => <button key={role.id} className={'role-choice ' + (role.id === activeId ? 'is-current' : '')} onClick={() => onSelect(role)}>
        <span className="role-avatar">{role.name.slice(0, 1)}</span><span className="role-copy"><strong>{role.name}</strong><small>{role.description}</small></span>{role.id === activeId ? <Check size={18}/> : <ArrowRight size={16}/>}
      </button>)}</div>{canCreate && <button className="role-create" onClick={begin}><Plus size={17}/>创建新的角色</button>}</>}
    </div>
  </div>;
}
