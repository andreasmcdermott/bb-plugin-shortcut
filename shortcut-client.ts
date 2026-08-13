const DEFAULT_BASE_URL = "https://api.app.shortcut.com/api/v3";
const REQUEST_TIMEOUT_MS = 15_000;
const IN_DEVELOPMENT_STATE_NAME = "In Development";

export interface ShortcutMember {
  id: string;
  name: string;
  mentionName: string;
  workspaceName: string;
}

export interface ShortcutWorkflowState {
  id: number;
  name: string;
  type: string;
  position: number;
  workflowId: number;
  workflowName: string;
}

export interface ShortcutTask {
  id: number;
  description: string;
  complete: boolean;
}

export interface ShortcutStory {
  id: number;
  position: number;
  name: string;
  description: string;
  appUrl: string;
  archived: boolean;
  completed: boolean;
  started: boolean;
  blocked: boolean;
  blocker: boolean;
  storyType: string;
  workflowState: ShortcutWorkflowState;
  labels: string[];
  estimate: number | null;
  deadline: string | null;
  createdAt: string;
  updatedAt: string;
  tasks: ShortcutTask[];
}

export type StoryPlacement = "before" | "after";

interface ApiMember {
  id?: unknown;
  name?: unknown;
  mention_name?: unknown;
  workspace2?: { name?: unknown };
}

interface ApiWorkflowState {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  position?: unknown;
}

interface ApiWorkflow {
  id?: unknown;
  name?: unknown;
  states?: ApiWorkflowState[];
}

interface ApiStory {
  id?: unknown;
  position?: unknown;
  name?: unknown;
  description?: unknown;
  app_url?: unknown;
  archived?: unknown;
  completed?: unknown;
  started?: unknown;
  blocked?: unknown;
  blocker?: unknown;
  story_type?: unknown;
  workflow_state_id?: unknown;
  labels?: Array<{ name?: unknown }>;
  estimate?: unknown;
  deadline?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  tasks?: Array<{ id?: unknown; description?: unknown; complete?: unknown }>;
}

export class ShortcutApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "ShortcutApiError";
  }
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function number(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function boolean(value: unknown): boolean {
  return value === true;
}

function combineSignals(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export class ShortcutClient {
  private readonly baseUrl: string;

  constructor(
    private readonly token: string,
    baseUrl = DEFAULT_BASE_URL,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    signal?: AbortSignal,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Shortcut-Token": this.token,
          ...init.headers,
        },
        signal: combineSignals(signal),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new ShortcutApiError("Shortcut request timed out or was cancelled.");
      }
      throw new ShortcutApiError(
        `Could not reach Shortcut: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!response.ok) {
      const detail = (await response.text()).trim().slice(0, 500);
      const suffix = detail ? `: ${detail}` : "";
      throw new ShortcutApiError(
        `Shortcut API returned ${response.status}${suffix}`,
        response.status,
      );
    }

    return (await response.json()) as T;
  }

  async currentMember(signal?: AbortSignal): Promise<ShortcutMember> {
    const member = await this.request<ApiMember>("/member", {}, signal);
    const id = text(member.id);
    if (!id) throw new ShortcutApiError("Shortcut did not return a member id.");
    return {
      id,
      name: text(member.name, "Shortcut member"),
      mentionName: text(member.mention_name),
      workspaceName: text(member.workspace2?.name),
    };
  }

  private async workflowStates(
    signal?: AbortSignal,
  ): Promise<Map<number, ShortcutWorkflowState>> {
    const workflows = await this.request<ApiWorkflow[]>("/workflows", {}, signal);
    const states = new Map<number, ShortcutWorkflowState>();
    for (const workflow of workflows) {
      const workflowId = number(workflow.id);
      const workflowName = text(workflow.name, "Unknown workflow");
      for (const raw of workflow.states ?? []) {
        const id = number(raw.id);
        if (!id) continue;
        states.set(id, {
          id,
          name: text(raw.name, "Unknown state"),
          type: text(raw.type, "unknown"),
          position: number(raw.position, Number.MAX_SAFE_INTEGER),
          workflowId,
          workflowName,
        });
      }
    }
    return states;
  }

  private normalizeStory(
    raw: ApiStory,
    states: Map<number, ShortcutWorkflowState>,
  ): ShortcutStory {
    const stateId = number(raw.workflow_state_id);
    return {
      id: number(raw.id),
      position: number(raw.position, Number.MAX_SAFE_INTEGER),
      name: text(raw.name, "Untitled story"),
      description: text(raw.description),
      appUrl: text(raw.app_url),
      archived: boolean(raw.archived),
      completed: boolean(raw.completed),
      started: boolean(raw.started),
      blocked: boolean(raw.blocked),
      blocker: boolean(raw.blocker),
      storyType: text(raw.story_type, "feature"),
      workflowState: states.get(stateId) ?? {
        id: stateId,
        name: "Unknown state",
        type: "unknown",
        position: Number.MAX_SAFE_INTEGER,
        workflowId: 0,
        workflowName: "Unknown workflow",
      },
      labels: (raw.labels ?? []).map((label) => text(label.name)).filter(Boolean),
      estimate: typeof raw.estimate === "number" ? raw.estimate : null,
      deadline: typeof raw.deadline === "string" ? raw.deadline : null,
      createdAt: text(raw.created_at),
      updatedAt: text(raw.updated_at),
      tasks: (raw.tasks ?? []).map((task) => ({
        id: number(task.id),
        description: text(task.description),
        complete: boolean(task.complete),
      })),
    };
  }

  private async storyWithWorkflowStates(
    id: number,
    signal?: AbortSignal,
  ): Promise<{
    states: Map<number, ShortcutWorkflowState>;
    story: ShortcutStory;
  }> {
    const [states, rawStory] = await Promise.all([
      this.workflowStates(signal),
      this.request<ApiStory>(`/stories/${id}`, {}, signal),
    ]);
    return { states, story: this.normalizeStory(rawStory, states) };
  }

  private async putStoryWorkflowState(
    id: number,
    targetState: ShortcutWorkflowState,
    states: Map<number, ShortcutWorkflowState>,
    signal?: AbortSignal,
  ): Promise<ShortcutStory> {
    const updated = await this.request<ApiStory>(
      `/stories/${id}`,
      {
        method: "PUT",
        body: JSON.stringify({ workflow_state_id: targetState.id }),
      },
      signal,
    );
    return this.normalizeStory(updated, states);
  }

  async listAssignedStories(
    includeCompleted = false,
    signal?: AbortSignal,
  ): Promise<{ member: ShortcutMember; stories: ShortcutStory[] }> {
    const member = await this.currentMember(signal);
    const [states, stories] = await Promise.all([
      this.workflowStates(signal),
      this.request<ApiStory[]>(
        "/stories/search",
        {
          method: "POST",
          body: JSON.stringify({
            owner_id: member.id,
            archived: false,
            includes_description: true,
            ...(includeCompleted
              ? {}
              : { workflow_state_types: ["backlog", "unstarted", "started"] }),
          }),
        },
        signal,
      ),
    ]);

    return {
      member,
      stories: stories
        .map((story) => this.normalizeStory(story, states))
        .filter((story) => story.id > 0)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    };
  }

  async getStory(id: number, signal?: AbortSignal): Promise<ShortcutStory> {
    return (await this.getStoryDetail(id, signal)).story;
  }

  async getStoryDetail(
    id: number,
    signal?: AbortSignal,
  ): Promise<{ story: ShortcutStory; workflowStates: ShortcutWorkflowState[] }> {
    const { states, story } = await this.storyWithWorkflowStates(id, signal);
    return {
      story,
      workflowStates: [...states.values()]
        .filter((state) => state.workflowId === story.workflowState.workflowId)
        .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)),
    };
  }

  async updateStoryWorkflowState(
    id: number,
    workflowStateId: number,
    signal?: AbortSignal,
  ): Promise<ShortcutStory> {
    const { states, story } = await this.storyWithWorkflowStates(id, signal);
    const targetState = states.get(workflowStateId);
    if (!targetState || targetState.workflowId !== story.workflowState.workflowId) {
      throw new ShortcutApiError(
        `Workflow state ${workflowStateId} does not belong to the story's workflow.`,
      );
    }
    if (targetState.id === story.workflowState.id) return story;

    return this.putStoryWorkflowState(id, targetState, states, signal);
  }

  async reorderStory(
    id: number,
    adjacentId: number,
    placement: StoryPlacement,
    signal?: AbortSignal,
  ): Promise<number> {
    const updated = await this.request<ApiStory>(
      `/stories/${id}`,
      {
        method: "PUT",
        body: JSON.stringify(
          placement === "before"
            ? { before_id: adjacentId }
            : { after_id: adjacentId },
        ),
      },
      signal,
    );
    const position = number(updated.position, -1);
    if (position < 0) {
      throw new ShortcutApiError("Shortcut did not return the story's new position.");
    }
    return position;
  }

  async moveStoryToInDevelopment(
    id: number,
    signal?: AbortSignal,
  ): Promise<ShortcutStory> {
    const { states, story } = await this.storyWithWorkflowStates(id, signal);
    const normalizedTargetName = IN_DEVELOPMENT_STATE_NAME.toLowerCase();

    if (story.workflowState.name.trim().toLowerCase() === normalizedTargetName) {
      return story;
    }

    const targetState = [...states.values()].find((state) =>
      state.workflowId === story.workflowState.workflowId &&
      state.name.trim().toLowerCase() === normalizedTargetName
    );
    if (!targetState) {
      throw new ShortcutApiError(
        `Shortcut workflow "${story.workflowState.workflowName}" has no "${IN_DEVELOPMENT_STATE_NAME}" state.`,
      );
    }

    return this.putStoryWorkflowState(id, targetState, states, signal);
  }
}

export function storyAsMarkdown(story: ShortcutStory): string {
  const labels = story.labels.length ? story.labels.join(", ") : "none";
  const taskLines = story.tasks.length
    ? story.tasks.map((task) => `- [${task.complete ? "x" : " "}] ${task.description}`).join("\n")
    : "No tasks.";
  return [
    `# sc-${story.id}: ${story.name}`,
    "",
    `- State: ${story.workflowState.name}`,
    `- Type: ${story.storyType}`,
    `- Estimate: ${story.estimate ?? "unestimated"}`,
    `- Labels: ${labels}`,
    `- URL: ${story.appUrl}`,
    "",
    story.description || "No description.",
    "",
    "## Tasks",
    "",
    taskLines,
  ].join("\n");
}
