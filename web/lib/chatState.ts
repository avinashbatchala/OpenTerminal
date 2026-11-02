export type ToolCall = { name: string; ok: boolean; durationMs: number };

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  symbol?: string;
  tools?: ToolCall[];
  status?: "sending" | "sent" | "failed";
  error?: string;
};

export type ChatState = {
  messages: ChatMessage[];
  pending: boolean;
};

export type ChatAction =
  | { type: "send-start"; message: ChatMessage }
  | { type: "send-success"; userId: string; assistant: ChatMessage }
  | { type: "send-error"; userId: string; error: string }
  | { type: "retry-start"; userId: string };

export const initialChatState: ChatState = { messages: [], pending: false };

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "send-start":
      return { messages: [...state.messages, action.message], pending: true };
    case "send-success":
      return {
        messages: [
          ...state.messages.map((message) =>
            message.id === action.userId ? { ...message, status: "sent" as const } : message
          ),
          action.assistant,
        ],
        pending: false,
      };
    case "send-error":
      return {
        messages: state.messages.map((message) =>
          message.id === action.userId
            ? { ...message, status: "failed" as const, error: action.error }
            : message
        ),
        pending: false,
      };
    case "retry-start":
      return {
        messages: state.messages.map((message) =>
          message.id === action.userId
            ? { ...message, status: "sending" as const, error: undefined }
            : message
        ),
        pending: true,
      };
  }
}

export function canRetry(state: ChatState, messageId: string): boolean {
  if (state.pending) return false;
  const index = state.messages.findIndex((message) => message.id === messageId);
  return (
    index === state.messages.length - 1 &&
    state.messages[index]?.role === "user" &&
    state.messages[index]?.status === "failed"
  );
}

/** Messages sent to the API: only successful user turns and assistant replies. */
export function toApiMessages(
  messages: ChatMessage[]
): Array<{ role: "user" | "assistant"; content: string }> {
  return messages
    .filter((message) => message.role === "assistant" || message.status === "sent")
    .map(({ role, content }) => ({ role, content }));
}
