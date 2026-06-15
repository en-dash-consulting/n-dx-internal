---
id: "a85cb98b-25b1-4efd-854c-8d0303ac7d80"
level: "task"
title: "Integrate Google OAuth flow into ndx init and ndx config with browser-launch UX"
status: "completed"
priority: "high"
tags:
  - "auth"
  - "google"
  - "cli"
  - "llm-client"
source: "smart-add"
startedAt: "2026-06-15T14:41:41.942Z"
completedAt: "2026-06-15T14:55:09.749Z"
endedAt: "2026-06-15T14:55:09.749Z"
acceptanceCriteria:
  - "ndx init Google provider step offers 'Browser (OAuth)' and 'API Key' as distinct options"
  - "Selecting 'Browser (OAuth)' triggers the browser-launch flow and confirms success before proceeding"
  - "ndx config exposes a `llm.google.authMethod` field accepting 'oauth' or 'apikey'"
  - "All user-action prompts and wait messages in the Google auth flow are yellow"
  - "`ndx auth google` standalone command appears in ndx --help and triggers re-authentication"
  - "Re-running ndx init when OAuth credentials already exist skips the browser flow and prints a confirmation"
description: "Extend `ndx init` provider selection and `ndx config` to offer Google OAuth as an auth option alongside API key entry. When the user selects OAuth, launch the browser flow inline. Show clear yellow-highlighted instructions at each step so users know what to do. Surface `ndx auth google` as a standalone re-auth command in help output. Re-running ndx init when OAuth credentials already exist should skip the browser flow and confirm the existing session."
---
