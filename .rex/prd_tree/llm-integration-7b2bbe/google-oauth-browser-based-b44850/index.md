---
id: "b448503e-c214-4ff3-bee0-1672b2eb8daa"
level: "feature"
title: "Google OAuth Browser-Based Local Authentication"
status: "pending"
source: "smart-add"
acceptanceCriteria: []
description: "Add a browser-launched OAuth2 local auth flow for Google's LLMs as a parallel pathway to API key authentication. Similar to how Claude CLI handles auth, users can run a command that opens a browser, authenticates with their Google account, and stores credentials locally. The existing API key flow must be fully preserved — this is an additive auth pathway, not a replacement."
---

## Children

| Title | Status |
|-------|--------|
| [Add regression and integration tests for Google OAuth flow, token refresh, and API-key fallback](./add-regression-and-integration-4d1fa9.md) | pending |
| [Implement Google OAuth2 browser-launch flow with local token storage](./implement-google-oauth2-browser-0a2f65.md) | completed |
| [Integrate Google OAuth flow into ndx init and ndx config with browser-launch UX](./integrate-google-oauth-flow-a85cb9.md) | completed |
| [Wire Google OAuth credential detection into the Google vendor adapter with API-key fallback](./wire-google-oauth-credential-6b118c.md) | pending |
