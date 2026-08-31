---
name: ai-features
description: Quality bar for this project's AI-generated customer-facing content, e.g. the Hebrew-first follow-up suggestion for a detected recovery case. Use when writing prompts or reviewing model output for tone, factuality, and structured-field constraints.
---

# Skill: AI Features

## Initial feature

Hebrew-first follow-up suggestion for a detected recovery case.

## Quality bar

The model should:

- be concise
- reference the actual situation
- avoid inventing facts
- avoid manipulative or spammy wording
- not claim a price/appointment is confirmed unless the data says so
- return only the requested structured fields

Prompt templates live under `services/ai-service/prompts` once implementation starts.
