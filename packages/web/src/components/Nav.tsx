import { FIXTURES, SURFACES, type SurfaceId } from "../lib/constants.js";

export function Nav({
  active,
  onNavigate,
  fixtureId,
  onFixtureChange,
}: {
  active: SurfaceId;
  onNavigate: (id: SurfaceId) => void;
  fixtureId: string;
  onFixtureChange: (id: string) => void;
}) {
  return (
    <nav className="border-b border-neutral-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-1">
          {SURFACES.map((s) => (
            <button
              key={s.id}
              onClick={() => onNavigate(s.id)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                active === s.id ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
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
