---
name: ndx-pr-description
description: Generate a PR description enriched with architectural context
---

Generate a PR description from completed work items, enriched with architectural zone context.

Replaces the former dashboard PR Markdown tab — runs standalone without `ndx start`.

## Prerequisites

This skill requires a git repository. It will fail with a clear message if:
- The current directory is not a git repository
- Git is not available on PATH

## Process

1. Verify git is available and the current directory is a git repository by running `git rev-parse --is-inside-work-tree`
2. Detect the base branch by checking for `main` then `origin/main` using `git rev-parse --verify`
3. If no base branch is found, warn the user and continue in fallback mode
4. Read `.rex/prd.json` to collect completed work items. If missing, note this as a limitation
5. Run `sourcevision pr-markdown .` to generate the base PR markdown to `.sourcevision/pr-markdown.md`
6. Read `.sourcevision/pr-markdown.md` for the generated content
7. Read `.sourcevision/zones.json` (if available) to identify which architectural zones are affected:
   - Run `git diff --name-only <base>...HEAD` to get changed files
   - Map changed files to zones from zones.json
   - Note zone cohesion/coupling metrics for affected zones
8. Read `.sourcevision/CONTEXT.md` (if available) for additional project context
9. Enrich the PR description with:
   - A "Zones Affected" section listing touched zones with their cohesion/coupling metrics
   - Cross-zone coupling impact notes if changes span multiple zones
   - Confidence/coverage scores when sourcevision data is unavailable (fallback mode)
10. Present the enriched PR description to the user
11. Ask if they want to adjust scope, audience, or format:
    - **Scope**: full PR vs. specific epic/feature focus
    - **Audience**: technical reviewers vs. stakeholders vs. release notes
    - **Format**: standard markdown vs. GitHub PR template vs. brief summary
12. Regenerate if adjustments are requested
13. Offer to copy the final description to clipboard

## Fallback mode

When `.sourcevision/zones.json` or `CONTEXT.md` is unavailable:
- Clearly indicate that architectural context is missing
- Include a confidence score reflecting data completeness
- Suggest running `sourcevision analyze` to enable full enrichment
