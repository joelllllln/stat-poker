import { useState, type ReactNode } from 'react'

/**
 * The panels beside the table, on a screen that has no beside.
 *
 * On a phone the coaching cannot sit next to the felt and stacking it turns
 * the page into a two-thousand-pixel scroll, where the thing you need while
 * deciding is the thing furthest from your thumb. One panel at a time, chosen
 * by a strip of tabs directly under the controls, keeps the whole game on one
 * screen — which is what a phone game has to be.
 */

export interface InfoTab {
  id: string
  label: string
  /** A quiet marker, for a tab with something new in it. */
  badge?: string | undefined
  content: ReactNode
}

export function InfoTabs({ tabs, initial }: { tabs: InfoTab[]; initial?: string }) {
  // Null until somebody actually picks one, rather than latched to whatever
  // happened to be first on the very first render. The coach's panel only
  // exists once its answer arrives, so latching left a beginner looking at the
  // last tab in the list — their own statistics — at the moment they most
  // needed the one that says what to do.
  const [chosen, setChosen] = useState<string | null>(initial ?? null)
  const current = (chosen === null ? undefined : tabs.find((tab) => tab.id === chosen)) ?? tabs[0]
  if (!current) return null

  return (
    <div className="plate">
      <div className="flex gap-1 border-b border-[color:var(--color-ink-4)] p-1" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={tab.id === current.id}
            onClick={() => setChosen(tab.id)}
            className={`flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-xs uppercase tracking-[0.14em] transition ${
              tab.id === current.id
                ? 'plaque-brass font-bold'
                : 'text-[color:var(--color-bone-faint)]'
            }`}
          >
            {tab.label}
            {tab.badge && (
              <span className="rounded-full bg-black/25 px-1.5 text-[10px] font-bold tracking-normal">
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Bounded rather than open-ended: a panel that grows without limit puts
          the next hand's controls off the bottom of the screen again. */}
      <div className="max-h-[46dvh] overflow-y-auto p-2">{current.content}</div>
    </div>
  )
}
