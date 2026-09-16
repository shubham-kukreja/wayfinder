import { NavLink } from "react-router-dom";
import { MODEL_ROUTES, PRIMARY_ROUTES } from "../../lib/constants.js";

// The left rail is desktop-only, so below `lg` the same routes collapse into
// a single horizontally scrollable strip.
const ROUTES = [...PRIMARY_ROUTES, ...MODEL_ROUTES];

export function MobileNav() {
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-line bg-paper px-4 py-2 lg:hidden">
      {ROUTES.map((route) => (
        <NavLink
          key={route.path}
          to={route.path}
          className={({ isActive }) =>
            `shrink-0 rounded-sm px-2.5 py-1.5 text-[13px] transition-colors duration-100 ease-in ${
              isActive ? "bg-paper-2 font-semibold text-ink" : "text-ink-2 hover:bg-paper-2"
            }`
          }
        >
          {route.label}
        </NavLink>
      ))}
    </nav>
  );
}
