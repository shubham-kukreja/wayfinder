import { useState } from "react";
import { NavLink } from "react-router-dom";
import { ALLOCATION_ROUTES, GOVERNANCE_ROUTES, MODEL_ROUTES, REFERENCE_ROUTES } from "../../lib/constants.js";

// Persistent left rail: wordmark up top, collapsible route groups beneath,
// and a collapse affordance that narrows the rail to icons-off/labels-off.
// Links are quiet by default and only go ink-dark plus a tint when active —
// the rail never competes with the content area for attention.
//
// The groups mirror how the system actually splits: Allocation is the
// published answer, Model is the draft you tune, Governance is the gate
// between the two. Methodology sits outside them as reference.
const GROUPS: Array<{ id: string; label: string; routes: readonly { path: string; label: string }[] }> = [
  { id: "allocation", label: "Allocation", routes: ALLOCATION_ROUTES },
  { id: "model", label: "Model", routes: MODEL_ROUTES },
  { id: "governance", label: "Governance", routes: GOVERNANCE_ROUTES },
];

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={`h-3.5 w-3.5 shrink-0 transition-transform duration-100 ease-in ${open ? "" : "-rotate-90"}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ allocation: true, model: true, governance: true });

  // One element across both states rather than two separate returns: React
  // then updates this node's width instead of swapping nodes, which is what
  // lets the width actually transition.
  return (
    <aside
      className={`sticky top-0 hidden h-screen shrink-0 overflow-y-auto border-r border-line bg-paper transition-[width] duration-150 ease-in-out lg:block ${
        collapsed ? "w-14" : "w-56"
      }`}
    >
      <div className={`flex h-[77px] items-center ${collapsed ? "justify-center border-b border-line" : "justify-between px-5"}`}>
        {!collapsed && (
          <NavLink to="/overview" className="font-display text-lg font-extrabold tracking-display text-ink">
            CORE.
          </NavLink>
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          className={`rounded-sm text-muted transition-colors duration-100 ease-in hover:bg-paper-2 hover:text-ink ${
            collapsed ? "p-1.5" : "p-1"
          }`}
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d={collapsed ? "M6 3l5 5-5 5" : "M10 3L5 8l5 5"} />
          </svg>
        </button>
      </div>

      {!collapsed && (
        <nav className="px-3 pb-8">
          {GROUPS.map((group) => {
            const open = openGroups[group.id] ?? true;
            return (
              <div key={group.id} className="mb-1">
                <button
                  type="button"
                  onClick={() => setOpenGroups((prev) => ({ ...prev, [group.id]: !open }))}
                  aria-expanded={open}
                  className="flex w-full items-center justify-between rounded-sm px-2 py-2 text-[13px] font-semibold text-ink transition-colors duration-100 ease-in hover:bg-paper-2"
                >
                  {group.label}
                  <ChevronIcon open={open} />
                </button>
                {open && (
                  <div className="mt-0.5">
                    {group.routes.map((route) => (
                      <NavLink
                        key={route.path}
                        to={route.path}
                        className={({ isActive }) =>
                          `block rounded-sm px-2 py-1.5 pl-3 text-[13px] transition-colors duration-100 ease-in ${
                            isActive ? "bg-paper-2 font-semibold text-ink" : "text-ink-2 hover:bg-paper-2 hover:text-ink"
                          }`
                        }
                      >
                        {route.label}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Reference sits under a rule with no group heading of its own:
              it is not a state of the model, so giving it a peer heading
              would imply it belongs to the same sequence as the rest. */}
          <div className="mt-3 border-t border-line pt-3">
            {REFERENCE_ROUTES.map((route) => (
              <NavLink
                key={route.path}
                to={route.path}
                className={({ isActive }) =>
                  `block rounded-sm px-2 py-1.5 text-[13px] transition-colors duration-100 ease-in ${
                    isActive ? "bg-paper-2 font-semibold text-ink" : "text-muted hover:bg-paper-2 hover:text-ink"
                  }`
                }
              >
                {route.label}
              </NavLink>
            ))}
          </div>
        </nav>
      )}
    </aside>
  );
}
