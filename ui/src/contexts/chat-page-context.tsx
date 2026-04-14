/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, type ReactNode } from "react";
import type { PageContext } from "@/types/chat";

const ChatPageContext = createContext<PageContext | null>(null);

export function ChatPageProvider({
  value,
  children,
}: {
  value: PageContext | null;
  children: ReactNode;
}) {
  return (
    <ChatPageContext.Provider value={value}>{children}</ChatPageContext.Provider>
  );
}

export function useChatPageContext(): PageContext | null {
  return useContext(ChatPageContext);
}
