export default function App() {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-slate-800 px-4 py-2">
        <span className="text-lg font-bold text-sky-300">Port Authority Stats</span>
        <span className="text-xs text-slate-400">Phase 0 scaffold</span>
      </header>
      <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section className="flex aspect-video w-full items-center justify-center bg-black lg:aspect-auto lg:flex-[3]">
          <p className="text-slate-500">Video pane</p>
        </section>
        <aside className="min-h-0 flex-1 overflow-auto border-slate-800 p-4 lg:max-w-md lg:flex-[2] lg:border-l">
          <p className="text-slate-400">Stat panel</p>
        </aside>
      </main>
    </div>
  )
}
