import { StateSummary } from "../StateSummary.js";
import { useSnapshot } from "../../hooks/useSnapshot.js";
import { PUBLISHED_SNAPSHOT_URL, CURRENT_SNAPSHOT_URL } from "../../lib/constants.js";

// One line: data freshness, active vetoes, qualifying sectors — the same
// status line the app shows elsewhere, dropped into a note as a quick
// "what shape was the model in" check without a chart's visual weight.
export function StateSummaryWidget() {
  const { snapshot, loading } = useSnapshot(PUBLISHED_SNAPSHOT_URL, CURRENT_SNAPSHOT_URL);

  if (loading || !snapshot) {
    return <div className="h-5 w-full animate-pulse bg-paper-2" />;
  }

  return <StateSummary snapshot={snapshot} />;
}
