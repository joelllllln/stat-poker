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
| 2 | Odds in a worker, predict-then-reveal | done |
| 3 | Hand-history persistence, stats dashboard, player profile | done |
| 4 | EV coach, Perfect Line view | done |
| 5 | Preflop solver, verified on Kuhn poker; heads-up preflop solved | done |
| 7 | Leak finder, run-it-again spread | done |
| 6 | Postflop river solver, analysis in a worker | done |

## Layout

```
src/
  engine/     cards, hand evaluator, betting rules   — pure, deterministic
  equity/     Monte Carlo + exact enumeration, ranges, opponent modelling
  bots/       archetypes and the policy that drives them
  coach/      pot odds, expected value, grading, leak finding, run-it-again
  solver/     CFR, the preflop game, and the solved blueprint
  stats/      statistics, profile, all-in adjustment, estimate tracking, storage
  game/       session: the table across hands
  ui/         React front end
  workers/    equity and solving, off the interface thread
scripts/      preflop, matchup and blueprint generators; browser smoke test
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
- **River solver**: the fast showdown sweep is checked against a hand-by-hand
  comparison of every holding against every holding — they agree to 1e-9 on
  narrow ranges, wide ranges, the whole deck, and boards where every hand
  chops. The solve converges to 0.0016 chips per hand in a ten-chip pot.
- **Outs**: a flush draw's spades are found without any rule about flushes,
  overcards against a made flush are correctly counted as nothing, and two
  cards to come are not scored by adding the one-card chance to itself.
- **Estimate tracking**: error is the mean *absolute* miss, so being twenty
  points out in both directions is not scored as accurate; bias is reported
  separately, because running consistently high is a different and more
  fixable fault than being scattered.
- **Run it again**: aces all-in against kings price at the ~82% they were worth
  however the board fell; chips balance across every re-dealt runout.
- **Leak finder**: a grouping that covers every decision scores zero excess and
  cannot be named a leak; a spot with too few decisions behind it is never
  called a habit.
- **Solver**: CFR is verified against Kuhn poker, whose equilibrium is known in
  closed form. It converges to exploitability below 0.001 chips per hand, never
  bets the queen, bluffs the jack at α ≤ ⅓, bets the king at exactly 3α, and
  calls the queen a third of the time — the equilibrium, not a regression
  against the solver's own output.
- **Coach**: folding a royal flush grades as a blunder, a correct call grades
  correct whatever the runout did, verdicts are deterministic, and no decision
  is ever offered a bet size that was not legal at the time.

## Counting outs

Outs are normally taught as rules — nine for a flush draw, eight for an
open-ender — and those rules quietly assume the opponent holds one specific
thing. The definition here needs no rules: **an out is a card that turns you
from an underdog into a favourite** against the range you are actually facing.
Every unseen card is tried and the hand re-priced with it in place.

That finds the flush cards without knowing what a flush is, declines to count a
card that improves them more than it improves you, and handles any board texture
identically because it never had a texture rule to begin with.

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

## What the solver solved, and what it did not

The solver is verified on a game with a known answer before being pointed at one
without. Kuhn poker's equilibrium has a closed form, and CFR reproduces it: the
3:1 ratio between value bets and bluffs, the ⅓ calling frequency, exploitability
below 0.001. Only then was it pointed at poker.

**Six-handed preflop was attempted and abandoned.** With a strategy stored per
hand per spot, a sampled deal trains only the hands it dealt; two million
iterations across 349,000 information sets left most spots with a handful of
observations. The result opened 2% under the gun and did not raise aces. That
artefact was thrown away rather than shipped — an unconverged solution presented
with a solver's authority is worse than no solution.

**Heads-up preflop is solved properly**, by vector CFR: the public betting tree
is traversed once per iteration and all 169 hands are updated at every node,
with card removal counted exactly. It converges to an exploitability of
0.000001 big blinds per hand — two-player and zero-sum, so that number means
what it says. The resulting button range opens 82% of hands, which is where
published solutions sit.

This is not a lesser target than six-handed. **Every hand folded to the small
blind is a heads-up preflop game at exactly these stakes**, which makes
blind-versus-blind the most repeated spot at the table. The app looks a hand up
only when it translates into that game exactly — two players left, no dead money
from anyone who folded, stacks at the solved depth — and returns nothing
otherwise. A strategy borrowed from a different spot is not an approximation.

Two abstractions remain, both stated in the code: limping is not modelled (the
opening decision is raise or fold), and everything after preflop is priced by
position-adjusted all-in equity rather than played out.

**The river is solved exactly.** With the board complete there is nothing left
to draw, so a river solve is a statement about poker rather than about a model
of it. Each player holds one of 1,081 possible pairs of cards, which would be a
million comparisons per showdown done naively; sorting holdings by strength once
and sweeping them while carrying running totals of the opponent's range turns
each showdown into a subtraction, and gets card removal out of the same sweep for
free. A river solves in about three seconds, in a worker, on request — the
interface thread computes nothing.

Turn and flop solves are not built. They multiply a river solve by every card
that could still come, and belong in a background job rather than behind a
button.

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
