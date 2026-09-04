# sqlclient contributor instructions

## Project contract

- This is a macOS terminal SQL client built with Bun, TypeScript, React, and Ink.
- Treat `package.json` and the CI matrix as the sources of truth for supported Bun versions, and keep them consistent.
- The application sends user-authored SQL to the database without parsing, allowlisting, or rewriting it. Write protection belongs to the database account. Do not add a read-only badge or claim that the application verifies write protection.
- Use only dedicated read-only accounts outside disposable local databases. Never run write SQL against staging or production while developing or testing this repository.
- MySQL login paths and PostgreSQL service/password files are the credential sources. Do not read or print `~/.mylogin.cnf`, `~/.pgpass`, or other real credential files. Use repository fixtures and temporary files selected through `MYSQL_TEST_LOGIN_FILE`, `PGSERVICEFILE`, and `PGPASSFILE`.
- Resolved connection passwords may exist only while resolving and opening a connection. Do not place them in application state, logs, UI output, history, temporary SQL files, or errors.

## Architecture and behavior

- Keep `src/core/` independent of React and Ink. Put parsing, query generation, editor operations, and layout calculations in testable pure functions where practical.
- Keep state transitions in `src/state.ts`. Dispatch operations rather than indexes calculated from a captured render when repeated input can arrive in one chunk.
- Pass database connection fields to `Bun.SQL` as structured options. Do not rebuild credential-bearing connection URLs. Preserve raw IPv4, DNS, and IPv6 hostnames, and allow MySQL public-key retrieval only for loopback hosts.
- Keep one reserved database connection per selected connection so schema context, queries, backend ID, timeout, and cancellation refer to the same server session.
- Preserve the primary navigation: connection `Enter` opens Catalog; schema `Enter` selects the default schema and opens Query without loading tables; `l`/Right lazily expands tables; `h`/Left collapses them; table `Enter` opens Result.
- Query input has priority over History when vertical space is constrained. Below 28 terminal rows, or with no history, hide History and remove it from focus cycling. When shown, render at most five history entries.
- Table browsing fetches 201 rows, displays 200, and discards the probe row. User SQL is not modified with a limit; retain at most 2,000 returned rows in state and document that the driver may temporarily hold the full result.
- Treat `README.md` as the usage guide, `SPEC.md` as the current behavior contract, and `docs/design.md` as the rationale. Update all affected documents when behavior or keybindings change.

## Dependencies

- When dependencies or `bun.lock` change, verify frozen installation, tests, typecheck, formatting, and build on every supported Bun version.
- Do not add a dependency when an existing Bun or platform API is sufficient. Explain non-obvious runtime dependencies in the commit message.

## Required validation

Run these checks before declaring a change complete:

```bash
bun install --frozen-lockfile
bun test
bun run typecheck
bun run format:check
bun run build
git diff --check
```

- For runtime-compatibility or dependency changes, run the same frozen install, tests, typecheck, formatting check, and compiled build for every version in the CI matrix.
- Use local disposable MySQL 8.4 and PostgreSQL 17 containers for database integration tests. Keep setup credentials in temporary files and remove the containers and temporary files afterward.
- Add or update tests for every changed reducer transition, parser edge case, dialect query, editor operation, or responsive layout boundary.

## Git conventions

- Use focused Conventional Commit messages such as `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, and `ci:`.
