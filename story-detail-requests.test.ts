import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import type { ShortcutStory, ShortcutWorkflowState } from "./shortcut-client";
import {
  requestWorkflowStateUpdate,
  StoryDetailRequestGuard,
} from "./story-detail-requests";

const readyState: ShortcutWorkflowState = {
  id: 10,
  name: "Ready",
  type: "unstarted",
  position: 1,
  workflowId: 7,
  workflowName: "Product",
};

const buildingState: ShortcutWorkflowState = {
  ...readyState,
  id: 11,
  name: "Building",
  type: "started",
  position: 2,
};

function story(workflowState = readyState): ShortcutStory {
  return {
    id: 42,
    position: 1,
    name: "Editable workflow state",
    description: "",
    appUrl: "",
    archived: false,
    completed: false,
    started: workflowState.type === "started",
    blocked: false,
    blocker: false,
    storyType: "feature",
    workflowState,
    labels: [],
    estimate: null,
    deadline: null,
    createdAt: "",
    updatedAt: "",
    tasks: [],
  };
}

describe("requestWorkflowStateUpdate", () => {
  it("sends the selected state and returns the updated story", async () => {
    const updatedStory = story(buildingState);
    const call = vi.fn(async () => ({ story: updatedStory }));

    const result = await requestWorkflowStateUpdate(
      { call },
      story(),
      buildingState,
    );

    expect(call).toHaveBeenCalledWith("updateStoryWorkflowState", {
      id: 42,
      workflowStateId: 11,
    });
    expect(result).toEqual({ ok: true, story: updatedStory });
  });

  it("propagates an update failure without changing the current story", async () => {
    const currentStory = story();
    const error = new Error("Shortcut rejected the update");
    const call = vi.fn(async () => { throw error; });

    expect(
      await requestWorkflowStateUpdate({ call }, currentStory, buildingState),
    ).toEqual({ ok: false, error });
    expect(currentStory.workflowState).toBe(readyState);
  });
});

describe("StoryDetailRequestGuard", () => {
  it("rejects a load that finishes after navigating to another story", () => {
    const guard = new StoryDetailRequestGuard(41);
    const story41Load = guard.begin(41);

    guard.activate(42);

    expect(guard.isCurrent(story41Load)).toBe(false);
  });

  it("keeps only the latest refresh for the active story", () => {
    const guard = new StoryDetailRequestGuard(42);
    const initialLoad = guard.begin(42);
    const realtimeRefresh = guard.begin(42);

    expect(guard.isCurrent(initialLoad)).toBe(false);
    expect(guard.isCurrent(realtimeRefresh)).toBe(true);
  });

  it("invalidates an in-flight request when the view unmounts", () => {
    const guard = new StoryDetailRequestGuard(42);
    const request = guard.begin(42);

    guard.invalidate();

    expect(guard.isCurrent(request)).toBe(false);
  });

  it("rejects an operation from an earlier activation of the same story", () => {
    const guard = new StoryDetailRequestGuard(41);
    const firstStory41Activation = guard.captureActivation();

    guard.activate(42);
    guard.activate(41);

    expect(guard.isActive(firstStory41Activation)).toBe(false);
    expect(guard.isActive(guard.captureActivation())).toBe(true);
  });
});
