export function QueryView({
  status,
  error,
  children,
}: {
  status: "loading" | "error" | "ready";
  error?: string | null;
  children: React.ReactNode;
}) {
  if (status === "loading") {
    return (
      <p className="panel px-5 py-8 text-sm text-slate-600" role="status">
        Loading stored data…
      </p>
    );
  }
  if (status === "error") {
    return (
      <p className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-800" role="alert">
        {error || "The request failed."}
      </p>
    );
  }
  return <>{children}</>;
}
