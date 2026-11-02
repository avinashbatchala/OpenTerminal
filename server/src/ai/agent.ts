import type {
  Message,
  MessageCreateParamsNonStreaming,
  MessageParam,
  Tool,
  ToolResultBlockParam,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
import { mapWithConcurrency } from "../concurrency.js";
import { AI_TOOLS, executeTool, type ToolExecution } from "./tools.js";

export type AgentClient = {
  messages: {
    create(params: MessageCreateParamsNonStreaming): Promise<Message>;
  };
};

export type AgentOptions = {
  client: AgentClient;
  model: string;
  system: string;
  messages: MessageParam[];
  context?: unknown;
  maxRounds?: number;
  maxToolCalls?: number;
  toolConcurrency?: number;
  execute?: typeof executeTool;
};

export type AgentResult = {
  text: string;
  toolCalls: ToolExecution[];
};

const DEFAULT_MAX_ROUNDS = 5;
const DEFAULT_MAX_TOOL_CALLS = 12;
const DEFAULT_TOOL_CONCURRENCY = 3;

function textOf(response: Message | null): string {
  if (!response) return "";
  return response.content
    .filter((block) => block.type === "text")
    .map((block) => ("text" in block ? block.text : ""))
    .join("");
}

/**
 * Runs the Anthropic tool-use loop: ask the model, execute requested tools,
 * append their results, and repeat until it produces a final text answer.
 * Thinking blocks are preserved because the API requires them to be sent back
 * with subsequent assistant turns when extended thinking is enabled.
 */
export async function runAgent(options: AgentOptions): Promise<AgentResult> {
  const execute = options.execute ?? executeTool;
  const maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const maxToolCalls = options.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
  const toolConcurrency = Math.max(1, options.toolConcurrency ?? DEFAULT_TOOL_CONCURRENCY);
  const toolCalls: ToolExecution[] = [];
  const messages: MessageParam[] = [];

  if (options.context !== undefined && options.context !== null) {
    messages.push({
      role: "user",
      content: `Current terminal context (JSON):\n${JSON.stringify(options.context)}`,
    });
  }
  messages.push(...options.messages);

  let response: Message | null = null;

  for (let round = 0; round < maxRounds; round++) {
    response = await options.client.messages.create({
      model: options.model,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: options.system,
      tools: AI_TOOLS as unknown as Tool[],
      messages,
    });

    if (response.stop_reason === "refusal") {
      return { text: "The assistant declined to answer this request.", toolCalls };
    }

    const toolUses = response.content.filter(
      (block): block is ToolUseBlock => block.type === "tool_use"
    );

    messages.push({
      role: "assistant",
      content: response.content as unknown as MessageParam["content"],
    });

    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      return { text: textOf(response), toolCalls };
    }

    const remaining = maxToolCalls - toolCalls.length;
    const allowed = remaining > 0 ? toolUses.slice(0, remaining) : [];
    const blocked = toolUses.slice(allowed.length);
    const executions: Array<ToolExecution | undefined> = new Array(allowed.length);

    const results = await mapWithConcurrency(
      allowed,
      toolConcurrency,
      async (block, index): Promise<ToolResultBlockParam> => {
        const result = await execute(block.name, block.input);
        executions[index] = result.execution;
        return {
          type: "tool_result",
          tool_use_id: block.id,
          content: result.content,
          is_error: result.isError,
        };
      }
    );
    toolCalls.push(...executions.filter((execution): execution is ToolExecution => Boolean(execution)));

    for (const block of blocked) {
      results.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify({ error: "tool-call budget exhausted for this request" }),
        is_error: true,
      });
    }

    messages.push({ role: "user", content: results });
  }

  return {
    text:
      textOf(response) ||
      "I reached the tool-call limit before finishing. Try a narrower question or ask about one data source at a time.",
    toolCalls,
  };
}
