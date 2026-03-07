# Plans Directory Index

This directory contains phased/tasked planning documents used to execute implementation work.
Unlike `docs/specs`, these files are execution plans, not normative product specifications.

For live status tracking and active-scope interpretation, files in this directory are
authoritative over `docs/architecture/development-roadmap.md`.

| File | Description |
| :--- | :---------- |
| [**01_DevelopmentStatusChecklist.md**](./01_DevelopmentStatusChecklist.md) | Canonical checklist for tracking current phase/work-item execution status and completion gates. |
| [**02_PhaseWorkItem_M1_MemoryVerticalSlice.md**](./02_PhaseWorkItem_M1_MemoryVerticalSlice.md) | Defines the initial Phase 1 work-item plan with scope, acceptance criteria, and explicit TDD red-test checkpoints. |
| [**03_PhaseWorkItem_P2P3_FileDurability_and_QueryCapacityKickoff.md**](./03_PhaseWorkItem_P2P3_FileDurability_and_QueryCapacityKickoff.md) | Defines kickoff implementation scope for Phase 2/3 with file durability baseline and query/capacity hardening tasks. |
| [**04_PhaseWorkItem_M2_FileDurabilitySlice.md**](./04_PhaseWorkItem_M2_FileDurabilitySlice.md) | Defines the dedicated M2 completion plan for remaining file durability obligations from ADR-01 before expanding further Phase 3 scope. |
| [**05_PhaseWorkItem_P4_DistributionDeliveryTracks.md**](./05_PhaseWorkItem_P4_DistributionDeliveryTracks.md) | Defines planning for dual-track delivery readiness (NPM module and browser bundle profiles). |
| [**06_PhaseWorkItem_M3_QueryScalability_IndexHardening.md**](./06_PhaseWorkItem_M3_QueryScalability_IndexHardening.md) | Defines dedicated M3 execution scope for B+ tree query-path hardening, split/merge regression coverage, and index-backed range-select integration. |
| [**07_PhaseWorkItem_P3_SchedulerCoalescing_and_ErrorChannelRegression.md**](./07_PhaseWorkItem_P3_SchedulerCoalescing_and_ErrorChannelRegression.md) | Defines completion scope for remaining Phase 3 scheduler coalescing and auto-commit error-channel regression coverage. |
| [**08_PhaseWorkItem_P0_FoundationSync_GovernanceClosure.md**](./08_PhaseWorkItem_P0_FoundationSync_GovernanceClosure.md) | Defines closure scope for remaining Phase 0 governance obligations (PR phase-gate enforcement, docs index consistency, workflow/testing-strategy alignment). |
| [**09_PhaseWorkItem_M5_ReleaseHardening_v0.1.md**](./09_PhaseWorkItem_M5_ReleaseHardening_v0.1.md) | Defines M5 release-hardening closure scope for benchmark evidence, v0.1 limitations documentation, and release-readiness verification gates. |
| [**09_SecurityReview_OOM_Null_DirectoryAccess.md**](./09_SecurityReview_OOM_Null_DirectoryAccess.md) | Documents a focused security review for OOM, null-handling crash paths, and directory-access containment risks with prioritized remediation recommendations. |
| [**10_PhaseWorkItem_M6_BrowserRuntimeBaseline.md**](./10_PhaseWorkItem_M6_BrowserRuntimeBaseline.md) | Defines active post-v0.1 browser-runtime-first execution scope aligned with ADR-51. |
