# Show sample task completion trend

## Goal
Add realistic sample completed tasks so the existing Task Completion Trend displays a useful weekly pattern, without changing the dashboard architecture or layout.

## Changes
- Add an idempotent database migration containing a small set of completed sample tasks across the current week.
- Spread task creation and completion timestamps across multiple days so both chart lines have meaningful variation.
- Keep every sample task within the existing UPC organization and projects, assigned to the existing admin user.
- Add matching completion activity records with the same historical timestamps so Recent Activity remains consistent with the sample history.
- Apply the sample data to the current backend, then verify dashboard totals, chart rendering, tooltips, and mobile layout.

## Technical details
- Use fixed UUIDs and conflict-safe inserts so the migration can run only once without duplicates.
- Insert completed tasks directly with `status = 'done'`, `progress = 100`, and explicit `created_at`, `completed_at`, and `updated_at` values.
- Preserve all existing tables, policies, functions, components, filters, and navigation.
