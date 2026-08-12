import { describe, expect, it } from "vitest";
import {
  dragAutoScrollDelta,
  groupStoriesByState,
  reorderStories,
  workflowsForStories,
} from "./kanban";
import type { ShortcutStory } from "./shortcut-client";

function story(
  id: number,
  stateId: number,
  stateName: string,
  stateType: string,
  position: number,
  workflowId = 1,
  workflowName = "Product",
  storyPosition = id,
): ShortcutStory {
  return {
    id,
    position: storyPosition,
    name: `Story ${id}`,
    description: "",
    appUrl: "",
    archived: false,
    completed: stateType === "done",
    started: stateType === "started",
    blocked: false,
    blocker: false,
    storyType: "feature",
    workflowState: {
      id: stateId,
      name: stateName,
      type: stateType,
      position,
      workflowId,
      workflowName,
    },
    labels: [],
    estimate: null,
    deadline: null,
    createdAt: "",
    updatedAt: "",
    tasks: [],
  };
}

describe("groupStoriesByState", () => {
  it("groups cards by state and orders the workflow from backlog to done", () => {
    const columns = groupStoriesByState([
      story(3, 30, "Done", "done", 3),
      story(1, 10, "Ready", "unstarted", 1),
      story(2, 20, "Building", "started", 2),
      story(4, 20, "Building", "started", 2),
      story(5, 21, "Building", "started", 4),
    ]);

    expect(columns.map((column) => column.name)).toEqual(["Ready", "Building", "Done"]);
    expect(columns[1]?.stories.map((item) => item.id)).toEqual([2, 4, 5]);
  });

  it("orders cards within a column by Shortcut's manual story position", () => {
    const columns = groupStoriesByState([
      story(1, 20, "Building", "started", 2, 1, "Product", 300),
      story(2, 20, "Building", "started", 2, 1, "Product", 100),
      story(3, 20, "Building", "started", 2, 1, "Product", 200),
    ]);

    expect(columns[0]?.stories.map((item) => item.id)).toEqual([2, 3, 1]);
  });

  it("uses the story-weighted position when equivalent states span workflows", () => {
    const readyFromEarlyWorkflow = Array.from(
      { length: 2 },
      (_, index) => story(index + 1, 100, "Ready for Deploy", "started", 3),
    );
    const waitingForReview = Array.from(
      { length: 2 },
      (_, index) => story(index + 10, 200, "Waiting for Review", "started", 6),
    );
    const readyFromMainWorkflow = Array.from(
      { length: 10 },
      (_, index) => story(index + 20, 300, "Ready for Deploy", "started", 8),
    );

    const columns = groupStoriesByState([
      ...readyFromEarlyWorkflow,
      ...waitingForReview,
      ...readyFromMainWorkflow,
    ]);

    expect(columns.map((column) => column.name)).toEqual([
      "Waiting for Review",
      "Ready for Deploy",
    ]);
  });

  it("summarizes stories into stable workflow tabs", () => {
    const workflows = workflowsForStories([
      story(1, 10, "Ready", "unstarted", 1, 2, "Backend"),
      story(2, 20, "Building", "started", 2, 1, "App"),
      story(3, 20, "Building", "started", 2, 1, "App"),
    ]);

    expect(workflows).toEqual([
      { id: 1, name: "App", storyCount: 2 },
      { id: 2, name: "Backend", storyCount: 1 },
    ]);
  });
});

describe("reorderStories", () => {
  const stories = [
    story(1, 20, "Building", "started", 2),
    story(2, 20, "Building", "started", 2),
    story(3, 20, "Building", "started", 2),
  ];

  it("moves a story before a target", () => {
    expect(reorderStories(stories, 3, 1, "before").map((item) => item.id))
      .toEqual([3, 1, 2]);
  });

  it("moves a story after a target", () => {
    expect(reorderStories(stories, 1, 3, "after").map((item) => item.id))
      .toEqual([2, 3, 1]);
  });

  it("keeps the original array when the drop cannot change its order", () => {
    expect(reorderStories(stories, 2, 2, "before")).toBe(stories);
  });
});

describe("dragAutoScrollDelta", () => {
  it("does not scroll while the pointer is away from either edge", () => {
    expect(dragAutoScrollDelta(250, 100, 400)).toBe(0);
  });

  it("scrolls upward faster as the pointer approaches the top", () => {
    expect(dragAutoScrollDelta(150, 100, 400)).toBeLessThan(0);
    expect(dragAutoScrollDelta(100, 100, 400)).toBeLessThan(
      dragAutoScrollDelta(150, 100, 400),
    );
  });

  it("scrolls downward faster as the pointer approaches the bottom", () => {
    expect(dragAutoScrollDelta(350, 100, 400)).toBeGreaterThan(0);
    expect(dragAutoScrollDelta(400, 100, 400)).toBeGreaterThan(
      dragAutoScrollDelta(350, 100, 400),
    );
  });
});
