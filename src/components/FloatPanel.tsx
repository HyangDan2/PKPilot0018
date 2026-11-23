import { useRef, type ReactNode } from 'react';
import type { Lang } from '../types';
import { t } from '../lib/i18n';
import { clampFloatPosition } from '../lib/layout';
import { IconDock } from './Icons';

interface Props {
  lang: Lang;
  title: string;
  testId: string;
  rect: { x: number; y: number; w: number; h: number };
  onRect: (next: { x: number; y: number }) => void;
  onDock: () => void;
  children: ReactNode;
}

/**
 * A docked panel lifted into a floating window: the same panel markup renders
 * inside a viewport-fixed frame, dragged by its header and docked back with the
 * button at its right end. Nothing is opened in another browser window, so the
 * panel keeps the live worksheet and results it had before detaching.
 */
export function FloatPanel({ lang, title, testId, rect, onRect, onDock, children }: Props) {
  const frameRef = useRef<HTMLDivElement | null>(null);

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button, a, input, select')) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = { x: rect.x, y: rect.y };
    const move = (e: PointerEvent) => {
      const next = clampFloatPosition(origin.x + e.clientX - startX, origin.y + e.clientY - startY, rect.w, window.innerWidth, window.innerHeight);
      onRect(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
      frameRef.current?.classList.remove('dragging');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    document.body.style.cursor = 'grabbing';
    frameRef.current?.classList.add('dragging');
  };

  return (
    <div
      ref={frameRef}
      className="float-panel"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      data-testid={testId}
      role="dialog"
      aria-label={title}
    >
      <div className="float-head" onPointerDown={startDrag} data-testid={`${testId}-head`}>
        <span className="float-grip" aria-hidden>⋮⋮</span>
        <span className="float-title">{title}</span>
        <span className="spacer" />
        <button
          type="button"
          className="float-dock"
          onClick={onDock}
          title={t(lang, 'panel.dock')}
          aria-label={t(lang, 'panel.dock')}
          data-testid={`${testId}-dock`}
        >
          <IconDock size={14} />
        </button>
      </div>
      <div className="float-body">{children}</div>
    </div>
  );
}
