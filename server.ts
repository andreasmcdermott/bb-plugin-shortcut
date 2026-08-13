import { defineRpcContract, type BbPluginApi } from "@bb/plugin-sdk";
import { z } from "zod";
import {
  ShortcutClient,
  type ShortcutStory,
  storyAsMarkdown,
} from "./shortcut-client";

const memberSchema = z.object({
  id: z.string(),
  name: z.string(),
  mentionName: z.string(),
  workspaceName: z.string(),
}).strict();

const workflowStateSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  type: z.string(),
  position: z.number().int().nonnegative(),
  workflowId: z.number().int().nonnegative(),
  workflowName: z.string(),
}).strict();

const storySchema = z.object({
  id: z.number().int().positive(),
  position: z.number().int().nonnegative(),
  name: z.string(),
  description: z.string(),
  appUrl: z.string(),
  archived: z.boolean(),
  completed: z.boolean(),
  started: z.boolean(),
  blocked: z.boolean(),
  blocker: z.boolean(),
  storyType: z.string(),
  workflowState: workflowStateSchema,
  labels: z.array(z.string()),
  estimate: z.number().nullable(),
  deadline: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  tasks: z.array(z.object({
    id: z.number().int(),
    description: z.string(),
    complete: z.boolean(),
  }).strict()),
}).strict();

export const rpcContract = defineRpcContract({
  status: {
    input: z.null(),
    output: z.object({
      configured: z.boolean(),
      member: memberSchema.nullable(),
      error: z.string().nullable(),
      defaultProjectId: z.string().nullable(),
    }).strict(),
  },
  listAssigned: {
    input: z.object({
      query: z.string().optional(),
      includeCompleted: z.boolean().optional(),
      refresh: z.boolean().optional(),
    }).strict(),
    output: z.object({ member: memberSchema, stories: z.array(storySchema) }).strict(),
  },
  getStory: {
    input: z.object({ id: z.number().int().positive() }).strict(),
    output: z.object({
      story: storySchema,
      workflowStates: z.array(workflowStateSchema),
    }).strict(),
  },
  updateStoryWorkflowState: {
    input: z.object({
      id: z.number().int().positive(),
      workflowStateId: z.number().int().positive(),
    }).strict(),
    output: z.object({ story: storySchema }).strict(),
  },
  reorderStory: {
    input: z.object({
      id: z.number().int().positive(),
      adjacentId: z.number().int().positive(),
      placement: z.enum(["before", "after"]),
    }).strict(),
    output: z.object({ position: z.number().int().nonnegative() }).strict(),
  },
  startWork: {
    input: z.object({
      id: z.number().int().positive(),
      projectId: z.string().nullable().optional(),
    }).strict(),
    output: z.object({ threadId: z.string().min(1) }).strict(),
  },
});

function configurationError(): Error {
  return new Error(
    "Shortcut is not configured. Add an API token in Settings → Plugins → Shortcut.",
  );
}

function filterStories(stories: ShortcutStory[], query: string): ShortcutStory[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return stories;
  return stories.filter((story) =>
    `sc-${story.id} ${story.name} ${story.description} ${story.labels.join(" ")}`
      .toLowerCase()
      .includes(normalized),
  );
}

function parseStoryId(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.match(/^(?:sc-)?(\d+)$/i);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function formatStoryList(stories: ShortcutStory[]): string {
  if (!stories.length) return "No assigned Shortcut stories found.";
  return stories.map((story) =>
    `sc-${story.id}\t${story.workflowState.name}\t${story.name}`,
  ).join("\n");
}

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    apiToken: {
      type: "string",
      label: "Shortcut API token",
      description: "Create a token in Shortcut → Settings → API Tokens. Stored as a secret.",
      secret: true,
    },
    defaultProject: {
      type: "project",
      label: "Default bb project",
      description: "Threads started from Shortcut stories will use this project.",
    },
    includeCompleted: {
      type: "boolean",
      label: "Include completed stories",
      description: "Show completed stories in the default assigned-to-me list.",
      default: false,
    },
  });

  let cached: {
    token: string;
    includeCompleted: boolean;
    loadedAt: number;
    result: Awaited<ReturnType<ShortcutClient["listAssignedStories"]>>;
  } | null = null;

  settings.onChange(() => {
    cached = null;
    bb.realtime.publish("stories-changed", { reason: "settings" });
  });

  const initial = await settings.get();
  if (!initial.apiToken) {
    bb.status.needsConfiguration(
      "Add a Shortcut API token in Settings → Plugins → Shortcut.",
    );
  }

  async function client(): Promise<ShortcutClient> {
    const { apiToken } = await settings.get();
    if (!apiToken) throw configurationError();
    return new ShortcutClient(apiToken);
  }

  async function assigned(
    includeCompleted: boolean,
    refresh = false,
    signal?: AbortSignal,
  ) {
    const { apiToken } = await settings.get();
    if (!apiToken) throw configurationError();
    if (
      !refresh &&
      cached &&
      cached.token === apiToken &&
      cached.includeCompleted === includeCompleted &&
      Date.now() - cached.loadedAt < 30_000
    ) {
      return cached.result;
    }
    const result = await new ShortcutClient(apiToken).listAssignedStories(
      includeCompleted,
      signal,
    );
    cached = { token: apiToken, includeCompleted, loadedAt: Date.now(), result };
    return result;
  }

  async function story(id: number, signal?: AbortSignal) {
    return (await client()).getStory(id, signal);
  }

  bb.rpc.register(rpcContract, {
    async status() {
      const values = await settings.get();
      if (!values.apiToken) {
        return {
          configured: false,
          member: null,
          error: null,
          defaultProjectId: values.defaultProject ?? null,
        };
      }
      try {
        return {
          configured: true,
          member: await (await client()).currentMember(),
          error: null,
          defaultProjectId: values.defaultProject ?? null,
        };
      } catch (error) {
        return {
          configured: true,
          member: null,
          error: error instanceof Error ? error.message : String(error),
          defaultProjectId: values.defaultProject ?? null,
        };
      }
    },
    async listAssigned({ query = "", includeCompleted, refresh = false }) {
      const values = await settings.get();
      const result = await assigned(
        includeCompleted ?? values.includeCompleted,
        refresh,
      );
      return { member: result.member, stories: filterStories(result.stories, query) };
    },
    async getStory({ id }) {
      return (await client()).getStoryDetail(id);
    },
    async updateStoryWorkflowState({ id, workflowStateId }) {
      const updatedStory = await (await client()).updateStoryWorkflowState(
        id,
        workflowStateId,
      );
      cached = null;
      bb.realtime.publish("stories-changed", { reason: "workflow-state" });
      return { story: updatedStory };
    },
    async reorderStory({ id, adjacentId, placement }) {
      if (id === adjacentId) {
        throw new Error("A story cannot be reordered relative to itself.");
      }
      const position = await (await client()).reorderStory(id, adjacentId, placement);
      cached = null;
      bb.realtime.publish("stories-changed", { reason: "reorder" });
      return { position };
    },
    async startWork({ id, projectId }) {
      const values = await settings.get();
      const targetProjectId = projectId ?? values.defaultProject;
      if (!targetProjectId) {
        throw new Error(
          "Choose a default bb project in the Shortcut plugin settings before starting work.",
        );
      }
      const item = await (await client()).moveStoryToInDevelopment(id);
      cached = null;
      bb.realtime.publish("stories-changed", { reason: "start-work" });
      const thread = await bb.sdk.threads.spawn({
        projectId: targetProjectId,
        environment: { type: "project-default" },
        title: `sc-${item.id}: ${item.name}`,
        prompt: `${storyAsMarkdown(item)}\n\nPlease investigate this Shortcut story and implement the requested work. Verify the result and report changed files, validation, and any blockers.`,
      });
      return { threadId: thread.id };
    },
  });

  bb.cli.register({
    name: "shortcut",
    summary: "Read Shortcut stories assigned to you",
    commands: [
      { name: "status", summary: "Check Shortcut authentication", usage: "bb shortcut status [--json]" },
      { name: "list", summary: "List stories assigned to you", usage: "bb shortcut list [query] [--completed] [--json]" },
      { name: "show", summary: "Show one story", usage: "bb shortcut show <story-id> [--json]" },
    ],
    async run(argv, ctx) {
      const command = argv[0] ?? "list";
      const json = argv.includes("--json");
      try {
        if (command === "status") {
          const values = await settings.get();
          if (!values.apiToken) {
            const result = { configured: false };
            return { exitCode: 1, stdout: json ? JSON.stringify(result, null, 2) : "Shortcut is not configured." };
          }
          const member = await (await client()).currentMember(ctx.signal);
          return { exitCode: 0, stdout: json ? JSON.stringify({ configured: true, member }, null, 2) : `Authenticated as ${member.name} in ${member.workspaceName}.` };
        }
        if (command === "show") {
          const id = parseStoryId(argv[1]);
          if (!id) return { exitCode: 2, stderr: "Usage: bb shortcut show <story-id> [--json]" };
          const item = await story(id, ctx.signal);
          return { exitCode: 0, stdout: json ? JSON.stringify(item, null, 2) : storyAsMarkdown(item) };
        }
        if (command === "list") {
          const values = await settings.get();
          const includeCompleted = argv.includes("--completed") || values.includeCompleted;
          const query = argv.slice(1).filter((arg) => !arg.startsWith("--")).join(" ");
          const result = await assigned(includeCompleted, false, ctx.signal);
          const stories = filterStories(result.stories, query);
          return { exitCode: 0, stdout: json ? JSON.stringify({ member: result.member, stories }, null, 2) : formatStoryList(stories) };
        }
        return { exitCode: 2, stderr: "Usage: bb shortcut <status|list|show>" };
      } catch (error) {
        return { exitCode: 1, stderr: error instanceof Error ? error.message : String(error) };
      }
    },
  });

  bb.agents.registerTool({
    name: "shortcut_list_assigned",
    description: "List Shortcut stories assigned to the authenticated user.",
    instructions: "Use this when the user asks about their assigned Shortcut work.",
    experimental_statusLabels: {
      pending: "Reading assigned Shortcut stories",
      completed: "Read assigned Shortcut stories",
    },
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string" },
        includeCompleted: { type: "boolean" },
      },
    },
    async execute(params, { signal }) {
      const { query = "", includeCompleted } = params as { query?: string; includeCompleted?: boolean };
      const values = await settings.get();
      const result = await assigned(includeCompleted ?? values.includeCompleted, false, signal);
      return JSON.stringify(filterStories(result.stories, query), null, 2);
    },
  });

  bb.agents.registerTool({
    name: "shortcut_get_story",
    description: "Read a Shortcut story by numeric id, including description and tasks.",
    experimental_statusLabels: {
      pending: "Reading Shortcut story",
      completed: "Read Shortcut story",
    },
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "integer", minimum: 1 },
      },
      required: ["id"],
    },
    async execute(params, { signal }) {
      const { id } = params as { id: number };
      return storyAsMarkdown(await story(id, signal));
    },
  });

  bb.agents.configure(() => ({
    tools: ["shortcut_list_assigned", "shortcut_get_story"],
    skills: ["shortcut-stories"],
  }));

  bb.ui.registerMentionProvider({
    id: "story",
    label: "Shortcut stories",
    triggers: ["#", "@"],
    async search({ query }) {
      const values = await settings.get();
      if (!values.apiToken) return [];
      const result = await assigned(values.includeCompleted);
      return filterStories(result.stories, query).slice(0, 8).map((item) => ({
        id: String(item.id),
        title: `sc-${item.id} ${item.name}`,
        subtitle: item.workflowState.name,
        icon: "Ticket",
      }));
    },
    async resolve(itemId) {
      const id = parseStoryId(itemId);
      if (!id) throw new Error(`Invalid Shortcut story id: ${itemId}`);
      return { context: storyAsMarkdown(await story(id)) };
    },
  });
}
