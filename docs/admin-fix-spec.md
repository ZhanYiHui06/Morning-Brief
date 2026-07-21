# Management Console Fix Specification

## Goal

Make the management console safe and honest in production: every visible control must either perform the promised operation or be removed, model routing must honor retry and fallback configuration, and the deployed admin/API surface must be authenticated and protected from credential exfiltration and SSRF.

## Scope and acceptance criteria

### 1. Production access and API security

- Caddy serves `/admin/*` and proxies `/api/*` to `127.0.0.1:8787`.
- Both surfaces require the same production Basic Auth credentials.
- The Hono API also rejects unauthenticated requests when server-side admin credentials are configured; health checks remain available locally.
- State-changing API requests are protected against cross-site form submissions and do not rely on CORS as authentication.
- Provider Base URLs accept HTTPS endpoints only by default. Loopback, link-local, private, multicast, unspecified, and cloud-metadata destinations are rejected after DNS resolution.
- Provider discovery does not follow redirects to an unvalidated destination.
- Automated tests cover unauthorized access and unsafe Provider URLs.

### 2. Provider and model management

- Provider editing uses a draft. Cancel discards changes; Save persists name, URL, key replacement, and enabled state.
- Connection tests display loading, success, and failure states and refresh health, model count, message, and check time.
- A failed test after Provider creation states that the Provider was saved but not connected and offers retry; it never displays a false connected state.
- Model import, manual add, enable/disable, delete, and route save have pending/error feedback and cannot be double-submitted.
- Removing a routed model is prevented with an actionable message or requires route reassignment first.
- Configuration writes distinguish 404 from other failures; network, validation, authentication, and server errors are never converted into create requests.

### 3. Runtime routing

- `maxRetries` applies to retryable failures of the primary model.
- After primary retries are exhausted, the configured enabled fallback model is attempted.
- Missing, disabled, or unusable models are skipped with an observable error when no route can run.
- Database-encrypted Provider keys are covered by Worker tests, including wrong/missing master keys.

### 4. Runs and task triggering

- Development environments never report that a task was queued when no runner exists.
- The Run button has pending/error handling and cannot enqueue duplicate runs by repeated clicks.
- Run records expose real duration and stage/status information where available.
- Run filtering works locally or through an API query.
- The raw-log action is implemented only when data exists; otherwise it is removed.

### 5. UI truthfulness and accessibility

- Publishing copy and actions reflect draft, partial, failed, and published states.
- Empty, loading, and error states provide meaningful status and retry actions.
- Dialogs support Escape, labelled titles, focus containment/restoration, and form submission with Enter.
- Navigation state is represented in the URL and supports reload/back/forward.
- Narrow-screen filters wrap without horizontal overflow; critical secondary text remains legible.
- A skip link is available and reduced-motion behavior remains intact.

### 6. Verification

- Admin has automated component/API-client coverage for Provider draft/cancel/toggle, failed connection, run filtering, and mutation errors.
- Server covers authentication, unsafe URLs, Provider secret handling, and route integrity.
- Worker covers encrypted secrets, retries, runtime fallback, and terminal failure.
- `pnpm test`, `pnpm typecheck`, and `pnpm build` pass.

## Implementation ownership

- Security/deployment: Caddy, API authentication, Provider URL policy, server security tests.
- Worker routing: retry/fallback abstraction, encrypted-secret behavior, Worker tests.
- Admin UI: component state, dialogs, controls, responsive/accessibility behavior.
- Integration: API client error semantics, run mapping/contracts, frontend test harness, final verification.
