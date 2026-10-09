/**
 * Embeddable memory dashboard (tabs + content). Used by the Memory page,
 * Experts MemoryCatalogDrawer, and Personalization.
 */

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Empty, Segmented } from "antd";
import type { LucideIcon } from "lucide-react";
import {
  Bell,
  Heart,
  Inbox,
  LayoutDashboard,
  MessageSquare,
  Network,
  ScrollText,
  Settings,
  User,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import TabLabel from "../../../components/TabLabel";

import ConversationRecords from "./ConversationRecords";
import Overview from "./Overview";
import ProfileOverview from "../../../extensions/memory/ProfileWithRadar";
import AtomsList from "./AtomsList";
import RawEventsList from "./RawEventsList";
import EpisodesList from "./EpisodesList";
import JournalList from "./JournalList";
import CandidatesReview from "./CandidatesReview";
import MemoryTree from "./MemoryTree";
import ProactiveConfig from "./ProactiveConfig";
import MemorySettings from "./MemorySettings";

import memoryDashboardApi from "../../../api/modules/memoryDashboard";
import styles from "./index.module.less";

type MemoryTab =
  | "overview"
  | "profile"
  | "library"
  | "episodes"
  | "candidates"
  | "journal"
  | "conversations"
  | "proactive"
  | "settings";

type LibraryView = "tree" | "atoms" | "raw";

interface TabDef {
  key: MemoryTab;
  labelKey: string;
  fallback: string;
  icon: LucideIcon;
  showPendingBadge?: boolean;
}

const TABS: TabDef[] = [
  {
    key: "overview",
    labelKey: "memory.tabs.overview",
    fallback: "概览",
    icon: LayoutDashboard,
  },
  {
    key: "profile",
    labelKey: "memory.tabs.profile",
    fallback: "用户画像",
    icon: User,
  },
  {
    key: "library",
    labelKey: "memory.tabs.library",
    fallback: "记忆树",
    icon: Network,
  },
  {
    key: "episodes",
    labelKey: "memory.tabs.episodes",
    fallback: "情绪日记",
    icon: Heart,
  },
  {
    key: "candidates",
    labelKey: "memory.tabs.candidates",
    fallback: "记忆沉淀",
    showPendingBadge: true,
    icon: Inbox,
  },
  {
    key: "journal",
    labelKey: "memory.tabs.journal",
    fallback: "整理记录",
    icon: ScrollText,
  },
  {
    key: "conversations",
    labelKey: "memory.conversationHistory",
    fallback: "对话记录",
    icon: MessageSquare,
  },
  {
    key: "proactive",
    labelKey: "memory.tabs.proactive",
    fallback: "主动关心",
    icon: Bell,
  },
  {
    key: "settings",
    labelKey: "memory.tabs.settings",
    fallback: "设置",
    icon: Settings,
  },
];

export interface MemoryPanelProps {
  agentId: string | null;
  /** Stretch tabs to fill parent height (desktop PageShell / drawer). */
  fill?: boolean;
}

export default function MemoryPanel({
  agentId,
}: MemoryPanelProps) {
  const { t } = useTranslation();
  const panelId = useId();
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const [activeTab, setActiveTab] = useState<MemoryTab>("overview");
  const [libraryView, setLibraryView] = useState<LibraryView>("tree");
  const [pendingCount, setPendingCount] = useState(0);
  const [expandEntityId, setExpandEntityId] = useState<string | undefined>(
    undefined,
  );
  const [expandKey, setExpandKey] = useState(0);

  useEffect(() => {
    if (!agentId) {
      setPendingCount(0);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const c = await memoryDashboardApi.statsCounts(agentId);
        if (!cancelled) setPendingCount(c.candidates_pending ?? 0);
      } catch {
        if (!cancelled) setPendingCount(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId, activeTab]);

  const tabItems = useMemo(() => {
    if (!agentId) return [];

    const library = (
      <div>
        <div className={styles.librarySwitchRow}>
          <Segmented
            value={libraryView}
            onChange={(v) => setLibraryView(v as LibraryView)}
            options={[
              {
                label: t("memory.library.viewTree", "主题视图"),
                value: "tree",
              },
              {
                label: t("memory.library.viewAtoms", "列表视图"),
                value: "atoms",
              },
              {
                label: t("memory.library.viewRaw", "原始素材"),
                value: "raw",
              },
            ]}
          />
          <span className={styles.librarySwitchHint}>
            {libraryView === "tree"
              ? t(
                  "memory.library.hintTree",
                  "按人、项目、工具等主题，分组浏览相关记忆",
                )
              : libraryView === "atoms"
              ? t(
                  "memory.library.hintAtoms",
                  "扁平展示全部记忆，可按重要程度筛选",
                )
              : t(
                  "memory.library.hintRaw",
                  "提炼前捕获的原始对话记忆（条数与「对话记录」不一一对应）",
                )}
          </span>
        </div>
        {libraryView === "tree" ? (
          <MemoryTree
            key={expandKey}
            agentId={agentId}
            initialExpandEntityId={expandEntityId}
          />
        ) : libraryView === "atoms" ? (
          <AtomsList agentId={agentId} />
        ) : (
          <RawEventsList agentId={agentId} />
        )}
      </div>
    );

    return TABS.map((tab) => {
      const showBadge = tab.showPendingBadge && pendingCount > 0;
      const label = (
        <TabLabel icon={tab.icon}>
          {t(tab.labelKey, tab.fallback)}
          {showBadge ? (
            <span className={styles.tabBadge}>{pendingCount}</span>
          ) : null}
        </TabLabel>
      );

      let children: ReactNode = null;
      switch (tab.key) {
        case "overview":
          children = (
            <Overview
              agentId={agentId}
              onViewConversations={() => setActiveTab("conversations")}
              onReviewCandidates={() => setActiveTab("candidates")}
              onOpenSettings={() => setActiveTab("settings")}
            />
          );
          break;
        case "profile":
          children = (
            <ProfileOverview
              agentId={agentId}
              onReview={() => setActiveTab("candidates")}
              onViewAll={(entityId) => {
                setExpandEntityId(entityId);
                setExpandKey((k) => k + 1);
                setLibraryView("tree");
                setActiveTab("library");
              }}
            />
          );
          break;
        case "library":
          children = library;
          break;
        case "episodes":
          children = <EpisodesList agentId={agentId} />;
          break;
        case "candidates":
          children = <CandidatesReview agentId={agentId} />;
          break;
        case "journal":
          children = <JournalList agentId={agentId} />;
          break;
        case "conversations":
          children = <ConversationRecords agentId={agentId} />;
          break;
        case "proactive":
          children = (
            <ProactiveConfig
              agentId={agentId}
              onSwitchToEpisodes={() => setActiveTab("episodes")}
            />
          );
          break;
        case "settings":
          children = <MemorySettings agentId={agentId} />;
          break;
      }

      return { key: tab.key, label, children };
    });
  }, [agentId, expandEntityId, expandKey, libraryView, pendingCount, t]);

  if (!agentId) {
    return (
      <Empty
        description={t("memory.noAgentSelected")}
        style={{ marginTop: 64 }}
      />
    );
  }

  const groups = [
    { title: "认识自己", keys: ["overview", "profile", "library"] },
    { title: "回看来处", keys: ["episodes", "candidates", "conversations"] },
    { title: "相处方式", keys: ["journal", "proactive", "settings"] },
  ];
  const keys = groups.flatMap((group) => group.keys) as MemoryTab[];
  const selected = tabItems.find((item) => item.key === activeTab);
  const introductions: Partial<Record<MemoryTab, { title: string; description: string }>> = {
    library: { title: "记忆树", description: "沿着人、事与主题，找到那些值得回看的记忆。" },
    episodes: { title: "情绪日记", description: "留意那些心情起伏，也给当时的自己一点理解。" },
    candidates: { title: "记忆沉淀", description: "回看从对话中整理出的理解，决定哪些值得留下。" },
    journal: { title: "整理记录", description: "每一次整理都有迹可循，回看记忆如何慢慢形成。" },
  };
  const introduction = introductions[activeTab];

  return (
    <div className="memory-workspace">
      <div className="memory-navigation" role="tablist" aria-label="记忆目录">
        {groups.map((group, groupIndex) => (
          <div className="memory-nav-group" role="presentation" key={group.title}>
            <span className="memory-nav-caption" aria-hidden="true">
              <span>0{groupIndex + 1}</span>{group.title}
            </span>
            <div className="memory-nav-items" role="presentation">
              {group.keys.map((key) => {
                const item = tabItems.find((entry) => entry.key === key)!;
                return (
                  <button
                    key={key}
                    ref={(node) => { tabRefs.current[key] = node; }}
                    id={`${panelId}-tab-${key}`}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === key}
                    aria-controls={`${panelId}-panel`}
                    tabIndex={activeTab === key ? 0 : -1}
                    onClick={() => setActiveTab(key as MemoryTab)}
                    onKeyDown={(event) => {
                      const index = keys.indexOf(key as MemoryTab);
                      let next: MemoryTab | undefined;
                      if (event.key === "ArrowRight") next = keys[(index + 1) % keys.length];
                      if (event.key === "ArrowLeft") next = keys[(index + keys.length - 1) % keys.length];
                      if (event.key === "Home") next = keys[0];
                      if (event.key === "End") next = keys[keys.length - 1];
                      if (next) {
                        event.preventDefault();
                        setActiveTab(next);
                        tabRefs.current[next]?.focus();
                      }
                    }}
                  >{item.label}</button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <section
        className="memory-tab-content"
        id={`${panelId}-panel`}
        role="tabpanel"
        aria-labelledby={`${panelId}-tab-${activeTab}`}
        tabIndex={0}
        key={activeTab}
      >
        {introduction && <header className="memory-section-heading">
          <h2>{introduction.title}</h2><p>{introduction.description}</p>
        </header>}
        {selected?.children}
      </section>
    </div>
  );
}
