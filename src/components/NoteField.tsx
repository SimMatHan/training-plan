import { useEffect, useRef, useState } from 'react';
import { TextArea } from '../ui/Field';

/** Fritekstnote der gemmes ved hver ændring. */
export function NoteField({ value, onSave, label, placeholder }: { value: string | null; onSave: (v: string | null) => void; label: string; placeholder?: string }) {
  const [text, setText] = useState(value ?? '');
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(value ?? '');
  }, [value]);

  return (
    <TextArea
      label={label}
      value={text}
      placeholder={placeholder}
      onFocus={() => (focused.current = true)}
      onBlur={() => (focused.current = false)}
      onChange={(e) => {
        setText(e.target.value);
        onSave(e.target.value.trim() ? e.target.value : null);
      }}
    />
  );
}
