# 0001 — One repository for frontend, backend, and infrastructure

**Status:** accepted · 2026-10

## Context

LifeMap has a React frontend, a Django API, a media-processing Lambda, and Terraform. Most
features cut across all of them: events, goals, and metrics each touched models, the API,
frontend types that mirror it, and sometimes infrastructure. There is one maintainer.

## Decision

Keep everything in one repository with clear top-level boundaries (`frontend/`, `backend/`,
`media-processor/`, `infra/`). CI jobs are path-filtered so each area's checks run only when it
changes, and a single aggregate **CI passed** check gates merges.

## Consequences

- A feature is one pull request that can be reviewed end to end, and the frontend and API
  can't drift out of sync.
- One pipeline builds one artifact that is promoted between environments.
- Splitting later stays possible: the boundaries, per-area CI jobs, and `CODEOWNERS` already
  map to separate repos.

**Revisit when** separate teams own the frontend and backend with independent release
cadences, or infrastructure needs stricter access control than application code.
