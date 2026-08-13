import { afterEach, describe, expect, it, vi } from "vitest";
import { ShortcutClient, storyAsMarkdown } from "./shortcut-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ShortcutClient", () => {
  it("loads the authenticated member without exposing the token in the URL", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      id: "member-1",
      name: "Ari Agent",
      mention_name: "ari",
      workspace2: { name: "Example" },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const member = await new ShortcutClient("secret-token").currentMember();

    expect(member).toEqual({
      id: "member-1",
      name: "Ari Agent",
      mentionName: "ari",
      workspaceName: "Example",
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://api.app.shortcut.com/api/v3/member");
    expect(String(url)).not.toContain("secret-token");
    expect(new Headers(init?.headers).get("Shortcut-Token")).toBe("secret-token");
  });

  it("queries non-completed stories owned by the current member", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/member")) {
        return new Response(JSON.stringify({ id: "member-1", name: "Ari" }));
      }
      if (url.endsWith("/workflows")) {
        return new Response(JSON.stringify([{ id: 7, name: "Product", states: [
          { id: 10, name: "In Progress", type: "started", position: 2 },
        ] }]));
      }
      if (url.endsWith("/stories/search")) {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toEqual({
          owner_id: "member-1",
          archived: false,
          includes_description: true,
          workflow_state_types: ["backlog", "unstarted", "started"],
        });
        return new Response(JSON.stringify([{
          id: 42,
          position: 125,
          name: "Ship the Shortcut plugin",
          description: "Make stories visible in bb.",
          app_url: "https://app.shortcut.com/example/story/42",
          story_type: "feature",
          workflow_state_id: 10,
          labels: [{ name: "bb" }],
          estimate: 3,
          tasks: [{ id: 1, description: "Build it", complete: true }],
          updated_at: "2026-08-10T12:00:00Z",
          created_at: "2026-08-09T12:00:00Z",
        }]));
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new ShortcutClient("token").listAssignedStories();

    expect(result.stories).toHaveLength(1);
    expect(result.stories[0]).toMatchObject({
      id: 42,
      position: 125,
      workflowState: {
        id: 10,
        name: "In Progress",
        type: "started",
        position: 2,
        workflowId: 7,
        workflowName: "Product",
      },
      labels: ["bb"],
      estimate: 3,
    });
    expect(storyAsMarkdown(result.stories[0]!)).toContain("# sc-42: Ship the Shortcut plugin");
    expect(storyAsMarkdown(result.stories[0]!)).toContain("- [x] Build it");
  });

  it("moves a story to In Development in its own workflow", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/workflows")) {
        return new Response(JSON.stringify([
          { id: 7, name: "Product", states: [
            { id: 10, name: "Ready", type: "unstarted", position: 1 },
            { id: 11, name: "In Development", type: "started", position: 2 },
          ] },
          { id: 8, name: "Support", states: [
            { id: 21, name: "In Development", type: "started", position: 2 },
          ] },
        ]));
      }
      if (url.endsWith("/stories/42") && init?.method === "PUT") {
        expect(JSON.parse(String(init.body))).toEqual({ workflow_state_id: 11 });
        return new Response(JSON.stringify({
          id: 42,
          position: 125,
          name: "Ship the Shortcut plugin",
          workflow_state_id: 11,
        }));
      }
      if (url.endsWith("/stories/42")) {
        return new Response(JSON.stringify({
          id: 42,
          position: 125,
          name: "Ship the Shortcut plugin",
          workflow_state_id: 10,
        }));
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const story = await new ShortcutClient("token").moveStoryToInDevelopment(42);

    expect(story.workflowState).toMatchObject({
      id: 11,
      name: "In Development",
      workflowId: 7,
    });
  });

  it("lists a story's workflow states in workflow order", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/workflows")) {
        return new Response(JSON.stringify([
          { id: 7, name: "Product", states: [
            { id: 12, name: "Done", type: "done", position: 3 },
            { id: 10, name: "Ready", type: "unstarted", position: 1 },
            { id: 11, name: "Building", type: "started", position: 2 },
          ] },
          { id: 8, name: "Support", states: [
            { id: 20, name: "Queued", type: "unstarted", position: 1 },
          ] },
        ]));
      }
      if (url.endsWith("/stories/42")) {
        return new Response(JSON.stringify({
          id: 42,
          name: "Ship the Shortcut plugin",
          workflow_state_id: 11,
        }));
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const detail = await new ShortcutClient("token").getStoryDetail(42);

    expect(detail.story.workflowState.name).toBe("Building");
    expect(detail.workflowStates.map((state) => state.name)).toEqual([
      "Ready",
      "Building",
      "Done",
    ]);
  });

  it("updates a story to a state in its own workflow", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/workflows")) {
        return new Response(JSON.stringify([{ id: 7, name: "Product", states: [
          { id: 10, name: "Ready", type: "unstarted", position: 1 },
          { id: 11, name: "Building", type: "started", position: 2 },
        ] }]));
      }
      if (url.endsWith("/stories/42") && init?.method === "PUT") {
        expect(JSON.parse(String(init.body))).toEqual({ workflow_state_id: 11 });
        return new Response(JSON.stringify({
          id: 42,
          name: "Ship the Shortcut plugin",
          workflow_state_id: 11,
        }));
      }
      if (url.endsWith("/stories/42")) {
        return new Response(JSON.stringify({
          id: 42,
          name: "Ship the Shortcut plugin",
          workflow_state_id: 10,
        }));
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const story = await new ShortcutClient("token").updateStoryWorkflowState(42, 11);

    expect(story.workflowState).toMatchObject({ id: 11, name: "Building" });
  });

  it("rejects a workflow state from another workflow", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(init?.method).not.toBe("PUT");
      if (url.endsWith("/workflows")) {
        return new Response(JSON.stringify([
          { id: 7, name: "Product", states: [
            { id: 10, name: "Ready", type: "unstarted", position: 1 },
          ] },
          { id: 8, name: "Support", states: [
            { id: 20, name: "Queued", type: "unstarted", position: 1 },
          ] },
        ]));
      }
      if (url.endsWith("/stories/42")) {
        return new Response(JSON.stringify({
          id: 42,
          name: "Ship the Shortcut plugin",
          workflow_state_id: 10,
        }));
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new ShortcutClient("token").updateStoryWorkflowState(42, 20),
    ).rejects.toThrow("does not belong to the story's workflow");
  });

  it("reorders a story relative to an adjacent story", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.app.shortcut.com/api/v3/stories/42");
      expect(init?.method).toBe("PUT");
      expect(JSON.parse(String(init?.body))).toEqual({ before_id: 41 });
      return new Response(JSON.stringify({ id: 42, position: 125 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const position = await new ShortcutClient("token").reorderStory(
      42,
      41,
      "before",
    );

    expect(position).toBe(125);
  });

  it("does not update a story when its workflow has no In Development state", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(init?.method).not.toBe("PUT");
      if (url.endsWith("/workflows")) {
        return new Response(JSON.stringify([{ id: 7, name: "Product", states: [
          { id: 10, name: "Ready", type: "unstarted", position: 1 },
        ] }]));
      }
      if (url.endsWith("/stories/42")) {
        return new Response(JSON.stringify({
          id: 42,
          name: "Ship the Shortcut plugin",
          workflow_state_id: 10,
        }));
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new ShortcutClient("token").moveStoryToInDevelopment(42),
    ).rejects.toThrow('Shortcut workflow "Product" has no "In Development" state.');
  });
});
