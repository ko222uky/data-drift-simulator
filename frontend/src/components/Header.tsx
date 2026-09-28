"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth";

export function Header() {
  const { user, loading, logout } = useAuth();
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold text-ink">
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
            <polyline points="2,14 7,9 11,12 18,4" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Drift Monitor
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          {user && (
            // A plain <a>: /mlflow is served by MLflow through the gateway, not by Next.js.
            <a href="/mlflow/" target="_blank" rel="noreferrer" className="text-ink-2 hover:text-ink">
              MLflow ↗
            </a>
          )}
          {loading ? null : user ? (
            <button onClick={logout} className="text-ink-2 hover:text-ink">
              Sign out
            </button>
          ) : (
            <Link href="/login" className="rounded-md bg-accent px-3 py-1.5 font-medium text-accent-ink hover:opacity-90">
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
