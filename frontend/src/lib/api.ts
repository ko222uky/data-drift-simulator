// Thin client for the gateway. All URLs are same-origin: the gateway routes
// /api/model/* to the model service and /api/auth/* to the auth service.

import type { MetricPoint, ModelEvent, MonitorConfig, Projection, Status, TrainingConfig, TrainingRun } from "./types";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    let message = res.statusText || `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") message = body.detail;
      else if (Array.isArray(body.detail)) message = body.detail.map((d: { msg: string }) => d.msg).join("; ");
    } catch {
      // Non-JSON error body (e.g. from the gateway); keep the status text.
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const modelApi = {
  status: () => request<Status>("/api/model/status"),
  metrics: (limit = 300) => request<MetricPoint[]>(`/api/model/metrics?limit=${limit}`),
  events: (limit = 50) => request<ModelEvent[]>(`/api/model/events?limit=${limit}`),
  projection: (maxPoints = 1500) => request<Projection>(`/api/model/projection?max_points=${maxPoints}`),
  updateConfig: (update: Partial<MonitorConfig>) =>
    request<MonitorConfig>("/api/model/config", { method: "PUT", body: JSON.stringify(update) }),
  trainings: (limit = 6) => request<TrainingRun[]>(`/api/model/trainings?limit=${limit}`),
  updateTrainingConfig: (update: Partial<TrainingConfig>) =>
    request<TrainingConfig>("/api/model/training-config", { method: "PUT", body: JSON.stringify(update) }),
  drift: () => post<{ detail: string }>("/api/model/drift"),
  retrain: () => post<{ detail: string }>("/api/model/retrain"),
  pause: () => post<{ detail: string }>("/api/model/pause"),
  resume: () => post<{ detail: string }>("/api/model/resume"),
  pauseAutoRetrain: () => post<{ detail: string }>("/api/model/auto-retrain/pause"),
  resumeAutoRetrain: () => post<{ detail: string }>("/api/model/auto-retrain/resume"),
  reset: () => post<{ detail: string }>("/api/model/reset"),
};

export const authApi = {
  login: (username: string, password: string) =>
    post<{ username: string; expires_in: number }>("/api/auth/login", { username, password }),
  logout: () => post<void>("/api/auth/logout"),
  me: () => request<{ username: string }>("/api/auth/me"),
};
