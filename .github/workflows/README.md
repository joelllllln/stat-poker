# Continuous integration

`ci.yml` runs on every push: typecheck, the test suite, and a production build.

The exhaustive checks — every one of the 133,784,560 seven-card hands, and the
larger bot simulations — run only on `main`. They take minutes and can only
break if the evaluator or the policy changed, so paying for them on every
branch push would slow the loop without catching anything sooner.

# Publishing

`pages.yml` builds the app and publishes it to GitHub Pages, after running the
same typecheck and tests as CI — the deployed link outlives the push that made
it, so it should not ship a build nobody checked.

Assets are built with a relative base (`vite.config.ts`), so the same `dist`
runs from the site root in development and from the repository subpath that
Pages serves it under.
