# Working in den-edge

## Contributor development

- `./scripts/dev.mjs` is the default contributor entry point. It runs the local Vite UI against the live public
  `d.oxy.fi` stack; an invited guest can use centralized Hearth, their own TorBox configuration, and authorized
  Remux without LAN access. This mode uses live guest data/resources and must never back fixtures or automation.
- Guest state is origin-local. Redeem/paste the invite on the localhost UI, or replace an existing guest session's
  “Use Den on your phone” link origin with `http://localhost:5173/` while preserving its fragment; merely opening
  the production invite signs in `d.oxy.fi`.
- `./scripts/dev.mjs --local-edge` is for Rust/backend changes. It binds Edge to loopback, keeps persistent isolated
  state in `.dev/data`, and has no authority over centralized Hearth. Configure a local Hearth or fixtures when a
  backend test needs services. A local Hearth flow must bootstrap the library in the default `open` mode, restart
  with `NEW_LIBRARIES=members`, share `REMUX_EDGE_SECRET` with combined Hearth (or Remux's `EDGE_SECRET`), and include
  the saved Den install origin in Hearth's `REMUX_SCOUT_ORIGINS`. Never restore private `192.168.*` defaults.
- Every Playwright/E2E server must retain `DEN_E2E=1`; real-service overrides are forbidden there. Explicit
  standalone addon proxies must strip Edge membership, grant, token, cookie, and authorization headers.
- The centralized Cast sender deliberately trusts only the exact contributor origin `http://localhost:5173` in
  addition to production/deployment origins. Keep its Rust CSP and bundled `VITE_DEN_PARENT_ORIGINS` allowlists in
  sync; never widen this active controller to arbitrary localhost ports.

## Testing

- Do not add a regression test mechanically for every change. Trivial styling changes, copy edits, and straightforward substitutions of an existing shared component usually need the relevant static checks, not a new test.
- When a regression test is warranted, prefer an end-to-end test of the user-visible behavior over a component or unit test. Cover the real route and interaction across the browser boundary when practical.
- Use unit tests for isolated logic with meaningful branches, invariants, or failure cases that end-to-end coverage would make slow, opaque, or impractical.
- Keep tests proportional to the risk. Do not assert implementation details merely to prove that a small refactor happened.

## Standing rule: parity, performance and discoveries

- These rules apply to every Den addition, fix, removal and behavior-affecting refactor, not only the audit backlog. Default to behavioral and contract parity across iOS/iPadOS, tvOS, browser, LG/webOS and Samsung/Tizen, plus relevant shared services/consumers in the active `den` and `den-*` repositories. Platform-appropriate UI can differ; authority, data semantics, capabilities, notices, recovery and supported outcomes must agree.
- Inspect the equivalent production paths on every target using current code and relevant PRs/issues. Do not assume a shared helper means each host uses it correctly, or that another platform is the reference implementation. Implement the corresponding change everywhere applicable; a correct counterpart may only need verification. For removals, retire matching affordances/routes/capabilities and handle persisted state, caches and older-client compatibility.
- Honor explicit, documented product/build/capability exclusions, such as reduced Tizen functionality. Cite the exclusion and preserve an accurate unsupported state or usable handoff. Existing absence is not evidence of an intentional exclusion. If required parity remains unfinished, link the work and report the change as incomplete for those targets; a follow-up issue alone does not establish parity.
- Review real entry points, caller/model/service/store behavior, role/profile authority, cancellation and stale results, cache keys/invalidation, durable outcomes, localization/accessibility, and success/empty/partial/stale/error states. A missing notice, warning, retry or usable recovery is a functional defect. Check for unreachable/stubbed paths and invented success or fallback logic.
- Performance is a highest-priority concern alongside correctness and privacy. Raise every credible negative effect and concrete opportunity for a gain, including optimizations present on another platform. Consider latency, frames/scroll/focus, CPU, memory, energy, decoders, network/I/O, caches, duplicate work, hidden/background tasks and service throughput/cost. Do not defer performance as cosmetic cleanup or suppress an opportunity because it is not yet measured.
- Distinguish reproduced/source-supported defects, investigations, measured gains and proposed optimizations. Record the mechanism, affected workloads/targets and comparison needed; never invent performance savings. Use matched before/after measurements where feasible. Resolve a regression introduced by the change or obtain explicit acceptance of its tradeoff before calling it complete. Follow existing device-recording instructions.
- Record every additional defect, parity gap, missing meaningful test, performance regression or optimization opportunity discovered while working. Search existing issues/PRs first. Add same-scope findings to the current issue; otherwise update a matching issue or create a focused issue in the owning repository and link it from the originating issue and audit tracker. Include trigger/workload, expected/actual behavior, source evidence, impact, confidence/counterevidence and useful acceptance. File uncertain items as investigations. Creating/linking these issues is explicitly authorized; do not ask permission again. If filing is blocked, retain a complete draft and report the blocker. Keep private implementation evidence out of public issues.
- Prefer E2E or real production-path integration that verifies visible behavior, failure/retry, cancellation/profile replacement and durable readback. Add focused unit tests for meaningful invariants, not mechanical implementation mirrors. Distinguish source/simulator checks from device, engine and performance qualification.
- Completion must include a result for every app target (changed/checked, explicit exclusion, not applicable with reason, or unverified with linked work), actual tests and their limits, performance findings/opportunities, and all new/reused follow-up issues. Do not claim app-wide correctness from a bounded feature check. Reporting discoveries does not automatically authorize unrelated features, deployment or paid pipeline runs.

The shared completion record and ongoing audit are maintained in [Den tracker #481](https://github.com/oxyc/den/issues/481#standing-implementation-rule). These rules stand on their own when the private tracker is unavailable.
