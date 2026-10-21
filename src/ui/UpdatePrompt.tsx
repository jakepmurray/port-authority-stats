import { useRegisterSW } from 'virtual:pwa-register/react'
import { Btn } from './kit'

/** How often an open app checks GitHub Pages for a new build. */
const CHECK_EVERY_MS = 30 * 60 * 1000

/**
 * "New version available" banner. The service worker downloads a new build in the
 * background and waits; Reload activates it and refreshes the page. All data is in
 * IndexedDB, so reloading loses nothing that was saved.
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      if (!reg) return
      const check = () => {
        if (navigator.onLine && !reg.installing) void reg.update().catch(() => {})
      }
      setInterval(check, CHECK_EVERY_MS)
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check())
    },
  })
  if (!needRefresh) return null
  return (
    <div role="status" data-testid="update-prompt" className="flex flex-wrap items-center gap-2 border-b border-sky-800 bg-sky-950 px-3 py-1.5 text-sm text-sky-100">
      <span>New version available.</span>
      <Btn size="sm" tone="primary" onClick={() => void updateServiceWorker(true)}>
        Reload
      </Btn>
      <Btn size="sm" tone="ghost" onClick={() => setNeedRefresh(false)}>
        Later
      </Btn>
    </div>
  )
}
