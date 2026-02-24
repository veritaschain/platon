'use client'
interface ToggleProps {
  checked: boolean
  onChange: (v: boolean) => void
  label?: string
}
export function Toggle({ checked, onChange, label }: ToggleProps) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <div
        className={`w-8 h-4 rounded-full transition-colors ${checked ? 'bg-gray-900' : 'bg-gray-300'}`}
        onClick={() => onChange(!checked)}
      >
        <div className={`w-4 h-4 bg-white rounded-full shadow transition-transform ${checked ? 'translate-x-4' : 'translate-x-0'}`} />
      </div>
      {label && <span className="text-xs text-gray-600">{label}</span>}
    </label>
  )
}
