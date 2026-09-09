"use client";

// ============================================================
// A Select that takes more than one answer.
//
// Same trigger, same portaled panel, same search box as Select —
// deliberately, since the two sit side by side in the admin's
// filter rows and a control that looked different would read as
// doing something different. What changes is what a click does:
// it toggles, the panel stays open, and the trigger summarises
// rather than naming the one choice.
//
// Empty means "no filter", not "nothing selected". That's why the
// first row is a real option rather than a Clear button tucked in
// a corner: "Any community" is the state the filter starts in and
// the state an admin wants back, and it belongs in the same list
// as everything else.
// ============================================================

import { useState, useRef, useEffect, useCallback, useMemo, memo } from "react";
import { createPortal } from "react-dom";
import { useDropdownAnchor } from "@/hooks/useDropdownAnchor";
import { cn } from "@/lib/utils";
import type { SelectOption } from "@/components/ui/Select";

interface MultiSelectProps {
  options: SelectOption[];
  values: string[];
  onChange: (values: string[]) => void;
  /** Trigger label when nothing is selected — the "no filter" state. */
  emptyLabel: string;
  /** Plural noun for the summary, e.g. "communities" → "3 communities". */
  countNoun: string;
  searchPlaceholder?: string;
  /** Applied to the outer wrapper div */
  className?: string;
  /** Overrides the default trigger button className entirely */
  triggerClassName?: string;
  disabled?: boolean;
  id?: string;
}

function MultiSelect({
  options,
  values,
  onChange,
  emptyLabel,
  countNoun,
  searchPlaceholder = "Search…",
  className,
  triggerClassName,
  disabled,
  id,
}: MultiSelectProps) {
  const {
    open,
    panelStyle,
    containerRef,
    triggerRef,
    dropdownRef,
    openDropdown: anchorOpen,
    closeDropdown,
  } = useDropdownAnchor(disabled);

  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(
    () =>
      query.trim()
        ? options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))
        : options,
    [options, query]
  );

  const selectedSet = useMemo(() => new Set(values), [values]);

  // One name reads better than "1 community", and it's the common case.
  const triggerLabel = useMemo(() => {
    if (values.length === 0) return emptyLabel;
    if (values.length === 1) {
      return options.find(o => o.value === values[0])?.label ?? values[0];
    }
    return `${values.length} ${countNoun}`;
  }, [values, options, emptyLabel, countNoun]);

  const openDropdown = useCallback(() => {
    if (!anchorOpen()) return;
    setQuery("");
    setTimeout(() => searchRef.current?.focus(), 30);
  }, [anchorOpen]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  // Selecting doesn't close: picking two of something is the reason this
  // control exists, and a panel that shut after each one would make the
  // second pick cost as much as the first.
  const toggle = useCallback(
    (value: string) => {
      onChange(
        selectedSet.has(value) ? values.filter(v => v !== value) : [...values, value]
      );
    },
    [onChange, values, selectedSet]
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

  const handlePanelKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        closeDropdown();
        triggerRef.current?.focus();
      }
    },
    [closeDropdown, triggerRef]
  );

  const triggerCls =
    triggerClassName ??
    cn(
      "input w-full text-left flex items-center justify-between gap-2",
      disabled && "opacity-50 cursor-not-allowed",
      values.length === 0 && "text-green-900/40"
    );

  return (
    <div ref={containerRef} className={cn("relative", className)}>
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
        <span className="truncate min-w-0">{triggerLabel}</span>
        <ChevronIcon open={open} />
      </button>

      {open && panelStyle && typeof document !== "undefined" &&
        createPortal(
          // eslint-disable-next-line jsx-a11y/interactive-supports-focus
          <div
            ref={dropdownRef}
            role="listbox"
            aria-multiselectable
            onKeyDown={handlePanelKeyDown}
            className="fixed z-50 rounded-xl border border-green-900/10 bg-white shadow-xl overflow-hidden"
            style={panelStyle}
          >
            {/* font-size 16px prevents iOS zooming the page on focus */}
            <div className="p-2 border-b border-green-900/08">
              <input
                ref={searchRef}
                type="search"
                className="w-full px-3 py-2 rounded-lg bg-green-50 text-green-900 placeholder:text-green-900/35 outline-none"
                style={{ fontSize: 16 }}
                placeholder={searchPlaceholder}
                value={query}
                onChange={e => setQuery(e.target.value)}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>

            <ul className="max-h-56 overflow-y-auto py-1 overscroll-contain">
              {/* Kept out of the search results: it isn't one of the things
                  being searched, and losing the way back to "no filter"
                  because a query matched nothing would be the wrong moment
                  for it to disappear. */}
              <ClearRow
                label={emptyLabel}
                active={values.length === 0}
                onSelect={() => onChange([])}
              />

              {filtered.length === 0 ? (
                <li className="px-3 py-3 text-sm text-green-900/40 italic text-center">
                  No results
                </li>
              ) : (
                filtered.map(opt => (
                  <OptionRow
                    key={opt.value}
                    opt={opt}
                    checked={selectedSet.has(opt.value)}
                    onToggle={toggle}
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

const ClearRow = memo(function ClearRow({
  label,
  active,
  onSelect,
}: {
  label: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events
    <li
      role="option"
      aria-selected={active}
      onClick={onSelect}
      className={cn(
        "px-3 min-h-[44px] flex items-center text-sm cursor-pointer select-none",
        "border-b border-green-900/[0.06] mb-1",
        active ? "text-green-900 font-medium" : "text-green-900/60 hover:bg-green-50/70"
      )}
    >
      {label}
    </li>
  );
});

const OptionRow = memo(function OptionRow({
  opt,
  checked,
  onToggle,
}: {
  opt: SelectOption;
  checked: boolean;
  onToggle: (value: string) => void;
}) {
  const handleClick = useCallback(() => onToggle(opt.value), [onToggle, opt.value]);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      onToggle(opt.value);
    },
    [onToggle, opt.value]
  );

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events
    <li
      role="option"
      aria-selected={checked}
      onClick={handleClick}
      onTouchEnd={handleTouchEnd}
      className={cn(
        "px-3 min-h-[44px] flex items-center gap-2.5 text-sm cursor-pointer select-none",
        checked ? "bg-green-50/60 text-green-900 font-medium" : "text-green-900 hover:bg-green-50/70"
      )}
    >
      {/* Presentational: the row carries the role and the click, and a real
          input here would be a second thing to tab to for the same answer. */}
      <span
        aria-hidden
        className={cn(
          "w-4 h-4 rounded flex-shrink-0 border flex items-center justify-center transition-colors",
          checked ? "bg-green-700 border-green-700 text-white" : "border-green-900/25"
        )}
      >
        {checked && <TickIcon />}
      </span>
      <span className="truncate min-w-0">{opt.label}</span>
    </li>
  );
});

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

const TickIcon = memo(function TickIcon() {
  return (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
});

export default memo(MultiSelect);
