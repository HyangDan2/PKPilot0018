import { useRef, type ReactNode } from 'react';
import type { Lang } from '../types';
import { t } from '../lib/i18n';
import { clampFloatPosition, resizeFloatRect, type FloatRect, type PanelId, type ResizeDir } from '../lib/layout';
import { IconDock } from './Icons';

interface Props {
  lang: Lang;
  panelId: PanelId;
  title: string;
  testId: string;
  rect: FloatRect;
  onRect: (next: { x: number; y: number }) => void;
  onResize: (next: FloatRect) => void;
  onDock: () => void;
  children: ReactNode;
}

const RESIZE_HANDLES: { dir: ResizeDir; className: string }[] = [
  { dir: 'n', className: 'float-rz-n' },
  { dir: 's', className: 'float-rz-s' },
  { dir: 'e', className: 'float-rz-e' },
  { dir: 'w', className: 'float-rz-w' },
  { dir: 'ne', className: 'float-rz-ne' },
  { dir: 'nw', className: 'float-rz-nw' },
  { dir: 'se', className: 'float-rz-se' },
  { dir: 'sw', className: 'float-rz-sw' },
];

const RESIZE_CURSORS: Record<ResizeDir, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
};

/**
 * A docked panel lifted into a floating window: the same panel markup renders
 * inside a viewport-fixed frame, dragged by its header, resized from any edge
 * or corner and docked back with the button at its right end. Nothing is
 * opened in another browser window, so the panel keeps the live worksheet and
 * results it had before detaching.
 */
export function FloatPanel({ lang, panelId, title, testId, rect, onRect, onResize, onDock, children }: Props) {
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

  const startResize = (dir: ResizeDir) => (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = { ...rect };
    const move = (e: PointerEvent) => {
      onResize(resizeFloatRect(panelId, origin, dir, e.clientX - startX, e.clientY - startY, window.innerWidth, window.innerHeight));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
      frameRef.current?.classList.remove('resizing');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    document.body.style.cursor = RESIZE_CURSORS[dir];
    frameRef.current?.classList.add('resizing');
  };

  const resizeFromKeys = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 32 : 8;
    let dx = 0;
    let dy = 0;
    if (event.key === 'ArrowRight') dx = step;
    else if (event.key === 'ArrowLeft') dx = -step;
    else if (event.key === 'ArrowDown') dy = step;
    else if (event.key === 'ArrowUp') dy = -step;
    else return;
    event.preventDefault();
    onResize(resizeFloatRect(panelId, rect, 'se', dx, dy, window.innerWidth, window.innerHeight));
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
      {RESIZE_HANDLES.map(({ dir, className }) => (
        <div
          key={dir}
          className={`float-rz ${className}`}
          onPointerDown={startResize(dir)}
          onKeyDown={dir === 'se' ? resizeFromKeys : undefined}
          tabIndex={dir === 'se' ? 0 : -1}
          title={dir === 'se' ? t(lang, 'panel.resize') : undefined}
          aria-label={dir === 'se' ? `${title} — ${t(lang, 'panel.resize')}` : undefined}
          data-testid={`${testId}-resize-${dir}`}
          aria-hidden={dir === 'se' ? undefined : true}
        />
      ))}
    </div>
  );
}
