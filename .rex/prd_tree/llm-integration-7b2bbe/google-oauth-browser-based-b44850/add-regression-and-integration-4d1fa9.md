---
id: "4d1fa975-cea7-4436-9a19-aff1327fc548"
level: "task"
title: "Add regression and integration tests for Google OAuth flow, token refresh, and API-key fallback"
status: "pending"
priority: "medium"
tags:
  - "auth"
  - "google"
  - "testing"
source: "smart-add"
acceptanceCriteria:
  - "Unit tests cover token storage, load, and silent refresh logic without live network calls"
  - "Integration tests validate the full credential resolution order: OAuth > API key > error"
  - "Test asserts clear yellow-formatted error output when both OAuth and API key are absent"
  - "Regression test confirms the API key flow is unaffected when OAuth credentials are absent"
  - "All tests run in CI without requiring a live Google account or browser"
description: "Write tests covering the Google OAuth credential lifecycle: successful token acquisition, silent token refresh on expiry, fallback to API key when OAuth fails, and error messaging when both are absent. Use a mock OAuth server for unit tests and record-and-replay fixtures for integration tests to avoid live network dependency."
overrideMarker: {"type":"duplicate_guard_override","reason":"content_overlap","reasonRef":"content_overlap:3151022c-f35e-4e0e-acbe-25b701ef2cf9","matchedItemId":"3151022c-f35e-4e0e-acbe-25b701ef2cf9","matchedItemTitle":"Add regression tests for Google API key validation across config and init paths","matchedItemLevel":"task","matchedItemStatus":"completed","createdAt":"2026-06-15T14:19:13.298Z"}
---
