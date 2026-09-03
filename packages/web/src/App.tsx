import { useSnapshot } from "./hooks/useSnapshot.js";
import { AllocationView } from "./views/AllocationView.js";

export default function App() {
  const { snapshot, loading, error } = useSnapshot();

  if (loading) {
    return <div className="mx-auto max-w-3xl px-6 py-10 text-sm text-neutral-500">Loading…</div>;
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <p className="text-sm text-red-600">Failed to load snapshot: {error}</p>
      </div>
    );
  }

  if (!snapshot) {
    return null;
  }

  return <AllocationView snapshot={snapshot} />;
}
