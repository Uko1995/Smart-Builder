"use client";

import { FormEvent, useEffect, useState } from "react";
import { z } from "zod";

const schema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<string>("Checking the API…");
  const [pending, setPending] = useState(false);

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
      <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Private dashboard</p>
      <h1 className="mt-2 text-3xl font-semibold">Soccer Prediction Lab</h1>
      <p className="mt-3 text-sm text-slate-600">Sign in to review fixtures, model estimates, and candidate slips. Nothing on this site places a bet.</p>
      <p className="mt-4 text-sm text-slate-500" role="status">{health}</p>
      <form className="panel mt-4 space-y-4 p-5" onSubmit={onSubmit}>
        <label className="block text-sm">
          Username
          <input name="username" autoComplete="username" className="mt-1 w-full rounded-xl border border-line px-3 py-2" />
        </label>
        <label className="block text-sm">
          Password
          <input name="password" type="password" autoComplete="current-password" className="mt-1 w-full rounded-xl border border-line px-3 py-2" />
        </label>
        {error ? <p className="text-sm text-rose-700">{error}</p> : null}
        <button type="submit" disabled={pending} className="rounded-full bg-tide px-4 py-2 text-sm text-white disabled:opacity-60">
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
