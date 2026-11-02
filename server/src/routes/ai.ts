import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { runAgent } from "../ai/agent.js";
import { AI_SYSTEM_PROMPT } from "../ai/prompt.js";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { getAiConfig } from "../settings.js";

export const aiRouter = Router();

// Rebuild the client when the key or base URL changes in Settings. Without
// settings overrides the SDK still falls back to env vars / `ant auth login`.
let client: Anthropic | null = null;
let clientSignature = "";

function getClient(): Anthropic {
  const config = getAiConfig();
  const signature = `${config.apiKey ?? ""}|${config.baseUrl ?? ""}`;
  if (!client || signature !== clientSignature) {
    const options: ConstructorParameters<typeof Anthropic>[0] = {};
    if (config.apiKey) options.apiKey = config.apiKey;
    if (config.baseUrl) options.baseURL = config.baseUrl;
    client = new Anthropic(options);
    clientSignature = signature;
  }
  return client;
}

aiRouter.post("/chat", async (req, res) => {
  const { messages, context } = req.body ?? {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages array required" });
  }
  try {
    const result = await runAgent({
      client: getClient(),
      model: getAiConfig().model,
      system: AI_SYSTEM_PROMPT,
      messages: messages.map((message: MessageParam) => ({
        role: message.role,
        content: message.content,
      })),
      context,
    });
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("api_key") || msg.includes("authentication")) {
      return res.status(503).json({
        error: "AI assistant unavailable: add an Anthropic API key in Settings (or set ANTHROPIC_API_KEY).",
      });
    }
    res.status(502).json({ error: msg });
  }
});
