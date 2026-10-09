"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/markets", label: "Markets" },
  { href: "/slips", label: "Slip lab" },
  { href: "/bookmakers", label: "Bookmakers" },
  { href: "/performance", label: "Performance" },
  { href: "/settings", label: "Data" },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Personal research</p>
            <p className="text-lg font-semibold">Soccer Prediction Lab</p>
          </div>
          <button
            type="button"
            className="rounded-full border border-line px-3 py-1.5 text-sm text-slate-600"
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              window.location.href = "/login";
            }}
          >
            Sign out
          </button>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pb-3" aria-label="Primary">
          {LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-full px-3 py-1.5 text-sm ${active ? "bg-ink text-white" : "text-slate-600 hover:bg-slate-100"}`}
                aria-current={active ? "page" : undefined}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      <footer className="mx-auto max-w-6xl px-4 pb-8 text-sm text-slate-500">
        Estimated probabilities are not guarantees. Verify every selection and price on the bookmaker. This application does not place bets.
      </footer>
    </div>
  );
}
