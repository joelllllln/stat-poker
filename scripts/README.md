# Scripts

Generators, and two harnesses that play the game rather than test its parts.

| | |
|---|---|
| `generate-preflop-table.ts` | Preflop hand strengths, computed once and checked in |
| `generate-matchup-table.ts` | Hand-class against hand-class equities |
| `generate-blueprint.ts` | Solves the heads-up preflop game (`ITERATIONS=…`) |
| `smoke.mjs` | Drives a browser through one session: every claim the app makes, checked |
| `simulate.ts` | Plays thousands of hands under different policies and measures everything |
| `soak.mjs` | Plays hundreds of hands through the real interface and watches it age |

## Playing the game to find out what it does

The unit tests prove the parts are right, which is not the same as the whole
behaving like poker. These two ask that instead.

```bash
npx vite-node scripts/simulate.ts -- --hands 2500   # writes simulation-report.md
```

Six hero policies — following the coach, a plain tight-aggressive rule, always
folding, never folding, raising everything, and choosing at random — play the
same bots, and every policy is measured the way the app measures a person:
winrate with its interval, expected value given up, the verdicts the coach
hands out, the profile it earns, the leak it is told about, and what each part
costs in milliseconds.

```bash
npx vite build && npx vite preview --port 4173 &
node scripts/soak.mjs --hands 400                   # writes soak-report.json
```

A long sitting in a real browser: how a hand's latency moves as the history
grows, whether the background grading keeps up with play, what a reload costs
once there is something to reload, and whether anything throws along the way.

Both write a report and both are meant to be read, not just passed. The point
is the numbers, and the numbers are how the gaps were found.
