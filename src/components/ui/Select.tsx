"use client";

import { useState, useRef, useEffect, useCallback, useMemo, memo } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  /** Applied to the outer wrapper div */
  className?: string;
  /** Overrides the default trigger button className entirely */
  triggerClassName?: string;
  disabled?: boolean;
  id?: string;
}

function Select({
  options,
  value,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  className,
  triggerClassName,
  disabled,
  id,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const [openUp, setOpenUp] = useState(false);
  const [coords, setCoords] = useState<{ top: number; bottom: number; left: number; width: number } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const shouldScrollRef = useRef(false);

  const filtered = useMemo(
    () =>
      query.trim()
        ? options.filter((o) =>
            o.label.toLowerCase().includes(query.toLowerCase())
          )
        : options,
    [options, query]
  );

  const selected = useMemo(
    () => options.find((o) => o.value === value),
    [options, value]
  );

  const closeDropdown = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  // Positioned via a portal (see render below) so the dropdown can escape
  // any ancestor with overflow-hidden (e.g. the .card container) — coords
  // are viewport-relative, matching getBoundingClientRect + position: fixed.
  const updatePosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setOpenUp(window.innerHeight - rect.bottom < 280);
    setCoords({ top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width });
  }, []);

  const openDropdown = useCallback(() => {
    if (disabled) return;
    updatePosition();
    setOpen(true);
    setQuery("");
    shouldScrollRef.current = true;
    setHighlighted(options.findIndex((o) => o.value === value) || 0);
    setTimeout(() => searchRef.current?.focus(), 30);
  }, [disabled, options, value, updatePosition]);

  const selectOption = useCallback(
    (opt: SelectOption) => {
      onChange(opt.value);
      closeDropdown();
    },
    [onChange, closeDropdown]
  );

  const handleTriggerKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        openDropdown();
      }
    },
    [openDropdown]
  );

  const handleListKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        closeDropdown();
        triggerRef.current?.focus();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        shouldScrollRef.current = true;
        setHighlighted((h) => Math.min(h + 1, filtered.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        shouldScrollRef.current = true;
        setHighlighted((h) => Math.max(h - 1, 0));
      }
      if (e.key === "Enter" && filtered[highlighted]) {
        e.preventDefault();
        selectOption(filtered[highlighted]);
      }
    },
    [closeDropdown, filtered, highlighted, selectOption]
  );

  // Close on outside click / tap — the dropdown is portaled outside
  // containerRef, so clicks inside it (search input, options) must also
  // count as "inside" or every interaction would immediately close it.
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent | TouchEvent) {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      closeDropdown();
    }
    document.addEventListener("mousedown", handle);
    document.addEventListener("touchstart", handle);
    return () => {
      document.removeEventListener("mousedown", handle);
      document.removeEventListener("touchstart", handle);
    };
  }, [open, closeDropdown]);

  // Keep the dropdown anchored to the trigger while open. The capture-phase
  // scroll listener catches scrolling in any ancestor container, not just window.
  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  // Scroll highlighted option into view — only for keyboard nav and on open, not mouse hover
  useEffect(() => {
    if (!shouldScrollRef.current) return;
    shouldScrollRef.current = false;
    const el = listRef.current?.children[highlighted] as
      | HTMLElement
      | undefined;
    el?.scrollIntoView({ block: "center", behavior: "instant" });
  }, [highlighted]);

  // Reset highlight when search query changes
  useEffect(() => setHighlighted(0), [query]);

  const triggerCls = useMemo(
    () =>
      triggerClassName ??
      cn(
        "input w-full text-left flex items-center justify-between gap-2",
        disabled && "opacity-50 cursor-not-allowed",
        !selected && "text-green-900/40"
      ),
    [triggerClassName, disabled, selected]
  );

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      {/* Trigger button */}
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        onClick={openDropdown}
        onKeyDown={handleTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={triggerCls}
      >
        <span className="truncate min-w-0">{selected?.label ?? placeholder}</span>
        <ChevronIcon open={open} />
      </button>

      {/* Dropdown — portaled to document.body so it can't be clipped by an
          ancestor's overflow-hidden (e.g. .card); positioned via fixed coords
          measured from the trigger. */}
      {open && coords && typeof document !== "undefined" &&
        createPortal(
          // eslint-disable-next-line jsx-a11y/interactive-supports-focus
          <div
            ref={dropdownRef}
            role="listbox"
            onKeyDown={handleListKeyDown}
            className="fixed z-50 rounded-xl border border-green-900/10 bg-white shadow-xl overflow-hidden"
            style={{
              left: coords.left,
              width: coords.width,
              ...(openUp
                ? { bottom: window.innerHeight - coords.top + 4 }
                : { top: coords.bottom + 4 }),
            }}
          >
            {/* Search input — font-size 16px prevents iOS zoom */}
            <div className="p-2 border-b border-green-900/08">
              <input
                ref={searchRef}
                type="search"
                className="w-full px-3 py-2 rounded-lg bg-green-50 text-green-900 placeholder:text-green-900/35 outline-none"
                style={{ fontSize: 16 }}
                placeholder={searchPlaceholder}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleListKeyDown}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>

            {/* Options list */}
            <ul
              ref={listRef}
              className="max-h-56 overflow-y-auto py-1 overscroll-contain"
            >
              {filtered.length === 0 ? (
                <li className="px-3 py-3 text-sm text-green-900/40 italic text-center">
                  No results
                </li>
              ) : (
                filtered.map((opt, i) => (
                  // eslint-disable-next-line jsx-a11y/click-events-have-key-events
                  <OptionItem
                    key={opt.value}
                    opt={opt}
                    isHighlighted={i === highlighted}
                    isSelected={opt.value === value}
                    index={i}
                    onSelect={selectOption}
                    onHover={setHighlighted}
                    shouldScrollRef={shouldScrollRef}
                  />
                ))
              )}
            </ul>
          </div>,
          document.body
        )}
    </div>
  );
}

// ---- Memoized option row ------------------------------------------------
interface OptionItemProps {
  opt: SelectOption;
  isHighlighted: boolean;
  isSelected: boolean;
  index: number;
  onSelect: (opt: SelectOption) => void;
  onHover: (index: number) => void;
  shouldScrollRef: React.MutableRefObject<boolean>;
}

const OptionItem = memo(function OptionItem({
  opt,
  isHighlighted,
  isSelected,
  index,
  onSelect,
  onHover,
  shouldScrollRef,
}: OptionItemProps) {
  const handleMouseEnter = useCallback(() => {
    shouldScrollRef.current = false;
    onHover(index);
  }, [shouldScrollRef, onHover, index]);

  const handleClick = useCallback(() => onSelect(opt), [onSelect, opt]);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      onSelect(opt);
    },
    [onSelect, opt]
  );

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events
    <li
      role="option"
      aria-selected={isSelected}
      onClick={handleClick}
      onTouchEnd={handleTouchEnd}
      onMouseEnter={handleMouseEnter}
      className={cn(
        "px-3 min-h-[44px] flex items-center justify-between gap-2 text-sm cursor-pointer select-none",
        isHighlighted
          ? "bg-green-50 text-green-900"
          : "text-green-900 hover:bg-green-50/70",
        isSelected && "font-medium"
      )}
    >
      <span className="truncate min-w-0">{opt.label}</span>
      {isSelected && <CheckIcon />}
    </li>
  );
});

// ---- Static sub-components ---------------------------------------------
const ChevronIcon = memo(function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={cn(
        "w-4 h-4 flex-shrink-0 text-green-900/40 transition-transform duration-150",
        open && "rotate-180"
      )}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.8}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
});

const CheckIcon = memo(function CheckIcon() {
  return (
    <svg
      className="w-4 h-4 flex-shrink-0 text-green-700"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
});

export default memo(Select);
