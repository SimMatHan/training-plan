import { useEffect, useRef, useState } from 'react';
import { formatDecimal, parseDecimal, parseWhole, sanitizeDecimal, sanitizeWhole } from '../logic/numbers';

/**
 * Stort talfelt. Gemmer ved hver ændring (onValue), viser komma som decimaltegn
 * og sidste gangs tal som dæmpet pladsholder.
 */
export function NumberField({
  value,
  onValue,
  decimal = false,
  placeholder,
  label,
}: {
  value: number | null;
  onValue: (v: number | null) => void;
  decimal?: boolean;
  placeholder?: string;
  label: string;
}) {
  const [text, setText] = useState(formatDecimal(value));
  const focused = useRef(false);

  // Opdater fra databasen (fx "Samme som sidst" eller sync), men aldrig mens der tastes.
  useEffect(() => {
    if (!focused.current) setText(formatDecimal(value));
  }, [value]);

  return (
    <input
      type="text"
      inputMode={decimal ? 'decimal' : 'numeric'}
      enterKeyHint="done"
      autoComplete="off"
      aria-label={label}
      value={text}
      placeholder={placeholder}
      onFocus={(e) => {
        focused.current = true;
        e.currentTarget.select();
      }}
      onBlur={() => {
        focused.current = false;
        setText(formatDecimal(value));
      }}
      onChange={(e) => {
        const s = decimal ? sanitizeDecimal(e.target.value) : sanitizeWhole(e.target.value);
        setText(s);
        const parsed = decimal ? parseDecimal(s) : parseWhole(s);
        if (parsed !== value) onValue(parsed);
      }}
      className="num h-14 w-full min-w-0 rounded-lg border border-line bg-raised text-center text-3xl font-semibold"
    />
  );
}
