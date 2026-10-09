'use client';

import type { ReactNode } from 'react';

export const OPEN_CHAT_EVENT = 'tigo:open-chat';

export interface OpenChatDetail {
  /** A question to ask straight away. */
  question?: string;
}

export function openChat(detail: OpenChatDetail = {}) {
  window.dispatchEvent(new CustomEvent<OpenChatDetail>(OPEN_CHAT_EVENT, { detail }));
}

/** Any button on the page that opens Ask Tigo, optionally with a question already asked. */
export function OpenChatButton({ children, className, question }: { children: ReactNode; className?: string; question?: string }) {
  return (
    <button type="button" className={className} aria-haspopup="dialog" onClick={() => openChat({ question })}>
      {children}
    </button>
  );
}
