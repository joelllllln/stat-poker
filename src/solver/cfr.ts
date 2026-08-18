/**
 * Counterfactual regret minimisation.
 *
 * A general solver over any two-player zero-sum game with imperfect
 * information, kept separate from poker so it can be verified on games whose
 * equilibrium is known exactly before it is trusted on games whose is not.
 *
 * The variant is CFR+: regrets are clipped at zero rather than allowed to go
 * negative, and the average strategy is weighted linearly by iteration. Both
 * converge substantially faster than vanilla CFR and neither changes what is
 * being computed.
 */

export interface Game<S> {
  /** How many players act. Two is required for exploitability. */
  players: number
  root(): S
  isTerminal(state: S): boolean
  /** Payoff to `player` at a terminal state, in chips. */
  payoff(state: S, player: number): number
  /** 0 or 1, or `CHANCE` at a chance node. */
  currentPlayer(state: S): number
  actions(state: S): number[]
  next(state: S, action: number): S
  /** What the acting player knows: states sharing a key are indistinguishable. */
  infoSet(state: S): string
  /** Outcomes and their probabilities at a chance node. */
  chanceOutcomes(state: S): { state: S; probability: number }[]
  /**
   * Draw a single chance outcome, for games whose deals are too numerous to
   * enumerate. Supplying this switches the solver to chance sampling: each
   * iteration walks the action tree under one sampled deal instead of every
   * deal at once. The estimate stays unbiased; it just arrives over many
   * iterations rather than in each one.
   */
  sampleChance?(state: S, random: () => number): S
}

export const CHANCE = -1

interface Node {
  /** Cumulative positive regret per action. */
  regret: Float64Array
  /** Cumulative strategy weight per action, for the average. */
  strategySum: Float64Array
  actions: number[]
  /**
   * Times this set was updated. With sampled deals a rare spot is visited
   * rarely, and its average strategy is correspondingly unreliable — this is
   * what lets a blueprint ship only what it actually learned.
   */
  visits: number
}

export class Solver<S> {
  private nodes = new Map<string, Node>()

  constructor(
    private game: Game<S>,
    private random: () => number = Math.random,
  ) {}

  private node(key: string, actions: number[]): Node {
    let node = this.nodes.get(key)
    if (node && node.actions.length !== actions.length) {
      // Two states sharing an information set must offer the same choices. If
      // they do not, the game's abstraction has merged spots that are not the
      // same decision, and the strategy would be indexed against actions that
      // do not exist in one of them.
      throw new Error(
        `Information set ${key} was seen with ${node.actions.length} actions and now ${actions.length}`,
      )
    }
    if (!node) {
      node = {
        regret: new Float64Array(actions.length),
        strategySum: new Float64Array(actions.length),
        actions,
        visits: 0,
      }
      this.nodes.set(key, node)
    }
    return node
  }

  /**
   * Regret matching: play each action in proportion to the regret accumulated
   * for not having played it. With no positive regret anywhere, play uniformly.
   */
  private currentStrategy(node: Node): Float64Array {
    const strategy = new Float64Array(node.actions.length)
    let total = 0
    for (let i = 0; i < strategy.length; i++) {
      strategy[i] = Math.max(0, node.regret[i]!)
      total += strategy[i]!
    }
    if (total > 0) {
      for (let i = 0; i < strategy.length; i++) strategy[i]! /= total
    } else {
      strategy.fill(1 / strategy.length)
    }
    return strategy
  }

  /**
   * One traversal, updating regrets for `player`.
   *
   * `reachSelf` is the probability the updating player's own strategy gives to
   * reaching here; `reachOthers` is the probability everything else does —
   * chance and the opponent. Keeping them apart is the whole trick: regret is
   * weighted by what the *rest of the world* contributed, so a player is not
   * rewarded for reaching a node by their own choice.
   */
  private walk(
    state: S,
    player: number,
    reachSelf: number,
    reachOthers: number,
    iteration: number,
  ): number {
    const { game } = this

    if (game.isTerminal(state)) return game.payoff(state, player)

    const actor = game.currentPlayer(state)
    if (actor === CHANCE) {
      if (game.sampleChance) {
        // Sampled, so its probability is already accounted for by having drawn
        // it and must not be multiplied in again.
        return this.walk(game.sampleChance(state, this.random), player, reachSelf, reachOthers, iteration)
      }
      let value = 0
      for (const outcome of game.chanceOutcomes(state)) {
        value +=
          outcome.probability *
          this.walk(outcome.state, player, reachSelf, reachOthers * outcome.probability, iteration)
      }
      return value
    }

    const actions = game.actions(state)
    const node = this.node(game.infoSet(state), actions)
    const strategy = this.currentStrategy(node)

    const values = new Float64Array(actions.length)
    let value = 0
    for (let i = 0; i < actions.length; i++) {
      const child = game.next(state, actions[i]!)
      values[i] =
        actor === player
          ? this.walk(child, player, reachSelf * strategy[i]!, reachOthers, iteration)
          : this.walk(child, player, reachSelf, reachOthers * strategy[i]!, iteration)
      value += strategy[i]! * values[i]!
    }

    if (actor === player) {
      node.visits++
      for (let i = 0; i < actions.length; i++) {
        // CFR+ clips regret at zero, so an action that was bad early is
        // reconsidered as soon as it stops being bad.
        node.regret[i] = Math.max(0, node.regret[i]! + reachOthers * (values[i]! - value))
        // Linear averaging: later iterations, played by better strategies,
        // count for more.
        node.strategySum[i]! += iteration * reachSelf * strategy[i]!
      }
    }

    return value
  }

  /**
   * External-sampling traversal, updating regrets for `player`.
   *
   * Only the player being updated enumerates their actions; chance and every
   * other player have a single action sampled from their current strategy.
   * That turns the per-iteration cost from the whole game tree into just the
   * traverser's own decision points, which is the difference between a
   * six-handed preflop solve being impossible and being routine. The estimate
   * stays unbiased — the sampling supplies the weighting that enumeration
   * would otherwise compute.
   */
  private walkSampled(state: S, player: number, iteration: number): number {
    const { game } = this
    if (game.isTerminal(state)) return game.payoff(state, player)

    const actor = game.currentPlayer(state)
    if (actor === CHANCE) {
      const sampled = game.sampleChance
        ? game.sampleChance(state, this.random)
        : this.drawChance(state)
      return this.walkSampled(sampled, player, iteration)
    }

    const actions = game.actions(state)
    const node = this.node(game.infoSet(state), actions)
    const strategy = this.currentStrategy(node)

    if (actor !== player) {
      // Someone else's decision: accumulate their average strategy, then take
      // one sampled action rather than exploring all of them.
      for (let i = 0; i < actions.length; i++) {
        node.strategySum[i]! += iteration * strategy[i]!
      }
      return this.walkSampled(game.next(state, actions[this.sample(strategy)]!), player, iteration)
    }

    const values = new Float64Array(actions.length)
    let value = 0
    for (let i = 0; i < actions.length; i++) {
      values[i] = this.walkSampled(game.next(state, actions[i]!), player, iteration)
      value += strategy[i]! * values[i]!
    }

    node.visits++
    for (let i = 0; i < actions.length; i++) {
      node.regret[i] = Math.max(0, node.regret[i]! + (values[i]! - value))
    }
    return value
  }

  private sample(strategy: Float64Array): number {
    const target = this.random()
    let cumulative = 0
    for (let i = 0; i < strategy.length; i++) {
      cumulative += strategy[i]!
      if (target < cumulative) return i
    }
    return strategy.length - 1
  }

  private drawChance(state: S): S {
    const outcomes = this.game.chanceOutcomes(state)
    const target = this.random()
    let cumulative = 0
    for (const outcome of outcomes) {
      cumulative += outcome.probability
      if (target < cumulative) return outcome.state
    }
    return outcomes[outcomes.length - 1]!.state
  }

  /** Run `iterations` of external-sampling updates. */
  trainSampled(iterations: number, onProgress?: (done: number) => void): void {
    for (let t = 1; t <= iterations; t++) {
      for (let player = 0; player < this.game.players; player++) {
        this.walkSampled(this.game.root(), player, t)
      }
      if (onProgress && t % 5_000 === 0) onProgress(t)
    }
  }

  /**
   * Run `iterations` of updates, one pass per player.
   *
   * Beyond two players this still minimises each player's regret against the
   * others, but the result is a self-play strategy rather than a Nash
   * equilibrium: multiplayer games have no such guarantee, and exploitability
   * is not defined for them. That is what a blueprint is, and it is why the
   * two-player case is the one held to the equilibrium standard.
   */
  train(iterations: number, onProgress?: (done: number) => void): void {
    for (let t = 1; t <= iterations; t++) {
      for (let player = 0; player < this.game.players; player++) {
        this.walk(this.game.root(), player, 1, 1, t)
      }
      if (onProgress && t % 1_000 === 0) onProgress(t)
    }
  }

  /**
   * The average strategy, which is what converges to equilibrium — the current
   * strategy of the final iteration does not.
   */
  averageStrategy(infoSet: string): number[] {
    const node = this.nodes.get(infoSet)
    if (!node) return []
    const total = node.strategySum.reduce((a, b) => a + b, 0)
    if (total <= 0) return node.actions.map(() => 1 / node.actions.length)
    return [...node.strategySum].map((weight) => weight / total)
  }

  /** Every information set the solver has visited. */
  infoSets(): string[] {
    return [...this.nodes.keys()].sort()
  }

  actionsFor(infoSet: string): number[] {
    return this.nodes.get(infoSet)?.actions ?? []
  }

  visitsFor(infoSet: string): number {
    return this.nodes.get(infoSet)?.visits ?? 0
  }

  /** The full average strategy, for shipping as a blueprint. */
  strategyTable(): Record<string, number[]> {
    const table: Record<string, number[]> = {}
    for (const key of this.infoSets()) table[key] = this.averageStrategy(key)
    return table
  }

  /**
   * Best-response value for `player` against the other's average strategy.
   *
   * The responder must commit to one action per *information set*, not per
   * state: within an information set it cannot tell the states apart, so a
   * responder allowed to choose differently in each would be reading the
   * opponent's cards. Getting this wrong silently overstates exploitability
   * and makes a converged solve look unconverged.
   *
   * So the tree is built once, states are grouped by the responder's
   * information set, and each set's action is chosen by the value it yields
   * summed over its states, weighted by how likely the rest of the world was
   * to put the responder there.
   */
  private bestResponseValue(player: number): number {
    type BRNode =
      | { kind: 'terminal'; value: number }
      | { kind: 'expected'; children: { probability: number; node: BRNode }[] }
      | {
          kind: 'decision'
          infoSet: string
          children: BRNode[]
          reachOthers: number
        }

    const { game } = this
    const byInfoSet = new Map<string, Extract<BRNode, { kind: 'decision' }>[]>()

    const build = (state: S, reachOthers: number): BRNode => {
      if (game.isTerminal(state)) {
        return { kind: 'terminal', value: game.payoff(state, player) }
      }

      const actor = game.currentPlayer(state)
      if (actor === CHANCE) {
        return {
          kind: 'expected',
          children: game.chanceOutcomes(state).map((outcome) => ({
            probability: outcome.probability,
            node: build(outcome.state, reachOthers * outcome.probability),
          })),
        }
      }

      const actions = game.actions(state)
      if (actor !== player) {
        const strategy = this.averageStrategy(game.infoSet(state))
        return {
          kind: 'expected',
          children: actions.map((action, i) => {
            const probability = strategy[i] ?? 1 / actions.length
            return {
              probability,
              node: build(game.next(state, action), reachOthers * probability),
            }
          }),
        }
      }

      // The responder's own probability of reaching here is deliberately not
      // folded into `reachOthers` — it is exactly what is being chosen.
      const node: Extract<BRNode, { kind: 'decision' }> = {
        kind: 'decision',
        infoSet: game.infoSet(state),
        reachOthers,
        children: actions.map((action) => build(game.next(state, action), reachOthers)),
      }
      const group = byInfoSet.get(node.infoSet)
      if (group) group.push(node)
      else byInfoSet.set(node.infoSet, [node])
      return node
    }

    const root = build(game.root(), 1)

    const chosen = new Map<string, number>()
    const values = new Map<BRNode, number>()

    const valueOf = (node: BRNode): number => {
      const cached = values.get(node)
      if (cached !== undefined) return cached

      let result: number
      if (node.kind === 'terminal') {
        result = node.value
      } else if (node.kind === 'expected') {
        result = node.children.reduce(
          (sum, child) => sum + child.probability * valueOf(child.node),
          0,
        )
      } else {
        result = valueOf(node.children[actionFor(node.infoSet)]!)
      }
      values.set(node, result)
      return result
    }

    const actionFor = (infoSet: string): number => {
      const cached = chosen.get(infoSet)
      if (cached !== undefined) return cached

      const group = byInfoSet.get(infoSet)!
      const width = group[0]!.children.length
      let best = 0
      let bestValue = -Infinity
      for (let i = 0; i < width; i++) {
        // Every state in the set contributes, weighted by how likely chance and
        // the opponent were to produce it.
        let total = 0
        for (const node of group) total += node.reachOthers * valueOf(node.children[i]!)
        if (total > bestValue) {
          bestValue = total
          best = i
        }
      }
      chosen.set(infoSet, best)
      return best
    }

    return valueOf(root)
  }

  /**
   * Exploitability, in chips per hand: how much a perfect counter-strategy
   * would win against this one, averaged over both seats. Zero is equilibrium.
   *
   * This is the only honest measure of how solved a strategy is, and the reason
   * the app can report how far a solve actually got rather than simply calling
   * its output "GTO".
   */
  exploitability(): number {
    if (this.game.players !== 2) {
      throw new Error('Exploitability is only defined for two-player zero-sum games')
    }
    if (this.game.sampleChance) {
      throw new Error('Exploitability needs enumerable chance outcomes')
    }
    return (this.bestResponseValue(0) + this.bestResponseValue(1)) / 2
  }
}
