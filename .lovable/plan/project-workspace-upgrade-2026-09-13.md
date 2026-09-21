# Project Workspace Upgrade

## What will change
- Keep the existing Projects page, full-page project workspace, sidebar, navigation, typography, colors, buttons, radii, and spacing system.
- Refactor the current project detail implementation into focused tab sections without rebuilding the surrounding application shell.
- Keep exactly these tabs: Overview, Tasks, Team, Timeline, Documents, Activity.

## Shared workspace data
- Introduce one shared in-memory workspace store for projects, tasks, milestones, documents, members, and activity so every screen reads and updates the same records.
- Replace page-local task copies in Dashboard, My Tasks, Team Tasks, Project Tasks, Calendar, and Reports with shared selectors and mutations.
- Extend the standard task model with the fields needed by the existing Add Task flow: project, dates, subtasks, dependencies, attachments, tags, and estimates.
- Reuse one standard Add Task modal and one standard Task Detail drawer everywhere; project entry points prefill and lock the current project selection.
- Keep this prototype session-scoped, matching the application’s existing data model; no parallel “project task” entity will be introduced.

## Project header and actions
- Show Back to Projects, project avatar, name, and `Project ID · Type · Department/Category` on the left.
- Show lifecycle Status, subtle calculated Health, Add Task, and a More menu on the right.
- Add Edit, Change Status, Duplicate, Archive, and Delete actions, with confirmation dialogs for archive/delete and activity entries for meaningful changes.
- Calculate health from overdue critical tasks, delayed milestones, dependency blockers, and the project target date; expose the reason in a tooltip.

## Overview tab
- Make the setup checklist state-driven, show completion count/percentage, link incomplete steps to relevant tabs, remain dismissible, and disappear when complete.
- Add About this Project with permission-aware editing.
- Replace separate information tiles with one compact Project Summary row for manager, timeline, priority, team, and lifecycle status.
- Calculate progress from completed tasks only, with completed/in-progress/overdue counts and a proper no-task state.
- Add a restrained two-column Milestones and Attention Required section using real project/task conditions, not filler alerts.
- Add the latest five meaningful activity entries and a View All Activity action.

## Tasks tab
- Add task count, Add Task, compact status filters, List/Board toggle with remembered preference, search, assignee/status/priority/due-date filters, and sorting.
- Build a horizontally scrollable task table and a drag-and-drop board using the shared tasks.
- Open the standard Task Detail drawer when a task is selected.
- Add a complete empty state with Create First Task.

## Team tab
- Clearly identify the project manager and replace arbitrary productivity percentages with assigned, completed, overdue, and calculated workload states.
- Add a responsive team table and a member detail drawer scoped to this project’s tasks.
- Add searchable multi-select member management with department/team filters and duplicate prevention.
- Require reassignment before removing a member who owns active project tasks.

## Timeline tab
- Add Timeline and Milestones subviews without creating another top-level tab.
- Build a lightweight horizontally scrollable Gantt view with task ranges, progress, overdue treatment, milestones, and visible dependency relationships.
- Add Today, Week, Month, and Fit Project controls.
- Add a milestone table, Add Milestone dialog, related-task linking, and a compact upcoming-deadlines section.

## Documents tab
- Add document count, Upload action, search, file-type filter, sorting, and a responsive document table.
- Add document actions for preview, download, rename, replace, and confirmed delete.
- Support multiple-file drag/drop or browsing with upload progress, and add upload/delete events to Project Activity.
- Add the requested document empty state.

## Activity tab
- Add All Activity, Tasks, Team, Documents, and Project Changes filters.
- Render meaningful state-generated events chronologically and omit ordinary UI interactions.

## Permissions and responsive behavior
- Gate each visible action through explicit capability flags for task creation/assignment, project management, team management, milestones, documents, and deletion.
- Apply the same checks to mutation handlers; this prototype will not claim client-side capability checks as a server security boundary.
- Preserve desktop information density, allow tables and timelines to scroll on tablet, and stack complex rows only where necessary.

## Verification
- Verify project header actions, status/health distinction, checklist navigation, progress/attention calculations, task filtering and drag/drop, shared task updates across screens, member reassignment safeguards, milestone creation, document upload/actions, activity filters, and destructive confirmations.
- Check desktop and tablet layouts in the running preview and run the project’s TypeScript checks.
