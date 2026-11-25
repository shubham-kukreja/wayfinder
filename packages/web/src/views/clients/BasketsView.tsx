import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { SleeveAllocation, type SleeveFilter } from "../../components/SleeveAllocation.js";
import { Pill } from "../../components/ui/Pill.js";
import { useBook } from "../../hooks/useBook.js";
import { useCoreAllocation } from "../../hooks/useCoreAllocation.js";
import { formatRupees } from "../../lib/backtestFormat.js";
import { BASKETS, basketById, type Basket } from "../../lib/baskets.js";
import { CLIENTS } from "../../lib/clients.js";

// Baskets: the client archetypes the model portfolios are designed for.

const clientsIn = (b: Basket) => CLIENTS.filter((c) => c.basket === b.id);

export function BasketsView() {
  const navigate = useNavigate();
  return (
    <div className="mx-auto w-full max-w-[1440px] px-8 py-8">
      <nav className="text-[13px] text-muted" aria-label="Breadcrumb">
        <Link to="/clients" className="hover:text-ink">
          Clients
        </Link>
        <span className="px-2">/</span>
        <span className="text-ink">Baskets</span>
      </nav>
      <h1 className="mt-4 font-display text-[28px] leading-tight text-ink">Baskets</h1>
      <p className="mt-1 max-w-3xl text-[13px] text-muted">
        Each basket is a client archetype, defined by time horizon, risk capacity, primary goal and liquidity needs. It answers who a model portfolio is for.
      </p>
      <section className="mt-6 overflow-x-auto rounded-xl border border-line bg-paper">
        <table className="w-full min-w-[900px] text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-[12px] text-muted">
              <th className="px-5 py-2.5 font-normal">Basket</th>
              <th className="px-3 py-2.5 font-normal">Time horizon</th>
              <th className="px-3 py-2.5 font-normal">Risk capacity</th>
              <th className="px-3 py-2.5 font-normal">Primary goal</th>
              <th className="px-3 py-2.5 font-normal">Liquidity needs</th>
              <th className="px-5 py-2.5 text-right font-normal">Clients</th>
            </tr>
          </thead>
          <tbody>
            {BASKETS.map((b) => (
              <tr
                key={b.id}
                onClick={() => navigate(`/baskets/${b.id}`)}
                onKeyDown={(e) => e.key === "Enter" && navigate(`/baskets/${b.id}`)}
                tabIndex={0}
                className="cursor-pointer border-b border-line align-top last:border-0 hover:bg-paper-2 focus:bg-paper-2 focus:outline-none"
              >
                <td className="px-5 py-3.5">
                  <span className="block font-semibold text-ink">
                    {b.code} · {b.name}
                  </span>
                  {b.profile ? (
                    <span className="text-[12px] text-brand-800">Model portfolio live</span>
                  ) : (
                    <span className="text-[12px] text-muted">Model portfolio not set up yet</span>
                  )}
                </td>
                <td className="px-3 py-3.5 text-ink-2">{b.horizon}</td>
                <td className="px-3 py-3.5 text-ink-2">{b.riskCapacity}</td>
                <td className="max-w-[280px] px-3 py-3.5 text-ink-2">{b.goal}</td>
                <td className="px-3 py-3.5 text-ink-2">{b.liquidity}</td>
                <td className="px-5 py-3.5 text-right tabular-nums text-ink">{clientsIn(b).length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

export function BasketView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const basket = basketById(id);
  const [filter, setFilter] = useState<SleeveFilter>("all");
  const members = basket ? clientsIn(basket) : [];
  const book = useBook(members, "MAX");
  const { allocation, data } = useCoreAllocation();

  if (!basket) {
    return (
      <div className="mx-auto w-full max-w-[1440px] px-8 py-8 text-sm text-muted">
        No such basket. <Link to="/baskets" className="font-semibold text-ink underline">Baskets</Link>
      </div>
    );
  }
  return (
    <div className="mx-auto w-full max-w-[1440px] px-8 py-8">
      <nav className="text-[13px] text-muted" aria-label="Breadcrumb">
        <Link to="/clients" className="hover:text-ink">
          Clients
        </Link>
        <span className="px-2">/</span>
        <Link to="/baskets" className="hover:text-ink">
          Baskets
        </Link>
        <span className="px-2">/</span>
        <span className="text-ink">{basket.code}</span>
      </nav>
      <header className="mt-4 flex flex-wrap items-end justify-between gap-6">
        <div>
          <span className="inline-block rounded-md bg-lilac px-2 py-0.5 text-[12px] font-semibold text-ink">{basket.code}</span>
          <h1 className="mt-2 font-display text-[28px] leading-tight text-ink">{basket.name}</h1>
          <p className="mt-1 max-w-2xl text-[13px] text-muted">{basket.goal}</p>
        </div>
        <dl className="flex flex-wrap gap-x-10 gap-y-3">
          <div>
            <dt className="text-[12px] text-muted">Clients</dt>
            <dd className="mt-1 text-[22px] font-semibold tabular-nums text-ink">{members.length}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-muted">AUM</dt>
            <dd className="mt-1 text-[22px] font-semibold tabular-nums text-ink">{members.length === 0 ? "–" : book.loading ? "…" : formatRupees(Math.round(book.total))}</dd>
          </div>
        </dl>
      </header>

      <div className="mt-6 grid grid-cols-2 rounded-xl border border-line sm:grid-cols-4 sm:divide-x sm:divide-line">
        <Def label="Time horizon" value={basket.horizon} />
        <Def label="Risk capacity" value={basket.riskCapacity} />
        <Def label="Primary goal" value={basket.goal} />
        <Def label="Liquidity needs" value={basket.liquidity} />
      </div>

      <div className="mt-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        {basket.profile && allocation ? (
          <SleeveAllocation
            allocation={allocation}
            filter={filter}
            onFilter={setFilter}
            title="Model portfolio"
            subtitle={
              <>
                {allocation.rollup.length} sleeves · {data?.version.kind === "draft" ? "shared draft" : "published"}, as of {data?.version.as_of}
              </>
            }
          />
        ) : (
          <section className="rounded-xl border border-line bg-paper px-5 py-6">
            <h2 className="text-lg font-semibold text-ink">Model portfolio</h2>
            <p className="mt-2 text-[13px] text-muted">
              {basket.profile ? "Loading the model allocation…" : `The model portfolio for ${basket.name} is not set up yet, so clients cannot be placed in this basket.`}
            </p>
          </section>
        )}
        <section className="overflow-hidden rounded-xl border border-line bg-paper">
          <h2 className="px-5 pb-3 pt-5 text-lg font-semibold text-ink">Clients in {basket.code}</h2>
          {members.length === 0 ? (
            <p className="border-t border-line px-5 py-6 text-[13px] text-muted">No clients yet.</p>
          ) : (
            <ul className="divide-y divide-line border-t border-line">
              {book.clients
                .slice()
                .sort((a, b) => b.value - a.value)
                .map((c) => (
                  <li key={c.client.id}>
                    <button
                      type="button"
                      onClick={() => navigate(`/clients/${c.client.id}`)}
                      className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-paper-2"
                    >
                      <span>
                        <span className="block text-[13px] font-semibold text-ink">{c.client.name}</span>
                        <span className="text-[12px] text-muted">{c.client.city}</span>
                      </span>
                      <span className="text-[13px] tabular-nums text-ink">{formatRupees(Math.round(c.value))}</span>
                    </button>
                  </li>
                ))}
            </ul>
          )}
          {basket.profile && (
            <div className="border-t border-line px-5 py-3">
              <Pill tone="green">Model portfolio live</Pill>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Def({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-line px-5 py-4 [&:nth-child(n+3)]:border-t sm:[&:nth-child(n+3)]:border-t-0">
      <p className="text-[13px] text-muted">{label}</p>
      <p className="mt-1 text-[14px] font-semibold text-ink">{value}</p>
    </div>
  );
}
