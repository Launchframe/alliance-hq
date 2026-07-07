"use client";

import {
  RELEASE_NOTES_PEEK_HEIGHT,
  RELEASE_NOTES_PEEK_HEIGHT_CLASS,
} from "@/lib/release-notes/releaseNotesDrawer";

type Props = {
  onExpand: () => void;
  label: string;
  expandHintDesktop: string;
  expandHintMobile: string;
};

export function ReleaseNotesPeekBar({
  onExpand,
  label,
  expandHintDesktop,
  expandHintMobile,
}: Props) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      data-testid="hq-release-notes-peek"
      className={`fixed inset-x-0 bottom-0 z-[54] flex flex-col items-center justify-center gap-2 rounded-t-[10px] border border-b-0 border-hq-border bg-hq-surface px-4 py-2 shadow-[0_-4px_24px_rgba(0,0,0,0.35)] ${RELEASE_NOTES_PEEK_HEIGHT_CLASS}`}
      style={{ height: RELEASE_NOTES_PEEK_HEIGHT }}
      onClick={onExpand}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onExpand();
        }
      }}
    >
      <div
        className="h-1.5 w-12 shrink-0 rounded-full bg-[#484f58]"
        aria-hidden
      />
      <p className="hidden text-center text-xs font-medium text-hq-fg-muted lg:block">
        {expandHintDesktop}
      </p>
      <p className="block text-center text-xs font-medium text-hq-fg-muted lg:hidden">
        {expandHintMobile}
      </p>
    </div>
  );
}
