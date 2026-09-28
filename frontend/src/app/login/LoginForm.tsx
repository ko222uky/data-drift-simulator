"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/lib/auth";

/** Only allow same-site relative redirects (e.g. /mlflow/), never absolute URLs. */
function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export function LoginForm() {
  const { login } = useAuth();
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username, password);
      // /mlflow is not a Next.js route, so leave the app with a full navigation.
      if (next.startsWith("/mlflow")) window.location.assign(next);
      else router.push(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-6">
      <div>
        <h1 className="text-lg font-semibold">Operator sign in</h1>
        <p className="mt-1 text-sm text-ink-2">Required to control the simulation and open MLflow.</p>
      </div>
      <label className="flex flex-col gap-1 text-sm text-ink-2">
        Username
        <input
          autoComplete="username"
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="rounded-md border border-line bg-page px-3 py-2 text-ink outline-none focus:border-accent"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink-2">
        Password
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-md border border-line bg-page px-3 py-2 text-ink outline-none focus:border-accent"
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-critical">
          ⚠ {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-ink hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
