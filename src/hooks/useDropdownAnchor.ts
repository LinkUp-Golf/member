"use client";

import { useState, useRef, useEffect, useCallback } from "react";

export interface DropdownCoords {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

/**
 * The mechanics a portaled dropdown needs, shared by Select and MultiSelect.
 *
 * Both render their panel into document.body so it can't be clipped by an
 * ancestor's overflow-hidden (a .card, the admin table's scroll container).
 * That buys them freedom from clipping and costs them everything a normally
 * positioned element gets for free: staying anchored to its trigger, flipping
 * up near the bottom of the viewport, and closing when something outside is
 * clicked — where "outside" has to count the portaled panel as inside.
 *
 * Only that plumbing lives here. Which option is highlighted, what the search
 * box matches, and what a click does are the differences between the two
 * components, and they keep them.
 */
export function useDropdownAnchor(disabled?: boolean) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const [coords, setCoords] = useState<DropdownCoords | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Viewport-relative, matching getBoundingClientRect + position: fixed.
  const updatePosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setOpenUp(window.innerHeight - rect.bottom < 280);
    setCoords({ top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width });
  }, []);

  const open_ = useCallback(() => {
    if (disabled) return false;
    updatePosition();
    setOpen(true);
    return true;
  }, [disabled, updatePosition]);

  const close = useCallback(() => setOpen(false), []);

  // The panel is portaled outside containerRef, so clicks inside it (the search
  // box, an option) must count as "inside" or every interaction would close it.
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent | TouchEvent) {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      close();
    }
    document.addEventListener("mousedown", handle);
    document.addEventListener("touchstart", handle);
    return () => {
      document.removeEventListener("mousedown", handle);
      document.removeEventListener("touchstart", handle);
    };
  }, [open, close]);

  // Stay anchored while open. Capture phase, so scrolling in any ancestor
  // container counts and not just the window.
  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  /** Where to put the panel: same left/width as the trigger, above or below it. */
  const panelStyle = coords
    ? {
        left: coords.left,
        width: coords.width,
        ...(openUp
          ? { bottom: window.innerHeight - coords.top + 4 }
          : { top: coords.bottom + 4 }),
      }
    : undefined;

  return {
    open,
    coords,
    panelStyle,
    containerRef,
    triggerRef,
    dropdownRef,
    /** Returns false when the control is disabled and nothing opened. */
    openDropdown: open_,
    closeDropdown: close,
  };
}
