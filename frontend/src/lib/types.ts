// Mirrors the model service's response schemas (services/model/src/model_service/schemas.py).

export type Phase = "starting" | "healthy" | "degraded" | "retraining" | "cooldown";

export interface MonitorConfig {
  batch_size: number;
  interval_seconds: number;
  accuracy_threshold: number;
  breach_intervals: number;
  window_intervals: number;
  retry_intervals: number;
  drift_rate: number;
}

export interface ModelInfo {
  version: number;
  trained_at_interval: number;
  reason: string;
  val_accuracy: number;
  n_train: number;
  mlflow_run_id: string | null;
}

export interface Status {
  session_id: string;
  interval: number;
  phase: Phase;
  paused: boolean;
  last_accuracy: number | null;
  consecutive_breaches: number;
  retry_at_interval: number | null;
  drift: { active: boolean; progress: number | null };
  model: ModelInfo | null;
  problem: { n_features: number; n_classes: number; initial_size: number; [key: string]: number };
  config: MonitorConfig;
  mlflow_enabled: boolean;
}

export interface MetricPoint {
  interval: number;
  created_at: string;
  accuracy: number;
  loss: number;
  n: number;
  model_version: number;
  drift_progress: number | null;
}

export interface ModelEvent {
  id: number;
  interval: number;
  created_at: string;
  kind: string;
  message: string;
  data: Record<string, unknown>;
}

export interface ProjectedPoint {
  x: number;
  y: number;
  label: number;
  prediction: number | null;
  interval: number;
  in_window: boolean;
}

export interface ProjectedCenter {
  label: number;
  x: number;
  y: number;
}

export interface Projection {
  interval: number;
  window_start: number;
  points: ProjectedPoint[];
  centers: ProjectedCenter[];
  targets: ProjectedCenter[];
}
