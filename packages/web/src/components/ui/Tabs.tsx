import { NavLink } from "react-router-dom";

// Section switcher: 13px semibold, muted until active, with a 2px ink
// underline on the active tab. Not a pill — the underline is what carries
// selection in this system.
export function Tabs({
  routes,
  className = "",
}: {
  routes: readonly { path: string; label: string }[];
  className?: string;
}) {
  return (
    <div className={`flex gap-[22px] border-b border-line text-[13px] font-semibold ${className}`}>
      {routes.map((route) => (
        <NavLink
          key={route.path}
          to={route.path}
          className={({ isActive }) =>
            `-mb-px border-b-2 pb-2.5 transition-colors duration-100 ease-in ${
              isActive ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"
            }`
          }
        >
          {route.label}
        </NavLink>
      ))}
    </div>
  );
}
