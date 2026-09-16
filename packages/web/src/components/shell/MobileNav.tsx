import { Fragment } from "react";
import { NavLink } from "react-router-dom";
import { ALLOCATION_ROUTES, GOVERNANCE_ROUTES, MODEL_ROUTES, REFERENCE_ROUTES } from "../../lib/constants.js";

// The left rail is desktop-only, so below `lg` the same routes collapse into
// a single horizontally scrollable strip. The rail's grouping survives as
// hairline separators rather than headings — a heading per group would cost
// more width than the labels themselves, but running all six together would
// lose the structure entirely.
const SECTIONS = [ALLOCATION_ROUTES, MODEL_ROUTES, GOVERNANCE_ROUTES, REFERENCE_ROUTES];

export function MobileNav() {
  return (
    <nav className="flex items-center gap-1 overflow-x-auto border-b border-line bg-paper px-4 py-2 lg:hidden">
      {SECTIONS.map((routes, index) => (
        <Fragment key={routes[0]?.path ?? index}>
          {index > 0 && <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-line" />}
          {routes.map((route) => (
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
        </Fragment>
      ))}
    </nav>
  );
}
