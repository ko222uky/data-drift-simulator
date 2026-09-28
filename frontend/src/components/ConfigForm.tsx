"use client";

import { useState } from "react";
import { Button } from "./ui";

type Primitive = number | string;

interface BaseField<T> {
  key: keyof T & string;
  label: string;
  /** README symbol (i, w, I, r, n), shown in italics after the label. */
  symbol?: string;
  help?: string;
  /** Live caption under the input, computed from the current draft value. */
  describe?: (value: string) => string | null;
}

export interface NumberFieldSpec<T> extends BaseField<T> {
  kind?: "number";
  step: number | "any";
  min: number;
  max: number;
}

export interface ChoiceFieldSpec<T> extends BaseField<T> {
  kind: "choice";
  options: { value: string; label: string }[];
}

export type FieldSpec<T> = NumberFieldSpec<T> | ChoiceFieldSpec<T>;

const inputClass =
  "tabular rounded-md border border-line bg-page px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent disabled:opacity-70";

/**
 * Settings form for numeric and choice fields. Mount it with `key={JSON.stringify(config)}`
 * so the draft re-seeds whenever the saved server-side values change. Only changed
 * fields are sent.
 */
export function ConfigForm<T extends { [K in keyof T]: Primitive }>({
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
      const raw = draft[f.key];
      const value = f.kind === "choice" ? raw : Number(raw);
      if (typeof value === "number" && Number.isNaN(value)) continue;
      if (value !== config[f.key]) changes[f.key] = value as T[typeof f.key];
    }
    if (Object.keys(changes).length > 0) onSave(changes);
  }

  const set = (key: string, value: string) => setDraft((d) => ({ ...d, [key]: value }));

  return (
    <form onSubmit={save}>
      <fieldset disabled={readOnly} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {fields.map((f) => {
          const caption = f.describe?.(draft[f.key]);
          return (
            <label key={f.key} className="flex flex-col gap-1 text-xs text-ink-2" title={f.help}>
              <span>
                {f.label}
                {f.symbol && <em className="ml-1 text-ink">{f.symbol}</em>}
              </span>
              {f.kind === "choice" ? (
                <select value={draft[f.key]} onChange={(e) => set(f.key, e.target.value)} className={inputClass}>
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="number"
                  step={f.step}
                  min={f.min}
                  max={f.max}
                  required
                  value={draft[f.key]}
                  onChange={(e) => set(f.key, e.target.value)}
                  className={inputClass}
                />
              )}
              {caption && <span className="text-muted">{caption}</span>}
            </label>
          );
        })}
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
