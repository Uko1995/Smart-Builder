import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Soccer Prediction Lab · Daily high-probability football picks",
  description: "Bookmaker-implied probabilities with the margin removed, checked against a Poisson model built on 15 seasons of results.",
};

const SAMPLE_PICKS = [
  { match: "Arsenal vs Leeds", market: "Over 1.5 goals", book: 75, model: 75, odds: "1.22" },
  { match: "Real Madrid vs Villarreal", market: "Home win", book: 70, model: 61, odds: "1.40" },
  { match: "Vallecano vs Ath Bilbao", market: "Under 3.5 goals", book: 70, model: 71, odds: "1.32" },
];

const TABS = ["All", "Home wins", "Away wins", "Over 1.5", "Over 2.5", "Under 2.5", "Under 3.5", "BTTS Yes"];

const STEPS = [
  {
    title: "Collect",
    body: "Fixtures and results from 38 leagues since 2012, plus current odds from licensed feeds. Every price is stored with the time it was captured.",
  },
  {
    title: "Estimate",
    body: "Bookmaker odds are converted to probabilities with the margin removed. A Dixon-Coles Poisson model gives an independent second opinion.",
  },
  {
    title: "Rank",
    body: "The day's priced selections are ranked by probability and split into tabs by market. Results are graded automatically after full time.",
  },
];

function Bar({ value, tone }: { value: number; tone: "tide" | "lime" }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-line" aria-hidden>
      <div className={`h-1.5 rounded-full ${tone === "tide" ? "bg-tide" : "bg-lime"}`} style={{ width: `${value}%` }} />
    </div>
  );
}

export default function WelcomePage() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5">
        <span className="flex items-center gap-2 font-semibold">
          <span className="inline-block h-6 w-6 rounded-full bg-tide" aria-hidden />
          Soccer Prediction Lab
        </span>
        <Link href="/login" className="rounded-full border border-line bg-white px-4 py-2 text-sm hover:border-tide">
          Sign in
        </Link>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-10 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-tide">Football probability research</p>
            <h1 className="mt-3 text-4xl font-semibold leading-tight sm:text-5xl">
              Today&apos;s most likely outcomes, without the bookmaker&apos;s margin.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-slate-600">
              Every morning the lab pulls fresh odds, strips out the overround, and checks each price against a model trained on 170,000
              matches. You get one ranked board, split by market.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/login" className="rounded-full bg-tide px-6 py-3 text-sm font-medium text-white hover:opacity-90">
                Sign in to the dashboard
              </Link>
              <a href="#how-it-works" className="rounded-full border border-line bg-white px-6 py-3 text-sm hover:border-tide">
                How it works
              </a>
            </div>
            <dl className="mt-10 grid max-w-lg grid-cols-3 gap-4">
              {[
                ["38", "leagues"],
                ["15", "seasons of results"],
                ["Daily", "automatic refresh"],
              ].map(([value, label]) => (
                <div key={label}>
                  <dt className="sr-only">{label}</dt>
                  <dd className="text-2xl font-semibold">{value}</dd>
                  <dd className="text-sm text-slate-500">{label}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="panel p-5" aria-label="Example of the daily picks board">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Daily picks</p>
              <span className="rounded-full bg-mist px-2 py-0.5 text-xs text-slate-500">Example</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {TABS.map((tab, index) => (
                <span
                  key={tab}
                  className={`rounded-full px-3 py-1 text-xs ${index === 0 ? "bg-ink text-white" : "border border-line text-slate-600"}`}
                >
                  {tab}
                </span>
              ))}
            </div>
            <ul className="mt-4 space-y-3">
              {SAMPLE_PICKS.map((pick) => (
                <li key={pick.match} className="rounded-xl border border-line p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{pick.match}</p>
                      <p className="text-xs text-slate-500">{pick.market}</p>
                    </div>
                    <span className="num text-sm">{pick.odds}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-[4.5rem_1fr_2.5rem] items-center gap-2 text-xs text-slate-500">
                    <span>Book</span>
                    <Bar value={pick.book} tone="tide" />
                    <span className="num text-right text-ink">{pick.book}%</span>
                    <span>Model</span>
                    <Bar value={pick.model} tone="lime" />
                    <span className="num text-right text-ink">{pick.model}%</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="how-it-works" className="border-y border-line bg-white">
          <div className="mx-auto max-w-6xl px-4 py-16">
            <h2 className="text-2xl font-semibold">How it works</h2>
            <ol className="mt-8 grid gap-6 md:grid-cols-3">
              {STEPS.map((step, index) => (
                <li key={step.title} className="rounded-2xl border border-line p-5">
                  <span className="num text-sm text-tide">0{index + 1}</span>
                  <h3 className="mt-2 font-medium">{step.title}</h3>
                  <p className="mt-2 text-sm text-slate-600">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16">
          <div className="grid gap-8 md:grid-cols-2">
            <div>
              <h2 className="text-2xl font-semibold">Honest by design</h2>
              <p className="mt-3 text-slate-600">
                Probabilities are estimates, not guarantees. Markets without enough data stay marked unavailable instead of being guessed,
                accuracy metrics are withheld until the sample is large enough, and synthetic demo data is always labelled.
              </p>
            </div>
            <ul className="space-y-3 text-sm text-slate-600">
              <li className="panel p-4">No bets are placed, and no bookmaker accounts are touched.</li>
              <li className="panel p-4">No accumulators. Each pick stands on its own probability.</li>
              <li className="panel p-4">Settled results are tracked so you can see how often each tab actually lands.</li>
            </ul>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-slate-500">
          <span>Soccer Prediction Lab · private research dashboard</span>
          <span>Gamble responsibly. 18+.</span>
        </div>
      </footer>
    </div>
  );
}
