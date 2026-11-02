import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiPost } from "../../lib/api";
import { useTerminal } from "../../store/terminal";
import { ChatProvider } from "./ChatProvider";
import ChatLauncher from "./ChatLauncher";
import { CHAT_RESIZE_LABEL } from "./useChatResize";

vi.mock("../../lib/api", () => ({ apiPost: vi.fn() }));

const apiPostMock = vi.mocked(apiPost);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderChat() {
  return render(
    <ChatProvider>
      <ChatLauncher />
    </ChatProvider>
  );
}

async function openChat(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Open AI assistant" }));
}

function panelWidth(): number {
  const panel = document.querySelector("#ai-chat-panel") as HTMLElement;
  return Number.parseFloat(panel.style.width);
}

function resizeHandle(): HTMLElement {
  return screen.getByRole("button", { name: CHAT_RESIZE_LABEL });
}

beforeEach(() => {
  useTerminal.setState({ activeSymbol: "AAPL", commandOpen: false });
  apiPostMock.mockReset();
});

describe("floating chat", () => {
  it("preserves an unsent draft across close and reopen", async () => {
    apiPostMock.mockResolvedValue({ text: "ok", toolCalls: [] });
    const user = userEvent.setup();
    renderChat();

    await openChat(user);
    const composer = screen.getByRole("textbox", { name: "Message about AAPL" });
    await user.type(composer, "unsent draft");

    await user.click(screen.getByRole("button", { name: "Close AI assistant" }));
    expect(screen.queryByRole("textbox", { name: "Message about AAPL" })).toBeNull();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Open AI assistant" })).toHaveFocus()
    );

    await openChat(user);
    expect(screen.getByRole("textbox", { name: "Message about AAPL" })).toHaveValue("unsent draft");
  });

  it("marks a response unread when it arrives while closed, then acknowledges on open", async () => {
    const request = deferred<{ text: string; toolCalls: [] }>();
    apiPostMock.mockReturnValue(request.promise);
    const user = userEvent.setup();
    renderChat();

    await openChat(user);
    await user.type(screen.getByRole("textbox", { name: "Message about AAPL" }), "hello");
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: "Close AI assistant" }));

    await act(async () => {
      request.resolve({ text: "A response", toolCalls: [] });
    });

    const unreadLauncher = await screen.findByRole("button", {
      name: "Open AI assistant, unread response",
    });
    expect(unreadLauncher).toHaveAttribute("data-unread", "success");

    await user.click(unreadLauncher);
    expect(screen.getByText("A response")).toBeInTheDocument();
    expect(screen.getByText("Assistant response ready.")).toBeInTheDocument();
    expect(document.querySelector(".chat-launcher")).toHaveAttribute("data-unread", "false");
  });

  it("surfaces an unread error and keeps the failed message retryable", async () => {
    const request = deferred<{ text: string; toolCalls: [] }>();
    apiPostMock.mockReturnValue(request.promise);
    const user = userEvent.setup();
    renderChat();

    await openChat(user);
    await user.type(screen.getByRole("textbox", { name: "Message about AAPL" }), "fail please");
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: "Close AI assistant" }));

    await act(async () => {
      request.reject(new Error("simulated failure"));
    });

    const unreadLauncher = await screen.findByRole("button", {
      name: "Open AI assistant, unread error",
    });
    expect(unreadLauncher).toHaveAttribute("data-unread", "error");

    await user.click(unreadLauncher);
    expect(screen.getByText("simulated failure")).toBeInTheDocument();
    expect(screen.getByText("Assistant request failed. Retry is available.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "RETRY" })).toBeInTheDocument();
  });

  it("supports multiline drafts, IME-safe Enter, and duplicate-send protection", async () => {
    const request = deferred<{ text: string; toolCalls: [] }>();
    apiPostMock.mockReturnValue(request.promise);
    const user = userEvent.setup();
    renderChat();

    await openChat(user);
    const composer = screen.getByRole("textbox", { name: "Message about AAPL" });
    await user.type(composer, "line one");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    await user.type(composer, "line two");
    expect(composer).toHaveValue("line one\nline two");
    expect(apiPostMock).not.toHaveBeenCalled();

    await user.type(composer, " composing");
    await act(async () => {
      composer.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      composer.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      composer.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    });
    expect(apiPostMock).not.toHaveBeenCalled();

    await user.keyboard("{Enter}");
    expect(apiPostMock).toHaveBeenCalledTimes(1);

    await user.type(composer, "second");
    await user.keyboard("{Enter}");
    expect(apiPostMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      request.resolve({ text: "done", toolCalls: [] });
    });
  });

  it("preserves the chosen desktop size across close and reopen", async () => {
    const user = userEvent.setup();
    renderChat();

    await openChat(user);
    fireEvent.keyDown(resizeHandle(), { key: "ArrowLeft", shiftKey: true });
    const width = panelWidth();
    expect(width).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Close AI assistant" }));
    await openChat(user);

    expect(panelWidth()).toBe(width);
  });

  it("keeps drafts, pending requests, and responses while resizing", async () => {
    const request = deferred<{ text: string; toolCalls: [] }>();
    apiPostMock.mockReturnValue(request.promise);
    const user = userEvent.setup();
    renderChat();

    await openChat(user);
    const composer = screen.getByRole("textbox", { name: "Message about AAPL" });
    await user.type(composer, "draft across resize");

    fireEvent.keyDown(resizeHandle(), { key: "ArrowLeft" });
    expect(composer).toHaveValue("draft across resize");

    await user.clear(composer);
    await user.type(composer, "pending across resize");
    await user.keyboard("{Enter}");
    expect(screen.getByText("pending across resize")).toBeInTheDocument();
    expect(screen.getByText(/thinking and fetching/)).toBeInTheDocument();

    fireEvent.keyDown(resizeHandle(), { key: "ArrowLeft", shiftKey: true });
    expect(screen.getByText("pending across resize")).toBeInTheDocument();
    expect(screen.getByText(/thinking and fetching/)).toBeInTheDocument();

    await act(async () => {
      request.resolve({ text: "response across resize", toolCalls: [] });
    });
    expect(await screen.findByText("response across resize")).toBeInTheDocument();
  });

  it("retries the original message with its captured ticker", async () => {
    apiPostMock
      .mockRejectedValueOnce(new Error("first failure"))
      .mockResolvedValueOnce({ text: "retried", toolCalls: [] });
    const user = userEvent.setup();
    renderChat();

    await openChat(user);
    await user.type(screen.getByRole("textbox", { name: "Message about AAPL" }), "original idea");
    await user.keyboard("{Enter}");
    await screen.findByRole("button", { name: "RETRY" });

    act(() => useTerminal.setState({ activeSymbol: "MSFT" }));
    await user.click(screen.getByRole("button", { name: "RETRY" }));
    await waitFor(() => expect(apiPostMock).toHaveBeenCalledTimes(2));

    const secondBody = apiPostMock.mock.calls[1][1] as {
      context: { activeSymbol: string };
      messages: Array<{ role: string; content: string }>;
    };
    expect(secondBody.context.activeSymbol).toBe("AAPL");
    expect(secondBody.messages.at(-1)).toEqual({ role: "user", content: "original idea" });
    expect(screen.getByText("original idea")).toBeInTheDocument();
  });
});
