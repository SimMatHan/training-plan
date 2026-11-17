import { useCallback, useEffect, useState } from 'react';

const editable = (el: Element | null) =>
  !!el && (el instanceof HTMLTextAreaElement || el.getAttribute('contenteditable') === 'true' || (el instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'submit'].includes(el.type)));

/** Den forskydning, vi selv har lagt på elementet (`translate: 0 Npx`). */
const appliedShift = (el: HTMLElement) => parseFloat(el.style.translate.split(' ')[1] ?? '') || 0;

/**
 * Til elementer med `position: fixed; bottom: 0` (pausetimer, fanebjælke). iOS lader dem hænge
 * midt på skærmen, når tastaturet lukkes eller appen kommer tilbage fra baggrunden: layout-viewporten
 * når ikke ned til den synlige bund. `shift` er det stykke, elementet skal flyttes ned for at ramme
 * den synlige bund. `keyboard` er sand, mens tastaturet er åbent.
 *
 * Giv `ref` til elementet: så måles, hvor det faktisk ligger. `window.innerHeight` passer ikke
 * altid i den tilstand, så den bruges kun, hvis elementet ikke er på skærmen.
 */
export function useFixedBottom() {
  const [state, setState] = useState({ shift: 0, keyboard: false });
  const [el, setEl] = useState<HTMLElement | null>(null);
  const ref = useCallback((node: HTMLElement | null) => setEl(node), []);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const visibleBottom = vv.offsetTop + vv.height;
        const keyboard = editable(document.activeElement) && window.innerHeight - vv.height > 150;
        // Hvor bunden ville ligge uden vores forskydning.
        const bottom = el ? el.getBoundingClientRect().bottom - appliedShift(el) : window.innerHeight;
        const shift = keyboard ? 0 : Math.max(0, Math.round(visibleBottom - bottom));
        setState((s) => (s.shift === shift && s.keyboard === keyboard ? s : { shift, keyboard }));
      });
    };
    // Når tastaturet lukker: et skub til scrollpositionen får iOS til at lægge viewporten på plads.
    const onFocusOut = () => {
      setTimeout(() => {
        if (!editable(document.activeElement)) window.scrollTo(window.scrollX, window.scrollY);
        update();
      }, 50);
      setTimeout(update, 400);
    };
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      update();
      setTimeout(update, 400);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    window.addEventListener('pageshow', update);
    document.addEventListener('visibilitychange', onVisible);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('pageshow', update);
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, [el]);

  return { ...state, ref };
}
