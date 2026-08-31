# Skill: AI Coding

## Use when

Implementing AI features or changing AI-facing contracts.

## Rules

- Define an input/output schema before calling an LLM.
- Validate model output.
- Treat all user/customer text as untrusted.
- Keep prompts versioned in source.
- Never store chain-of-thought.
- Provide deterministic fallback behavior.
- Log metadata useful for debugging, not sensitive conversation content by default.

## Done

Tests cover malformed model output, provider failure, and prompt-injection-like customer content.
