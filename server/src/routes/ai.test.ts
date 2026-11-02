import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

const { create } = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create };
  },
}));

vi.mock("../settings.js", () => ({
  getAiConfig: () => ({ apiKey: "test-key", baseUrl: null, model: "test-model" }),
}));

import { AI_SYSTEM_PROMPT } from "../ai/prompt.js";
import { aiRouter } from "./ai.js";

function fakeRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

function getHandler(path: string) {
  const layer = (aiRouter as any).stack.find((l: any) => l.route?.path === path);
  if (!layer) throw new Error(`no route registered for ${path}`);
  return layer.route.stack[0].handle as (req: Request, res: Response, next: () => void) => unknown;
}

describe("POST /chat", () => {
  it("sends the server-owned strategy prompt in the actual model request", async () => {
    create.mockResolvedValueOnce({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "ok" }],
    });
    const handler = getHandler("/chat");
    const req = {
      body: {
        messages: [{ role: "user", content: "Suggest a strategy for AAPL" }],
        context: { activeSymbol: "AAPL" },
      },
    } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(create).toHaveBeenCalledTimes(1);
    const params = create.mock.calls[0][0];
    expect(params.system).toBe(AI_SYSTEM_PROMPT);
    expect(params.system).toContain("STRATEGY RESPONSES");
    expect(params.model).toBe("test-model");
    // The agent mutates this array after the call, so inspect the original
    // context + user turns rather than the trailing assistant message.
    expect(params.messages[0].content).toContain("AAPL");
    expect(params.messages[1]).toEqual({
      role: "user",
      content: "Suggest a strategy for AAPL",
    });
    expect(res.json).toHaveBeenCalledWith({ text: "ok", toolCalls: [] });
  });
});
