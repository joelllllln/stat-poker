# Continuous integration

`ci.yml` runs on every push: typecheck, the test suite, and a production build.

The exhaustive checks — every one of the 133,784,560 seven-card hands, and the
larger bot simulations — run only on `main`. They take minutes and can only
break if the evaluator or the policy changed, so paying for them on every
branch push would slow the loop without catching anything sooner.
