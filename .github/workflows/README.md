# Continuous integration

`ci.yml` runs on every push: typecheck, the test suite, and a production build.

The exhaustive checks — every one of the 133,784,560 seven-card hands, and the
larger bot simulations — run only on `main`. They take minutes and can only
break if the evaluator or the policy changed, so paying for them on every
branch push would slow the loop without catching anything sooner.

# Publishing

The `publish` job in `ci.yml` builds the app and publishes it to GitHub Pages.
It runs only on `main`, and only behind `check`: the deployed link outlives the
push that made it, so it should never carry a build that did not pass.

Pages has to be switched on once for the repository — Settings -> Pages ->
Source: GitHub Actions. The workflow token cannot do that itself, and the
`github-pages` environment only accepts deployments from the default branch,
which is why publishing is tied to `main` rather than to whatever branch is in
flight.

Assets are built with a relative base (`vite.config.ts`), so the same `dist`
runs from the site root in development and from the repository subpath that
Pages serves it under.
