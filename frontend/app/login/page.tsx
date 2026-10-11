"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { z } from "zod";

const schema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M3 3l18 18" />
      <path d="M10.6 5.1A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7a10.7 10.7 0 0 0 5.4-1.4" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<string>("Checking the API…");
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    fetch("/api/backend/health")
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        setHealth(response.ok && body?.status === "ok" ? "API is reachable." : "API health check failed.");
      })
      .catch(() => setHealth("API is not reachable from this page."));
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = schema.safeParse({
      username: String(form.get("username") || ""),
      password: String(form.get("password") || ""),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message || "Check the form.");
      return;
    }
    setPending(true);
    setError(null);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed.data),
    });
    const body = await response.json().catch(() => null);
    setPending(false);
    if (!response.ok) {
      setError(body?.error?.message || "Login failed.");
      return;
    }
    window.location.href = "/";
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <Link href="/" className="mb-8 text-sm text-slate-500 hover:text-tide">
        ← Back to home
      </Link>
      <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Private dashboard</p>
      <h1 className="mt-2 text-3xl font-semibold">Soccer Prediction Lab</h1>
      <p className="mt-3 text-sm text-slate-600">Sign in to review fixtures, model estimates, and daily high-probability picks. Nothing on this site places a bet.</p>
      <p className="mt-4 text-sm text-slate-500" role="status">{health}</p>
      <form className="panel mt-4 space-y-4 p-5" onSubmit={onSubmit}>
        <label className="block text-sm">
          Username
          <input name="username" autoComplete="username" className="mt-1 w-full rounded-xl border border-line px-3 py-2" />
        </label>
        <div className="text-sm">
          <label htmlFor="password">Password</label>
          <div className="relative mt-1">
            <input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              className="w-full rounded-xl border border-line py-2 pl-3 pr-16"
            />
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              aria-controls="password"
              className="absolute inset-y-1 right-1 flex items-center rounded-lg px-3 text-xs font-medium text-tide hover:bg-mist"
            >
              {showPassword ? (
                <EyeOffIcon />
              ) : (
                <EyeIcon />
              )}
              <span className="ml-1">{showPassword ? "Hide" : "Show"}</span>
            </button>
          </div>
        </div>
        {error ? <p className="text-sm text-rose-700">{error}</p> : null}
        <button type="submit" disabled={pending} className="rounded-full bg-tide px-4 py-2 text-sm text-white disabled:opacity-60">
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
