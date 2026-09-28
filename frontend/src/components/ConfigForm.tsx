"use client";

import { useState } from "react";
import { Button } from "./ui";

export interface FieldSpec<T> {
  key: keyof T & string;
  label: string;
  /** README symbol (i, w, I, r, n), shown in italics after the label. */
  symbol?: string;
  step: number | "any";
  min: number;
  max: number;
  help?: string;
}

/**
 * Numeric settings form. Mount it with `key={JSON.stringify(config)}` so the draft
 * re-seeds whenever the saved server-side values change. Only changed fields are sent.
 */
export function ConfigForm<T extends { [K in keyof T]: number }>({
  fields,
  config,
  busy,
  readOnly = false,
  submitLabel,
  onSave,
}: {
  fields: FieldSpec<T>[];
  config: T;
  busy: boolean;
  readOnly?: boolean;
  submitLabel: string;
  onSave: (changes: Partial<T>) => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, String(config[f.key])])),
  );

  function save(e: React.FormEvent) {
    e.preventDefault();
    const changes: Partial<T> = {};
    for (const f of fields) {
      const value = Number(draft[f.key]);
      if (!Number.isNaN(value) && value !== config[f.key]) changes[f.key] = value as T[typeof f.key];
    }
    if (Object.keys(changes).length > 0) onSave(changes);
  }

  return (
    <form onSubmit={save}>
      <fieldset disabled={readOnly} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {fields.map((f) => (
          <label key={f.key} className="flex flex-col gap-1 text-xs text-ink-2" title={f.help}>
            <span>
              {f.label}
              {f.symbol && <em className="ml-1 text-ink">{f.symbol}</em>}
            </span>
            <input
              type="number"
              step={f.step}
              min={f.min}
              max={f.max}
              required
              value={draft[f.key]}
              onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
              className="tabular rounded-md border border-line bg-page px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent disabled:opacity-70"
            />
          </label>
        ))}
      </fieldset>
      {!readOnly && (
        <div className="mt-4">
          <Button type="submit" disabled={busy}>
            {submitLabel}
          </Button>
        </div>
      )}
    </form>
  );
}
