import type { ShortcutStory } from "./shortcut-client";

export interface StoryColumn {
  key: string;
  name: string;
  type: string;
  position: number;
  stories: ShortcutStory[];
}

export interface WorkflowSummary {
  id: number;
  name: string;
  storyCount: number;
}

export type StoryDropEdge = "before" | "after";

const AUTO_SCROLL_EDGE_PX = 64;
const AUTO_SCROLL_MAX_PX = 18;

const STATE_TYPE_ORDER: Record<string, number> = {
  backlog: 0,
  unstarted: 1,
  started: 2,
  done: 3,
};

export function groupStoriesByState(stories: ShortcutStory[]): StoryColumn[] {
  const columns = new Map<string, StoryColumn & { positionTotal: number }>();
  for (const story of stories) {
    // Workspaces can have several workflows with equivalent state names.
    // Merge those into one useful board column instead of rendering duplicate
    // headings such as "Ready for Deploy" twice.
    const key = `${story.workflowState.type}:${story.workflowState.name.toLowerCase()}`;
    const existing = columns.get(key);
    if (existing) {
      existing.stories.push(story);
      existing.positionTotal += story.workflowState.position;
      existing.position = existing.positionTotal / existing.stories.length;
    } else {
      columns.set(key, {
        key,
        name: story.workflowState.name,
        type: story.workflowState.type,
        position: story.workflowState.position,
        positionTotal: story.workflowState.position,
        stories: [story],
      });
    }
  }

  for (const column of columns.values()) {
    column.stories.sort((a, b) =>
      a.position - b.position ||
      b.updatedAt.localeCompare(a.updatedAt) ||
      a.id - b.id
    );
  }

  return [...columns.values()].sort((a, b) => {
    const position = a.position - b.position;
    const rank = (STATE_TYPE_ORDER[a.type] ?? 99) - (STATE_TYPE_ORDER[b.type] ?? 99);
    return position || rank || a.name.localeCompare(b.name);
  });
}

export function workflowsForStories(stories: ShortcutStory[]): WorkflowSummary[] {
  const workflows = new Map<number, WorkflowSummary>();
  for (const story of stories) {
    const { workflowId, workflowName } = story.workflowState;
    const existing = workflows.get(workflowId);
    if (existing) {
      existing.storyCount += 1;
    } else {
      workflows.set(workflowId, {
        id: workflowId,
        name: workflowName,
        storyCount: 1,
      });
    }
  }
  return [...workflows.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function reorderStories(
  stories: ShortcutStory[],
  draggedId: number,
  targetId: number,
  edge: StoryDropEdge,
): ShortcutStory[] {
  if (draggedId === targetId) return stories;
  const dragged = stories.find((story) => story.id === draggedId);
  if (!dragged) return stories;

  const withoutDragged = stories.filter((story) => story.id !== draggedId);
  const targetIndex = withoutDragged.findIndex((story) => story.id === targetId);
  if (targetIndex < 0) return stories;

  const insertionIndex = edge === "before" ? targetIndex : targetIndex + 1;
  const reordered = [...withoutDragged];
  reordered.splice(insertionIndex, 0, dragged);
  return reordered;
}

export function dragAutoScrollDelta(
  pointerY: number,
  containerTop: number,
  containerBottom: number,
): number {
  const height = containerBottom - containerTop;
  if (height <= 0) return 0;
  const edge = Math.min(AUTO_SCROLL_EDGE_PX, height / 2);

  if (pointerY < containerTop + edge) {
    const intensity = Math.min(1, (containerTop + edge - pointerY) / edge);
    return -Math.max(1, Math.round(AUTO_SCROLL_MAX_PX * intensity));
  }
  if (pointerY > containerBottom - edge) {
    const intensity = Math.min(1, (pointerY - (containerBottom - edge)) / edge);
    return Math.max(1, Math.round(AUTO_SCROLL_MAX_PX * intensity));
  }
  return 0;
}
