-- lovable-cron-fallback-reviewed: recurring tasks set to on_schedule need time-based creation without a preceding row change; a 15-minute maximum delay matches the task scheduling experience
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-scheduled-task-recurrences') THEN
    PERFORM cron.unschedule('process-scheduled-task-recurrences');
  END IF;
  PERFORM cron.schedule(
    'process-scheduled-task-recurrences',
    '*/15 * * * *',
    'SELECT public.process_scheduled_task_recurrences();'
  );
END
$$;