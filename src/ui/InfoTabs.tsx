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
  const [open, setOpen] = useState(initial ?? tabs[0]?.id)
  const current = tabs.find((tab) => tab.id === open) ?? tabs[0]
  if (!current) return null

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60">
      <div className="flex gap-1 border-b border-slate-800 p-1" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={tab.id === current.id}
            onClick={() => setOpen(tab.id)}
            className={`flex min-h-11 flex-1 items-center justify-center gap-1 rounded-lg px-2 text-sm transition ${
              tab.id === current.id
                ? 'bg-slate-800 font-medium text-white'
                : 'text-slate-400 active:bg-slate-900'
            }`}
          >
            {tab.label}
            {tab.badge && (
              <span className="rounded-full bg-emerald-400/20 px-1.5 text-[10px] text-emerald-300">
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
