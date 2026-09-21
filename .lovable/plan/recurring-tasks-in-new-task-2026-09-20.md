# Recurring tasks in New Task

## What will be added

- Add a **Recurring task** switch inside the existing New Task dialog.
- When enabled, reveal a compact scheduling section with:
  - Frequency: daily, weekly, monthly, or yearly
  - Repeat interval, such as every 2 weeks
  - Weekly day selection when “Weekly” is chosen
  - Monthly pattern: same day of month or same weekday pattern
  - End condition: never, on a selected date, or after a chosen number of occurrences
- Show a plain-language summary before creation, such as “Repeats every 2 weeks on Monday and Friday until Dec 31, 2026.”
- Validate recurrence choices and reset hidden options when recurrence is turned off.

## Task behavior

- Save the recurrence rule with the task so it remains available after refresh.
- Create the first task using the date entered in the form.
- Let the user choose how the next occurrence is created: **on schedule**, even if the previous task is incomplete, or **after completion** of the current task. Both modes prevent duplicate occurrences.
- Link generated occurrences to the same recurrence series while keeping each task independently editable.
- Display the recurrence summary in task details.

## Technical details

- Add a secure organization-scoped recurrence table linked to work tasks, with access matching existing task permissions.
- Add a database trigger/function that generates the next occurrence after completion and respects the end date or occurrence limit.
- Extend the shared task model and New Task save flow to read and write recurrence details.
- Keep the current dialog structure, styling, task workflows, permissions, and non-recurring task behavior unchanged.

## Verification

- Create and persist daily, weekly, monthly, and yearly recurring tasks.
- Confirm conditional controls, validation, summaries, and responsive layout.
- Complete an occurrence and verify exactly one correctly dated next occurrence is created.
- Confirm recurrence stops at the selected end condition and ordinary tasks remain unchanged.
