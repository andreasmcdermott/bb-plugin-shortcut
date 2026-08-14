import {
  type DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Markdown,
  definePluginApp,
  useBbContext,
  useBbNavigate,
  useRealtime,
  useRpc,
} from "@bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "./server";
import type {
  ShortcutMember,
  ShortcutStory as Story,
  ShortcutWorkflowState,
} from "./shortcut-client";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  dragAutoScrollDelta,
  groupStoriesByState,
  reorderStories,
  type StoryDropEdge,
  workflowsForStories,
} from "./kanban";
import { shortcutStoryIdFromUrl, shortcutStoryPluginPath } from "./shortcut-links";
import {
  requestWorkflowStateUpdate,
  StoryDetailRequestGuard,
} from "./story-detail-requests";

type AssignedResult = { member: ShortcutMember; stories: Story[] };

function relativeTime(value: string): string {
  if (!value) return "";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const ranges: Array<[number, Intl.RelativeTimeFormatUnit]> = [
    [60, "second"],
    [60, "minute"],
    [24, "hour"],
    [7, "day"],
    [4.345, "week"],
    [12, "month"],
    [Number.POSITIVE_INFINITY, "year"],
  ];
  let amount = seconds;
  for (const [size, unit] of ranges) {
    if (Math.abs(amount) < size) return formatter.format(Math.round(amount), unit);
    amount /= size;
  }
  return value;
}

function ErrorNotice({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive-text">
      {message}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="h-20 animate-pulse rounded-lg border border-border bg-muted/50" />
      ))}
    </div>
  );
}

function KanbanSkeleton() {
  return (
    <div className="flex h-full min-w-max gap-3" aria-label="Loading Kanban board">
      {[3, 4, 2].map((cardCount, columnIndex) => (
        <section
          key={columnIndex}
          className="flex h-full w-72 shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-muted/30"
        >
          <div className="flex h-9 items-center justify-between border-b border-border px-2.5">
            <div className="h-3 w-28 animate-pulse rounded bg-muted" />
            <div className="h-5 w-6 animate-pulse rounded-full bg-muted" />
          </div>
          <div className="space-y-1.5 p-1.5">
            {Array.from({ length: cardCount }, (_, cardIndex) => (
              <div
                key={cardIndex}
                className="h-24 animate-pulse rounded-md border border-border bg-card"
              >
                <div className="space-y-2 p-2.5">
                  <div className="h-2.5 w-16 rounded bg-muted" />
                  <div className="h-3 w-4/5 rounded bg-muted" />
                  <div className="h-2.5 w-full rounded bg-muted" />
                  <div className="h-2.5 w-2/3 rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function WorkflowStatePicker({
  story,
  states,
  updating,
  onChange,
}: {
  story: Story;
  states: ShortcutWorkflowState[];
  updating: boolean;
  onChange: (state: ShortcutWorkflowState) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={updating}
          aria-label={`Change workflow state. Current state: ${story.workflowState.name}`}
          title="Change workflow state"
          className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60"
        >
          <span>{updating ? "Updating…" : story.workflowState.name}</span>
          <span aria-hidden="true" className="text-[9px]">▾</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" mobileTitle="Change workflow state">
        {states.map((state) => (
          <DropdownMenuItem
            key={state.id}
            disabled={updating || state.id === story.workflowState.id}
            onSelect={() => onChange(state)}
          >
            <span className="flex-1">{state.name}</span>
            {state.id === story.workflowState.id ? (
              <span aria-hidden="true" className="ml-3 text-muted-foreground">✓</span>
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function StoryCard({
  story,
  onOpen,
  onStartWork,
  draggable,
  dragging,
  dropEdge,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  story: Story;
  onOpen: () => void;
  onStartWork: () => Promise<void>;
  draggable: boolean;
  dragging: boolean;
  dropEdge: StoryDropEdge | null;
  onDragStart: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
}) {
  const [starting, setStarting] = useState(false);

  async function startWork() {
    if (starting) return;
    setStarting(true);
    try {
      await onStartWork();
    } finally {
      setStarting(false);
    }
  }

  function openInShortcut() {
    if (story.appUrl) {
      window.open(story.appUrl, "_blank", "noopener,noreferrer");
    }
  }

  async function copyId() {
    const id = `sc-${story.id}`;
    try {
      await navigator.clipboard.writeText(id);
      toast.success(`Copied ${id}`);
    } catch {
      toast.error(`Could not copy ${id}`);
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={`relative w-full ${dragging ? "opacity-50" : ""}`}
          draggable={draggable}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragOver={onDragOver}
          onDrop={onDrop}
        >
          {dropEdge ? (
            <div
              aria-hidden="true"
              className={`pointer-events-none absolute inset-x-0 z-20 h-0.5 rounded-full bg-primary ${
                dropEdge === "before" ? "-top-1" : "-bottom-1"
              }`}
            />
          ) : null}
          <button
            type="button"
            onClick={onOpen}
            className={`group w-full rounded-md border border-border bg-card p-2.5 text-left shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
            }`}
          >
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2 pr-6">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[10px] text-file-accent">sc-{story.id}</span>
                  {story.blocked ? (
                    <span className="text-[10px] font-medium text-destructive-text">Blocked</span>
                  ) : null}
                </div>
                <span className="shrink-0 text-[10px] text-subtle-foreground">
                  {relativeTime(story.updatedAt)}
                </span>
              </div>
              <h2 className="text-[13px] font-medium leading-4 text-foreground group-hover:text-primary">
                {story.name}
              </h2>
              {story.description ? (
                <p className="line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                  {story.description.replace(/\s+/g, " ")}
                </p>
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-subtle-foreground">
              <span className="capitalize">{story.storyType}</span>
              {story.estimate !== null ? <span>{story.estimate} pts</span> : null}
              {story.labels.slice(0, 3).map((label) => (
                <span key={label} className="max-w-24 truncate rounded bg-muted px-1.5 py-0.5">
                  {label}
                </span>
              ))}
            </div>
          </button>
          <div className="absolute right-1.5 top-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`Actions for sc-${story.id}`}
                  title="Story actions"
                  onClick={(event) => event.stopPropagation()}
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-sm leading-none text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span aria-hidden="true">…</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                mobileTitle={`Actions for sc-${story.id}`}
                onClick={(event) => event.stopPropagation()}
              >
                <DropdownMenuItem onSelect={onOpen}>View details</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void copyId()}>
                  Copy ID
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={starting}
                  onSelect={() => void startWork()}
                >
                  {starting ? "Starting…" : "Start work in bb"}
                </DropdownMenuItem>
                {story.appUrl ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={openInShortcut}>
                      Open in Shortcut
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent onClick={(event) => event.stopPropagation()}>
        <ContextMenuItem onSelect={onOpen}>View details</ContextMenuItem>
        <ContextMenuItem onSelect={() => void copyId()}>Copy ID</ContextMenuItem>
        <ContextMenuItem disabled={starting} onSelect={() => void startWork()}>
          {starting ? "Starting…" : "Start work in bb"}
        </ContextMenuItem>
        {story.appUrl ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={openInShortcut}>Open in Shortcut</ContextMenuItem>
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function KanbanColumn({
  name,
  stories,
  onOpen,
  onStartWork,
  onReorder,
  reordering,
}: {
  name: string;
  stories: Story[];
  onOpen: (story: Story) => void;
  onStartWork: (story: Story) => Promise<void>;
  onReorder: (
    nextStories: Story[],
    movedId: number,
    adjacentId: number,
    placement: StoryDropEdge,
  ) => Promise<void>;
  reordering: boolean;
}) {
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    id: number;
    edge: StoryDropEdge;
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragPointerY = useRef<number | null>(null);
  const autoScrollFrame = useRef<number | null>(null);
  const stateIds = new Set(stories.map((story) => story.workflowState.id));
  const canReorder = stories.length > 1 && stateIds.size === 1 && !reordering;

  function stopAutoScroll() {
    dragPointerY.current = null;
    if (autoScrollFrame.current !== null) {
      cancelAnimationFrame(autoScrollFrame.current);
      autoScrollFrame.current = null;
    }
  }

  function autoScroll() {
    autoScrollFrame.current = null;
    const scroller = scrollRef.current;
    const pointerY = dragPointerY.current;
    if (!scroller || pointerY === null) return;

    const bounds = scroller.getBoundingClientRect();
    const delta = dragAutoScrollDelta(pointerY, bounds.top, bounds.bottom);
    if (delta === 0) return;

    const previousScrollTop = scroller.scrollTop;
    scroller.scrollTop += delta;
    if (scroller.scrollTop !== previousScrollTop) {
      autoScrollFrame.current = requestAnimationFrame(autoScroll);
    }
  }

  function updateAutoScroll(pointerY: number) {
    dragPointerY.current = pointerY;
    if (autoScrollFrame.current === null) {
      autoScrollFrame.current = requestAnimationFrame(autoScroll);
    }
  }

  useEffect(() => stopAutoScroll, []);

  function finishDrag() {
    stopAutoScroll();
    setDraggedId(null);
    setDropTarget(null);
  }

  function dragOverStory(event: DragEvent<HTMLDivElement>, targetId: number) {
    if (!canReorder || draggedId === null || draggedId === targetId) {
      setDropTarget(null);
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const bounds = event.currentTarget.getBoundingClientRect();
    const edge = event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
    setDropTarget({ id: targetId, edge });
  }

  function dropOnStory(event: DragEvent<HTMLDivElement>, targetId: number) {
    event.preventDefault();
    if (!canReorder || draggedId === null || draggedId === targetId || !dropTarget) {
      finishDrag();
      return;
    }
    const nextStories = reorderStories(stories, draggedId, targetId, dropTarget.edge);
    const changed = nextStories.some((story, index) => story.id !== stories[index]?.id);
    const placement = dropTarget.edge;
    const movedId = draggedId;
    finishDrag();
    if (changed) {
      void onReorder(nextStories, movedId, targetId, placement);
    }
  }

  return (
    <section className="flex h-full w-72 shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-muted/30">
      <header
        className="flex items-center justify-between border-b border-border px-2.5 py-2"
        title={stateIds.size > 1 ? "Choose a workflow tab to reorder stories" : undefined}
      >
        <h2 className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {name}
        </h2>
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-subtle-foreground">
          {stories.length}
        </span>
      </header>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-1.5"
        onDragOver={(event) => {
          if (canReorder && draggedId !== null) {
            event.preventDefault();
            updateAutoScroll(event.clientY);
          }
        }}
      >
        {stories.map((story) => (
          <StoryCard
            key={story.id}
            story={story}
            onOpen={() => onOpen(story)}
            onStartWork={() => onStartWork(story)}
            draggable={canReorder}
            dragging={draggedId === story.id}
            dropEdge={dropTarget?.id === story.id ? dropTarget.edge : null}
            onDragStart={(event) => {
              if (!canReorder) {
                event.preventDefault();
                return;
              }
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", String(story.id));
              setDraggedId(story.id);
            }}
            onDragEnd={finishDrag}
            onDragOver={(event) => dragOverStory(event, story.id)}
            onDrop={(event) => dropOnStory(event, story.id)}
          />
        ))}
      </div>
    </section>
  );
}

function StoriesList() {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const { projectId } = useBbContext();
  const [query, setQuery] = useState("");
  const [includeCompleted, setIncludeCompleted] = useState(false);
  const [selectedWorkflow, setSelectedWorkflow] = useState("all");
  const [result, setResult] = useState<AssignedResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reordering, setReordering] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef<Record<string, number>>({});

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const next = await rpc.call("listAssigned", {
        includeCompleted,
        refresh,
      });
      setResult(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [includeCompleted, rpc]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtime("stories-changed", () => {
    void load(true);
  });

  const workflows = useMemo(
    () => workflowsForStories(result?.stories ?? []),
    [result],
  );

  useEffect(() => {
    if (
      selectedWorkflow !== "all" &&
      !workflows.some((workflow) => String(workflow.id) === selectedWorkflow)
    ) {
      setSelectedWorkflow("all");
    }
  }, [selectedWorkflow, workflows]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (boardRef.current) {
        boardRef.current.scrollLeft = scrollPositions.current[selectedWorkflow] ?? 0;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedWorkflow]);

  const searchedStories = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return result?.stories ?? [];
    return (result?.stories ?? []).filter((story) =>
      `sc-${story.id} ${story.name} ${story.description} ${story.labels.join(" ")}`
        .toLowerCase()
        .includes(normalized),
    );
  }, [query, result]);

  const stories = useMemo(
    () => selectedWorkflow === "all"
      ? searchedStories
      : searchedStories.filter(
        (story) => String(story.workflowState.workflowId) === selectedWorkflow,
      ),
    [searchedStories, selectedWorkflow],
  );

  const columns = useMemo(() => groupStoriesByState(stories), [stories]);

  function chooseWorkflow(workflowId: string) {
    if (boardRef.current) {
      scrollPositions.current[selectedWorkflow] = boardRef.current.scrollLeft;
    }
    setSelectedWorkflow(workflowId);
  }

  async function startWork(story: Story) {
    setError(null);
    try {
      const { threadId } = await rpc.call("startWork", { id: story.id, projectId });
      navigate.toThread(threadId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function reorderStory(
    nextStories: Story[],
    movedId: number,
    adjacentId: number,
    placement: StoryDropEdge,
  ) {
    if (!result || reordering) return;
    const previousResult = result;
    const optimisticPositions = new Map(
      nextStories.map((story, index) => [story.id, index]),
    );
    setReordering(true);
    setResult((current) => current ? {
      ...current,
      stories: current.stories.map((story) => {
        const position = optimisticPositions.get(story.id);
        return position === undefined ? story : { ...story, position };
      }),
    } : current);

    try {
      await rpc.call("reorderStory", {
        id: movedId,
        adjacentId,
        placement,
      });
      toast.success(`Moved sc-${movedId}`);
    } catch (cause) {
      setResult(previousResult);
      const message = cause instanceof Error ? cause.message : String(cause);
      toast.error(`Could not move sc-${movedId}: ${message}`);
    } finally {
      setReordering(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 space-y-2 border-b border-border p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search assigned stories…"
            aria-label="Search assigned Shortcut stories"
            className="h-8 text-xs sm:max-w-sm"
          />
          <div className="flex items-center gap-2">
            <Button
              variant={includeCompleted ? "default" : "outline"}
              size="sm"
              onClick={() => setIncludeCompleted((value) => !value)}
            >
              {includeCompleted ? "Completed shown" : "Show completed"}
            </Button>
            <Button variant="outline" size="sm" disabled={loading} onClick={() => void load(true)}>
              Refresh
            </Button>
          </div>
        </div>

        {result ? (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Assigned to {result.member.name}
              {result.member.workspaceName ? ` · ${result.member.workspaceName}` : ""}
            </span>
            <span>{stories.length} {stories.length === 1 ? "story" : "stories"}</span>
          </div>
        ) : null}

        {workflows.length > 1 ? (
          <div
            className="flex gap-1 overflow-x-auto pb-0.5"
            role="tablist"
            aria-label="Shortcut workflows"
          >
            <button
              type="button"
              role="tab"
              aria-selected={selectedWorkflow === "all"}
              onClick={() => chooseWorkflow("all")}
              className={selectedWorkflow === "all"
                ? "shrink-0 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground"
                : "shrink-0 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"}
            >
              All <span className="ml-1 tabular-nums opacity-70">{result?.stories.length ?? 0}</span>
            </button>
            {workflows.map((workflow) => {
              const id = String(workflow.id);
              const selected = selectedWorkflow === id;
              return (
                <button
                  key={workflow.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => chooseWorkflow(id)}
                  className={selected
                    ? "shrink-0 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground"
                    : "shrink-0 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"}
                >
                  {workflow.name}
                  <span className="ml-1 tabular-nums opacity-70">{workflow.storyCount}</span>
                </button>
              );
            })}
          </div>
        ) : null}

      </div>

      <div
        ref={boardRef}
        onScroll={(event) => {
          scrollPositions.current[selectedWorkflow] = event.currentTarget.scrollLeft;
        }}
        className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden p-3"
      >
        {error ? <ErrorNotice message={error} /> : null}
        {loading && !result ? <KanbanSkeleton /> : null}
        {!loading && !error && stories.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
            No assigned stories match this view.
          </div>
        ) : null}
        {columns.length ? (
          <div className="flex h-full min-w-max gap-3">
            {columns.map((column) => (
              <KanbanColumn
                key={column.key}
                name={column.name}
                stories={column.stories}
                onOpen={(story) => navigate.toPluginPanel("stories", { subPath: String(story.id) })}
                onStartWork={startWork}
                onReorder={reorderStory}
                reordering={reordering}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function StoryDetail({ id }: { id: number }) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const { projectId } = useBbContext();
  const [story, setStory] = useState<Story | null>(null);
  const [workflowStates, setWorkflowStates] = useState<ShortcutWorkflowState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [updatingState, setUpdatingState] = useState(false);
  const requestGuardRef = useRef<StoryDetailRequestGuard | null>(null);
  if (requestGuardRef.current === null) {
    requestGuardRef.current = new StoryDetailRequestGuard(id);
  }
  const requestGuard = requestGuardRef.current;

  const load = useCallback(async () => {
    const request = requestGuard.begin(id);
    setLoading(true);
    try {
      const { story: next, workflowStates: nextStates } = await rpc.call(
        "getStory",
        { id },
      );
      if (!requestGuard.isCurrent(request)) return;
      setStory(next);
      setWorkflowStates(nextStates);
      setError(null);
    } catch (cause) {
      if (requestGuard.isCurrent(request)) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (requestGuard.isCurrent(request)) {
        setLoading(false);
      }
    }
  }, [id, requestGuard, rpc]);

  useEffect(() => {
    requestGuard.invalidate();
    setStory(null);
    setWorkflowStates([]);
    setError(null);
    setStarting(false);
    setUpdatingState(false);
    void load();
    return () => requestGuard.invalidate();
  }, [load, requestGuard]);

  useRealtime("stories-changed", () => {
    void load();
  });

  async function startWork() {
    setStarting(true);
    setError(null);
    try {
      const { threadId } = await rpc.call("startWork", { id, projectId });
      navigate.toThread(threadId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStarting(false);
    }
  }

  async function updateWorkflowState(state: ShortcutWorkflowState) {
    if (
      !story ||
      story.id !== id ||
      updatingState ||
      state.id === story.workflowState.id
    ) return;
    const storyId = story.id;
    const activation = requestGuard.captureActivation();
    setUpdatingState(true);
    setError(null);
    try {
      const result = await requestWorkflowStateUpdate(rpc, story, state);
      if (!requestGuard.isActive(activation)) return;
      if (!result.ok) {
        setError(result.error.message);
        toast.error(`Could not update sc-${storyId}: ${result.error.message}`);
        return;
      }
      const updatedStory = result.story;
      setStory(updatedStory);
      toast.success(`Moved sc-${storyId} to ${updatedStory.workflowState.name}`);
    } finally {
      if (requestGuard.isActive(activation)) setUpdatingState(false);
    }
  }

  const visibleStory = story?.id === id ? story : null;

  return (
    <div className="h-full overflow-y-auto p-3 md:p-4">
      <div className="mx-auto w-full max-w-3xl space-y-4 text-sm">
        <Button variant="ghost" size="sm" onClick={() => navigate.toPluginPanel("stories")}>
          ← Assigned stories
        </Button>
        {error ? <ErrorNotice message={error} /> : null}
        {(loading && !visibleStory) || (story !== null && visibleStory === null)
          ? <DetailSkeleton />
          : null}
        {visibleStory ? (
          <article className="space-y-4">
            <header className="space-y-2.5 border-b border-border pb-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-file-accent">sc-{visibleStory.id}</span>
                <WorkflowStatePicker
                  story={visibleStory}
                  states={workflowStates}
                  updating={updatingState}
                  onChange={(state) => void updateWorkflowState(state)}
                />
                <span className="text-xs capitalize text-muted-foreground">{visibleStory.storyType}</span>
                {visibleStory.blocked ? <span className="text-xs font-medium text-destructive-text">Blocked</span> : null}
              </div>
              <h1 className="text-xl font-semibold tracking-tight text-foreground">{visibleStory.name}</h1>
              <div className="flex flex-wrap gap-2">
                <Button disabled={starting} onClick={() => void startWork()}>
                  {starting ? "Starting…" : "Start work in bb"}
                </Button>
                {visibleStory.appUrl ? (
                  <Button asChild variant="outline">
                    <a
                      href={visibleStory.appUrl}
                      target="_blank"
                      rel="noreferrer"
                      data-shortcut-open-external=""
                    >
                      Open in Shortcut
                    </a>
                  </Button>
                ) : null}
              </div>
            </header>

            <dl className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-card p-3 text-xs sm:grid-cols-4">
              <div><dt className="text-subtle-foreground">Estimate</dt><dd className="mt-1 text-foreground">{visibleStory.estimate ?? "—"}</dd></div>
              <div><dt className="text-subtle-foreground">Updated</dt><dd className="mt-1 text-foreground">{relativeTime(visibleStory.updatedAt)}</dd></div>
              <div><dt className="text-subtle-foreground">Tasks</dt><dd className="mt-1 text-foreground">{visibleStory.tasks.filter((task) => task.complete).length}/{visibleStory.tasks.length}</dd></div>
              <div><dt className="text-subtle-foreground">Deadline</dt><dd className="mt-1 text-foreground">{visibleStory.deadline ? new Date(visibleStory.deadline).toLocaleDateString() : "—"}</dd></div>
            </dl>

            <section className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Description</h2>
              {visibleStory.description ? (
                <Markdown content={visibleStory.description} className="text-sm text-foreground" />
              ) : (
                <p className="text-xs text-muted-foreground">No description.</p>
              )}
            </section>

            {visibleStory.tasks.length ? (
              <section className="space-y-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tasks</h2>
                <ul className="divide-y divide-border rounded-lg border border-border bg-card">
                  {visibleStory.tasks.map((task) => (
                    <li key={task.id} className="flex gap-2 p-2.5 text-xs">
                      <span aria-hidden="true" className={task.complete ? "text-success" : "text-subtle-foreground"}>
                        {task.complete ? "✓" : "○"}
                      </span>
                      <span className={task.complete ? "text-muted-foreground line-through" : "text-foreground"}>
                        {task.description}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {visibleStory.labels.length ? (
              <div className="flex flex-wrap gap-2">
                {visibleStory.labels.map((label) => (
                  <span key={label} className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    {label}
                  </span>
                ))}
              </div>
            ) : null}
          </article>
        ) : null}
      </div>
    </div>
  );
}

function ShortcutPanel({ subPath }: { subPath: string }) {
  const id = /^\d+$/.test(subPath) ? Number(subPath) : null;
  return id ? <StoryDetail id={id} /> : <StoriesList />;
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "shortcut-story-links",
    mount({ pluginId, signal }) {
      const rewrittenLinks = new Map<
        HTMLAnchorElement,
        { href: string; target: string | null; rewrittenHref: string }
      >();

      function rewriteLink(link: HTMLAnchorElement) {
        if (link.hasAttribute("data-shortcut-open-external")) return;

        const href = link.getAttribute("href");
        if (!href) return;

        const storyId = shortcutStoryIdFromUrl(href);
        if (storyId === null) return;

        const rewrittenHref = shortcutStoryPluginPath(pluginId, storyId);
        if (!rewrittenLinks.has(link)) {
          rewrittenLinks.set(link, {
            href,
            target: link.getAttribute("target"),
            rewrittenHref,
          });
        }
        link.setAttribute("href", rewrittenHref);
        link.removeAttribute("target");
      }

      function rewriteLinksWithin(root: ParentNode) {
        if (root instanceof HTMLAnchorElement) rewriteLink(root);
        root.querySelectorAll<HTMLAnchorElement>("a[href]").forEach(rewriteLink);
      }

      function handleShortcutLinkClick(event: MouseEvent) {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
          return;
        }

        const link = event.composedPath().find(
          (node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement,
        );
        if (!link) return;
        if (link.hasAttribute("data-shortcut-open-external")) return;

        const href = rewrittenLinks.get(link)?.href ?? link.getAttribute("href");
        if (!href) return;

        const storyId = shortcutStoryIdFromUrl(href);
        if (storyId === null) return;

        event.preventDefault();
        event.stopImmediatePropagation();
        window.location.assign(shortcutStoryPluginPath(pluginId, storyId));
      }

      rewriteLinksWithin(document);
      window.addEventListener("click", handleShortcutLinkClick, { capture: true, signal });

      const observer = new MutationObserver((records) => {
        for (const record of records) {
          if (record.type === "attributes") {
            if (record.target instanceof HTMLAnchorElement) rewriteLink(record.target);
            continue;
          }
          record.addedNodes.forEach((node) => {
            if (node instanceof Element || node instanceof DocumentFragment) {
              rewriteLinksWithin(node);
            }
          });
        }
      });
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["href"],
        childList: true,
        subtree: true,
      });

      let disposed = false;
      const dispose = () => {
        if (disposed) return;
        disposed = true;
        observer.disconnect();
        window.removeEventListener("click", handleShortcutLinkClick, true);
        for (const [link, original] of rewrittenLinks) {
          if (link.getAttribute("href") !== original.rewrittenHref) continue;
          link.setAttribute("href", original.href);
          if (original.target === null) link.removeAttribute("target");
          else link.setAttribute("target", original.target);
        }
        rewrittenLinks.clear();
      };

      signal.addEventListener("abort", dispose, { once: true });
      return dispose;
    },
  });

  app.slots.navPanel({
    id: "assigned-stories",
    title: "Shortcut",
    icon: "Shortcut",
    path: "stories",
    component: ShortcutPanel,
  });
});
