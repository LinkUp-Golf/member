"use client";

import { useEffect, useRef, useState } from "react";
import Avatar from "@/components/ui/Avatar";
import { formatMessageTime } from "@/lib/utils";
import type { OptimisticMessage } from "@/types";

interface Props {
  message: OptimisticMessage;
  isMe: boolean;
  showSenderInfo: boolean;
  isSeen?: boolean;
  isGroup?: boolean;
  /** True when the current user is a group moderator (can delete others' messages) */
  isModerator?: boolean;
  onEdit?: (messageId: string, newBody: string) => Promise<boolean>;
  onDelete?: (messageId: string) => Promise<boolean>;
  onRetry?: (tempId: string, body: string) => void;
}

export function MessageBubble({
  message: msg,
  isMe,
  showSenderInfo,
  isSeen,
  isGroup,
  isModerator,
  onEdit,
  onDelete,
  onRetry,
}: Props) {
  const isDeleted = !!msg.deleted_at;
  const isPending = !!msg.pending;
  const isFailed = !!msg.failed;

  const canEdit = isMe && !isDeleted && !isPending && !isFailed && !!onEdit;
  const canDelete =
    !isDeleted &&
    !isPending &&
    (isMe || (isGroup && isModerator)) &&
    !!onDelete;

  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(msg.body);
  const [saving, setSaving] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    if (!menuOpen) return;
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  // Auto-focus edit textarea
  useEffect(() => {
    if (editing) {
      editRef.current?.focus();
      const len = editRef.current?.value.length ?? 0;
      editRef.current?.setSelectionRange(len, len);
    }
  }, [editing]);

  async function handleSaveEdit() {
    if (!onEdit || !editBody.trim() || editBody.trim() === msg.body) {
      setEditing(false);
      setEditBody(msg.body);
      return;
    }
    setSaving(true);
    const ok = await onEdit(msg.id, editBody.trim());
    setSaving(false);
    if (ok) setEditing(false);
  }

  function handleCancelEdit() {
    setEditing(false);
    setEditBody(msg.body);
  }

  async function handleDelete() {
    setMenuOpen(false);
    if (onDelete) await onDelete(msg.id);
  }

  function startEdit() {
    setMenuOpen(false);
    setEditBody(msg.body);
    setEditing(true);
  }

  function handleEditKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSaveEdit();
    }
    if (e.key === "Escape") handleCancelEdit();
  }

  const showMenu = (canEdit || canDelete) && !editing;

  // Extra horizontal padding so the bubble text never slides under the dots button.
  // isMe  → dots at top-right  → pad the right side
  // !isMe → dots at top-left   → pad the left side
  const actionPadding = showMenu ? (isMe ? "pr-6" : "pl-6") : "";

  return (
    <div
      className={`flex items-end gap-2 mb-1 ${isMe ? "flex-row-reverse" : "flex-row"}`}
    >
      {/* Avatar column (received messages only) */}
      {!isMe && (
        <div className="w-7 flex-shrink-0 self-end mb-1">
          {showSenderInfo && !isDeleted && (
            <Avatar
              firstName={msg.sender.first_name}
              lastName={msg.sender.last_name}
              avatarUrl={msg.sender.profile?.avatar_url}
              size="sm"
              className="w-7 h-7 text-xs"
            />
          )}
        </div>
      )}

      {/* Bubble + meta */}
      <div
        className={`flex flex-col ${isMe ? "items-end" : "items-start"} max-w-[75%]`}
      >
        {/* Sender name (group chats, first in run) */}
        {showSenderInfo && !isMe && isGroup && (
          <p className="text-xs text-green-900/40 mb-0.5 ml-1 capitalize">
            {msg.sender.first_name}
          </p>
        )}

        {/* ---- Edit mode ---- */}
        {editing ? (
          <div className="flex flex-col gap-1.5 w-full min-w-[200px]">
            <textarea
              ref={editRef}
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              onKeyDown={handleEditKeyDown}
              rows={2}
              className="text-sm rounded-2xl px-3.5 py-2.5 resize-none border-2 outline-none w-full"
              style={{
                borderColor: "#85bb65",
                background: "#f9fafb",
                color: "#1a2e1a",
              }}
              disabled={saving}
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={handleCancelEdit}
                disabled={saving}
                className="text-xs px-3 py-1 rounded-full border border-green-900/20 text-green-900/60 hover:bg-green-50 transition-colors disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={saving || !editBody.trim()}
                className="text-xs px-3 py-1 rounded-full font-medium text-white transition-colors disabled:opacity-40"
                style={{ background: "#3a6e1f" }}
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        ) : isFailed && onRetry ? (
          /* Failed bubble — tap to retry */
          <button
            className={[
              "bubble",
              "bubble-out",
              "!bg-red-100 !text-red-700",
              actionPadding,
            ].join(" ")}
            onClick={() => onRetry(msg.tempId ?? "", msg.body)}
          >
            {msg.body}
          </button>
        ) : (
          /* ---- Normal bubble with optional dots button ---- */
          <div className="relative" ref={showMenu ? menuRef : undefined}>
            <div
              className={[
                "bubble",
                isDeleted
                  ? "bubble-deleted italic opacity-50"
                  : isMe
                    ? `bubble-out ${isPending ? "opacity-60" : ""}`
                    : "bubble-in",
                actionPadding,
              ].join(" ")}
            >
              {isDeleted ? "Message deleted" : msg.body}
            </div>

            {/* Vertical 3-dot button — top-right for sent, top-left for received */}
            {showMenu && (
              <div
                className={`absolute top-1.5 z-10 ${isMe ? "right-1.5" : "left-1.5"}`}
              >
                <button
                  onClick={() => setMenuOpen((prev) => !prev)}
                  className={[
                    "w-5 h-5 flex items-center justify-center rounded",
                    "transition-colors",
                    isMe
                      ? "text-white/50 hover:text-white/90 hover:bg-white/15"
                      : "text-green-900/40 hover:text-green-900/80 hover:bg-green-900/10",
                  ].join(" ")}
                  aria-label="Message actions"
                >
                  <DotsVertical />
                </button>

                {menuOpen && (
                  <div
                    className={[
                      "absolute top-full mt-1 w-36 rounded-xl shadow-lg overflow-hidden",
                      "border border-green-900/08 z-20",
                      isMe ? "right-0" : "left-0",
                    ].join(" ")}
                    style={{ background: "#fff" }}
                  >
                    {canEdit && <MenuAction label="Edit" onClick={startEdit} />}
                    {canDelete && (
                      <MenuAction
                        label="Delete"
                        danger
                        onClick={handleDelete}
                      />
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Timestamp + delivery status */}
        {!editing && (
          <div
            className={`flex items-center gap-1 mt-0.5 ${isMe ? "flex-row-reverse mr-1" : "ml-1"}`}
          >
            <span className="text-[10px] text-green-900/30">
              {formatMessageTime(msg.created_at)}
            </span>
            {msg.edited_at && !isDeleted && (
              <span className="text-[10px] text-green-900/30">edited</span>
            )}
            {isMe && isFailed && (
              <span className="text-[10px] text-red-500">
                Failed · Tap to retry
              </span>
            )}
            {isMe && isPending && (
              <span className="text-[10px] text-green-900/30">Sending…</span>
            )}
            {isMe && isSeen && !isPending && !isFailed && (
              <span className="text-[10px] text-green-600">Seen</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Sub-components -----------------------------------------

function MenuAction({
  label,
  danger,
  onClick,
}: {
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-4 py-2.5 text-sm hover:bg-green-50 transition-colors"
      style={{ color: danger ? "#dc2626" : "#1a2e1a" }}
    >
      {label}
    </button>
  );
}

function DotsVertical() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3">
      <circle cx="12" cy="5" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="12" cy="19" r="1.75" />
    </svg>
  );
}
