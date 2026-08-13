import type { ShortcutStory, ShortcutWorkflowState } from "./shortcut-client";

export interface WorkflowStateUpdateRpc {
  call(
    method: "updateStoryWorkflowState",
    input: { id: number; workflowStateId: number },
  ): Promise<{ story: ShortcutStory }>;
}

export type WorkflowStateUpdateResult =
  | { ok: true; story: ShortcutStory }
  | { ok: false; error: Error };

export async function requestWorkflowStateUpdate(
  rpc: WorkflowStateUpdateRpc,
  story: ShortcutStory,
  state: ShortcutWorkflowState,
): Promise<WorkflowStateUpdateResult> {
  try {
    const result = await rpc.call("updateStoryWorkflowState", {
      id: story.id,
      workflowStateId: state.id,
    });
    return { ok: true, story: result.story };
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error ? cause : new Error(String(cause)),
    };
  }
}

export interface StoryDetailRequest {
  storyId: number;
  generation: number;
}

export interface StoryActivation {
  storyId: number;
  generation: number;
}

export class StoryDetailRequestGuard {
  private activeStoryId: number;
  private activationGeneration = 0;
  private generation = 0;

  constructor(storyId: number) {
    this.activeStoryId = storyId;
  }

  activate(storyId: number): void {
    if (storyId === this.activeStoryId) return;
    this.activeStoryId = storyId;
    ++this.activationGeneration;
    this.invalidate();
  }

  begin(storyId: number): StoryDetailRequest {
    this.activate(storyId);
    return { storyId, generation: ++this.generation };
  }

  invalidate(): void {
    ++this.generation;
  }

  isCurrent(request: StoryDetailRequest): boolean {
    return request.storyId === this.activeStoryId &&
      request.generation === this.generation;
  }

  captureActivation(): StoryActivation {
    return {
      storyId: this.activeStoryId,
      generation: this.activationGeneration,
    };
  }

  isActive(activation: StoryActivation): boolean {
    return activation.storyId === this.activeStoryId &&
      activation.generation === this.activationGeneration;
  }
}
