import type {AtomItem,EntityItem} from "../api/modules/memoryDashboard";
export function makeAtom(overrides: Partial<AtomItem> = {}): AtomItem {
  return {
    id: "atom-1",
    entity_id: "ent-1",
    candidate_id: "cand-1",
    assertion: "用户喜欢喝美式咖啡。",
    verbatim_quote: "我喜欢喝美式咖啡",
    search_terms: ["coffee", "美式"],
    occurred_at: null,
    importance: "medium",
    confidence: "high",
    deprecated_at: null,
    created_at: "2026-06-29T10:00:00Z",
    kind: "Preference",
    ...overrides,
  };
}

export function makeEntity(overrides: Partial<EntityItem> = {}): EntityItem {
  return {
    id: "ent-1",
    entity_type: "Person",
    canonical_name: "用户",
    aliases: ["You", "you"],
    atom_count: 4,
    created_at: "2026-06-20T08:00:00Z",
    ...overrides,
  };
}

