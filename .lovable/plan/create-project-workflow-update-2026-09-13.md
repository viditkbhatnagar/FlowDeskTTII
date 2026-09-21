# Create Project Workflow Update

## What will change
- Keep the existing modal styling while restructuring it into concise sections and responsive two-column rows.
- Add validated fields for project identity, optional template, classification, conditional client selection, ownership, priority/status, and start/end dates.
- Add searchable manager, department/team, client, and multi-select team-member controls using the app's existing people data and lightweight settings-style sample data.
- Keep attachments compact, support multiple files, show file metadata, and allow removal.
- Disable submission until required values are present; show inline errors only after interaction or submission, validate date ordering, prevent duplicate submissions, and show a success toast.
- Add the new project to the current project list and open its full Project Overview immediately after creation.
- Show a dismissible setup checklist near the top of the new project's Overview, with links to the relevant project tabs.

## Behavior details
- Internal projects hide Client; client projects require it.
- Project Manager is automatically included in the project team without duplicates.
- The generated project ID is created automatically in the current prototype data flow.
- Member suggestions prioritize the selected department/team but do not restrict other active users.
- Existing project list, cards, views, and styling remain unchanged outside the requested workflow.

## Technical notes
- Use existing design-system controls and add only missing lightweight popover/calendar wiring where needed.
- Keep creation state in the current client-side project experience; no persistent project database schema is introduced in this UI-focused update.
- Verify modal scrolling, sticky footer visibility, validation, conditional fields, member selection, file removal, creation loading, toast, and post-create navigation in the preview.
