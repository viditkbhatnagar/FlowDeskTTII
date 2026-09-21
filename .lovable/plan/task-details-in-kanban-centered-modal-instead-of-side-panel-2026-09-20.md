# Task details in Kanban: centered modal instead of side panel

## The problem

Clicking a task on the Kanban board opens the task details in a right-side panel. That's fine next to a list, but on a Kanban board with more than 4 stages the panel squeezes the columns, the board shifts sideways, and you lose the visual context of where the card sits in the workflow.

## Recommended option: centered modal for Kanban

The best option for a multi-stage Kanban board is a **centered modal (dialog) over a dimmed board**:

- Columns keep their width and position — nothing reflows or jumps.
- The whole board stays faintly visible behind, so you never lose the workflow context.
- The task details get a wider, two-column-friendly space instead of a narrow side strip.
- This is the standard pattern in Trello, Asana and Linear board views — familiar and proven.

The right-side panel stays where it already works well: **List view** (and the Dashboard deep links), where the panel sits beside the list without squeezing anything.

## What changes

1. **TaskDetailDrawer becomes view-aware** (`src/components/workspace/TaskDetailDrawer.tsx`):
   - New optional prop `variant: "sheet" | "modal"` (default `"sheet"`).
   - `"modal"` renders the same content inside a centered `Dialog` — wider (`max-w-2xl`/`3xl`), comfortable two-column layout for the details grid, same sections (status, blocked switch, progress, subtasks, comments, attachments, activity).
2. **KanbanBoard opens the modal variant** — My Tasks, Team Tasks, and Project Workspace Kanban boards pass `variant="modal"`; their List views keep the side panel.
3. **No other changes** — same task data, same editing controls, same deep links (`task:<id>` still opens the panel on Dashboard, where sheet stays). No data, workflow, or permission changes.

## Technical notes

- Files touched: `TaskDetailDrawer.tsx` (variant support), `KanbanBoard.tsx` / its callers in `MyTasksPage.tsx`, `TeamTasksPage.tsx`, `ProjectWorkspace.tsx` (pass the variant when the view is Kanban).
- Uses the existing shadcn `Dialog` — no new dependencies, design tokens preserved.
- Verified on desktop and mobile after implementation (modal centers and scrolls correctly on small screens).

## Verification

- Open Kanban with many stages, click a task → centered modal, board does not move.
- List view still opens the right-side panel.
- Dashboard task deep links still work.
