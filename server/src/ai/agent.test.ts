import { describe, expect, it, vi } from "vitest";
import { runAgent } from "./agent.js";

function fakeClient(responses: unknown[]) {
  const create = vi.fn();
  for (const response of responses) create.mockResolvedValueOnce(response);
  return { create, client: { messages: { create } } as any };
}

const toolExecution = {
  name: "get_quote",
  input: { symbol: "AAPL" },
  ok: true,
  durationMs: 3,
};

describe("AI agent tool loop", () => {
  it("executes a tool, appends the result, and returns the final text", async () => {
    const { create, client } = fakeClient([
      {
        stop_reason: "tool_use",
        content: [
          { type: "thinking", thinking: "Need a quote", signature: "sig" },
          { type: "tool_use", id: "tool-1", name: "get_quote", input: { symbol: "AAPL" } },
        ],
      },
      {
        stop_reason: "end_turn",
        content: [{ type: "text", text: "AAPL is trading at 230.50." }],
      },
    ]);
    const execute = vi.fn().mockResolvedValue({
      content: '{"symbol":"AAPL","price":230.5}',
      isError: false,
      execution: toolExecution,
    });

    const result = await runAgent({
      client,
      model: "test-model",
      system: "system",
      messages: [{ role: "user", content: "How is AAPL?" }],
      execute,
    });

    expect(result.text).toBe("AAPL is trading at 230.50.");
    expect(result.toolCalls).toEqual([toolExecution]);
    expect(execute).toHaveBeenCalledWith("get_quote", { symbol: "AAPL" });
    expect(create.mock.calls[0][0].system).toBe("system");

    const secondMessages = create.mock.calls[1][0].messages;
    expect(secondMessages[0]).toEqual({ role: "user", content: "How is AAPL?" });
    expect(secondMessages[1]).toEqual({
      role: "assistant",
      content: [
        { type: "thinking", thinking: "Need a quote", signature: "sig" },
        { type: "tool_use", id: "tool-1", name: "get_quote", input: { symbol: "AAPL" } },
      ],
    });
    expect(secondMessages[2]).toEqual({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "tool-1",
          content: '{"symbol":"AAPL","price":230.5}',
          is_error: false,
        },
      ],
    });
  });

  it("marks failed tools as errors so the model can explain", async () => {
    const { client } = fakeClient([
      {
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "tool-1", name: "get_news", input: {} }],
      },
      { stop_reason: "end_turn", content: [{ type: "text", text: "News is unavailable." }] },
    ]);
    const execute = vi.fn().mockResolvedValue({
      content: '{"error":"news down"}',
      isError: true,
      execution: { ...toolExecution, name: "get_news", ok: false },
    });

    const result = await runAgent({
      client,
      model: "test-model",
      system: "system",
      messages: [{ role: "user", content: "News?" }],
      execute,
    });

    expect(result.text).toBe("News is unavailable.");
    expect(result.toolCalls[0].ok).toBe(false);
  });

  it("prepends terminal context to the conversation", async () => {
    const { create, client } = fakeClient([
      { stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] },
    ]);

    await runAgent({
      client,
      model: "test-model",
      system: "system",
      messages: [{ role: "user", content: "Question" }],
      context: { activeSymbol: "AAPL" },
    });

    expect(create.mock.calls[0][0].messages[0].content).toContain("AAPL");
    expect(create.mock.calls[0][0].messages[1]).toEqual({ role: "user", content: "Question" });
  });

  it("stops after the maximum number of tool rounds", async () => {
    const responses = Array.from({ length: 3 }, () => ({
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "tool-1", name: "get_quote", input: { symbol: "AAPL" } }],
    }));
    const { create, client } = fakeClient(responses);
    const execute = vi.fn().mockResolvedValue({
      content: "{}",
      isError: false,
      execution: toolExecution,
    });

    const result = await runAgent({
      client,
      model: "test-model",
      system: "system",
      messages: [{ role: "user", content: "loop" }],
      execute,
      maxRounds: 2,
    });

    expect(create).toHaveBeenCalledTimes(2);
    expect(result.text).toContain("tool-call limit");
  });

  it("bounds tool concurrency and total tool calls", async () => {
    const toolUses = Array.from({ length: 6 }, (_, i) => ({
      type: "tool_use",
      id: `tool-${i}`,
      name: "get_quote",
      input: { symbol: "AAPL" },
    }));
    const { create, client } = fakeClient([
      { stop_reason: "tool_use", content: toolUses },
      { stop_reason: "end_turn", content: [{ type: "text", text: "done" }] },
    ]);

    let active = 0;
    let maxActive = 0;
    const execute = vi.fn().mockImplementation(async (_name: string, input: unknown) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return {
        content: "{}",
        isError: false,
        execution: { ...toolExecution, input },
      };
    });

    const result = await runAgent({
      client,
      model: "test-model",
      system: "system",
      messages: [{ role: "user", content: "many tools" }],
      execute,
      maxToolCalls: 4,
      toolConcurrency: 2,
    });

    expect(execute).toHaveBeenCalledTimes(4);
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(result.toolCalls).toHaveLength(4);

    // The array is mutated with the final assistant message after the second
    // create call, so the tool results are the second-to-last entry.
    const toolResults = create.mock.calls[1][0].messages.at(-2).content;
    expect(toolResults).toHaveLength(6);
    expect(toolResults.filter((result: { is_error?: boolean }) => result.is_error)).toHaveLength(2);
  });

  it("preserves a refusal response", async () => {
    const { client } = fakeClient([{ stop_reason: "refusal", content: [] }]);

    const result = await runAgent({
      client,
      model: "test-model",
      system: "system",
      messages: [{ role: "user", content: "no" }],
    });

    expect(result.text).toContain("declined");
  });
});
