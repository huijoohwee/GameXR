---
title: "GameXR validation adoption"
doc_type: "PRD-TAD-ADR-MVP-GTM"
version: "1.0.0"
owner: "GameXR"
date: "2026-09-14"
lang: "en-US"
frontmatter_contract: "required"
load_policy: "on-demand"
continuity_id: "GAMEXR-VALIDATION-ADOPTION-001"
prd_revision: "1.0.0"
tad_revision: "1.0.0"
adr_revision: "1.0.0"
mvp_revision: "1.0.0"
gtm_revision: "1.0.0"
status: "implementation"
---

# GameXR validation adoption

## PRD

`GAMEXR-VALIDATION-ADOPTION-001@1.0.0`: the spatial-runtime maintainer validates
changed inputs through the shared Agentic OS owner. Role/Subject: maintainer.
Action/Verb: validates. Object: exact source and candidate artifacts. Preserve
browser, drone, Apex, native and artifact-round-trip gates while selecting source
checks by their declared dependencies and avoiding duplicate typechecking.

## TAD and ADR

The package and lockfile bind the exact upstream execution revision. Its
`guides/REPOSITORY-VALIDATION.md` owns process bounds, CI event binding and receipts;
`.agentic-os-validation.json` declares GameXR commands only. `npm run check` uses
the shared runner, `check:plan` previews it, and `check:all` requests fresh broad
local validation. `check:source` preserves the original complete command chain.

Candidate generation stays mandatory because the existing CI publishes its
immutable artifact even for documentation changes. `build` already executes
`tsc -b`, so the selected candidate chain preserves type validation once before
release preparation and verification. Behavioral tests run for their declared
inputs; shared or unknown changes select the complete fallback. Installed build
tools and ignored artifact outputs make these groups ineligible for result reuse.

The existing workflow still invokes `npm run check`, which detects CI and verifies
the provider event before fresh execution. All other existing workflow checks and
its required `Integration Gate` stay in place. This first OS profile matches that
observed protection, preserves consumer-owned runtime/release authority, and retains
all cleanup targets. Bootstrap uses an isolated branch before normal lane admission;
it does not create delegated authority or change GitHub protection settings.

## MVP

Validate the profile against Git origin and existing protection; inspect affected,
broad and unchanged plans; run the existing checks and require exact protected CI.
After integration, install the committed package and run OS setup to establish the
local trust anchor. A profile file or plan is not evidence of completed enrollment.

## GTM

Measure command counts and elapsed time, separating artifact work and hosted waiting
from source tests. The acceptance boundary is validation and enrollment, with zero
new runtime dependencies or always-loaded guidance. Production publication continues
through the existing release owner described in `docs/RELEASE.md`; buyer demand,
revenue and physical-device certification are not established by these checks.
