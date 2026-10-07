import { useEffect, useId, useRef, useState } from 'react';

/** Fritekstnote der gemmes ved hver ændring. */
export function NoteField({ value, onSave, label, placeholder }: { value: string | null; onSave: (v: string | null) => void; label: string; placeholder?: string }) {
  const id = useId();
  const [text, setText] = useState(value ?? '');
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(value ?? '');
  }, [value]);

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm text-muted">
        {label}
      </label>
      <textarea
        id={id}
        rows={2}
        value={text}
        placeholder={placeholder}
        onFocus={() => (focused.current = true)}
        onBlur={() => (focused.current = false)}
        onChange={(e) => {
          setText(e.target.value);
          onSave(e.target.value.trim() ? e.target.value : null);
        }}
        className="block min-h-12 w-full rounded-lg border border-line bg-raised px-3 py-2.5 text-base"
      />
    </div>
  );
}
