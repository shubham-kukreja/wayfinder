import { useEffect, useState } from "react";
import { CheckIcon, HandoffIcon } from "./icons.js";
import { PrimaryButton, SecondaryButton } from "./ui.js";
import { formatRupees } from "../../lib/backtestFormat.js";

// Sending an order out: the distributor picks the transaction platform and
// how the client pays, the order goes to the platform, and the client gets
// an approval link. The platform connection is not wired yet; the stages run
// locally and the order is recorded in the client's activity.

const PLATFORMS = [
  { id: "bse", name: "BSE StAR MF", note: "Most distributors' default" },
  { id: "nse", name: "NSE NMF II", note: "NSE's mutual fund platform" },
  { id: "mfu", name: "MF Utility", note: "One CAN across fund houses" },
] as const;
const PAYMENTS = ["UPI", "Net banking", "Mandate on file"] as const;

type Stage = "choose" | "sending" | "sent";

export function OrderHandoff({
  clientFirstName,
  amount,
  funds,
  onPlaced,
  onClose,
}: {
  clientFirstName: string;
  amount: number;
  funds: number;
  onPlaced: (platform: string) => void;
  onClose: () => void;
}) {
  const [platform, setPlatform] = useState<(typeof PLATFORMS)[number]["id"]>("bse");
  const [payment, setPayment] = useState<(typeof PAYMENTS)[number]>("UPI");
  const [stage, setStage] = useState<Stage>("choose");
  const [step, setStep] = useState(0);
  const name = PLATFORMS.find((p) => p.id === platform)!.name;
  const steps = [`Order created on ${name}`, `Approval link sent to ${clientFirstName} by SMS and email`, `Recorded in ${clientFirstName}'s activity`];

  useEffect(() => {
    if (stage !== "sending") return;
    if (step >= steps.length) {
      setStage("sent");
      onPlaced(name);
      return;
    }
    const t = setTimeout(() => setStep((s) => s + 1), 700);
    return () => clearTimeout(t);
  }, [stage, step]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && stage === "choose" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [stage, onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Send order">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-ink/20" onClick={() => stage === "choose" && onClose()} />
      <div className="relative w-full max-w-lg rounded-xl border border-line bg-paper shadow-xl">
        <div className="border-b border-line px-6 py-5">
          <h2 className="text-lg font-semibold text-ink">Send order</h2>
          <p className="mt-1 text-[13px] tabular-nums text-muted">
            {formatRupees(amount)} across {funds} funds for {clientFirstName}
          </p>
        </div>

        {stage === "choose" ? (
          <div className="px-6 py-5">
            <p className="text-[13px] font-semibold text-ink">Platform</p>
            <div className="mt-2 grid gap-2">
              {PLATFORMS.map((p) => (
                <label
                  key={p.id}
                  className={`flex cursor-pointer items-center justify-between rounded-md border px-4 py-3 transition-colors duration-150 ease-out ${
                    platform === p.id ? "border-ink bg-paper-2" : "border-line hover:bg-paper-2"
                  }`}
                >
                  <span>
                    <span className="block text-[14px] text-ink">{p.name}</span>
                    <span className="text-[12px] text-muted">{p.note}</span>
                  </span>
                  <input type="radio" name="platform" checked={platform === p.id} onChange={() => setPlatform(p.id)} className="accent-ink" />
                </label>
              ))}
            </div>
            <p className="mt-5 text-[13px] font-semibold text-ink">{clientFirstName} pays by</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {PAYMENTS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPayment(m)}
                  aria-pressed={payment === m}
                  className={`h-9 rounded-md border px-3 text-[13px] font-semibold transition-colors duration-150 ease-out ${
                    payment === m ? "border-ink bg-ink text-paper" : "border-line text-ink hover:bg-paper-2"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
              <button
                type="button"
                onClick={() => setStage("sending")}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-5 text-[14px] font-semibold text-paper transition-colors duration-150 ease-out hover:bg-ink/85"
              >
                <HandoffIcon />
                Send to {name}
              </button>
            </div>
          </div>
        ) : (
          <div className="px-6 py-5">
            <ol className="space-y-3">
              {steps.map((label, i) => {
                const done = i < step || stage === "sent";
                const active = i === step && stage === "sending";
                return (
                  <li key={label} className={`flex items-center gap-3 text-[14px] ${done ? "text-ink" : active ? "text-ink-2" : "text-muted"}`}>
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                        done ? "border-brand-800 bg-brand-50 text-brand-800" : "border-line"
                      }`}
                    >
                      {done ? <CheckIcon className="h-3.5 w-3.5" /> : <span className="text-[12px] tabular-nums">{i + 1}</span>}
                    </span>
                    {label}
                  </li>
                );
              })}
            </ol>
            {stage === "sent" && (
              <>
                <p className="mt-5 rounded-md bg-paper-2 px-4 py-3 text-[13px] text-ink-2">
                  Units are allotted at the NAV of the day {clientFirstName} approves and pays by {payment.toLowerCase()}
                </p>
                <div className="mt-5 flex justify-end">
                  <PrimaryButton onClick={onClose}>Done</PrimaryButton>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
