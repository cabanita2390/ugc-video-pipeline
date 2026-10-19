export interface RenderJobAccepted {
  job_id: string;
  status: 'queued';
  ai_model_used: string;
}
