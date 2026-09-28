"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatLossTick } from "@/lib/format";
import type { TrainingRun } from "@/lib/types";
import { Panel, SegmentedToggle } from "./Panel";

const TRAIN = "var(--series-1)";
const VAL = "var(--series-2)";

function LineKey({ color }: { color: string }) {
  return (
    <svg width="18" height="8" aria-hidden="true" className="shrink-0">
      <line x1="1" y1="4" x2="17" y2="4" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

interface Row {
  epoch: number;
  train: number;
  val: number;
}

function LossTooltip({ active, payload, best }: { active?: boolean; payload?: { payload: Row }[]; best: number }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-sm">
      <div className="font-semibold text-ink">
        Epoch {r.epoch}
        {r.epoch === best && <span className="ml-1.5 font-normal text-ink-2">· deployed</span>}
      </div>
      <div className="tabular mt-1 grid grid-cols-[auto_auto_auto] items-center gap-x-2 text-ink-2">
        <LineKey color={TRAIN} />
        <span>Training</span>
        <span className="text-right text-ink">{r.train.toFixed(3)}</span>
        <LineKey color={VAL} />
        <span>Validation</span>
        <span className="text-right text-ink">{r.val.toFixed(3)}</span>
        <span />
        <span>Gap</span>
        <span className="text-right text-ink">{(r.val - r.train).toFixed(3)}</span>
      </div>
    </div>
  );
}

function Fact({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-ink-2">{label}</div>
      <div className="text-sm font-semibold text-ink">{value}</div>
      {detail && <div className="text-xs text-muted">{detail}</div>}
    </div>
  );
}

/**
 * Training vs. validation loss per epoch for one model version, chosen from every run
 * the model service keeps this session (newest first). "Latest" follows new retrains.
 */
export function ModelLossChart({
  versions,
  selected,
  onSelect,
  run,
}: {
  /** Kept runs, newest first (history may be omitted). */
  versions: TrainingRun[];
  /** Explicitly chosen version, or null to follow the latest. */
  selected: number | null;
  onSelect: (version: number | null) => void;
  /** Full run (with history) for the version being shown, once loaded. */
  run: TrainingRun | null;
}) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const latest = versions[0]?.version;
  const rows: Row[] = useMemo(
    () => (run?.history ?? []).map((h, i) => ({ epoch: i + 1, train: h.train_loss, val: h.val_loss })),
    [run],
  );
  const best = run ? run.best_epoch + 1 : 0;

  const picker = (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-1.5 text-xs text-ink-2">
        Model version
        <select
          value={selected ?? "latest"}
          onChange={(e) => onSelect(e.target.value === "latest" ? null : Number(e.target.value))}
          className="rounded-md border border-line bg-page px-2 py-1 text-xs text-ink outline-none focus:border-accent"
        >
          <option value="latest">Latest{latest != null ? ` (v${latest})` : ""}</option>
          {versions.map((v) => (
            <option key={v.version} value={v.version}>
              v{v.version} · {v.reason} · t={v.interval}
            </option>
          ))}
        </select>
      </label>
      <SegmentedToggle
        label="View"
        value={view}
        onChange={setView}
        options={[
          { value: "chart", label: "Chart" },
          { value: "table", label: "Table" },
        ]}
      />
    </div>
  );

  return (
    <Panel
      title="Model version · training vs. validation loss"
      subtitle={`Per-epoch curves for one kept model version (${versions.length} this session). Pick an older version to compare how it trained.`}
      actions={picker}
    >
      {!run ? (
        <div className="grid h-64 place-items-center text-sm text-muted">No training runs yet…</div>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Fact label="Version" value={`v${run.version} · ${run.reason}`} detail={`Trained at interval ${run.interval}`} />
            <Fact
              label="Deployed epoch"
              value={`${best} of ${run.epochs_run}`}
              detail={run.stopped_early ? "Stopped early" : `Hit max epochs (${run.config.max_epochs})`}
            />
            <Fact
              label="Loss at deployed epoch"
              value={`${run.history[run.best_epoch]?.train_loss.toFixed(3)} / ${run.val_loss.toFixed(3)}`}
              detail="training / validation"
            />
            <Fact
              label="Split"
              value={run.split_method === "temporal" ? "Recent intervals" : "Random rows"}
              detail={`${run.n_train} train · ${run.n_val} validation rows`}
            />
          </div>

          {view === "chart" ? (
            <>
              <ul className="mb-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2" aria-label="Legend">
                <li className="flex items-center gap-1.5">
                  <LineKey color={TRAIN} />
                  Training loss
                </li>
                <li className="flex items-center gap-1.5">
                  <LineKey color={VAL} />
                  Validation loss
                </li>
              </ul>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={rows} margin={{ top: 16, right: 16, bottom: 4, left: -8 }}>
                    <CartesianGrid stroke="var(--grid)" strokeWidth={1} vertical={false} />
                    <XAxis
                      dataKey="epoch"
                      type="number"
                      domain={[1, "dataMax"]}
                      allowDecimals={false}
                      tick={{ fill: "var(--muted)", fontSize: 11 }}
                      tickLine={false}
                      axisLine={{ stroke: "var(--axis)" }}
                      label={{ value: "Epoch", position: "insideBottomRight", offset: -2, fill: "var(--muted)", fontSize: 11 }}
                    />
                    <YAxis
                      domain={[0, "auto"]}
                      tickFormatter={formatLossTick}
                      tick={{ fill: "var(--muted)", fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      width={48}
                    />
                    <ReferenceLine
                      x={best}
                      stroke="var(--axis)"
                      strokeWidth={1}
                      label={{ value: "deployed", position: "top", fill: "var(--ink-2)", fontSize: 11 }}
                    />
                    <Tooltip content={<LossTooltip best={best} />} cursor={{ stroke: "var(--axis)", strokeWidth: 1 }} />
                    <Line
                      dataKey="train"
                      stroke={TRAIN}
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      dot={false}
                      activeDot={{ r: 4, fill: TRAIN, stroke: "var(--surface)", strokeWidth: 2 }}
                      isAnimationActive={false}
                    />
                    <Line
                      dataKey="val"
                      stroke={VAL}
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      dot={false}
                      activeDot={{ r: 4, fill: VAL, stroke: "var(--surface)", strokeWidth: 2 }}
                      isAnimationActive={false}
                    />
                    <ReferenceDot x={best} y={run.val_loss} r={5} fill={VAL} stroke="var(--surface)" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          ) : (
            <div className="max-h-72 overflow-auto">
              <table className="tabular w-full text-left text-xs">
                <thead className="sticky top-0 bg-surface text-ink-2">
                  <tr>
                    <th className="py-1.5 pr-3 font-medium">Epoch</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Train loss</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Val loss</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Train acc</th>
                    <th className="py-1.5 text-right font-medium">Val acc</th>
                  </tr>
                </thead>
                <tbody>
                  {run.history.map((h, i) => (
                    <tr key={i} className={`border-t border-line ${i === run.best_epoch ? "font-semibold text-ink" : ""}`}>
                      <td className="py-1 pr-3">
                        {i + 1}
                        {i === run.best_epoch ? " · deployed" : ""}
                      </td>
                      <td className="py-1 pr-3 text-right">{h.train_loss.toFixed(3)}</td>
                      <td className="py-1 pr-3 text-right">{h.val_loss.toFixed(3)}</td>
                      <td className="py-1 pr-3 text-right">{(h.train_accuracy * 100).toFixed(1)}%</td>
                      <td className="py-1 text-right">{(h.val_accuracy * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
