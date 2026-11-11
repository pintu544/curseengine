# Grimoire auditor — CLI run, 2026-11-11

> **Provenance.**
> - Date: 2026-11-11.
> - Run via Kiro CLI V3. The custom agent `grimoire-auditor` was invoked **by name**, from `.kiro/agents/grimoire-auditor.md`, under the repo owner's Kiro Pro account (GitHub login).
> - This replaces the Session 2 stand-in caveat in `docs/audits/grimoire-auditor-2026-11-11.md` **for the by-name requirement**: that earlier report came from a generic sub-agent given the agent's prompt, not from the named agent. This report is the named agent's own output.
> - Targets: `auditor-fixture/` (now moved to `fixtures/auditor-negative/`), `packs/standup/`, `apps/grimmod`, `apps/deadbeat`.

## Agent report (verbatim from `run1-report-raw.md`)

# Grimoire audit: auditor-fixture/, packs/standup/, apps/grimmod, apps/deadbeat

This audit covers three targets, in the order requested. Each target uses the standard skeleton and ends with a one-line verdict.

I only read source. I did not run tests, the simulator or the apps. `.kiro/steering/inviolables.md` and `docs/grammar.md` came as loaded context, and I did not re-open them from disk. Where I cite a line number, I read that line. Where I describe behaviour I did not read, I say so.

---

# Grimoire audit: auditor-fixture/ (GrimMod-style seeded host pack)

**Verdict**: FINDINGS (2 blockers, 2 warnings)

Files read: `auditor-fixture/README.md`, `auditor-fixture/host.ts`, `auditor-fixture/pack.curse`. For context only: `packages/curse-engine/src/tokenizer.ts`, `packages/curse-engine/src/executor.ts` (preflight and `triggerMatch`).

The fixture directory contains only these three files. It has no `adapter.ts`, `grimoire.ts`, `runtime.ts` or simulate route. `host.ts` is a descriptor object (`declaredCapabilities`, `inverses`, `sendsTicks`), not executable host code. I treated its `declaredCapabilities` list (`host.ts:8`) as the declared set and its `inverses` map (`host.ts:12-15`) as the inverse registry. I confirmed each README claim from source, not from the README.

## 1. Undeclared capabilities
- **blocker**, `pack.curse:1` (`prize-patrol`): the curse uses `email winner-note to author`. The host declares `post`, `mute` and `escalate` (`host.ts:8`), and `email` is not among them. Why it matters: this is a curse naming a capability the host never declared (inviolable 1). On a real host the executor would refuse the whole run at preflight (`executor.ts:224-226`), but the pack still asks for something the host never granted. Fix: remove the `email` action, or have the owner approve adding an email adapter with its own inverse and audit path.
- No `fetch`, `http`, `net` or `process.env` flow exists in `host.ts`. The fixture has no adapter code, so there is nothing further to check.

## 2. Actions with no undo path
- **blocker**, `pack.curse:3` with `host.ts:8` and `host.ts:12-15` (`spam-hammer`): `escalate to owner` is declared (`host.ts:8`), but the `inverses` map holds only `mute` and `post`. The `escalate` entry is commented out (`host.ts:15`). Why it matters: an escalation taken here could never be reversed from the grimoire (inviolable 3). Fix: add an `escalate` inverse (retract the escalation) and make sure the reversal is written as an audit entry. Otherwise stop declaring `escalate`.
- **Secondary**, `host.ts:13-14`: `email` has no inverse either. This is moot while `email` is undeclared (finding 1), but declaring it without an inverse would break inviolable 3 as well.
- **Not verifiable**: the fixture has no grimoire or `recordDecision` code, so I can't confirm that actions and reversals become audit entries.

## 3. Simulator / live divergence risk
none found. Files read: `host.ts`, `pack.curse`, `README.md`. The fixture has no executor wiring, simulate route, `runtime.ts` or `Date.now`/`Math.random` use. There is nothing to audit for this class.

## 4. Tick-rules in non-tick hosts
- **warning**, `pack.curse:2` with `host.ts:6-7` (`daily-digest`): the curse uses `every 1 days`. The host sets `events: ["message"]` and `sendsTicks: false`. Why it matters: the curse can never fire in this host. The executor only matches a timer trigger against `tick` events (`executor.ts:193-194`). Fix: move it to a tick-emitting host, or change it to an event trigger.
- **warning (found beyond the README)**, `pack.curse:2`, column 65: the curse ends with `to #general`. The tokenizer accepts only `[A-Za-z_]` word starts (`tokenizer.ts:13`). It has no branch for `#`, so it reaches `throw new CurseSyntaxError(..., "unexpected character ...")` (`tokenizer.ts:144`). So `daily-digest` fails to parse and could not be installed. This contradicts the README's claim that the curses are grammar-valid. Fix: use `general` in place of `#general`. I did not run the parser. This conclusion rests on reading the tokenizer.
- I also did not check how a single file holding three curses would be loaded. No loader exists in the fixture, and `packs/standup/` uses one curse per file.

**Verdict (auditor-fixture/)**: FINDINGS. Both README-planted blockers (undeclared `email` at `pack.curse:1`, un-invertible `escalate` at `pack.curse:3`/`host.ts:15`) and the tick-in-non-tick-host warning (`pack.curse:2`) are confirmed in source. I also found an unplanted parse error at `pack.curse:2` col 65.

---

# Grimoire audit: packs/standup/

**Verdict**: FINDINGS (0 blockers, 2 warnings)

Files read: `packs/standup/README.md`, `packs/standup/curses/shipped-digest.curse`, `packs/standup/curses/blocker-callout.curse`, `packs/standup/curses/blocked-three-days.curse`, `packs/standup/test/standup.test.ts`, `packs/standup/package.json`. For hosting context only: `apps/grimmod/src/lib/{adapter,grimoire,host,install-warnings}.ts`, `apps/deadbeat/src/lib/{adapter,host}.ts`.

The pack has curses and a simulate-only test. It has no host, adapter or grimoire of its own.

## 1. Undeclared capabilities
- The pack's actions are `post` (`shipped-digest.curse:1`, `blocker-callout.curse:1`) and `escalate` (`blocker-callout.curse:1`, `blocked-three-days.curse:1`). There is no `mute` or `email`, and the test asserts that (`standup.test.ts:35`, `:56`). No `fetch`, `http`, `net` or `process.env` appears in the curses or the test.
- **warning**, `standup.test.ts:40`: the only "declared set" is the literal `declared: ["post", "escalate"]` in the test. The apps derive theirs from the live adapter (`host.declaredCapabilities()`). A passing dry run therefore does not show that any real host can run the pack. No host in the repo both declares `post` and `escalate` and emits `standup` events:
  - GrimMod declares `mute`, `post` and `escalate` (`adapter.ts:12,16,30`) but emits only `type: "message"` events (`host.ts:27`).
  - Deadbeat declares only `email` and `escalate` (`adapter.ts:24,34`) and emits only `tick` events (`host.ts:28`).
  - On Deadbeat the two `post` curses would be refused at preflight. On GrimMod all three would install without a warning, because `install-warnings.ts:8-9` only flags timer and webhook triggers, and then never fire.
  - Fix: add a host that declares `post` and `escalate` and emits `standup`, or add an install warning for event types a host never emits. Either one needs the owner's call, because it touches the apps.

## 2. Actions with no undo path
none found. The pack defines no inverse registry because it has no host. The inverses come from whichever host runs it, and I checked GrimMod's:
- `post` has an inverse at `grimoire.ts:35` and `escalate` at `grimoire.ts:36`.
- Reversals are appended through `AuditLog.reverse` (`packages/curse-engine/src/grimoire.ts`). It runs the inverse first and appends a `reversed` entry only if the inverse succeeds.
- Deadbeat has no `post` inverse (`grimoire.ts:30-34`, email and escalate only), but `post` is undeclared there, so the curses would be refused rather than run.

The dry run writes nothing to a grimoire (it uses the recording stub). I could not check per-action audit writes inside the pack itself, because the pack has none.

## 3. Simulator / live divergence risk
- The test calls `simulate()` (`standup.test.ts:40`) with no adapter, so no live adapter is handed over (inviolable 2). The fixture history uses fixed `Date.UTC` times (`standup.test.ts:11`). The test file has no `Date.now`, `Math.random`, network or env reads. Its only I/O is reading the pack's own `curses/*.curse` files (`standup.test.ts:6-8`).
- **warning**, `standup.test.ts:40`: this is the same drift risk as in finding 1. The hard-coded declared list can diverge from a real host's adapter and make a run look valid when it would be refused.

## 4. Tick-rules in non-tick hosts
none found. All three curses use `when standup`. There is no `every` trigger (`shipped-digest.curse:1`, `blocker-callout.curse:1`, `blocked-three-days.curse:1`). Related note, covered in section 1: no shipped host emits `standup` events.

**Verdict (packs/standup/)**: FINDINGS (warnings only). The curses are inviolable-clean (declared-style `post`/`escalate` only, both invertible in GrimMod, no tick rules), but no host in the repo can currently run them, and the test's hard-coded `declared` list hides that.

---

# Grimoire audit: apps/grimmod and apps/deadbeat

**Verdict**: FINDINGS (0 blockers, 5 warnings)

Files read:
- **GrimMod**: `src/lib/{host,adapter,grimoire,persistence,runtime,fixtures,install-warnings,chat-state}.ts`, `app/api/{events,curses,fixtures,reset}/route.ts`, `app/api/curses/[id]/simulate/route.ts`, `app/api/grimoire/[id]/undo/route.ts`.
- **Deadbeat**: `src/lib/{host,adapter,grimoire,persistence,runtime,fixtures,install-warnings,invoice-state}.ts`, `app/api/{events,curses,fixtures,reset,grimoire}/route.ts`, `app/api/curses/[id]/simulate/route.ts`, `app/api/grimoire/[id]/undo/route.ts`.
- **Engine and shared package**: `packages/curse-engine/src/{executor,simulator,grimoire,tokenizer}.ts` (parts) and `packages/kill-switch/src/index.ts`.
- **Also searched, not read in full**: a regex search of `apps/**` for `fetch`, `http`, `net`, `process.env`, `eval`, `new Function`, `Math.random` and `Date.now`, and a search of `packages/*/src` for the same nondeterminism and network patterns.
- **Not read**: UI components, `graph.ts`, `http.ts`, `grimoire/route.ts` for GrimMod, health routes, tests, and the `.kiro` specs.

## 1. Undeclared capabilities
none found as breaches. Evidence:
- **GrimMod**: the adapter declares `mute` (`adapter.ts:12`), `post` (`:16`) and `escalate` (`:30`). The shipped curse uses `mute` and `escalate` (`fixtures.ts:35`).
- **Deadbeat**: the adapter declares `email` (`adapter.ts:24`) and `escalate` (`:34`). The shipped curses use `email`, `email` and `escalate` (`fixtures.ts:33,35,37`).
- **Enforcement**: `install()` routes any curse using an undeclared kind to a refused shadow executor (GrimMod `host.ts:107-109`, Deadbeat `host.ts:102-103`). The executor then refuses the whole run before any action executes (`executor.ts:224-226`). Capabilities count only as own properties (`executor.ts:89-91`, `:256-259`).
- **Network and env**: the search found no server-side `fetch`, `http` or `net`. The only `fetch` calls are same-origin `/api/*` calls from client components (for example `Deadbeat.tsx:34,40,56,67,78`, `GrimMod.tsx:34,42,56,78`). The Deadbeat `email` capability only appends to the in-memory outbox (`adapter.ts:31`).
- **warning (owner awareness, not curse-reachable)**, `runtime.ts:35` and `poolFromEnv` in both apps: with `DATABASE_URL` set, host state and the grimoire (chat text, client emails and names, amounts) are written to Postgres via `pg`. The destination is operator configuration. No curse can name it, so this isn't an inviolable 1 breach as written. It is still a host-level data egress, so the owner should confirm it is covered by the declared-capability model. Fix: record that decision in the spec.

## 2. Actions with no undo path
Inverse coverage is complete for every declared capability:
- **GrimMod**: `mute` (`grimoire.ts:31-34`), `post` (`:35`) and `escalate` (`:36`).
- **Deadbeat**: `email` (`grimoire.ts:32`) and `escalate` (`:33`).
- **Reversals are audited**: `host.undo` calls `AuditLog.reverse`. It runs the inverse, then appends a `reversed` entry, and appends nothing if the inverse throws (`packages/curse-engine/src/grimoire.ts`).
- **`viewOf`**: GrimMod's `viewOf` (`grimoire.ts:47`) and Deadbeat's (`grimoire.ts:48`) agree with the inverse registries.
- **Deadbeat undo**: it does not clear sent-tier tracking, so a retracted email is not re-sent. This is documented in `UNDO_NOTE` and `host.ts` and is not a breach.

Warnings:
- **warning**, GrimMod `host.ts:159,166`, `adapter.ts:13,20-28,31`, `host.ts:176`. Deadbeat `host.ts:178`, `adapter.ts:31,37-48`, `host.ts:190`: effects are applied inside `executor.handle`, but the grimoire write (`recordDecision`) happens afterwards, once all executors have run. The loop rethrows any non-`UndeclaredCapabilityError` error. Such an error would skip every audit write for effects already applied in that pass. Why it matters: it is a mutation not preceded by a grimoire write (inviolable 3). The likelihood is low, because the executor catches capability throws (`executor.ts` run loop). Fix: record in a `finally` over the decisions gathered so far, or write the audit entry in the same step as the effect.
- **warning**, both `runtime.ts:88` and `:107`: `getHostReady` retries the database only while `!hydrated && !dirty`. `persistHost` sets `dirty = true` and returns without saving when not hydrated. So after one failed boot, the app never reconnects and never saves. The comment on `persistHost` promises that "the next successful save also stores any grimoire entries that were missed", but no save can succeed. Every audit entry made after that exists only in process memory. After a later successful hydrate-and-save cycle (`degraded` status), the code does flush missed entries. Only the never-hydrated case is affected. Fix: let a reconnect path run when `dirty` and flush the in-memory grimoire. The comment's reconcile-instead-of-overwrite concern needs a design decision.
- **Demo resets** (`app/api/reset/route.ts`, `app/api/fixtures/route.ts`, both apps): with persistence off, resetting discards the in-memory grimoire. This is documented in the route comments and `fixtures.ts`. With Postgres the old rows are kept and the epoch rotates. Noted, not a finding.

## 3. Simulator / live divergence risk
No second execution path and no live adapter reaches the simulator:
- **Simulate routes**: they pass only a list of declared names (`host.declaredCapabilities()`, derived from the adapter's own properties). GrimMod: `simulate/route.ts:50`, `host.ts:128-130`. Deadbeat: `simulate/route.ts:20`, `host.ts:122-124`.
- **Engine**: `SimulateOptions` has no capabilities parameter. It builds recording stubs (`simulator.ts:79-83`) and runs the same `createExecutor` (`simulator.ts:93`).
- **Persistence**: neither simulate route calls `persistHost`.
- **Wall clock and randomness**: `packages/*/src` has no `Date.now`, `Math.random`, `fetch` or `eval`. Its only `process.env` read is in the kill switch (`kill-switch/src/index.ts:5`). In the apps, `Date.now()` appears only at GrimMod intake (`events/route.ts:33,37`, `host.ts:90`) and in the retry timer (`runtime.ts:55,90`). It stamps incoming events and does not take part in rule evaluation. Deadbeat uses a fixed `REFERENCE_NOW`.
- **Kill switch**: it reads the environment on every intake (GrimMod `host.ts:114`, Deadbeat `host.ts:108`). It decides whether an event is processed, not what the decision is. The simulate routes don't consult it. Noted, not a finding.

Warnings:
- **warning**, GrimMod `host.ts:208` (also Deadbeat `host.ts:214`): the comment says executor count history and quota usage are not persisted. After a restart, live `count(... within 7 days)` conditions start from zero. `spam-strikes` (`fixtures.ts:35`) would under-mute, while `simulate` replays the full supplied history and would predict a mute. GrimMod is affected for counts and quota. Deadbeat has no count conditions and loses quota usage only. Fix: persist the count history or rebuild it from stored messages on restore. If neither is acceptable, document the gap.
- **warning**, Deadbeat `host.ts:170-171,183` against `simulator.ts`: the one-email-per-tier rule lives in the host (`hasSent`/`markSent` filter the active curses per tick). The simulator has no equivalent. The shipped simulate route emits one tick per invoice (`simulate/route.ts:18`), so the demo is consistent. A multi-tick history sent through `simulate` would predict repeat emails that the live host suppresses. Fix: move the dedupe into the executor path both share, or limit and document simulation to single-tick histories.

## 4. Tick-rules in non-tick hosts
none found.
- **GrimMod** (non-tick): it emits only `message` events (`host.ts:27`). Its one shipped curse uses `when message` (`fixtures.ts:35`) and has no `every` trigger. If a user installs an `every` curse, `install-warnings.ts:8` warns that it can never fire. The curse is still accepted with a 201 (`curses/route.ts`).
- **Deadbeat** (tick host): all three shipped curses use `every 1 day` (`fixtures.ts:33,35,37`). The host emits `tick` events with a 1-day interval (`host.ts:28-30`). It emits them once per invoice per day from `advanceClock` (`host.ts:155-156`), reached via `POST /api/events`. The executor matches timer triggers by interval in milliseconds (`executor.ts:193-194`), so these curses fire. `install-warnings.ts:11-14` warns about other intervals. Ticks come only from the API call and not from a scheduler. I recorded that as an observation and not a defect.

**Verdict (apps/grimmod, apps/deadbeat)**: FINDINGS (warnings only). All shipped curses use declared capabilities and have audited inverses, and the simulator never touches a live adapter. The open items are an audit-write ordering window, a persistence path that can stop saving the grimoire after a failed boot, non-persisted count and quota state, host-only dedupe in Deadbeat, and the Postgres egress that needs the owner's sign-off.

---

## Scoring

Scored from the verbatim report above. Fixture: `fixtures/auditor-negative/` (originally `auditor-fixture/`).

**Planted defects: exactly 3. Caught: 3.**

| Planted defect | Location | Caught? |
|---|---|---|
| Undeclared `email` capability | `pack.curse:1` (`prize-patrol`) | Yes — blocker, section 1 |
| `every` trigger in a non-tick host | `pack.curse:2` (`daily-digest`) | Yes — warning, section 4 |
| `escalate` with no inverse | `pack.curse:3` / `host.ts:15` (`spam-hammer`) | Yes — blocker, section 2 |

- True positives on planted defects: **3/3**. False negatives: **0**.
- Additional true positive (unplanted): the auditor found that `daily-digest` ended in `to #general`, which the tokenizer cannot lex (no `#` branch), so the curse was a parse error and contradicted the fixture README's "grammar-valid" claim. This is a real defect and is counted as an additional true positive, not a false positive. It has been fixed: `#general` is now `general` in `fixtures/auditor-negative/pack.curse`, so the README's claim is now true.
- Fixture false positives: **0**.

Other verdicts:
- `packs/standup/`: FINDINGS, warnings only (0 blockers, 2 warnings) — the curses are inviolable-clean, but no shipped host can run the pack.
- `apps/grimmod` + `apps/deadbeat`: FINDINGS, 0 blockers, 5 warnings.
