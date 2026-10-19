import type { Logger } from '@nestjs/common';

/** AUDITORÍA: todo log de un job lleva `job_id` y `ai_model_used`. */
export interface JobLogContext {
  job_id: string;
  ai_model_used: string;
}

export function logJobEvent(
  logger: Logger,
  ctx: JobLogContext,
  event: string,
  fields: Record<string, unknown> = {},
): void {
  logger.log(JSON.stringify({ event, ...ctx, ...fields }));
}

export function logJobError(
  logger: Logger,
  ctx: JobLogContext,
  event: string,
  fields: Record<string, unknown> = {},
): void {
  logger.error(JSON.stringify({ event, ...ctx, ...fields }));
}
