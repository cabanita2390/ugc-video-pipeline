export const JOB_STATUSES = ['queued', 'rendering', 'done', 'failed'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/**
 * Contenido de `jobs/<job_id>/job.json`: registro de auditoría y fuente de verdad del estado.
 * Fechas en ISO 8601 (UTC). Los campos que aún no aplican van a `null`.
 */
export interface JobRecord {
  job_id: string;
  status: JobStatus;
  ai_model_used: string;
  hook: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  /** Duración del audio según ffprobe. */
  duration_seconds: number | null;
  /** Tiempo de `hyperframes render`. */
  render_ms: number | null;
  /** Mensaje corto si `status` es `failed`. */
  error: string | null;
}
