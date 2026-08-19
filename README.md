# stat-poker

A 6-max No-Limit Hold'em trainer. Play against bots with the odds visible the
whole time, get every decision graded against what you should have done, and
watch your leaks close over hundreds of sessions.

**Play it: https://joelllllln.github.io/stat-poker/** — no install, no
account, no server. Everything runs in the browser, and your hand history stays
in it: hands are stored locally and never leave the machine unless you export
them yourself.

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
| 8 | Statistics across sessions, trend over time, table interface | done |

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
  table sizes. Side pots, uncalled-bet returns, odd-chip distribution, and the
  rule that decides when a raise reopens the betting each have targeted tests —
  including two short all-ins that add up to a full raise, which reopen it.
- **What a call plays for**: checked against the engine rather than against a
  formula. The same hand is played out twice, once folding and once calling,
  and what the seat ends up with has to match what the call was priced at.
- **Equity**: exact enumeration and sampling agree within the reported margin
  of error; AA over KK enumerates to 82% across all 1.7m runouts.
- **Bots**: their statistical signatures are measured by simulation rather than
  asserted, and are required to stay separable.
- **Storage**: a hand round-trips through the store and replays to the same
  board, result and statistics; a corrupt deck is refused rather than replayed
  as half a hand; statistics are recomputed on read, so improving a definition
  applies to hands already recorded.
- **Metrics over time**: the browser test plays thirty hands, reloads the page,
  and requires the dashboard to describe all thirty — the trend across blocks,
  where the money goes, and the verdicts — rather than starting again from zero.
- **Layout**: every box on the felt — each seat, the board, the pot, every pile
  of chips — reports its position, and the test fails if any two of them share
  a pixel. Checked on a phone, a tablet and a laptop, at showdown, and after
  every action across five hands of betting. "It looked fine" is not a check.
- **Backup**: a saved file holds every stored hand, and loading the same file
  twice leaves the history exactly as it was rather than counting it twice.
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
  however the board fell; chips balance across every re-dealt runout. The board
  is re-dealt from the point the betting ended, which is the only stretch over
  which holding the betting fixed says anything about the hand, and a hand the
  hero folded is priced as the call it is compared against — with the price of
  finding out in the number.
- **Leak finder**: a spot is compared against the decisions outside it rather
  than against an average it is part of, a spot with too few decisions behind it
  is never called a habit, and a dozen groups tested at once are corrected for
  as a dozen.
- **Solver**: CFR is verified against Kuhn poker, whose equilibrium is known in
  closed form. It converges to exploitability below 0.001 chips per hand, never
  bets the queen, bluffs the jack at α ≤ ⅓, bets the king at exactly 3α, and
  calls the queen a third of the time — the equilibrium, not a regression
  against the solver's own output.
- **Coach**: folding a royal flush grades as a blunder — whether it cost
  something to fold or nothing at all — a correct call grades correct whatever
  the runout did, every action the rules allow comes back with a price, and no
  decision is offered a bet size that was not legal at the time.
- **Verdicts do not depend on the seed**: the same hands are graded under four
  different sampling seeds and every verdict has to come out the same. This is
  the acceptance test for the whole expected-value model, and the reason for
  the error bars, the shared random numbers and the extra rollouts spent on
  close decisions.
- **Nothing is announced from noise**: two halves drawn from the same player
  must be called a trend no more than one time in twenty, and a player whose
  costs have nothing to do with the spots they happened in must be handed a
  leak no more than one time in twenty. Both are measured against results
  shaped the way poker results are shaped — mostly nothing, occasionally
  enormous — and both keep the power to find a difference that is really
  there.

## Following the game, and knowing what to do

Three things run while a hand is live, and between them they answer "what is
happening" and "what should I do about it":

- **What happened** — a running account of the hand as a dealer would give it:
  the blinds, every action in order, and each street as its cards come out. A
  pot of 33 tells you nothing about who raised and who came along; this does.
- **What to do** — the highest-value action at the decision in front of you,
  with *every* option priced beside it, so the recommendation is an argument
  rather than an instruction: raising beats calling by 1.3 big blinds and
  folding by 2.6. It is marked on the button it recommends, and a recommended
  raise names its size.
- **This decision** — the arithmetic underneath: what your hand is worth
  against the ranges still in, and what the price demands.

The live advice is the *same pricing that grades the hand afterwards*, run on
the position as it stands, so what the coach says while you decide and what the
review says when you are done cannot disagree. It can be switched off — being
told the answer is how a spot becomes familiar, and not being told is how you
find out whether it has.

## Reading the screen

Two screens, not one: the **Table**, which is what you are doing, and
**Progress**, which is why. The table screen shows one sentence about the
decision in front of you — what your hand is worth against the range still in,
and what the price demands — with the two numbers behind it and everything else
folded away under a disclosure. Nine numbers on screen is not more informative
than two; it is less, because nobody reads nine numbers while deciding whether
to call.

The felt is drawn in units of its own width, so the arrangement is identical at
every size rather than reflowing into itself. Below the width where that would
leave the text too small to read, the oval is dropped for a plain stacked
layout — a small screen is a reason to change the arrangement, not to shrink it
until it collides.

## What playing it for a few thousand hands showed

`scripts/simulate.ts` plays the game rather than testing its parts: six hero
policies against the same bots, each measured the way the app measures a
person. The results are the most useful thing in this repository, because two
of them contradict what the app appears to claim.

| Policy | Hands | bb/100 | Given up bb/100 | VPIP | PFR |
|---|---|---|---|---|---|
| Follow the coach | 1,000 | **−424** | 0.0 | 76% | 76% |
| A plain tight-aggressive rule | 2,500 | −111 | 287 | 27% | 12% |
| Fold every hand | 2,500 | **−23** | 65 | 0% | 0% |
| Never fold | 2,500 | −1,084 | 2,358 | 98% | 0% |
| Raise everything | 2,500 | −2,972 | 907 | 99% | 99% |
| At random | 2,500 | −324 | 457 | 66% | 37% |

**Following the coach loses more than folding every hand.** Its 95% interval
(−843 to −4) is entirely below zero, so that is not variance. It plays 76% of
hands and raises nearly all of them.

**And it grades itself perfect while doing it** — 0.0bb/100 given up, "Elite",
100% of decisions optimal. That number is not a lie so much as a tautology: the
live coach and the grader are the same model on the same seed, so agreeing with
it exactly is worth zero by construction. The dashboard now says as much.

The cause is measured rather than guessed. For every bet the coach recommends,
the simulation records the fold-through probability the model predicted and
then watches what the table did:

> Across 268 bets the coach expected the field to fold **43.4%** of the time.
> It actually folded **24.6%**.

The model prices opponents who continue when their hand clears the price,
discounted for the equity they will not realise. The bots at this table decide
by their archetype's widths and their own heuristics, and they call almost twice
as often as the model expects. Every bluff the coach recommends is therefore
priced against opponents who do not exist, and the one-street model then credits
the called branch with a showdown it has not reached.

So: **the coach is a good guide to the arithmetic of a decision and a bad guide
to a strategy.** Pot odds, equity against a modelled range, and which of two
lines is obviously worse — those it gets right, and they are what the overlay
is for. "Play what it says on every street" is not supported by the evidence,
and the app should not be read as claiming it.

An attempted fix — charging the hero the same realisation discount the villains
get — moved the winrate from −424 to −233 and the style from 76% to 63% of
hands, which is the right direction but not a rescue, and it made verdicts
depend on the sampling seed. It was reverted rather than shipped: a bias that
can be stated is better than an instability that cannot.

## Keeping score across sessions

Every hand is stored, and the statistics are built from all of them rather than
from the current tab. Three things follow from that, and each of them is a rule
about honesty rather than a feature:

- **Only replay inputs are stored** — the deck, the actions, the stacks. Every
  statistic is recomputed on read, so improving a definition applies to hands
  recorded months ago rather than only to hands played afterwards.
- **Verdicts are cached against a grader version.** Grading a hand costs under
  a second, which cannot be paid again for a whole history on every load; it is
  paid once, in a worker, newest hands first. Changing the coach raises the
  version and every cached verdict is discarded and worked out again, because a
  stale grade shown as a current one is worse than an ungraded hand.
- **A trend is only reported when the sample supports it.** The history is cut
  into blocks — wide enough to mean something, narrow enough to show movement —
  and a change is called a change only when the sample can carry the claim.
  Rates are compared as proportions and chips by permutation, because chips per
  hand are nothing like normally distributed and a test that assumes they are
  will find trends in anybody. Several questions asked of one history are
  corrected for as several. Over a few hundred hands the honest answer is
  usually that nothing has moved, and the app says so.

## Counting outs

Outs are normally taught as rules — nine for a flush draw, eight for an
open-ender — and those rules quietly assume the opponent holds one specific
thing. The definition here needs no rules: **an out is a card that turns you
from an underdog into a favourite** against the range you are actually facing.
Every unseen card is tried and the hand re-priced with it in place.

That finds the flush cards without knowing what a flush is, declines to count a
card that improves them more than it improves you, and handles any board texture
identically because it never had a texture rule to begin with.

With two cards to come the question changes from "how often does an out
arrive?" to **"how often does the hand end up in front?"**, and every pair of
cards still to come is tried rather than assuming what an out is stays the same
after the first one lands. A fourth heart can fill their range as easily as
yours, and a turn that puts you ahead can be undone by the river. The usual
"miss twice" shortcut cannot see either.

## What the coach can and cannot see

The EV model prices **one street**: what folding, calling, checking or betting
is worth right now. It is exact where the hand ends there — a river call is
fully priced — and an approximation where it does not, so implied odds on a
flop draw are not captured. Three consequences worth knowing:

- All-in is only offered as a candidate when stacks are shallow (SPR ≤ 2).
  Inside a one-street model a huge bet with a strong hand always scores best,
  because there is no later street in which it could cost the value a smaller
  bet would have collected. Offering it everywhere made the coach recommend
  jamming the nuts on the flop.
- Whether a villain folds is modelled by whether its hand clears the price it
  is personally being laid, after discounting for the equity it will not get to
  realise. That is a defensible rule rather than a solved one, and Phase 6
  replaces it for heads-up postflop.
- Which opponents call is not known when a bet is made, so every way the field
  can split is priced and weighted by how likely it is. Their decisions are
  modelled as independent; the arithmetic then follows from that assumption
  rather than quietly contradicting it.

A call is priced against what it can actually win. Facing 400 with 30 behind,
only 28 of that bet is ever at stake and the rest goes back to whoever bet it —
so the call plays for 32 chips, not for the 404 on the table.

**Every priced action carries its error bar**, because most of them are
sampled. Expected value is linear in equity, so the sampler's error carries
through exactly, and the alternatives are priced against the same random draws
so that most of it cancels where they are compared. A verdict is then read off
the *conservative* end of that bar: noise can lose a blunder but can never
invent one. Where the bar straddles a band, that one decision is priced again
with far more rollouts — which is where they change what is said, and the only
place they are spent.

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
what it says. The resulting button range opens 80% of hands, which is where
published solutions sit.

**Four depths are solved, not one**: 40, 70, 100 and 150 big blinds. Depth is
the game rather than a detail of it — forty blinds and a hundred disagree about
which hands can open and about when a three-bet is a shove — so a hand is
answered from the rung nearest the *effective* stack, the shorter of the two,
and from none at all outside them.

This is not a lesser target than six-handed. **Every hand folded to the small
blind is a heads-up preflop game at exactly these stakes**, which makes
blind-versus-blind the most repeated spot at the table. The app looks a hand up
only when it translates into that game — two players left, no dead money from
anyone who folded, an effective stack near a solved depth — and returns nothing
otherwise. A strategy borrowed from a different spot is not an approximation.

Two abstractions remain, both stated in the code: limping is not modelled (the
opening decision is raise or fold), and a pot that sees a flop is priced by
all-in equity adjusted for the position it will be played from rather than
played out. A pot that is already all-in gets no such adjustment: there are no
later streets for position to act on, so the equity is the answer. Discounting
those too priced a coin flip as 54/46 to the button, at exactly the decisions
most sensitive to it.

**The river is solved exactly in the cards.** With the board complete there is
nothing left to draw, so no equity is estimated and no runout is assumed: every
holding is compared against every holding. What is still an abstraction is the
betting — two bet sizes and two raises deep — so the solve is exact about who
beats whom and a model of how much they can bet about it.

Each player holds one of 1,081 possible pairs of cards, which would be a
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

| | VPIP | PFR | 3-bet | Fold to raise | WTSD | AF |
|---|---|---|---|---|---|---|
| The Rock (nit) | 9.0% | 6.3% | 1.5% | 93% | 48% | 1.32 |
| The Eagle (TAG) | 23.1% | 18.2% | 3.3% | 82% | 48% | 2.05 |
| The Hawk (LAG) | 32.3% | 22.1% | 5.7% | 69% | 51% | 2.81 |
| The Fish (station) | 43.9% | 7.0% | 0.5% | 43% | 57% | 0.25 |
| The Maniac | 45.9% | 35.7% | 21.3% | 52% | 45% | 3.31 |

Preflop profiles are realistic. **WTSD is still not**: real players show down
25–30% of the flops they see and these bots roughly double it, because multiway
pots get checked down rather than bet. It makes them too passive on later
streets — the known weakness of this generation of bots, and the reason Phase 5
replaces the policy with a solved preflop blueprint.

These numbers used to read 60–86%, and most of that was a measurement rather
than the bots: whether a seat had seen the flop was read off whether it was
still in the hand at the end, which strikes out everyone who saw a flop and
folded on it. The denominator of a rate decides what the rate means, and a
wrong one produces a plausible number that answers a different question.

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
- **A claim about a player gets a test that could refute it.** Not an assertion
  that the code does what it says, but a measured false-positive rate: point
  the trend finder at a player who has not changed, or the leak finder at a
  player with no leak, and require them to say so nineteen times in twenty.
- **A verdict is a property of the decision, not of the run.** Anything the app
  computes by sampling carries the error of that sampling, and no verdict is
  delivered that the sample cannot support.
