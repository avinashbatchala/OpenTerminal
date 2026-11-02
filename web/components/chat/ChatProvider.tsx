"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { apiPost } from "../../lib/api";
import {
  canRetry,
  chatReducer,
  initialChatState,
  toApiMessages,
  type ChatMessage,
  type ToolCall,
} from "../../lib/chatState";
import type { ChatSize } from "../../lib/chatSize";

export type UnreadKind = "success" | "error" | null;
export type ChatScrollState = { top: number; atBottom: boolean };

type ChatContextValue = {
  messages: ChatMessage[];
  pending: boolean;
  draft: string;
  setDraft: (draft: string) => void;
  open: boolean;
  openChat: () => void;
  closeChat: () => void;
  unread: UnreadKind;
  acknowledgeUnread: () => void;
  desktopChatSize: ChatSize | null;
  setDesktopChatSize: (size: ChatSize) => void;
  send: (text: string, symbol: string) => void;
  retry: (messageId: string) => void;
  canRetry: (messageId: string) => boolean;
  getScrollState: () => ChatScrollState;
  saveScrollState: (state: ChatScrollState) => void;
};

type ChatApiResponse = { text: string; toolCalls?: ToolCall[] };

const ChatContext = createContext<ChatContextValue | null>(null);

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState<UnreadKind>(null);
  const [desktopChatSize, setDesktopChatSize] = useState<ChatSize | null>(null);
  const inFlight = useRef(false);
  const openRef = useRef(false);
  const scrollState = useRef<ChatScrollState>({ top: 0, atBottom: true });

  const openChat = useCallback(() => {
    openRef.current = true;
    setOpen(true);
  }, []);

  const closeChat = useCallback(() => {
    openRef.current = false;
    setOpen(false);
  }, []);

  const acknowledgeUnread = useCallback(() => setUnread(null), []);

  const getScrollState = useCallback(() => scrollState.current, []);
  const saveScrollState = useCallback((next: ChatScrollState) => {
    scrollState.current = next;
  }, []);

  const runRequest = useCallback(async (userMessage: ChatMessage, history: ChatMessage[]) => {
    try {
      const response = await apiPost<ChatApiResponse>("/api/ai/chat", {
        messages: [...toApiMessages(history), { role: "user", content: userMessage.content }],
        // The symbol is captured with the message, not read from the store
        // when the response eventually arrives.
        context: { activeSymbol: userMessage.symbol },
      });
      dispatch({
        type: "send-success",
        userId: userMessage.id,
        assistant: {
          id: newId(),
          role: "assistant",
          content: response.text,
          tools: response.toolCalls ?? [],
        },
      });
      if (!openRef.current) setUnread("success");
    } catch (err) {
      dispatch({
        type: "send-error",
        userId: userMessage.id,
        error: err instanceof Error ? err.message : String(err),
      });
      if (!openRef.current) setUnread("error");
    } finally {
      inFlight.current = false;
    }
  }, []);

  const send = useCallback(
    (raw: string, symbol: string) => {
      const content = raw.trim();
      if (!content || inFlight.current) return;

      const userMessage: ChatMessage = {
        id: newId(),
        role: "user",
        content,
        symbol,
        status: "sending",
      };
      const history = state.messages;
      inFlight.current = true;
      setDraft("");
      dispatch({ type: "send-start", message: userMessage });
      void runRequest(userMessage, history);
    },
    [runRequest, state.messages]
  );

  const retry = useCallback(
    (messageId: string) => {
      if (inFlight.current) return;
      const index = state.messages.findIndex((message) => message.id === messageId);
      const message = state.messages[index];
      if (!message || index !== state.messages.length - 1 || message.status !== "failed") return;

      inFlight.current = true;
      dispatch({ type: "retry-start", userId: messageId });
      void runRequest(message, state.messages.slice(0, index));
    },
    [runRequest, state.messages]
  );

  const canRetryMessage = useCallback((messageId: string) => canRetry(state, messageId), [state]);

  const value = useMemo<ChatContextValue>(
    () => ({
      messages: state.messages,
      pending: state.pending,
      draft,
      setDraft,
      open,
      openChat,
      closeChat,
      unread,
      acknowledgeUnread,
      desktopChatSize,
      setDesktopChatSize,
      send,
      retry,
      canRetry: canRetryMessage,
      getScrollState,
      saveScrollState,
    }),
    [
      acknowledgeUnread,
      canRetryMessage,
      closeChat,
      desktopChatSize,
      draft,
      getScrollState,
      open,
      openChat,
      retry,
      saveScrollState,
      send,
      setDesktopChatSize,
      state.messages,
      state.pending,
      unread,
    ]
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatContextValue {
  const value = useContext(ChatContext);
  if (!value) throw new Error("useChat must be used inside ChatProvider");
  return value;
}
