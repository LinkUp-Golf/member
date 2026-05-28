interface FormFieldProps {
  label: string
  htmlFor?: string
  required?: boolean
  error?: string
  hint?: string
  children: React.ReactNode
}

export default function FormField({ label, htmlFor, required, error, hint, children }: FormFieldProps) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="text-xs text-gray-400 mb-1 flex items-center gap-0.5 select-none"
      >
        {label}
        {required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
      {hint && !error && (
        <p className="mt-1 text-[11px] text-gray-400">{hint}</p>
      )}
      {error && (
        <p className="mt-1 text-[11px] text-red-500">{error}</p>
      )}
    </div>
  )
}
