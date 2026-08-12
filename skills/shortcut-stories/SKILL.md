---
name: shortcut-stories
description: Read Shortcut stories when the user asks about a Shortcut story, their assigned stories, or work tracked in Shortcut.
---

# Shortcut stories

Use `shortcut_list_assigned` to find stories assigned to the authenticated user.
Use `shortcut_get_story` when a specific numeric story id is known.

Treat Shortcut as the source of truth for the story title, description, state,
labels, estimate, and tasks. When referring to a story, use `sc-<id>` and include
its Shortcut URL when available.
