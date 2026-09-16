import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { FIXTURES, MODEL_ROUTES, PRIMARY_ROUTES } from "../lib/constants.js";
import { getDraftStatus, type DraftStatus } from "../lib/reviewsApi.js";

export function Nav({
  fixtureId,
  onFixtureChange,
}: {
  fixtureId: string;
  onFixtureChange: (id: string) => void;
}) {
  const [draftStatus, setDraftStatus] = useState<DraftStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    getDraftStatus()
      .then((status) => {
        if (!cancelled) setDraftStatus(status);
      })
      .catch(() => {
        if (!cancelled) setDraftStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const draftCount = draftStatus?.diff.totalChanges ?? 0;

  return (
    <nav className="sticky top-0 z-20 border-b border-neutral-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-6 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-4">
          <div className="mr-1">
            <div className="font-display text-base font-extrabold tracking-tight text-ink">CORE</div>
            <div className="text-[11px] text-muted">Allocation model</div>
          </div>
          <div className="flex items-center gap-1">
            {PRIMARY_ROUTES.map((route) => (
              <NavLink
                key={route.path}
                to={route.path}
                className={({ isActive }) =>
                  `rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-100 ease-in ${
                    isActive ? "bg-brand-500 text-black" : "text-neutral-600 hover:bg-neutral-100"
                  }`
                }
              >
                {route.label}
              </NavLink>
            ))}
          </div>
          <div className="flex items-center gap-1 border-l border-neutral-200 pl-3">
            {MODEL_ROUTES.map((route) => (
              <NavLink
                key={route.path}
                to={route.path}
                className={({ isActive }) =>
                  `rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    isActive ? "bg-neutral-100 text-neutral-950" : "text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900"
                  }`
                }
              >
                {route.label}
              </NavLink>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {draftStatus && (
            <NavLink
              to="/reviews"
              className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                draftCount > 0 || !draftStatus.hasPublishedVersion
                  ? "border-amber-200 bg-amber-50 text-amber-800"
                  : "border-brand-100 bg-brand-50 text-brand-800"
              }`}
            >
              {!draftStatus.hasPublishedVersion ? "No published version" : draftCount > 0 ? `${draftCount} unpublished` : "Published current"}
            </NavLink>
          )}
          <span className="text-xs text-neutral-400">Fixture (dev):</span>
          <select
            value={fixtureId}
            onChange={(e) => onFixtureChange(e.target.value)}
            className="rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-700"
          >
            {FIXTURES.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </nav>
  );
}
