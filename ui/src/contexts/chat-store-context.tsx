import { createContext, useContext } from "react";
import { useStore } from "zustand/react";
import type { ChatState } from "@/stores/chat";
import { useChatStore } from "@/stores/chat";

export type ChatStoreApi = typeof useChatStore;

export const ChatStoreApiContext = createContext<ChatStoreApi | null>(null);

export function useChatStoreApi(): ChatStoreApi {
  return useContext(ChatStoreApiContext) ?? useChatStore;
}

export function useScopedChatStore<T>(selector: (s: ChatState) => T): T {
  const api = useChatStoreApi();
  return useStore(api, selector);
}
