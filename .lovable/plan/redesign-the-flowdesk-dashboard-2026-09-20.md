# Redesign the Flowdesk Dashboard

## Goal
Replace the duplicated task board on Dashboard with a compact, actionable overview that uses the same organization access, roles, tasks, projects, and task-detail experience as the rest of Flowdesk.

## Current-state constraint
The existing task, project, milestone, and operational activity records are largely browser-only demo data. The backend currently stores organizations, memberships, roles, and profiles only. Accurate completion trends, blocked work, reviewer-specific actions, organization-secure summaries, and durable cross-page filters cannot be implemented truthfully without persisting the operational records first.

## What will change

### 1. Secure shared work data
- Add organization-scoped projects, tasks, project milestones, and activity records to Lovable Cloud.
- Add the smallest required task fields: project and organization ownership, assignee, reviewer, blocked state, due date/time, created timestamp, and real completion timestamp.
- Preserve existing status values and project-health meanings rather than creating competing definitions.
- Add access rules so employees see their authorized records and management views require the existing admin, manager, or team-lead roles.
- Keep completion timestamps null for old completed records when no trustworthy completion time exists; those records will not be counted in period metrics.

### 2. Shared data and permissions
- Replace Dashboard-only mock calculations with one shared, permission-aware dashboard query and mutation layer.
- Reuse organization memberships and roles to determine available organizations, My Overview, Team Overview, review actions, assignment actions, and organization labels.
- Revalidate saved organization/scope preferences when memberships or roles change.
- Persist valid Dashboard filter preferences locally, matching the app’s existing preference convention.
- Use the selected organization timezone for date-only due dates; use the user’s primary organization timezone for All Organizations.

### 3. Dashboard header and filters
- Show the authenticated profile name, requested supporting text, organization selector, overview scope selector, reporting period, custom date range, and existing New Task action.
- Show All Organizations only for multi-organization users and Team Overview only when their existing role grants management reporting access.
- Make every widget use the same organization, scope, and period.

### 4. Actionable summary and work panels
- Replace the existing KPI row with six clickable cards: Open Tasks, Due Today, Overdue, Awaiting Review, Blocked Tasks, and Completed.
- Remove Productivity and all Dashboard Board/List/Calendar controls, Kanban cards, and drag instructions.
- Add Needs Attention with deduplicated urgency ranking, permission-aware Review/Assign/Open actions, and the existing task-detail drawer.
- Add Upcoming Deadlines for incomplete tasks and existing milestones in Today, Tomorrow, and Next 5 days groups.
- Add Organization Overview only for authorized multi-organization Team Overview.
- Add Project Health using task-derived progress and transparent Delayed → At risk → On track → No schedule rules.
- Add Team Workload counts without utilization or productivity scoring.
- Add Task Completion Trend from real created/completed timestamps, with accessible chart and readable totals.
- Replace Notifications with Recent Activity sourced from actual operational activity records.

### 5. Linked existing pages
- Add URL-backed filters to My Tasks and Team Tasks for status, due state, blocked state, assignee, review action, organization, and compound “needs attention” views.
- Dashboard cards, rows, “View all,” project rows, and member rows will open the matching existing page or task/project detail state.
- Keep all existing My Tasks and Team Tasks views intact.

### 6. States and responsive layout
- Add loading skeletons, explicit empty states, and visible error states so failed reads never appear as zero.
- Use six cards on wide screens, three on tablets, and two on mobile.
- Follow the requested two-thirds/one-third panel layout and stack panels in priority order on mobile.
- Keep status text alongside color, keyboard-visible focus, accessible chart details/tooltips, and reduced-motion behavior.

## Technical details
- Use authenticated server functions for scoped reads and mutations; server-side access checks and row-level policies enforce organization boundaries.
- Use TanStack Query for cache priming, refresh after task changes, and stale-data clearing during scope changes.
- Record task creation, completion, review submission, assignment changes, due-date changes, and milestone completion as durable activity events.
- Seed only the existing visible demo projects/tasks where they can be mapped safely to the test organization; do not fabricate historical completion timestamps or trend history.
- The Dashboard remains inside the existing authenticated workspace and preserves the current sidebar, header search, theme, typography, tokens, and non-Dashboard pages.

## Verification
- Compare every summary count with its linked filtered task page.
- Test authorization across organization and role scopes, including removal of stale saved preferences.
- Test date-only and timed deadlines at timezone boundaries, completed exclusions, deduplication, and period completion counts.
- Test task/project links, review/assignment permissions, loading/error/empty states, and cache refresh after updates.
- Verify desktop, tablet, and mobile layouts plus keyboard and reduced-motion behavior.

## Known external limitation
Password-recovery email still needs an owned email domain; this Dashboard work does not change that existing configuration requirement.
