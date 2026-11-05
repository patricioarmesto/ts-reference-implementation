# Todos

**Intent:** capture, complete, filter, and delete a single user's todos.

- Critical: the in-memory repo. If it fails, every todo route fails.
- Degradable: none. This slice has no fanOut; degradable behavior lives in
  `dashboard/`.
- Errors: validation 400, missing todo 404. All expected failures are `Result`
  values mapped by the controller.
- Tests: `repo.test.ts` (storage), `todos.test.ts` (usecases, fake repo),
  `todos.controller.test.ts` (supertest + contract `safeParse`).
