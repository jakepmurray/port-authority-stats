import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'

const tones = {
  default: 'bg-slate-800 hover:bg-slate-700 text-slate-100 border-slate-700',
  primary: 'bg-sky-600 hover:bg-sky-500 text-white border-sky-500',
  good: 'bg-emerald-700 hover:bg-emerald-600 text-white border-emerald-600',
  bad: 'bg-rose-800 hover:bg-rose-700 text-white border-rose-700',
  ghost: 'bg-transparent hover:bg-slate-800 text-slate-300 border-transparent',
} as const

export function Btn({
  tone = 'default',
  size = 'md',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: keyof typeof tones; size?: 'sm' | 'md' | 'lg' }) {
  const sz = size === 'sm' ? 'px-2 py-1 text-xs' : size === 'lg' ? 'px-4 py-3 text-base' : 'px-3 py-1.5 text-sm'
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-1 rounded-lg border font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${tones[tone]} ${sz} ${className}`}
      {...rest}
    />
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-slate-400">{label}</span>
      {children}
      {hint && <span className="text-xs text-slate-500">{hint}</span>}
    </label>
  )
}

export const inputCls =
  'rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-sky-500'

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputCls} ${props.className ?? ''}`} />
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputCls} ${props.className ?? ''}`} />
}

export function Card({ title, children, actions, className = '' }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-slate-800 bg-slate-900/60 p-3 ${className}`}>
      {(title || actions) && (
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-200">{title}</h2>
          <div className="flex gap-1">{actions}</div>
        </div>
      )}
      {children}
    </section>
  )
}

export function Badge({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'good' | 'bad' | 'warn' | 'info' }) {
  const t = {
    default: 'bg-slate-800 text-slate-300',
    good: 'bg-emerald-900/70 text-emerald-200',
    bad: 'bg-rose-900/70 text-rose-200',
    warn: 'bg-amber-900/70 text-amber-200',
    info: 'bg-sky-900/70 text-sky-200',
  }[tone]
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${t}`}>{children}</span>
}

