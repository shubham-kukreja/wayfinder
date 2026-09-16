// Sector / asset-class breakdown: a 28px-tall flex-weighted bar with a 6px
// radius clipping the segments, and an optional legend beneath.
export interface Segment {
  id: string;
  label: string;
  weight: number;
  color: string;
}

export function SegmentedBar({
  segments,
  legend = true,
  className = "",
}: {
  segments: readonly Segment[];
  legend?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="flex h-7 overflow-hidden rounded-md">
        {segments.map((segment) => (
          <div
            key={segment.id}
            style={{ flex: segment.weight, background: segment.color }}
            title={`${segment.label} — ${segment.weight}`}
          />
        ))}
      </div>
      {legend && (
        <div className="mt-2.5 flex flex-wrap gap-3.5 text-[11px] text-muted">
          {segments.map((segment) => (
            <span key={segment.id} className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2" style={{ background: segment.color }} />
              {segment.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
