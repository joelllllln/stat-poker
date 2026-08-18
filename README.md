# stat-poker

A 6-max No-Limit Hold'em trainer. Play against bots with the odds visible the
whole time, get every decision graded against what you should have done, and
watch your leaks close over hundreds of sessions.

Full design in [`docs/PLAN.md`](docs/PLAN.md).

```bash
npm install
npm run dev        # play at localhost:5173
npm test           # unit and simulation tests
npm run test:slow  # adds the exhaustive 133m-hand evaluator check (~80s)
```

## Where it is

| Phase | | |
|---|---|---|
| 0 | Cards, evaluator, betting engine | done |
| 1 | Equity engine, archetype bots, playable table, live odds overlay | done |
| 2 | Odds in a worker, predict-then-reveal metrics | overlay shipped, worker pending |
| 3 | Hand-history persistence, stats dashboard, player profile | done |
| 4 | EV coach, Perfect Line view | done |
| 5–7 | Preflop blueprint, postflop CFR solver, leak finder | next |

## Layout

```
src/
  engine/     cards, hand evaluator, betting rules   — pure, deterministic
  equity/     Monte Carlo + exact enumeration, ranges, opponent modelling
  bots/       archetypes and the policy that drives them
  coach/      pot odds, expected value, and per-decision grading
  stats/      statistics, profile, all-in adjustment, hand-history storage
  game/       session: the table across hands
  ui/         React front end
scripts/      preflop table generator, browser smoke test
```

## What is verified

- **Evaluator**: all 2,598,960 five-card hands and all 133,784,560 seven-card
  hands classify to the known category frequencies. The direct seven-card path
  is also checked against the best of all 21 five-card subsets.
- **Betting engine**: chips are conserved, pots distribute fully, and no seat
  acts out of turn across 10,000 randomly played hands with random stacks and
  table sizes. Side pots, uncalled-bet returns, short all-ins that do not
  reopen betting, and odd-chip distribution each have targeted tests.
- **Equity**: exact enumeration and sampling agree within the reported margin
  of error; AA over KK enumerates to 82% across all 1.7m runouts.
- **Bots**: their statistical signatures are measured by simulation rather than
  asserted, and are required to stay separable.
- **Storage**: a hand round-trips through the store and replays to the same
  board, result and statistics; a corrupt deck is refused rather than replayed
  as half a hand; statistics are recomputed on read, so improving a definition
  applies to hands already recorded.
- **All-in adjustment**: aces against kings all-in preflop price at the ~82% the
  hand was worth however the board fell, and chips still balance.
- **Coach**: folding a royal flush grades as a blunder, a correct call grades
  correct whatever the runout did, verdicts are deterministic, and no decision
  is ever offered a bet size that was not legal at the time.

## What the coach can and cannot see

The EV model prices **one street**: what folding, calling, checking or betting
is worth right now. It is exact where the hand ends there — a river call is
fully priced — and an approximation where it does not, so implied odds on a
flop draw are not captured. Two consequences worth knowing:

- All-in is only offered as a candidate when stacks are shallow (SPR ≤ 2).
  Inside a one-street model a huge bet with a strong hand always scores best,
  because there is no later street in which it could cost the value a smaller
  bet would have collected. Offering it everywhere made the coach recommend
  jamming the nuts on the flop.
- Whether a villain folds is modelled by whether its hand clears the price,
  after discounting for the equity it will not get to realise. That is a
  defensible rule rather than a solved one, and Phase 6 replaces it for
  heads-up postflop.

## Bot signatures

Measured over 1,200 hands of the five archetypes playing each other. These are
emergent — the policy takes style parameters, not target stats.

| | VPIP | PFR | 3-bet | Fold to 3-bet | WTSD | AF |
|---|---|---|---|---|---|---|
| The Rock (nit) | 9.0% | 6.4% | 1.9% | 93% | 77% | 1.79 |
| The Eagle (TAG) | 21.6% | 17.7% | 3.8% | 86% | 63% | 2.60 |
| The Hawk (LAG) | 35.6% | 25.9% | 8.6% | 68% | 62% | 2.62 |
| The Fish (station) | 42.2% | 6.3% | 0.4% | 56% | 86% | 0.29 |
| The Maniac | 51.1% | 42.5% | 28.7% | 49% | 56% | 3.87 |

Preflop profiles are realistic. **WTSD is not**: real players show down 25–30%
of the flops they see, and these bots are far higher because multiway pots get
checked down rather than bet. It makes them too passive on later streets — the
known weakness of this generation of bots, and the reason Phase 5 replaces the
policy with a solved preflop blueprint.

Winrates in these tables are noise at this sample size, which is exactly the
point the app's own dashboard makes about your own.

## Design rules

- **The engine is a pure reducer.** No randomness inside it — the deck is
  passed in, so a hand is reproducible from `(seed, actions[])` and replay,
  "run it again", and deterministic tests all fall out for free.
- **Equity is always measured against a modelled range**, never against random
  cards. One model, in `equity/opponent.ts`, shared by the bots that decide and
  the overlay that explains, so what a bot believed and what the review says it
  believed cannot diverge.
- **Decisions are graded, not outcomes.** A correct call that loses is a
  correct call, and the app says so.
- **Rates carry their sample size.** A winrate over 200 hands is noise, and
  showing it as anything else is the main way poker software misleads people.
