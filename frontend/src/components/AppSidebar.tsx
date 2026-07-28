import { useEffect, useState } from "react";
import { ThemeToggle } from "./ThemeToggle";

export type Tab =
  | "activity"
  | "email-templates"
  | "whatsapp-templates"
  | "whatsapp-inbox"
  | "leads"
  | "table"
  | "master-table"
  | "inbox"
  | "calls"
  | "chatbot"
  | "kpi"
  | "users";

export type LeadsTableSection =
  | "all"
  | "master"
  | "old_clients"
  | "interested_clients"
  | "not_interested_clients"
  | "not_received_call_clients"
  | `assigned:${number}`;

export function isAssignedLeadsSection(
  section: string,
): section is `assigned:${number}` {
  return /^assigned:\d+$/.test(section);
}

export function assignedUserIdFromSection(section: LeadsTableSection): number | null {
  if (!isAssignedLeadsSection(section)) return null;
  const id = Number(section.slice("assigned:".length));
  return Number.isFinite(id) ? id : null;
}

export type MailSection =
  | "inbox"
  | "sent"
  | "trash"
  | "archive"
  | "drafts"
  | "activity"
  | "email-templates"
  | `label:${number}`;

export function isMailLabelSection(section: string): section is `label:${number}` {
  return /^label:\d+$/.test(section);
}

export function mailLabelIdFromSection(section: MailSection): number | null {
  if (!isMailLabelSection(section)) return null;
  const id = Number(section.slice("label:".length));
  return Number.isFinite(id) ? id : null;
}

export type NavChild = {
  id: string;
  label: string;
  count: number;
};

export type NavItem =
  | {
      id: Tab;
      label: string;
      count: number;
      alert?: boolean;
      external?: undefined;
      children?: NavChild[];
    }
  | { id: "quotation-agent"; label: string; count: number; external: string };

interface AppSidebarProps {
  navItems: NavItem[];
  activeTab: Tab;
  tableSection?: LeadsTableSection;
  /** Section opened when the table parent is clicked. Admins: "master"; sales users: "old_clients". */
  defaultTableSection?: LeadsTableSection;
  mailSection?: MailSection;
  onSelectTab: (tab: Tab) => void;
  onSelectTableSection?: (section: LeadsTableSection) => void;
  onSelectMailSection?: (section: MailSection) => void;
  onRefresh: () => void;
  userLabel?: string;
  userRole?: string;
  onLogout?: () => void;
  /** Mobile drawer open state (< lg). Ignored on desktop. */
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export function AppSidebar({
  navItems,
  activeTab,
  tableSection = "master",
  defaultTableSection = "master",
  mailSection = "inbox",
  onSelectTab,
  onSelectTableSection,
  onSelectMailSection,
  onRefresh,
  userLabel,
  userRole,
  onLogout,
  mobileOpen = false,
  onMobileClose,
}: AppSidebarProps) {
  const [leadsMenuOpen, setLeadsMenuOpen] = useState(activeTab === "table");
  const [mailMenuOpen, setMailMenuOpen] = useState(
    activeTab === "inbox" || activeTab === "activity" || activeTab === "email-templates",
  );

  useEffect(() => {
    if (activeTab === "table") {
      setLeadsMenuOpen(true);
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === "inbox" || activeTab === "activity" || activeTab === "email-templates") {
      setMailMenuOpen(true);
    }
  }, [activeTab]);

  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  function closeMobile() {
    onMobileClose?.();
  }

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/60 lg:hidden transition-opacity ${
          mobileOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        aria-hidden={!mobileOpen}
        onClick={closeMobile}
      />

      <aside
        className={`fixed lg:sticky inset-y-0 left-0 z-50 flex w-[min(18rem,85vw)] lg:w-64 shrink-0 flex-col border-r border-slate-800 bg-slate-950 lg:bg-slate-900/50 h-dvh lg:h-screen transition-transform duration-200 ease-out ${
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
        aria-label="Main navigation"
      >
        <div className="px-5 py-5 sm:py-6 border-b border-slate-800 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Sales Agent</p>
            <h1 className="mt-1 text-lg font-semibold tracking-tight text-slate-100">
              <span className="text-slate-500 font-normal">by </span>Izaan Bin Mujeeb
            </h1>
            <p className="mt-2 text-xs text-slate-500 leading-relaxed">Kafi Commodities</p>
          </div>
          <button
            type="button"
            onClick={closeMobile}
            className="lg:hidden shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
            aria-label="Close menu"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto overscroll-contain px-3 py-4 space-y-1">
          {navItems.map((item) => {
            if ("external" in item) {
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    window.open(item.external, "_blank", "noopener,noreferrer");
                    closeMobile();
                  }}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-sm font-medium text-left transition text-slate-300 hover:bg-slate-800 hover:text-slate-100"
                >
                  <span className="truncate">{item.label}</span>
                  <span className="shrink-0 text-xs opacity-70">↗</span>
                </button>
              );
            }

            const isActive =
              item.id === "inbox"
                ? activeTab === "inbox" ||
                  activeTab === "activity" ||
                  activeTab === "email-templates"
                : activeTab === item.id;
            const hasAlert = Boolean(item.alert);
            const hasChildren = Boolean(item.children?.length);
            const isTableParent = item.id === "table" && hasChildren;
            const isMailParent = item.id === "inbox" && hasChildren;
            const isExpandableParent = isTableParent || isMailParent;
            const menuOpen = isTableParent ? leadsMenuOpen : isMailParent ? mailMenuOpen : false;
            const setMenuOpen = isTableParent
              ? setLeadsMenuOpen
              : isMailParent
                ? setMailMenuOpen
                : undefined;
            const defaultChildId = isTableParent ? defaultTableSection : "inbox";
            const activeChildId = isTableParent
              ? tableSection
              : isMailParent
                ? activeTab === "activity"
                  ? "activity"
                  : activeTab === "email-templates"
                    ? "email-templates"
                    : mailSection
                : null;
            const parentHighlighted =
              isExpandableParent && isActive && activeChildId === defaultChildId
                ? true
                : !isExpandableParent && isActive;

            return (
              <div key={item.id} className="space-y-1">
                <div
                  className={`w-full flex items-center rounded-lg text-sm font-medium transition ${
                    parentHighlighted
                      ? "bg-emerald-600 text-white shadow-sm shadow-emerald-900/30"
                      : isExpandableParent && isActive
                        ? "bg-emerald-700/35 text-emerald-100"
                        : "text-slate-300 hover:bg-slate-800 hover:text-slate-100"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (isTableParent) {
                        setLeadsMenuOpen(true);
                        onSelectTab("table");
                        onSelectTableSection?.(defaultTableSection);
                        closeMobile();
                        return;
                      }
                      if (isMailParent) {
                        setMailMenuOpen(true);
                        onSelectTab("inbox");
                        onSelectMailSection?.("inbox");
                        closeMobile();
                        return;
                      }
                      onSelectTab(item.id);
                      closeMobile();
                    }}
                    className="flex-1 min-w-0 flex items-center justify-between gap-2 px-3 py-2.5 text-left rounded-lg"
                  >
                    <span className="flex items-center gap-2 truncate min-w-0">
                      {hasAlert && (
                        <span
                          aria-label="new messages"
                          className={`shrink-0 ${
                            parentHighlighted ? "text-white" : "text-emerald-400"
                          } animate-pulse`}
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-5-1.6-1.6V10a5.4 5.4 0 0 0-4-5.23V4a1.4 1.4 0 0 0-2.8 0v.77A5.4 5.4 0 0 0 6.6 10v5.4L5 17a.9.9 0 0 0 .64 1.54h12.72A.9.9 0 0 0 19 17Z" />
                          </svg>
                        </span>
                      )}
                      <span className="truncate">{item.label}</span>
                    </span>
                    <span
                      className={`shrink-0 text-xs tabular-nums px-1.5 py-0.5 rounded ${
                        hasAlert && !parentHighlighted
                          ? "bg-emerald-500/20 text-emerald-300"
                          : parentHighlighted
                            ? "bg-emerald-500/30 text-emerald-50"
                            : "bg-slate-800 text-slate-400"
                      }`}
                    >
                      {item.count}
                    </span>
                  </button>

                  {isExpandableParent && setMenuOpen && (
                    <button
                      type="button"
                      aria-label={
                        menuOpen
                          ? `Collapse ${item.label} menu`
                          : `Expand ${item.label} menu`
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpen((open) => !open);
                      }}
                      className={`shrink-0 px-2.5 py-2.5 rounded-r-lg text-xs ${
                        parentHighlighted || (isExpandableParent && isActive)
                          ? "text-emerald-50/90 hover:bg-emerald-500/20"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      {menuOpen ? "▾" : "▸"}
                    </button>
                  )}
                </div>

                {isExpandableParent && menuOpen && item.children && (
                  <div className="ml-3 pl-2 border-l border-slate-700 space-y-0.5">
                    {item.children.map((child) => {
                      const childActive = isActive && activeChildId === child.id;
                      return (
                        <button
                          key={child.id}
                          type="button"
                          onClick={() => {
                            if (isTableParent) {
                              setLeadsMenuOpen(true);
                              onSelectTab("table");
                              onSelectTableSection?.(child.id as LeadsTableSection);
                            } else if (isMailParent) {
                              setMailMenuOpen(true);
                              onSelectMailSection?.(child.id as MailSection);
                            }
                            closeMobile();
                          }}
                          className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm text-left transition ${
                            childActive
                              ? "bg-emerald-600 text-white shadow-sm shadow-emerald-900/30"
                              : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                          }`}
                        >
                          <span className="truncate">{child.label}</span>
                          <span
                            className={`shrink-0 text-xs tabular-nums px-1.5 py-0.5 rounded ${
                              childActive
                                ? "bg-emerald-500/30 text-emerald-50"
                                : "bg-slate-800/80 text-slate-500"
                            }`}
                          >
                            {child.count}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="px-3 py-4 border-t border-slate-800 space-y-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {(userLabel || userRole) && (
            <div className="px-3 py-2 rounded-lg bg-slate-900/80 border border-slate-800">
              <p className="text-sm text-slate-200 truncate">{userLabel}</p>
              {userRole && (
                <p className="text-xs text-slate-500 mt-0.5 capitalize">{userRole}</p>
              )}
            </div>
          )}
          <ThemeToggle />
          <button
            type="button"
            onClick={() => {
              onRefresh();
              closeMobile();
            }}
            className="w-full text-sm px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300"
          >
            Refresh
          </button>
          {onLogout && (
            <button
              type="button"
              onClick={() => {
                closeMobile();
                onLogout();
              }}
              className="w-full text-sm px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400"
            >
              Sign out
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
