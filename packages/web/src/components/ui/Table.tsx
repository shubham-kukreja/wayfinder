import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes } from "react";

// Data tables use hairline row dividers and no zebra striping. The header rule
// is the one strong line in the table; every other divider is a hairline.
export function Table({ className = "", children }: { className?: string; children: ReactNode }) {
  return <table className={`w-full border-collapse text-[13px] ${className}`}>{children}</table>;
}

export function Th({ className = "", children, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={`border-b border-line-strong px-1.5 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted ${className}`}
      {...props}
    >
      {children}
    </th>
  );
}

export function Td({ className = "", children, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={`border-b border-line px-1.5 py-2.5 align-middle ${className}`} {...props}>
      {children}
    </td>
  );
}
