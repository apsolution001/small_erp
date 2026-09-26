---
name: implement-task
description: Execute one Ekaro task file from docs/tasks end-to-end (spec check, TDD, implementation, verification, review, status update). Use when asked to "do task T-xxx" or to pick up the next task.
---

# Implement an Ekaro task

1. **Select.** Open `docs/tasks/README.md`. Pick the requested task, or the lowest-numbered `todo` whose `depends_on` are all `done`. Set `status: in-progress` in its frontmatter.
2. **Load context.** Read the task file, its linked spec sections and ADRs, `CLAUDE.md`, and the standards for the touched areas. Skim the existing code you will extend.
3. **Resolve ambiguity.** Decide using the BRD first, then Indian practice (GST law, Tally conventions), then industry norms. Write each decision under `## Decisions` in the task file. If it is architectural, add `docs/adr/NNNN-title.md`.
4. **Plan.** Write a short checklist under `## Plan` in the task file: files, tests, migration.
5. **TDD loop** per slice: failing test → minimal code → refactor. Commit after each green slice (Conventional Commits, scope = module).
6. **Verify.** Run:
   ```bash
   pnpm lint && pnpm typecheck && pnpm test
   pnpm --filter @ekaro/api test:e2e   # if api/db touched
   ```
   Paste a summary (pass counts) under `## Verification`. If anything fails, fix the cause. Never skip.
7. **Review.** Run the `code-reviewer` agent on the change, and the `accounting-reviewer` agent if money, stock or GST changed. Fix all BLOCKING findings and re-run verification.
8. **Close.** Set `status: done`, and update `docs/tasks/README.md` if it tracks status. Report what changed, the decisions and the evidence.
