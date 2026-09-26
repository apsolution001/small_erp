# Git & delivery standards

- **Trunk-based:** short-lived branches off `main`, merged by PR after CI is green and the review is approved. No direct pushes to `main`.
- **Conventional Commits:** `feat(masters): add item UoM conversions`, `fix(auth): rotate refresh token on reuse`, `docs(adr): 0007 numbering series`, `test(...)`, `refactor(...)`, `chore(...)`, `ci(...)`. The scope is the module name.
- Each commit builds and passes tests. Make small, focused commits.
- A PR references its task file (`docs/tasks/...`), describes _what_ and _why_, and lists verification evidence.
- The CI gate is lint, typecheck, unit tests, API e2e on Postgres, migration check and build. All must pass.
- Never commit secrets. `.env` is git-ignored and `.env.example` documents every variable.
