# stat-poker — Build Plan

A 6-max No-Limit Hold'em trainer. You play against bots with live odds visible the
whole time, get a statistically grounded review of every decision after the hand,
and watch your leaks close over hundreds of sessions.

**Decisions locked:** Web app (React + TypeScript, local-first). 6-max NLHE.
Solver-grade analysis (see §3 for what that actually means).

---

## 1. What the product is

Three layers, always in this order of priority:

1. **A correct poker engine.** Everything else is worthless if side pots are wrong.
2. **An always-on odds overlay.** Not "click to see odds" — the numbers live on
   screen while you decide, and can be progressively hidden as you improve.
3. **A reflection + metrics layer.** Every decision is graded in EV, stored
   forever, and rolled up into trend lines that show whether you're improving or
   just running good.

The differentiator over existing tools: commercial trackers (PT4, HM3) analyze
hands you played elsewhere; solvers (Pio, GTO+) analyze spots you set up by hand.
This does both, live, in one loop — play, see the math, get graded, watch the
graph move.

---

## 2. Architecture

```
src/
  engine/     pure game rules — no UI, no async, fully deterministic
  equity/     Monte Carlo + exact enumeration, range algebra   → Web Worker
  solver/     CFR postflop + preflop blueprint lookup          → Web Worker (WASM)
  bots/       opponent archetypes and decision policies
  coach/      per-decision EV grading and verdicts
  stats/      hand-history store, stat derivation, aggregation
  ui/         table, HUD, reflection screen, dashboard
```

**Stack:** Vite + React 18 + TypeScript (strict), Zustand for game state, Tailwind
for styling, Dexie (IndexedDB) for hand history, Recharts for the dashboard,
Vitest for tests. Solver core in Rust → WASM with SIMD; everything else TS.

**No backend in v1.** All data is local. Add sync later behind an export/import
boundary that exists from day one (§9).

### Non-negotiable design rules

- **The engine is a pure reducer:** `(GameState, Action) => GameState`. No
  randomness inside it — the deck is passed in. This is what makes replay,
  "run it again" analysis, and deterministic tests possible.
- **Seeded RNG** (xoshiro256\*\*) for every deck. A hand is fully reproducible from
  `(seed, actions[])`, so a stored hand is ~200 bytes, not a blob of card data.
- **Workers do all math.** The UI thread never computes equity. Ever. Cancel
  in-flight worker jobs when the user acts.
- **Range-aware, not card-aware.** Every equity number shown is vs. the villain's
  *modeled range*, never vs. random cards. Equity vs. random cards is the single
  most common way poker trainers teach people wrong instincts.

---

## 3. The analysis engine — what "solver-grade" means here

Honest scoping, because this is where the project can quietly fail.

| Situation | Method | Latency |
|---|---|---|
| Preflop, any number of players | Precomputed 6-max blueprint (lookup) | instant |
| Postflop heads-up | In-browser CFR on abstracted tree | 5–60s, post-hand |
| Postflop multiway (3+) | Equity vs. range + EV comparison, labeled as heuristic | <100ms |
| Live during play | Monte Carlo equity + pot odds + EV | <50ms |

**Preflop blueprint.** Solved offline (a build-time job, not in the app) for a
6-max 100bb tree with discrete sizings. Ships as a compressed lookup table of
action frequencies per (position, action sequence, hand) — on the order of a few
MB. This gives genuinely correct preflop grading and lets bots play a real
strategy rather than a hand-written chart.

**Postflop CFR.** Discounted CFR over an abstracted tree: 3–4 bet sizes per node
(33% / 75% / 150% pot + all-in), board isomorphism collapsing suit-equivalent
runouts, range-vs-range with card removal. Rust/WASM, one worker per solve.
Convergence measured as **exploitability in the abstracted game** — reported to
the user as a confidence label, never as "this is GTO". Turn and river subgames
solve in seconds; flop solves are the expensive case and run in the background
after the hand ends, streaming into the reflection view when ready.

**Why this ordering works:** live play never waits on the solver. The HUD is
equity math and runs in milliseconds. The solver is a post-hand luxury, so it's
allowed to be slow — which is exactly what makes an in-browser CFR feasible.

---

## 4. The live odds overlay

On screen during every decision:

- **Your equity vs. villain's modeled range** — the headline number.
- **Pot odds and required equity**, shown side by side with your equity so the
  comparison is visual, not arithmetic.
- **Outs**, with improvement probability by street (turn / river / by river).
- **SPR** and effective stack in bb.
- **Hand strength percentile** within your own range — teaches range thinking,
  not just hand thinking.
- **Implied odds estimate** on drawing hands.
- **Villain's range**, rendered as a 13×13 grid that narrows visibly as they act.

### Training-wheels levels (the feature that makes it a trainer)

1. **Full** — everything visible.
2. **Predict-then-reveal** — you enter your equity estimate before the numbers
   appear. Your estimation error is tracked as a first-class metric. This is the
   most valuable mode in the app and should exist from Phase 2.
3. **Delayed** — numbers appear only in the post-hand review.
4. **Off** — pure play; grading still happens silently.

---

## 5. The reflection layer — "how I should have played, exactly"

### 5.1 Two rules that govern all grading

**Rule 1 — grade the decision, never the outcome.** If you call correctly and lose
to a better hand, that is a *correct call*. The app says so, in those words. A
trainer that grades on results teaches you to fold winners and chase losers; it
is the single most common failure mode in poker software and this app must not
have it.

**Rule 2 — grade against the range, never the cards.** "You should have folded,
he had aces" is worse than no feedback at all — you could not see his aces. Every
prescribed action is computed from the information available *at that moment*:
his range, the board, stacks, position. Villain's actual hand is revealed only
after the verdict is shown, and never feeds into it.

### 5.2 What "statistically perfect" resolves to at each node

Each of your decisions produces a **prescribed strategy** — not a single action:

| Node | Source | Output |
|---|---|---|
| Preflop | Blueprint lookup | Exact frequencies: `3-bet to 9bb 65% / call 35%` |
| Postflop HU | CFR solve | Frequency + EV for every action and sizing at the node |
| Postflop multiway | EV vs. modeled ranges | Highest-EV action, labeled heuristic |

**Mixed strategies are shown honestly.** If the solution is "check 78% / bet 22%",
the app shows both — because that is what the correct strategy *is*. Poker's
correct play at many nodes is a dice roll, and pretending otherwise is a lie that
produces worse players.

### 5.3 The verdict comes from EV, not from frequency match

This is the detail that makes mixed strategies usable. Betting a 22%-frequency
action is **not a mistake** — at equilibrium, actions in a mix have nearly
identical EV, which is *why* they're mixed. So:

```
EV loss = EV(prescribed best action) − EV(your action)
```

| EV loss | Verdict |
|---|---|
| ≤ 0.1bb | **Optimal** — inside the mix |
| 0.1–0.5bb | **Fine** — small, defensible |
| 0.5–2bb | **Mistake** |
| > 2bb | **Blunder** |

Frequency is displayed as context ("solver checks here 78% of the time"), never as
the grade. Thresholds are configurable and get calibrated against real data.

### 5.4 The Perfect Line view

Every hand gets a replay with your actions swapped for the prescribed ones, side
by side with what you actually did. Each node shows:

- The exact prescribed action, sizing, and frequency.
- The EV of the line you took vs. the line you should have taken, in bb.
- **Why**, in words, generated from node features — range advantage, board
  texture, SPR, blockers, and which of your hands need to bluff to balance the
  value bets you're already making.
- **"Perfect play still loses this pot 34% of the time."** Stated explicitly on
  every hand you played correctly and lost. This is the whole point.

### 5.5 Run It 1000 Times

On any decision, replay the rest of the hand thousands of times from that node
with the prescribed action, and show the outcome distribution — how often it wins,
loses, the EV, and where this particular result fell in that spread. Turns "I got
sucked out on" into a visible tail of a distribution you chose correctly.

A tracked stat, **Correct-and-Lost**, counts decisions that were optimal and lost
anyway. It should go *up* as you improve. It is the tilt-control metric.

**After every session:** EV lost broken down by street, by position, by action
type, and by pot type (single-raised / 3-bet / limped).

**Rolling:** a leak-finder that clusters your worst spots by feature —
"turn barrels out of position in 3-bet pots: −4.2bb/100 across 340 samples".

---

## 6. Metrics tracked over time

Standard tracker stats: VPIP, PFR, 3-bet%, fold-to-3bet, 4-bet%, C-bet flop/turn/
river, fold-to-cbet, WTSD, W$SD, WWSF, aggression frequency, steal and defense by
position — all with positional splits.

App-specific stats that matter more:

- **bb/100 actual vs. bb/100 all-in-adjusted** on one chart. The gap between the
  lines *is* your luck, made visible. This is the chart that makes the app.
- **EV lost per 100 hands** — the purest skill metric here, and the one that
  should trend down.
- **Mistake rate** and average EV loss per decision, by street.
- **Equity estimation error** (from predict-then-reveal mode) — trends toward
  intuition.
- **Solver agreement %** on heads-up postflop nodes.

### Sample-size honesty

Non-negotiable: every stat carries a confidence interval and is greyed out below
its reliability threshold (winrate needs tens of thousands of hands; VPIP
stabilizes in a few hundred). A poker tracker that displays a 200-hand bb/100 as
meaningful is lying to its user, and this app's entire premise is not doing that.

---

## 7. Player classification — style vs. mastery

Offsuit-style archetypes, but split along **two independent axes**, because a
single animal label conflates two different questions.

### Axis 1 — Style (descriptive, not a ranking)

Your position on the VPIP/PFR plane plus postflop aggression. This is the classic
tracker taxonomy: fish sit at VPIP 40%+, the balanced TAG benchmark sits around
VPIP 22 / PFR 19 / Agg 55, nits sit bottom-left.

|  | Low aggression | High aggression |
|---|---|---|
| **Tight** | Rock / Nit | **Eagle** (TAG) |
| **Loose** | Fish / Calling Station | Maniac (LAG) |

Rendered as a scatter plot: your point, your trail over the last N sessions, and
the shaded zone winning players occupy. No style is "bad" — LAG and TAG both win.
Being *unaware* of your style is what's bad.

### Axis 2 — Mastery (a real ranking)

Derived from **EV lost per 100 hands** and solver agreement — *not* from winrate.
Winrate depends on which bots you sat with and needs tens of thousands of hands to
mean anything; EV lost is measurable in hundreds and is purely about you.

| Tier | EV lost / 100 hands |
|---|---|
| Elite | < 1.5bb |
| Strong | 1.5–4bb |
| Solid | 4–8bb |
| Amateur | 8–15bb |
| Fish | > 15bb |

Thresholds are placeholders until calibrated against real play against the shipped
bot pool — do not present them as authoritative before that.

So a profile reads: **"Loose-Aggressive · Solid (−5.1bb/100 EV lost)"** — you play
like a LAG, and you're mid-tier at it. Both facts are useful; the single-label
version hides the second one.

### Axis 3 — Per-street and per-spot archetypes

The most actionable output, and where this beats a single badge: your style is
rarely uniform. "**Nit preflop, maniac on turns**" is a diagnosis you can act on
tomorrow. Compute the style classification independently per street, per position,
and per pot type, and surface the biggest internal contradiction as the headline
leak.

## 8. Bots

Three tiers, shipped in this order:

1. **Archetypes** — nit, TAG, LAG, calling station, maniac. Frequency tables
   driving a rule-based policy. Fast to build, immediately fun, good enough to
   validate the whole loop.
2. **Range-aware** — uses the equity module and pot odds to make actual EV
   decisions against a modeled range of yours.
3. **Blueprint** — plays the preflop solution with tunable deviation, so you can
   dial an opponent from "exploitable fish" to "near-unexploitable" and see your
   winrate respond.

Bots must also be *readable*: each has a stable style so range modeling has
something real to learn from. A bot with no exploitable tendency teaches nothing.

---

## 9. Data model

Hands stored as `(seed, actions[], stacks, positions, timestamp, botConfig)` —
replay reconstructs everything. Derived stats are computed on read and cached,
never stored as the source of truth, so improvements to the stat logic
retroactively apply to your whole history.

Schema versioning and migrations from the first commit. Export/import as JSON
plus a PokerStars-format hand-history text export from Phase 3 — this is the
escape hatch that makes the local-first choice safe.

---

## 10. Phases

| Phase | Deliverable | Exit criteria |
|---|---|---|
| **0** | Scaffold, CI, cards, 7-card evaluator | **Done.** All 133,784,560 seven-card hands verified |
| **1** | Playable 6-max table vs. archetype bots | **Done.** Chips conserved across random play; side pots correct |
| **2** | Equity + live HUD + predict-then-reveal | Overlay shipped and matches published figures; moving it to a worker is outstanding |
| **3** | Hand history persistence + stats dashboard + style/mastery profile (§7) | **Done.** Hands replay from storage to identical results; export/import round-trips |
| **4** | EV coach, Perfect Line view (§5) | **Done.** Every decision graded; verdicts reproducible and outcome-independent. Run It 1000 Times still to build |
| **5** | Preflop blueprint + blueprint bots | **Done.** CFR verified against Kuhn poker's known equilibrium; 6-max preflop solved by external sampling and shipped as a lookup |
| **6** | WASM postflop CFR + solver frequencies in Perfect Line | Turn/river solves <10s; exploitability reported |
| **7** | Leak finder, per-street archetypes, deeper analytics | Clusters validated against known leaks in seeded histories |

Phases 0–4 are the actual product. 5–7 are the depth that makes it worth using
for a year. Ship 1–4 before touching Rust.

Note the sequencing on "exactly how I should have played": Phase 4 already
answers it with EV-vs-range math on every decision, and Phase 5 makes preflop
exact. Phase 6 upgrades postflop heads-up from "highest EV against my model of
his range" to true equilibrium frequencies. The verdict UI does not change
between those phases — only the number feeding it gets better — so build the
reflection screen once, in Phase 4, against a strategy-provider interface that
the blueprint and solver later implement.

---

## 11. Testing

- **Evaluator:** exhaustive or large-sample verification against a reference
  implementation across 7-card combinations.
- **Engine:** property tests — chips are conserved, pots always distribute fully,
  min-raise and all-in rules hold under random action sequences.
- **Equity:** compare against published matchups (AA vs. KK ≈ 81.9%, AKs vs. 22 ≈
  50%) within Monte Carlo error bars.
- **Solver:** convergence by exploitability; regression-test known simple spots
  (river polarized toy games have analytic solutions).
- **Stats:** a fixture set of hand histories with hand-verified expected stats.

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| Solver scope swallows the project | Phase-gated to 6; the app is complete and useful at Phase 4 |
| Multiway "solver" expectations | Labeled as heuristic in the UI wherever it applies |
| Evaluator too slow for Monte Carlo | Lookup-table evaluator, typed arrays, worker pool; measure early |
| Analysis paralysis for the user | Training-wheels levels; the HUD is designed to be turned down |
| Bots feel fake, so training doesn't transfer | Readable archetypes + measurable exploitability, tuned against real stat distributions |
| IndexedDB data loss | Versioned schema + export from Phase 3 |

---

## 13. Immediate next steps

1. Scaffold Vite + React + TS + Tailwind + Vitest, CI on push.
2. `engine/cards.ts` — card representation, seeded deck, 7-card evaluator.
3. Property-test the evaluator before writing a single line of UI.
