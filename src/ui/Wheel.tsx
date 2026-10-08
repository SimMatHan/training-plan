import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { nearestIndex } from '../logic/wheel';
import { formatDecimal, parseDecimal, parseWhole, sanitizeDecimal, sanitizeWhole } from '../logic/numbers';

/**
 * Talhjul med CSS scroll-snap: 5 synlige rækker, den valgte i en --surface-2-pille, de øvrige
 * falmer mod --ink-3. Tryk på den valgte værdi åbner det numeriske tastatur som nødudgang.
 *
 * Tilgængelighed: role="spinbutton" med aria-valuenow; piletaster (og VoiceOver, der sender
 * pil op/ned for justerbare elementer) ændrer værdien ét trin.
 */
export function Wheel({
  values,
  value,
  onChange,
  label,
  format = (v) => (v == null ? '–' : formatDecimal(v)),
  decimal = false,
  rows = 5,
  rowHeight = 32,
  className = '',
}: {
  values: readonly (number | null)[];
  value: number | null;
  onChange: (v: number | null) => void;
  label: string;
  format?: (v: number | null) => string;
  decimal?: boolean;
  rows?: number;
  rowHeight?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const index = nearestIndex(values, value);
  const [pos, setPos] = useState(index);
  const [editing, setEditing] = useState(false);
  const scrolling = useRef(false);
  const settle = useRef<ReturnType<typeof setTimeout>>(undefined);
  const frame = useRef(0);
  const pad = ((rows - 1) / 2) * rowHeight;
  const clamp = (i: number) => Math.min(values.length - 1, Math.max(0, i));

  // Følg værdien udefra (fx "Samme som sidst"), men ikke mens fingeren styrer hjulet.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || scrolling.current) return;
    el.scrollTop = index * rowHeight;
    setPos(index);
  }, [index, values.length, rowHeight]);

  useEffect(() => () => clearTimeout(settle.current), []);

  function commit() {
    const el = ref.current;
    scrolling.current = false;
    if (!el) return;
    const v = values[clamp(Math.round(el.scrollTop / rowHeight))];
    if (v !== value) onChange(v);
  }

  function onScroll() {
    const el = ref.current;
    if (!el) return;
    scrolling.current = true;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => setPos(el.scrollTop / rowHeight));
    clearTimeout(settle.current);
    settle.current = setTimeout(commit, 140);
  }

  function step(delta: number) {
    const next = values[clamp(index + delta)];
    if (next !== value) onChange(next);
  }

  function onKeyDown(e: KeyboardEvent) {
    const keys: Record<string, () => void> = {
      ArrowUp: () => step(1),
      ArrowRight: () => step(1),
      ArrowDown: () => step(-1),
      ArrowLeft: () => step(-1),
      PageUp: () => step(5),
      PageDown: () => step(-5),
      Home: () => step(-values.length),
      End: () => step(values.length),
      Enter: () => setEditing(true),
    };
    const action = keys[e.key];
    if (!action) return;
    e.preventDefault();
    action();
  }

  function pick(i: number) {
    if (i === index) return setEditing(true);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    ref.current?.scrollTo({ top: i * rowHeight, behavior: reduce ? 'auto' : 'smooth' });
  }

  const numeric = values.filter((v): v is number => v != null);
  return (
    <div
      role="spinbutton"
      tabIndex={0}
      aria-label={label}
      aria-valuenow={value ?? undefined}
      aria-valuemin={numeric[0]}
      aria-valuemax={numeric.at(-1)}
      aria-valuetext={value == null ? 'ingen' : format(value)}
      onKeyDown={editing ? undefined : onKeyDown}
      className={`relative rounded-[12px] ${className}`}
      style={{ height: rows * rowHeight }}
    >
      <div aria-hidden="true" className="absolute inset-x-0 rounded-[10px] bg-surface-2" style={{ top: pad, height: rowHeight }} />
      <div ref={ref} tabIndex={-1} aria-hidden="true" onScroll={onScroll} className="wheel absolute inset-0 overflow-y-scroll" style={{ paddingBlock: pad }}>
        {values.map((v, i) => {
          const dist = Math.abs(i - pos);
          const selected = dist < 0.5;
          return (
            <div
              key={`${v}`}
              onClick={() => pick(i)}
              className={`num flex cursor-pointer items-center justify-center text-[20px] ${selected ? 'font-semibold text-ink' : 'font-medium text-ink-3'}`}
              style={{ height: rowHeight, opacity: selected ? 1 : Math.max(0.35, 1 - dist * 0.25) }}
            >
              {format(v)}
            </div>
          );
        })}
      </div>
      {editing && (
        <WheelInput
          initial={value}
          decimal={decimal}
          label={label}
          top={pad}
          height={rowHeight}
          onDone={(v) => {
            setEditing(false);
            if (v !== undefined && v !== value) onChange(v);
          }}
        />
      )}
    </div>
  );
}

/** Numerisk felt oven på den valgte række. `undefined` = fortryd. */
function WheelInput({ initial, decimal, label, top, height, onDone }: { initial: number | null; decimal: boolean; label: string; top: number; height: number; onDone: (v: number | null | undefined) => void }) {
  const [text, setText] = useState(formatDecimal(initial));
  const finish = () => onDone(text.trim() === '' ? null : ((decimal ? parseDecimal(text) : parseWhole(text)) ?? undefined));
  return (
    <input
      autoFocus
      type="text"
      inputMode={decimal ? 'decimal' : 'numeric'}
      enterKeyHint="done"
      autoComplete="off"
      aria-label={label}
      value={text}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setText(decimal ? sanitizeDecimal(e.target.value) : sanitizeWhole(e.target.value))}
      onBlur={finish}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') onDone(undefined);
      }}
      className="num absolute inset-x-0 rounded-[10px] bg-surface text-center text-[20px] font-semibold text-ink outline-2 outline-brand-red"
      style={{ top, height }}
    />
  );
}
