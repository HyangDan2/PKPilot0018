import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface ContextMenuItem {
  id: string;
  label: string;
  kbd?: string;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
  checked?: boolean;
  children?: ContextMenuItem[];
  onSelect?: () => void;
}

interface Props {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
  label?: string;
}

const EDGE = 8;

/** Keeps a menu fully inside the viewport, and flips a submenu to the left
 *  when its parent sits too close to the right edge. */
function clampPosition(x: number, y: number, width: number, height: number): { left: number; top: number } {
  const vw = typeof window === 'undefined' ? 1024 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 768 : window.innerHeight;
  return {
    left: Math.max(EDGE, Math.min(x, vw - width - EDGE)),
    top: Math.max(EDGE, Math.min(y, vh - height - EDGE)),
  };
}

export function ContextMenu({ x, y, items, onClose, label }: Props) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const node = menuRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    setBox({ ...clampPosition(x, y, rect.width, rect.height), width: rect.width, height: rect.height });
  }, [x, y, items]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    const onScroll = () => onClose();
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onScroll);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [onClose]);

  useEffect(() => {
    const first = menuRef.current?.querySelector<HTMLButtonElement>('[role=menuitem]:not([aria-disabled=true])');
    first?.focus();
  }, []);

  const moveFocus = (step: number) => {
    const node = menuRef.current;
    if (!node) return;
    const buttons = [...node.querySelectorAll<HTMLButtonElement>(':scope > .ctx-list > .ctx-row > [role=menuitem]:not(:disabled)')];
    if (!buttons.length) return;
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = current < 0 ? 0 : (current + step + buttons.length) % buttons.length;
    buttons[next].focus();
  };

  const style = box
    ? { left: box.left, top: box.top }
    : { left: x + 2000, top: y + 2000 };

  return createPortal(
    <div
      className="ctx-menu"
      role="menu"
      aria-label={label}
      data-testid="ctx-menu"
      ref={menuRef}
      style={style}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown') { event.preventDefault(); moveFocus(1); }
        else if (event.key === 'ArrowUp') { event.preventDefault(); moveFocus(-1); }
      }}
    >
      <ul className="ctx-list">
        {items.map((item) => (
          <ContextRow key={item.id} item={item} onClose={onClose} />
        ))}
      </ul>
    </div>,
    document.body,
  );
}

function ContextRow({ item, onClose }: { item: ContextMenuItem; onClose: () => void }) {
  const [open, setOpen] = useState(false);
  const rowRef = useRef<HTMLLIElement | null>(null);
  const [flyout, setFlyout] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !rowRef.current) { setFlyout(null); return; }
    const rect = rowRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const width = 200;
    const left = rect.right + width + EDGE <= vw ? rect.right : Math.max(EDGE, rect.left - width);
    setFlyout({ left, top: Math.min(rect.top, window.innerHeight - 220) });
  }, [open]);

  if (item.separator) return <li className="ctx-sep" role="separator" />;

  const hasChildren = Boolean(item.children?.length);

  return (
    <li
      ref={rowRef}
      className={`ctx-row${item.danger ? ' danger' : ''}`}
      onMouseEnter={() => { if (hasChildren && !item.disabled) setOpen(true); }}
      onMouseLeave={() => { if (hasChildren) setOpen(false); }}
    >
      <button
        type="button"
        role="menuitem"
        className={`ctx-item${item.checked ? ' checked' : ''}`}
        aria-disabled={item.disabled ? 'true' : undefined}
        aria-haspopup={hasChildren ? 'menu' : undefined}
        aria-expanded={hasChildren ? open : undefined}
        aria-checked={typeof item.checked === 'boolean' ? item.checked : undefined}
        disabled={item.disabled}
        data-testid={`ctx-item-${item.id}`}
        onClick={() => {
          if (item.disabled) return;
          if (hasChildren) { setOpen((value) => !value); return; }
          item.onSelect?.();
          onClose();
        }}
      >
        <span className="ctx-check">{item.checked ? '✓' : ''}</span>
        <span className="ctx-label">{item.label}</span>
        {item.kbd && <span className="ctx-kbd">{item.kbd}</span>}
        {hasChildren && <span className="ctx-arrow">›</span>}
      </button>
      {hasChildren && open && (
        <div
          className="ctx-menu ctx-submenu"
          role="menu"
          style={flyout ? { left: flyout.left, top: flyout.top } : { visibility: 'hidden' }}
          data-testid={`ctx-submenu-${item.id}`}
        >
          <ul className="ctx-list">
            {item.children?.map((child) => (
              <ContextRow key={child.id} item={child} onClose={onClose} />
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}
