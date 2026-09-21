ALTER FUNCTION public.track_work_task_activity() SET SCHEMA private;
ALTER FUNCTION public.track_milestone_completion() SET SCHEMA private;
REVOKE ALL ON FUNCTION private.track_work_task_activity() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.track_milestone_completion() FROM PUBLIC, anon, authenticated;