import { useEffect, useState } from 'react';

const editable = (el: Element | null) =>
  !!el && (el instanceof HTMLTextAreaElement || el.getAttribute('contenteditable') === 'true' || (el instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'submit'].includes(el.type)));

/**
 * Til elementer med `position: fixed; bottom: 0` (pausetimer, fanebjælke). iOS lader dem hænge
 * midt på skærmen, når tastaturet lukkes: layout-viewporten når ikke ned til den synlige bund,
 * før man scroller. `shift` er det stykke, elementet skal flyttes ned for at ramme den synlige
 * bund. `keyboard` er sand, mens tastaturet er åbent.
 */
export function useFixedBottom() {
  const [state, setState] = useState({ shift: 0, keyboard: false });

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const visibleBottom = vv.offsetTop + vv.height;
        const keyboard = editable(document.activeElement) && window.innerHeight - vv.height > 150;
        const shift = keyboard ? 0 : Math.max(0, Math.round(visibleBottom - window.innerHeight));
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
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    window.addEventListener('scroll', update, { passive: true });
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      window.removeEventListener('scroll', update);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  return state;
}
