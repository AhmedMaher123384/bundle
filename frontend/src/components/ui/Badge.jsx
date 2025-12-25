export function Badge({ tone = 'slate', children }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-800',
    green: 'bg-emerald-100 text-emerald-800',
    red: 'bg-rose-100 text-rose-800',
    amber: 'bg-amber-100 text-amber-800',
    sky: 'bg-sky-100 text-sky-800',
  }
  return (
    <span className={['inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold', tones[tone] || tones.slate].join(' ')}>
      {children}
    </span>
  )
}

