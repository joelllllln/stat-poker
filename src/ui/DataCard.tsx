import { useRef, useState } from 'react'
import { ARCHIVE_LIMIT, useStore } from './store'

/**
 * Your hands, as a file.
 *
 * Local-first is only a promise if the data can leave. Everything is stored in
 * this browser, which means clearing site data or switching machines loses it
 * unless there is a way to take it with you — so the export exists, and it is
 * reachable rather than only implemented.
 */
export function DataCard() {
  const exportHistory = useStore((s) => s.exportHistory)
  const importHistory = useStore((s) => s.importHistory)
  const storedHands = useStore((s) => s.storedHands)
  const unreadable = useStore((s) => s.unreadable)
  const storageBroken = useStore((s) => s.storageBroken)
  const [message, setMessage] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  async function save() {
    try {
      const json = await exportHistory()
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `stat-poker-${new Date().toISOString().slice(0, 10)}.json`
      link.click()
      URL.revokeObjectURL(url)
      setMessage(`Saved ${storedHands.toLocaleString('en-US')} hands.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save the file.')
    }
  }

  async function load(file: File) {
    try {
      const added = await importHistory(await file.text())
      setMessage(
        `Added ${added.hands.toLocaleString('en-US')} hand${added.hands === 1 ? '' : 's'}` +
          (added.estimates > 0 ? ` and ${added.estimates} equity guesses.` : '.') +
          // Said out loud rather than swallowed: a file that was half readable
          // should not look like a file that imported cleanly.
          (added.unreadable > 0
            ? ` ${added.unreadable} hand${added.unreadable === 1 ? '' : 's'} in the file could not be read and ${added.unreadable === 1 ? 'was' : 'were'} left out.`
            : ''),
      )
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'That file could not be read.')
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-[color:var(--color-ink-4)] bg-black/40 px-3 py-2">
      <div className="stamp">Your hands</div>

      <p className="text-xs text-[color:var(--color-bone-dim)]">
        {storageBroken
          ? 'This browser will not let the app store anything — in a private window, or with site data blocked. You can still play, but nothing will be kept after you close the tab.'
          : `${storedHands.toLocaleString('en-US')} hand${storedHands === 1 ? '' : 's'} are stored in this browser and nowhere else.`}
        {storedHands > ARCHIVE_LIMIT &&
          ` Statistics are built from the most recent ${ARCHIVE_LIMIT.toLocaleString('en-US')}.`}
        {unreadable > 0 &&
          ` ${unreadable} could not be replayed and are left out rather than guessed at.`}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => void save()}
          disabled={storedHands === 0}
          className="rounded-md border border-[color:var(--color-ink-4)] px-3 py-1.5 text-xs text-[color:var(--color-bone)] transition hover:bg-black/45 disabled:opacity-40"
        >
          Save a copy
        </button>
        <button
          onClick={() => fileInput.current?.click()}
          className="rounded-md border border-[color:var(--color-ink-4)] px-3 py-1.5 text-xs text-[color:var(--color-bone)] transition hover:bg-black/45"
        >
          Load a copy
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void load(file)
            event.target.value = ''
          }}
        />
        {message && <span className="text-[11px] text-[color:var(--color-bone-dim)]">{message}</span>}
      </div>
    </div>
  )
}
