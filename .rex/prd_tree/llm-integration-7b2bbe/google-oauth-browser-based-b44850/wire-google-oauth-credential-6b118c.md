---
id: "6b118cd3-189a-4b2f-83f0-b9348bc4bdef"
level: "task"
title: "Wire Google OAuth credential detection into the Google vendor adapter with API-key fallback"
status: "completed"
priority: "high"
tags:
  - "auth"
  - "google"
  - "llm-client"
source: "smart-add"
startedAt: "2026-06-15T14:55:59.605Z"
completedAt: "2026-06-15T15:19:05.147Z"
endedAt: "2026-06-15T15:19:05.147Z"
acceptanceCriteria:
  - "If valid OAuth credentials exist, API calls use Bearer token auth rather than an API key"
  - "If OAuth credentials are absent or expired and refresh fails, the adapter falls back to the API key without crashing"
  - "Active auth method (OAuth / API key) is shown in the vendor/model header line in CLI output"
  - "Unit tests cover all three credential resolution paths: OAuth-only, API-key-only, OAuth-expired-fallback"
  - "No breaking changes to existing Google API key configuration or the failover chain"
description: "Extend the existing Google vendor adapter in llm-client to detect local OAuth credentials and use them for API calls when present, falling back transparently to the API key if no OAuth credentials exist or if the refresh fails. Resolution order: OAuth token > API key env var > configured API key. Surface the active auth method in vendor header output so users know which pathway is active."
---
