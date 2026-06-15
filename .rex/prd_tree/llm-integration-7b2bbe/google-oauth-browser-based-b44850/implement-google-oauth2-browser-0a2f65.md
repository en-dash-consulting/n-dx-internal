---
id: "0a2f651a-8e7d-4fa2-afd4-09bf33825ca1"
level: "task"
title: "Implement Google OAuth2 browser-launch flow with local token storage"
status: "completed"
priority: "high"
tags:
  - "auth"
  - "google"
  - "llm-client"
source: "smart-add"
startedAt: "2026-06-15T14:30:00.599Z"
completedAt: "2026-06-15T14:40:59.129Z"
endedAt: "2026-06-15T14:40:59.129Z"
acceptanceCriteria:
  - "Running `ndx auth google` opens the default browser to Google's OAuth consent screen"
  - "A localhost redirect server captures the auth code and exchanges it for access and refresh tokens"
  - "Tokens are persisted to a local credential file (e.g. ~/.config/n-dx/google-credentials.json)"
  - "Token refresh runs automatically when the access token expires before an API call"
  - "All user-action prompts, wait messages, and remediation hints during the auth flow are yellow"
  - "Auth errors surface actionable yellow-highlighted messages explaining what to do next"
  - "Existing API key flow continues to work unchanged when no OAuth credentials are present"
description: "Build a Google OAuth2 authorization code flow that opens the system browser, handles the localhost callback, exchanges the auth code for access and refresh tokens, and persists them securely in a local credential file. Scope to the Google AI / Vertex AI APIs. The flow should be triggerable from both ndx init and a standalone ndx auth google command. All wait messages, instructions, and remediation steps during the flow must render in yellow."
---
