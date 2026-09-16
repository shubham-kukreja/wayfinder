import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getDraftStatus, type DraftStatus } from "../lib/reviewsApi.js";

export function DraftStatusBanner() {
  const [status, setStatus] = useState<DraftStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    getDraftStatus()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch(() => {
        // The banner is contextual; a status failure should not block the page.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status || !status.hasPublishedVersion || status.diff.totalChanges === 0) return null;

  return (
    <div className="border-b border-warn-200 bg-warn-50 px-6 py-2.5 text-sm text-warn-800">
      <div className="flex items-center justify-between gap-4">
        <span>
          Editing an unpublished draft: {status.diff.totalChanges} input{status.diff.totalChanges === 1 ? "" : "s"} changed since the last published version.
        </span>
        <Link className="shrink-0 font-medium text-warn-800 underline underline-offset-2" to="/reviews">
          Review changes
        </Link>
      </div>
    </div>
  );
}
