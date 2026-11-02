import { describe, expect, it } from "vitest";
import {
  canRetry,
  chatReducer,
  initialChatState,
  toApiMessages,
  type ChatMessage,
} from "./chatState";

const user = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: "u1",
  role: "user",
  content: "How is AAPL?",
  symbol: "AAPL",
  status: "sending",
  ...overrides,
});

const assistant: ChatMessage = {
  id: "a1",
  role: "assistant",
  content: "AAPL is up.",
  tools: [{ name: "get_quote", ok: true, durationMs: 4 }],
};

describe("chat state", () => {
  it("marks a new message pending", () => {
    const state = chatReducer(initialChatState, { type: "send-start", message: user() });
    expect(state.pending).toBe(true);
    expect(state.messages).toEqual([user()]);
  });

  it("marks the user turn sent and appends the assistant response", () => {
    const started = chatReducer(initialChatState, { type: "send-start", message: user() });
    const state = chatReducer(started, {
      type: "send-success",
      userId: "u1",
      assistant,
    });

    expect(state.pending).toBe(false);
    expect(state.messages[0].status).toBe("sent");
    expect(state.messages[1]).toEqual(assistant);
  });

  it("preserves a failed user turn for retry", () => {
    const started = chatReducer(initialChatState, { type: "send-start", message: user() });
    const failed = chatReducer(started, {
      type: "send-error",
      userId: "u1",
      error: "upstream unavailable",
    });

    expect(failed.pending).toBe(false);
    expect(failed.messages[0]).toMatchObject({ status: "failed", error: "upstream unavailable" });
    expect(canRetry(failed, "u1")).toBe(true);

    const retried = chatReducer(failed, { type: "retry-start", userId: "u1" });
    expect(retried.pending).toBe(true);
    expect(retried.messages[0]).toMatchObject({ status: "sending", error: undefined });
  });

  it("only retries the latest failed message", () => {
    const started = chatReducer(initialChatState, { type: "send-start", message: user() });
    const failed = chatReducer(started, { type: "send-error", userId: "u1", error: "nope" });
    const withAnother = chatReducer(failed, {
      type: "send-start",
      message: user({ id: "u2", content: "Next question" }),
    });

    expect(canRetry(withAnother, "u1")).toBe(false);
    expect(canRetry(failed, "u1")).toBe(true);
  });

  it("excludes failed and in-flight turns from API history", () => {
    const history: ChatMessage[] = [
      user({ id: "u1", status: "sent" }),
      assistant,
      user({ id: "u2", status: "failed", error: "failed" }),
      user({ id: "u3", status: "sending" }),
    ];

    expect(toApiMessages(history)).toEqual([
      { role: "user", content: "How is AAPL?" },
      { role: "assistant", content: "AAPL is up." },
    ]);
  });
});
