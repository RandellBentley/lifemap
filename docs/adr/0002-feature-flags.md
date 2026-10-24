# 0002 — Per-environment feature flags instead of separate codebases

**Status:** accepted · 2026-10

## Context

LifeMap runs as a personal site and as a public demo. Some features (workout tracking first)
belong only on the personal site. Maintaining two codebases or a fork would mean copying every
shared fix and running two pipelines.

## Decision

Same code everywhere; environments differ only in configuration. The `FEATURES` setting (e.g.
`FEATURES=workouts`) is set per environment in Terraform.

- **The backend is the boundary.** Views behind a flag use
  `permission_classes = [requires_feature("workouts"), IsAuthenticated]`. When the flag is off
  they answer **404**, even to signed-out callers, as if the feature didn't exist.
- **The frontend follows.** `GET /api/config/` lists enabled features; `useFeature()` and
  `<FeatureGate>` hide UI. This is decided at runtime, not build time, so the same frontend
  build can be promoted from demo to personal.
- Unknown flag names stop the server at startup, and `requires_feature()` rejects unknown names
  when a view is defined, so typos fail loudly.
- Flagged apps' tables exist in every environment (simple migrations); they stay empty where
  the flag is off.

## Consequences

- Flagged code is public along with the rest of the repo. User data is never in the repo.
- Tests exercise both states with `override_settings(FEATURES=...)`.

**Revisit when** a feature should differ per *user* rather than per environment (e.g. sharing
with family). The flag check is one function, so it can grow into per-user entitlements.
