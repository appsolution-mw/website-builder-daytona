"use client";

import {
  use,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Bug,
  Camera,
  Code2,
  ExternalLink,
  Globe2,
  History,
  ImagePlus,
  KeyRound,
  Loader2,
  MessageSquare,
  Monitor,
  Plus,
  RefreshCw,
  Save,
  ScrollText,
  Send,
  Settings2,
  Smartphone,
  Square,
  Tablet,
  Terminal,
  Trash2,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  AgentRuntime,
  BrowserToProxy,
  PromptImageAttachment,
  ProxyToBrowser,
} from "@wbd/protocol";
import { Message, type ChatImageAttachmentView, type ChatMessageView } from "@/components/chat/Message";
import { ModelPicker, type ModelOption } from "@/components/chat/ModelPicker";
import { PresetPicker, type PresetOption } from "@/components/library/PresetPicker";
import { RightPane, type RightPaneTab } from "@/components/workspace/RightPane";
import { FileTree } from "@/components/workspace/FileTree";
import { CodeEditor } from "@/components/workspace/CodeEditor";
import { XtermTerminal, type XtermTerminalStatus } from "@/components/workspace/XtermTerminal";
import { ProjectAgentConfigPanel } from "@/components/agent-config/ProjectAgentConfigPanel";
import { normalizeProjectAgentConfigResponse } from "@/components/agent-config/normalizers";
import type {
  MaterializedAgentFile,
  ProjectAgentConfigInput,
  ProjectAgentConfigResponse,
} from "@/components/agent-config/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { runtimeLabel } from "@/lib/agents/runtime";
import { libraryPresetItemIdForRuntimeSync } from "@/lib/agents/openhands-library-snapshot";
import {
  ensureNextDevtoolsCssImport,
  ensurePreviewConsoleBridge,
  nextConfigContent,
  nextDevIndicatorsEnabled,
  nextDevtoolsCssContent,
  previewConsoleBridgeContent,
  resolveNextAppConsoleBridgePaths,
  resolveNextConfigPath,
  resolveNextAppDevtoolsPaths,
  setNextDevIndicators,
  staleNextDevtoolsCleanupPaths,
} from "@/lib/next-dev-indicators";
import {
  isUsableCaptureRect,
  normalizeDragRect,
  viewportRectToVideoCrop,
  type CapturePoint,
  type CaptureRect,
} from "@/lib/preview-capture";

type RuntimeState = {
  runtime: AgentRuntime;
  providerSessionId: string;
  modelId: string | null;
  lastUsedAt: string;
  librarySnapshot?: {
    id: string;
    presetItemId: string | null;
    presetRevisionId: string | null;
    snapshotJson: unknown;
    createdAt: string;
  };
};

type ChatSession = {
  id: string;
  title: string;
  defaultRuntime: AgentRuntime;
  runtimeStates: RuntimeState[];
  createdAt: string;
  lastMessageAt: string;
  _count: { messages: number };
};

type DbMessage = {
  id: string;
  role: "USER" | "AGENT" | "SYSTEM";
  content: string;
  turnId: string | null;
  agentId: string | null;
  runtime: AgentRuntime | null;
  provider: string | null;
  modelId: string | null;
  createdAt: string;
};

type Project = {
  id: string;
  name: string;
  status: "PROVISIONING" | "RUNNING" | "PAUSED" | "ARCHIVED" | "DESTROYED";
  daytonaSandboxId: string | null;
  agentRuntime: AgentRuntime;
  desiredRuntime: AgentRuntime;
  runtimeSwitchStatus: "IDLE" | "PENDING" | "SWITCHING" | "FAILED";
  availableRuntimes: Array<{ value: AgentRuntime; label: string; provider: string }>;
  previewUrl: string | null;
  provisioningError: string | null;
  chatSession: ChatSession;
  chatSessions: ChatSession[];
};

type DeviceView = "desktop" | "tablet" | "mobile";

type DraftImageAttachment = ChatImageAttachmentView & PromptImageAttachment;
type LibraryPresetApiItem = PresetOption & {
  status?: string;
  currentRevision?: unknown | null;
};
type TerminalProtocolEvent = Extract<
  ProxyToBrowser,
  { type: "terminal.ready" | "terminal.output" | "terminal.exit" }
>;
type BrowserConsoleLevel = "log" | "info" | "warn" | "error";
type BrowserConsoleEntry = {
  id: string;
  level: BrowserConsoleLevel;
  values: string[];
  timestamp: number;
  url: string;
};
type SerializableRunEvent = {
  id: string;
  runId: string;
  attemptId: string | null;
  projectId: string;
  sessionId: string;
  sequence: number;
  type: "STATUS" | "CHUNK" | "TOOL_USE" | "USAGE" | "DONE" | "ERROR" | "FILE_CHANGED";
  agentId: string | null;
  payload: unknown;
  createdAt: string;
};
type ProjectRunQueueState = {
  state: "IDLE" | "RUNNING" | "BLOCKED";
  activeRunId: string | null;
  blockedRunId: string | null;
  blockedAt: string | null;
  updatedAt: string | null;
};

const POLL_INTERVAL_MS = 2_000;
const EVENT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_CHAT_WIDTH_PCT = 28;
const MIN_CHAT_WIDTH_PCT = 22;
const MAX_CHAT_WIDTH_PCT = 45;
const BADGE_DURATION_MS = 3000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_CHAT_IMAGES = 5;
const MAX_CHAT_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_CONSOLE_ENTRIES = 500;
const ACCEPTED_IMAGE_TYPES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);
const PROJECT_AGENTS_PATH = "AGENTS.md";
const PROJECT_ENV_PATH = ".env";
const PREVIEW_CONSOLE_MESSAGE_TYPE = "wbd-preview-console";
const DEFAULT_PROJECT_AGENTS_CONTENT = `# AGENTS.md

## Project Context

- This project is a Next.js 16 App Router application running from \`/workspace/project\`.
- The preview renders the Next.js app, not a standalone HTML file.
- User-facing page work belongs in \`app/\`, \`components/\`, \`lib/\`, and \`public/\`.
- For the main page, edit \`app/page.tsx\` and related styles. Do not create or rely on a root \`index.html\` unless explicitly asked.
- This is not older Next.js: read the relevant guide in \`node_modules/next/dist/docs/\` before using framework APIs, routes, config, middleware/proxy, or runtime behavior.

## Commands

- Use \`pnpm\`.
- The sandbox manages the dev server. Do not start a second long-running server unless explicitly asked.
- Check TypeScript changes with \`pnpm exec tsc --noEmit\` when practical.

## Code Style

- Use TypeScript with strict types.
- Keep diffs small, focused, and maintainable.
- Prefer functional React components and App Router patterns.
- Preserve correct native spelling, including umlauts such as ä, ö, ü, and ß.
- Animations and parallax effects must be progressive enhancement: primary text, navigation, cards, and CTAs must remain visible in the server-rendered HTML/CSS fallback. Do not leave important content at \`opacity: 0\` waiting for client-side animation or hydration.
`;

const DEVICE_FRAME: Record<DeviceView, { label: string; Icon: typeof Monitor }> = {
  desktop: { label: "Desktop", Icon: Monitor },
  tablet: { label: "Tablet", Icon: Tablet },
  mobile: { label: "Mobile", Icon: Smartphone },
};

function toRelativePath(url: string | null): string {
  if (!url) return "/";
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}${u.hash}` || "/";
  } catch {
    return "/";
  }
}

function timestampLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function isPreviewConsoleMessage(data: unknown): data is {
  type: typeof PREVIEW_CONSOLE_MESSAGE_TYPE;
  level: BrowserConsoleLevel;
  values: string[];
  timestamp: number;
  url: string;
} {
  if (!data || typeof data !== "object") return false;
  const value = data as {
    type?: unknown;
    level?: unknown;
    values?: unknown;
    timestamp?: unknown;
    url?: unknown;
  };
  return (
    value.type === PREVIEW_CONSOLE_MESSAGE_TYPE &&
    (value.level === "log" || value.level === "info" || value.level === "warn" || value.level === "error") &&
    Array.isArray(value.values) &&
    value.values.every((entry) => typeof entry === "string") &&
    typeof value.timestamp === "number" &&
    typeof value.url === "string"
  );
}

function formatDoneFooter(d: {
  durationMs: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  exitCode: number;
  usage?: {
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
    totalTokens: number;
  };
}): string {
  if (d.exitCode === -1) return "aborted by user";
  const secs = (d.durationMs / 1000).toFixed(1);
  const cost = d.costUsd.toFixed(3);
  const cacheCreated = d.usage?.cacheCreationInputTokens ?? 0;
  const cacheRead = d.usage?.cacheReadInputTokens ?? 0;
  const total = d.usage?.totalTokens ?? d.tokensIn + d.tokensOut;
  return `${secs}s · ${total} total (${d.tokensIn} input / ${cacheCreated} cache write / ${cacheRead} cache read / ${d.tokensOut} output) · $${cost}`;
}

function summariseTool(tool: string, input: unknown): string {
  void input;
  if (tool === "Read" || tool === "Grep" || tool === "Glob" || tool === "LS") return "Working on it";
  if (tool === "Write" || tool === "Edit" || tool === "Create" || tool === "NotebookEdit") {
    return "Updating project";
  }
  if (tool === "Bash") return "Checking progress";
  if (tool === "Task") return "Working on it";
  return "Working on it";
}

function appendAgentDelta(text: string, delta: string): string {
  if (!text) return delta;
  if (!delta) return text;
  if (/\s$/.test(text) || /^\s/.test(delta)) return text + delta;
  return `${text}\n\n${delta}`;
}

function hasImageDataTransferItems(items: DataTransferItemList): boolean {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === "file" && ACCEPTED_IMAGE_TYPES.has(item.type)) return true;
  }
  return false;
}

function hasImageFiles(files: FileList): boolean {
  for (let i = 0; i < files.length; i++) {
    const file = files.item(i);
    if (file && ACCEPTED_IMAGE_TYPES.has(file.type)) return true;
  }
  return false;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readImageFile(file: File): Promise<DraftImageAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name || "image"}`));
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      const comma = dataUrl.indexOf(",");
      if (!dataUrl || comma < 0) {
        reject(new Error(`Could not read ${file.name || "image"}`));
        return;
      }
      resolve({
        id: crypto.randomUUID(),
        name: file.name || "image.png",
        mimeType: file.type,
        size: file.size,
        dataUrl,
        dataBase64: dataUrl.slice(comma + 1),
      });
    };
    reader.readAsDataURL(file);
  });
}

function base64ByteLength(dataBase64: string): number {
  const padding = dataBase64.endsWith("==") ? 2 : dataBase64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((dataBase64.length * 3) / 4) - padding);
}

function imageAttachmentFromDataUrl(dataUrl: string, name: string): DraftImageAttachment {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    throw new Error("Screenshot could not be converted into an image");
  }
  const [, mimeType, dataBase64] = match;
  if (!ACCEPTED_IMAGE_TYPES.has(mimeType)) {
    throw new Error(`Unsupported screenshot type: ${mimeType}`);
  }
  return {
    id: crypto.randomUUID(),
    name,
    mimeType,
    size: base64ByteLength(dataBase64),
    dataUrl,
    dataBase64,
  };
}

async function captureViewportSelectionAsPngDataUrl(selection: CaptureRect): Promise<string> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error("Screen capture is not available in this browser");
  }

  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("Screen capture could not be loaded"));
    });
    await video.play();

    const crop = viewportRectToVideoCrop(
      selection,
      { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
      { width: video.videoWidth, height: video.videoHeight },
    );
    if (!isUsableCaptureRect(crop)) {
      throw new Error("Captured area is too small");
    }

    const canvas = document.createElement("canvas");
    canvas.width = crop.width;
    canvas.height = crop.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Screenshot canvas could not be created");
    }
    ctx.drawImage(
      video,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      crop.width,
      crop.height,
    );
    return canvas.toDataURL("image/png");
  } finally {
    for (const track of stream.getTracks()) track.stop();
  }
}

function messagesFromDb(rows: DbMessage[]): ChatMessageView[] {
  return rows.map((m) => {
    const turnId = m.turnId ?? m.id;
    if (m.role === "USER") return { kind: "user", turnId, text: m.content };
    if (m.role === "AGENT") {
      return {
        kind: "agent",
        turnId,
        agentId: m.agentId ?? undefined,
        runtime: m.runtime ?? undefined,
        modelId: m.modelId,
        text: m.content,
        streaming: false,
        tools: [],
        footer: null,
      };
    }
    return {
      kind: "error",
      turnId,
      agentId: m.agentId ?? undefined,
      runtime: m.runtime ?? undefined,
      modelId: m.modelId,
      text: m.content,
    };
  });
}

function isAgentStreamEvent(event: ProxyToBrowser): boolean {
  return (
    event.type === "agent.session" ||
    event.type === "agent.status" ||
    event.type === "agent.chunk" ||
    event.type === "agent.tool_use" ||
    event.type === "agent.usage" ||
    event.type === "agent.done" ||
    event.type === "agent.error"
  );
}

function proxyEventFromRunEvent(event: SerializableRunEvent): ProxyToBrowser | null {
  const payload = event.payload;
  if (isProxyEventPayload(payload)) {
    return payload;
  }
  if (event.type === "DONE") {
    return {
      type: "agent.done",
      turnId: event.runId,
      durationMs: 0,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      exitCode: 0,
    };
  }
  if (event.type === "ERROR") {
    const message = typeof payload === "object" && payload !== null && "message" in payload
      ? String((payload as { message?: unknown }).message ?? "Run failed")
      : "Run failed";
    return {
      type: "agent.error",
      turnId: event.runId,
      message,
      ...(event.agentId ? { agentId: event.agentId } : {}),
    };
  }
  return null;
}

function isProxyEventPayload(value: unknown): value is ProxyToBrowser {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

function runtimeStateForSession(session: ChatSession | null, runtime: AgentRuntime): RuntimeState | undefined {
  return session?.runtimeStates.find((state) => state.runtime === runtime);
}

function supportsOpenRouterModelPicker(runtime: AgentRuntime): boolean {
  return runtime === "openhands" || runtime === "vercel-ai";
}

function selectedModelForSession(session: ChatSession | null, runtime: AgentRuntime): string | null {
  return runtimeStateForSession(session, runtime)?.modelId ?? null;
}

function isSelectableLibraryPreset(item: LibraryPresetApiItem): boolean {
  return item.status === "PUBLISHED" && item.currentRevision !== null && item.currentRevision !== undefined;
}

function WorkspaceLoadingState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <main className="flex min-h-dvh flex-1 items-center justify-center bg-background p-6">
      <section className="w-full max-w-xl rounded-lg border border-border bg-card p-6 text-center shadow-sm">
        <Button asChild variant="ghost" className="mb-5 w-fit">
          <Link href="/">
            <ArrowLeft />
            Back
          </Link>
        </Button>
        <div className="mx-auto flex size-14 items-center justify-center rounded-lg border border-border bg-secondary">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
      </section>
    </main>
  );
}

export default function ProjectWorkspace({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [project, setProject] = useState<Project | null>(null);
  const [wsStatus, setWsStatus] = useState<"idle" | "connecting" | "open" | "closed">("idle");
  const [brokerReadyProjectId, setBrokerReadyProjectId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [activeSession, setActiveSession] = useState<ChatSession | null>(null);
  const [selectedRuntime, setSelectedRuntime] = useState<AgentRuntime>("claude-code");
  const [openRouterModels, setOpenRouterModels] = useState<ModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [libraryPresets, setLibraryPresets] = useState<PresetOption[]>([]);
  const [selectedLibraryPresetId, setSelectedLibraryPresetId] = useState<string | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [draftAttachments, setDraftAttachments] = useState<DraftImageAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [draggingImages, setDraggingImages] = useState(false);
  const [turnInFlight, setTurnInFlight] = useState<string | null>(null);
  const [reviewingActive, setReviewingActive] = useState(false);
  const [sandboxRestarting, setSandboxRestarting] = useState(false);
  const [sandboxRestartError, setSandboxRestartError] = useState<string | null>(null);
  const [workspaceWs, setWorkspaceWs] = useState<WebSocket | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const chatScrollRef = useRef<HTMLUListElement | null>(null);
  const stickToBottomRef = useRef(true);
  const [chatWidthPct, setChatWidthPct] = useState(DEFAULT_CHAT_WIDTH_PCT);

  const [paths, setPaths] = useState<string[]>([]);
  const [recentlyChanged, setRecentlyChanged] = useState<Set<string>>(() => new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileContentBase, setFileContentBase] = useState<string | null>(null);
  const [fileListLoading, setFileListLoading] = useState(false);
  const [fileListError, setFileListError] = useState<string | null>(null);
  const [saveIndicator, setSaveIndicator] = useState<"idle" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [envPanelOpen, setEnvPanelOpen] = useState(false);
  const [envContent, setEnvContent] = useState("");
  const [envContentBase, setEnvContentBase] = useState<string | null>(null);
  const [envLoading, setEnvLoading] = useState(false);
  const [envSaving, setEnvSaving] = useState(false);
  const [envError, setEnvError] = useState<string | null>(null);
  const [envSyncWarning, setEnvSyncWarning] = useState<string | null>(null);
  const [envSyncPending, setEnvSyncPending] = useState(false);
  const [agentConfigOpen, setAgentConfigOpen] = useState(false);
  const [agentConfig, setAgentConfig] = useState<ProjectAgentConfigResponse | null>(null);
  const [agentConfigLoading, setAgentConfigLoading] = useState(false);
  const [agentConfigError, setAgentConfigError] = useState<string | null>(null);
  const [agentConfigSaving, setAgentConfigSaving] = useState(false);
  const [agentConfigSyncWarning, setAgentConfigSyncWarning] = useState<string | null>(null);
  const [tab, setTab] = useState<RightPaneTab>("preview");
  const [device, setDevice] = useState<DeviceView>("desktop");
  const [devIndicatorEnabled, setDevIndicatorEnabled] = useState<boolean | null>(null);
  const [devIndicatorSaving, setDevIndicatorSaving] = useState(false);
  const [devIndicatorError, setDevIndicatorError] = useState<string | null>(null);
  const [previewReloadKey, setPreviewReloadKey] = useState(0);
  const [previewCaptureActive, setPreviewCaptureActive] = useState(false);
  const [previewCaptureBusy, setPreviewCaptureBusy] = useState(false);
  const [previewCaptureSelection, setPreviewCaptureSelection] = useState<{
    viewport: CaptureRect;
    local: CaptureRect;
  } | null>(null);
  const [terminalEvent, setTerminalEvent] = useState<{ seq: number; event: TerminalProtocolEvent } | null>(null);
  const [terminalStatus, setTerminalStatus] = useState<XtermTerminalStatus>("offline");
  const [terminalClearSignal, setTerminalClearSignal] = useState(0);
  const [terminalCloseSignal, setTerminalCloseSignal] = useState(0);
  const [terminalReconnectSignal, setTerminalReconnectSignal] = useState(0);
  const [consoleEntries, setConsoleEntries] = useState<BrowserConsoleEntry[]>([]);

  const pendingRef = useRef<
    Map<string, { resolve: (msg: ProxyToBrowser) => void; reject: (err: Error) => void; timer: number }>
  >(new Map());
  const handleEventRef = useRef<(ev: ProxyToBrowser) => void>(() => {});
  const messagesRef = useRef<ChatMessageView[]>([]);
  const activeSessionRef = useRef<ChatSession | null>(null);
  const draftAttachmentsRef = useRef<DraftImageAttachment[]>([]);
  const selectedRuntimeRef = useRef<AgentRuntime>("claude-code");
  const turnInFlightRef = useRef<string | null>(null);
  const eventCursorRef = useRef<number | null>(null);
  const turnRuntimeRef = useRef<Map<string, { runtime: AgentRuntime; modelId: string | null }>>(new Map());
  const modelsRequestStartedRef = useRef(false);
  const mountedRef = useRef(true);
  const previewFrameRef = useRef<HTMLDivElement | null>(null);
  const previewCaptureStartRef = useRef<CapturePoint | null>(null);

  const selectedPathRef = useRef<string | null>(null);
  const pathsRef = useRef<string[]>([]);
  const fileContentRef = useRef<string | null>(null);
  const fileContentBaseRef = useRef<string | null>(null);
  const terminalEventSeqRef = useRef(0);
  const consoleOutputRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { activeSessionRef.current = activeSession; }, [activeSession]);
  useEffect(() => { draftAttachmentsRef.current = draftAttachments; }, [draftAttachments]);
  useEffect(() => { selectedRuntimeRef.current = selectedRuntime; }, [selectedRuntime]);
  useEffect(() => { turnInFlightRef.current = turnInFlight; }, [turnInFlight]);
  useEffect(() => { selectedPathRef.current = selectedPath; }, [selectedPath]);
  useEffect(() => { pathsRef.current = paths; }, [paths]);
  useEffect(() => { fileContentRef.current = fileContent; }, [fileContent]);
  useEffect(() => { fileContentBaseRef.current = fileContentBase; }, [fileContentBase]);
  const activeOpenHandsLibraryPresetId =
    selectedRuntime === "openhands"
      ? runtimeStateForSession(activeSession, "openhands")?.librarySnapshot?.presetItemId ?? null
      : null;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  function updateMessages(
    updater: ChatMessageView[] | ((prev: ChatMessageView[]) => ChatMessageView[]),
  ) {
    setMessages((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      messagesRef.current = next;
      return next;
    });
  }

  function appendConsoleEntry(entry: Omit<BrowserConsoleEntry, "id">): void {
    setConsoleEntries((prev) => [
      ...prev,
      {
        ...entry,
        id: crypto.randomUUID(),
      },
    ].slice(-MAX_CONSOLE_ENTRIES));
  }

  function activateSession(session: ChatSession | null) {
    activeSessionRef.current = session;
    setActiveSession(session);
    if (!session) return;
    selectedRuntimeRef.current = session.defaultRuntime;
    setSelectedRuntime(session.defaultRuntime);
  }

  function onResizeStart(e: ReactPointerEvent<HTMLDivElement>) {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = workspace.getBoundingClientRect();
    const updateWidth = (clientX: number) => {
      const next = ((clientX - rect.left) / rect.width) * 100;
      setChatWidthPct(Math.min(MAX_CHAT_WIDTH_PCT, Math.max(MIN_CHAT_WIDTH_PCT, next)));
    };
    updateWidth(e.clientX);
    const onPointerMove = (ev: PointerEvent) => updateWidth(ev.clientX);
    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
  }

  const sendRequest = useCallback(function sendRequest<T extends ProxyToBrowser>(
    msg: BrowserToProxy,
    requestId: string,
  ): Promise<T> {
    const ws = wsRef.current;
    return new Promise<T>((resolve, reject) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reject(new Error("ws not open"));
        return;
      }
      const timer = window.setTimeout(() => {
        pendingRef.current.delete(requestId);
        reject(new Error("request timeout"));
      }, REQUEST_TIMEOUT_MS);
      pendingRef.current.set(requestId, {
        resolve: (m) => resolve(m as T),
        reject,
        timer,
      });
      ws.send(JSON.stringify(msg));
    });
  }, []);

  const ensureProjectAgentsFile = useCallback(async (currentPaths: string[]) => {
    if (currentPaths.includes(PROJECT_AGENTS_PATH)) return;

    const readRequestId = crypto.randomUUID();
    const read = await sendRequest<Extract<ProxyToBrowser, { type: "file.content" }>>(
      { type: "file.read", requestId: readRequestId, path: PROJECT_AGENTS_PATH },
      readRequestId,
    );
    if (typeof read.content === "string") {
      setPaths((prev) => (
        prev.includes(PROJECT_AGENTS_PATH) ? prev : [...prev, PROJECT_AGENTS_PATH].sort()
      ));
      return;
    }
    if (read.error && read.error !== "not_found") return;

    const writeRequestId = crypto.randomUUID();
    const write = await sendRequest<Extract<ProxyToBrowser, { type: "file.write.result" }>>(
      {
        type: "file.write",
        requestId: writeRequestId,
        path: PROJECT_AGENTS_PATH,
        content: DEFAULT_PROJECT_AGENTS_CONTENT,
      },
      writeRequestId,
    );
    if (write.ok) {
      setPaths((prev) => (
        prev.includes(PROJECT_AGENTS_PATH) ? prev : [...prev, PROJECT_AGENTS_PATH].sort()
      ));
    }
  }, [sendRequest]);

  const requestFileList = useCallback(async (): Promise<string[]> => {
    const requestId = crypto.randomUUID();
    setFileListLoading(true);
    setFileListError(null);
    try {
      const reply = await sendRequest<Extract<ProxyToBrowser, { type: "file.list.result" }>>(
        { type: "file.list", requestId },
        requestId,
      );
      const sortedPaths = reply.paths.slice().sort();
      pathsRef.current = sortedPaths;
      setPaths(sortedPaths);
      void ensureProjectAgentsFile(sortedPaths).catch(() => undefined);
      return sortedPaths;
    } catch (err) {
      const message = err instanceof Error ? err.message : "request failed";
      setFileListError(`File list failed: ${message}`);
      return [];
    } finally {
      setFileListLoading(false);
    }
  }, [ensureProjectAgentsFile, sendRequest]);

  const applyDevIndicatorRuntime = useCallback(async (enabled: boolean) => {
    const res = await fetch(`/api/projects/${id}/next-devtools`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? "runtime update failed");
    }
  }, [id]);

  const writeProjectFile = useCallback(async (path: string, content: string) => {
    const requestId = crypto.randomUUID();
    const write = await sendRequest<Extract<ProxyToBrowser, { type: "file.write.result" }>>(
      { type: "file.write", requestId, path, content },
      requestId,
    );
    if (!write.ok) throw new Error(write.reason ?? `could not write ${path}`);
  }, [sendRequest]);

  const deleteProjectFile = useCallback(async (path: string) => {
    const requestId = crypto.randomUUID();
    const result = await sendRequest<Extract<ProxyToBrowser, { type: "file.delete.result" }>>(
      { type: "file.delete", requestId, path, cleanupEmptyParents: true },
      requestId,
    );
    if (!result.ok && result.reason !== "not_found") {
      throw new Error(result.reason ?? `could not delete ${path}`);
    }
  }, [sendRequest]);

  async function loadProjectEnv(): Promise<void> {
    if (envLoading) return;
    setEnvLoading(true);
    setEnvError(null);
    setEnvSyncWarning(null);
    try {
      const res = await fetch(`/api/projects/${id}/environment`, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { content?: unknown; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (typeof data.content !== "string") throw new Error("invalid environment response");
      setEnvContent(data.content);
      setEnvContentBase(data.content);
      setEnvSyncPending(false);
    } catch (err) {
      setEnvError(err instanceof Error ? err.message : "environment load failed");
    } finally {
      setEnvLoading(false);
    }
  }

  function openEnvPanel(): void {
    setTab("code");
    setEnvPanelOpen(true);
    setAgentConfigOpen(false);
    if (envContentBase === null && !envLoading) {
      void loadProjectEnv();
    }
  }

  async function loadAgentConfig(): Promise<void> {
    if (agentConfigLoading) return;
    setAgentConfigLoading(true);
    setAgentConfigError(null);
    setAgentConfigSyncWarning(null);
    try {
      const res = await fetch(`/api/projects/${id}/agent-config`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const body = data as { error?: string; message?: string };
        throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
      }
      setAgentConfig(normalizeProjectAgentConfigResponse(data));
    } catch (err) {
      setAgentConfigError(err instanceof Error ? err.message : "agent config load failed");
    } finally {
      setAgentConfigLoading(false);
    }
  }

  function openAgentConfigPanel(): void {
    setTab("code");
    setEnvPanelOpen(false);
    setAgentConfigOpen(true);
    if (!agentConfig && !agentConfigLoading) {
      void loadAgentConfig();
    }
  }

  async function saveProjectEnv(): Promise<void> {
    if (turnInFlight !== null || envSaving) return;
    setEnvSaving(true);
    setEnvError(null);
    setEnvSyncWarning(null);
    try {
      const res = await fetch(`/api/projects/${id}/environment`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: envContent }),
      });
      const data = (await res.json().catch(() => ({}))) as { content?: unknown; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (typeof data.content !== "string") throw new Error("invalid environment response");

      setEnvContent(data.content);
      setEnvContentBase(data.content);

      try {
        await writeProjectFile(PROJECT_ENV_PATH, data.content);
        setEnvSyncPending(false);
        setEnvSyncWarning(null);
        setPaths((prev) => (
          prev.includes(PROJECT_ENV_PATH) ? prev : [...prev, PROJECT_ENV_PATH].sort()
        ));
        markChanged(PROJECT_ENV_PATH);
        if (selectedPathRef.current === PROJECT_ENV_PATH) {
          setFileContent(data.content);
          setFileContentBase(data.content);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "sandbox sync failed";
        setEnvSyncPending(true);
        setEnvSyncWarning(`Saved to project settings, but .env sync failed: ${message}`);
      }
    } catch (err) {
      setEnvError(err instanceof Error ? err.message : "environment save failed");
    } finally {
      setEnvSaving(false);
    }
  }

  async function syncOpenHandsFiles(files: MaterializedAgentFile[]): Promise<void> {
    if (turnInFlight !== null) {
      throw new Error("an agent turn is running");
    }

    for (const file of files) {
      await writeProjectFile(file.path, file.content);
      setPaths((prev) => (
        prev.includes(file.path) ? prev : [...prev, file.path].sort()
      ));
      markChanged(file.path);
      if (selectedPathRef.current === file.path) {
        setFileContent(file.content);
        setFileContentBase(file.content);
      }
    }
  }

  async function saveAgentConfig(next: ProjectAgentConfigInput): Promise<void> {
    if (turnInFlight !== null || agentConfigSaving) return;
    setAgentConfigSaving(true);
    setAgentConfigError(null);
    setAgentConfigSyncWarning(null);
    try {
      const res = await fetch(`/api/projects/${id}/agent-config`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const body = data as { error?: string; message?: string };
        throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
      }
      const updated = normalizeProjectAgentConfigResponse({
        ...(agentConfig ?? {}),
        ...data,
      });
      setAgentConfig(updated);

      try {
        await syncOpenHandsFiles(updated.materializedFiles);
      } catch (err) {
        const message = err instanceof Error ? err.message : "sandbox sync failed";
        setAgentConfigSyncWarning(
          `Saved to project settings, but live OpenHands file sync failed: ${message}. Restart applies the managed config.`,
        );
      }
    } catch (err) {
      setAgentConfigError(err instanceof Error ? err.message : "agent config save failed");
    } finally {
      setAgentConfigSaving(false);
    }
  }

  const syncDevtoolsProjectFiles = useCallback(async (enabled: boolean) => {
    const stalePaths = staleNextDevtoolsCleanupPaths(pathsRef.current);
    const appPaths = resolveNextAppDevtoolsPaths(pathsRef.current);
    if (!appPaths) return;
    const layoutRequestId = crypto.randomUUID();
    const layout = await sendRequest<Extract<ProxyToBrowser, { type: "file.content" }>>(
      { type: "file.read", requestId: layoutRequestId, path: appPaths.layoutPath },
      layoutRequestId,
    );
    if (typeof layout.content === "string") {
      const nextLayout = ensureNextDevtoolsCssImport(layout.content);
      if (nextLayout !== layout.content) {
        await writeProjectFile(appPaths.layoutPath, nextLayout);
        if (selectedPathRef.current === appPaths.layoutPath) {
          setFileContent(nextLayout);
          setFileContentBase(nextLayout);
        }
      }
    }

    const nextCss = nextDevtoolsCssContent(enabled);
    await writeProjectFile(appPaths.cssPath, nextCss);
    setPaths((prev) => (
      prev.includes(appPaths.cssPath) ? prev : [...prev, appPaths.cssPath].sort()
    ));
    if (selectedPathRef.current === appPaths.cssPath) {
      setFileContent(nextCss);
      setFileContentBase(nextCss);
    }

    for (const stalePath of stalePaths) {
      await deleteProjectFile(stalePath);
      setPaths((prev) => prev.filter((path) => path !== stalePath));
      if (selectedPathRef.current === stalePath) {
        setSelectedPath(null);
        setFileContent(null);
        setFileContentBase(null);
      }
    }
  }, [deleteProjectFile, sendRequest, writeProjectFile]);

  const syncPreviewConsoleBridge = useCallback(async () => {
    const bridgePaths = resolveNextAppConsoleBridgePaths(pathsRef.current);
    if (!bridgePaths) return;

    const layoutRequestId = crypto.randomUUID();
    const layout = await sendRequest<Extract<ProxyToBrowser, { type: "file.content" }>>(
      { type: "file.read", requestId: layoutRequestId, path: bridgePaths.layoutPath },
      layoutRequestId,
    );
    if (typeof layout.content === "string") {
      const nextLayout = ensurePreviewConsoleBridge(layout.content);
      if (nextLayout !== layout.content) {
        await writeProjectFile(bridgePaths.layoutPath, nextLayout);
        if (selectedPathRef.current === bridgePaths.layoutPath) {
          setFileContent(nextLayout);
          setFileContentBase(nextLayout);
        }
      }
    }

    const bridgeContent = previewConsoleBridgeContent();
    await writeProjectFile(bridgePaths.componentPath, bridgeContent);
    setPaths((prev) => (
      prev.includes(bridgePaths.componentPath) ? prev : [...prev, bridgePaths.componentPath].sort()
    ));
    if (selectedPathRef.current === bridgePaths.componentPath) {
      setFileContent(bridgeContent);
      setFileContentBase(bridgeContent);
    }
  }, [sendRequest, writeProjectFile]);

  const loadDevIndicatorSetting = useCallback(async () => {
    const configPath = resolveNextConfigPath(pathsRef.current);
    const requestId = crypto.randomUUID();
    try {
      const reply = await sendRequest<Extract<ProxyToBrowser, { type: "file.content" }>>(
        { type: "file.read", requestId, path: configPath },
        requestId,
      );
      const currentConfig = typeof reply.content === "string" ? reply.content : nextConfigContent();
      const nextConfig = setNextDevIndicators(currentConfig, false);
      if (nextConfig !== reply.content) {
        await writeProjectFile(configPath, nextConfig);
        setPaths((prev) => (
          prev.includes(configPath) ? prev : [...prev, configPath].sort()
        ));
        if (selectedPathRef.current === configPath) {
          setFileContent(nextConfig);
          setFileContentBase(nextConfig);
        }
      }
      const enabled = nextDevIndicatorsEnabled(nextConfig);
      setDevIndicatorEnabled(enabled);
      setDevIndicatorError(null);
      await applyDevIndicatorRuntime(false).catch(() => undefined);
      await syncDevtoolsProjectFiles(false).catch(() => undefined);
    } catch (err) {
      setDevIndicatorError(err instanceof Error ? err.message : "failed");
      // The preview still works; this only affects the toolbar toggle.
    }
  }, [applyDevIndicatorRuntime, sendRequest, syncDevtoolsProjectFiles, writeProjectFile]);

  const loadOpenRouterModels = useCallback(async (retry = false): Promise<void> => {
    if (!retry && (openRouterModels.length > 0 || modelsRequestStartedRef.current)) return;

    modelsRequestStartedRef.current = true;
    setModelsLoading(true);
    setModelsError(null);
    try {
      const res = await fetch(`/api/projects/${id}/models`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { models: ModelOption[] };
      if (mountedRef.current) setOpenRouterModels(data.models);
    } catch (err) {
      if (mountedRef.current) setModelsError(err instanceof Error ? err.message : "models unavailable");
    } finally {
      if (mountedRef.current) setModelsLoading(false);
    }
  }, [id, openRouterModels.length]);

  const refreshChatSessions = useCallback(async () => {
    const res = await fetch(`/api/projects/${id}/sessions`);
    if (!res.ok) return;
    const data = (await res.json()) as { sessions: ChatSession[] };
    setChatSessions(data.sessions);
    const current = activeSessionRef.current;
    if (current) {
      const updated = data.sessions.find((s) => s.id === current.id);
      if (updated) activateSession(updated);
    }
  }, [id]);

  const refreshRunEvents = useCallback(async (): Promise<void> => {
    const runsRes = await fetch(`/api/projects/${id}/runs`, { cache: "no-store" });
    if (!runsRes.ok) return;
    const runsData = (await runsRes.json()) as {
      queueState: ProjectRunQueueState;
    };
    const replayRunIds = new Set(
      [runsData.queueState.activeRunId, runsData.queueState.blockedRunId]
        .filter((runId): runId is string => Boolean(runId)),
    );
    setTurnInFlight(runsData.queueState.activeRunId);
    if (runsData.queueState.state !== "RUNNING") {
      setReviewingActive(false);
    }

    const after = eventCursorRef.current;
    const eventsRes = await fetch(
      `/api/projects/${id}/events${after === null ? "" : `?after=${after}`}`,
      { cache: "no-store" },
    );
    if (!eventsRes.ok) return;
    const eventsData = (await eventsRes.json()) as { events: SerializableRunEvent[] };
    const events = eventsData.events;
    if (events.length === 0) return;

    const maxSequence = Math.max(...events.map((event) => event.sequence));
    const eventsToApply = after === null
      ? events.filter((event) => replayRunIds.has(event.runId))
      : events;
    for (const event of eventsToApply) {
      const proxyEvent = proxyEventFromRunEvent(event);
      if (proxyEvent) handleEventRef.current(proxyEvent);
    }
    eventCursorRef.current = Math.max(eventCursorRef.current ?? 0, maxSequence);
  }, [id]);

  const loadChatSession = useCallback(async (sessionId: string) => {
    if (turnInFlight) return;
    setSessionLoading(true);
    try {
      const res = await fetch(`/api/projects/${id}/sessions/${sessionId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { session: ChatSession & { messages: DbMessage[] } };
      const { messages: dbMessages, ...session } = data.session;
      activateSession(session);
      setChatSessions((prev) => {
        const next = prev.filter((s) => s.id !== session.id);
        return [session, ...next].sort(
          (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
        );
      });
      updateMessages(messagesFromDb(dbMessages));
      setDraftAttachments([]);
      setAttachmentError(null);
    } finally {
      setSessionLoading(false);
    }
  }, [id, turnInFlight]);

  async function createChatSession() {
    if (turnInFlight) return;
    const res = await fetch(`/api/projects/${id}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "New chat", runtime: selectedRuntimeRef.current }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { session: ChatSession };
    activateSession(data.session);
    setChatSessions((prev) => [data.session, ...prev]);
    updateMessages([]);
    setPrompt("");
    setDraftAttachments([]);
    setAttachmentError(null);
  }

  async function syncRuntimeState(
    runtime: AgentRuntime,
    providerSessionId: string,
    modelId?: string,
    libraryPresetItemId?: string | null,
  ) {
    const session = activeSessionRef.current;
    if (!session) return;
    const existingState = runtimeStateForSession(session, runtime);
    if (
      libraryPresetItemId === undefined &&
      existingState &&
      existingState.providerSessionId === providerSessionId &&
      existingState.modelId === (modelId ?? existingState.modelId ?? null)
    ) {
      return;
    }

    const nextState: RuntimeState = {
      runtime,
      providerSessionId,
      modelId: modelId ?? null,
      lastUsedAt: new Date().toISOString(),
      ...(existingState?.librarySnapshot ? { librarySnapshot: existingState.librarySnapshot } : {}),
    };
    const nextSession = {
      ...session,
      runtimeStates: [
        nextState,
        ...session.runtimeStates.filter((state) => state.runtime !== runtime),
      ],
    };
    activeSessionRef.current = nextSession;
    activateSession(nextSession);
    setChatSessions((prev) =>
      prev.map((s) =>
        s.id === session.id
          ? {
              ...s,
              runtimeStates: [
                nextState,
                ...s.runtimeStates.filter((state) => state.runtime !== runtime),
              ],
            }
          : s,
      ),
    );

    const res = await fetch(`/api/projects/${id}/sessions/${session.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        runtimeState: {
          runtime,
          providerSessionId,
          ...(modelId ? { modelId } : {}),
          ...(libraryPresetItemId ? { libraryPresetItemId } : {}),
        },
      }),
    }).catch(() => null);
    if (res?.ok) {
      void refreshChatSessions();
    }
  }

  function selectLibraryPreset(presetId: string): void {
    setSelectedLibraryPresetId(presetId);
    const session = activeSessionRef.current;
    if (!session || selectedRuntimeRef.current !== "openhands") return;
    const runtimeState = runtimeStateForSession(session, "openhands");
    if (!runtimeState) return;
    void syncRuntimeState(
      "openhands",
      runtimeState.providerSessionId,
      runtimeState.modelId ?? undefined,
      libraryPresetItemIdForRuntimeSync({
        selectedLibraryPresetId: presetId,
        librarySnapshot: runtimeState.librarySnapshot,
      }) ?? presetId,
    );
  }

  async function setSessionDefaultRuntime(runtime: AgentRuntime) {
    const session = activeSessionRef.current;
    if (!session || session.defaultRuntime === runtime) {
      setSelectedRuntime(runtime);
      return;
    }

    const nextSession = { ...session, defaultRuntime: runtime };
    activateSession(nextSession);
    setSelectedRuntime(runtime);
    setChatSessions((prev) => prev.map((entry) => (entry.id === session.id ? nextSession : entry)));

    await fetch(`/api/projects/${id}/sessions/${session.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ defaultRuntime: runtime }),
    }).catch(() => undefined);
  }

  function markChanged(path: string) {
    setRecentlyChanged((prev) => {
      const next = new Set(prev);
      next.add(path);
      return next;
    });
    window.setTimeout(() => {
      setRecentlyChanged((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    }, BADGE_DURATION_MS);
  }

  async function refreshOpenFile(path: string) {
    const requestId = crypto.randomUUID();
    try {
      const reply = await sendRequest<Extract<ProxyToBrowser, { type: "file.content" }>>(
        { type: "file.read", requestId, path },
        requestId,
      );
      if (reply.error) {
        setSaveIndicator("error");
        setSaveError(reply.error);
        return;
      }
      if (typeof reply.content === "string") {
        setFileContent(reply.content);
        setFileContentBase(reply.content);
      }
    } catch {
      // swallow — WS drop surfaces via wsStatus
    }
  }

  function handleEvent(ev: ProxyToBrowser) {
    const maybeRequestId = (ev as { requestId?: string }).requestId;
    if (maybeRequestId && pendingRef.current.has(maybeRequestId)) {
      const entry = pendingRef.current.get(maybeRequestId)!;
      clearTimeout(entry.timer);
      pendingRef.current.delete(maybeRequestId);
      entry.resolve(ev);
      return;
    }

    if (ev.type === "terminal.output") {
      terminalEventSeqRef.current += 1;
      setTerminalEvent({ seq: terminalEventSeqRef.current, event: ev });
      return;
    }

    if (ev.type === "terminal.ready") {
      terminalEventSeqRef.current += 1;
      setTerminalEvent({ seq: terminalEventSeqRef.current, event: ev });
      return;
    }

    if (ev.type === "terminal.exit") {
      terminalEventSeqRef.current += 1;
      setTerminalEvent({ seq: terminalEventSeqRef.current, event: ev });
      return;
    }

    if (ev.type === "agent.session") {
      const runtimeMeta = turnRuntimeRef.current.get(ev.turnId);
      void syncRuntimeState(ev.runtime, ev.providerSessionId, ev.modelId ?? runtimeMeta?.modelId ?? undefined);
      if (runtimeMeta) {
        turnRuntimeRef.current.set(ev.turnId, {
          runtime: ev.runtime,
          modelId: ev.modelId ?? runtimeMeta.modelId,
        });
      }
      return;
    }

    if (ev.type === "agent.status") {
      if (ev.phase === "reviewing") setReviewingActive(true);
      if (ev.phase === "done") {
        setTurnInFlight(null);
        setReviewingActive(false);
      }
      return;
    }
    if (ev.type === "agent.chunk") {
      const evAgentId = (ev as { agentId?: string }).agentId;
      const runtimeMeta = turnRuntimeRef.current.get(ev.turnId);
      updateMessages((msgs) => {
        for (let i = msgs.length - 1; i >= 0; i--) {
          const m = msgs[i];
          if (m.kind !== "agent") continue;
          if (m.turnId !== ev.turnId) break;
          if (m.agentId === evAgentId) {
            const next = msgs.slice();
            next[i] = {
              ...m,
              runtime: runtimeMeta?.runtime ?? m.runtime,
              modelId: runtimeMeta?.modelId ?? m.modelId ?? null,
              text: appendAgentDelta(m.text, ev.delta),
            };
            return next;
          }
          break;
        }
        return [
          ...msgs,
          {
            kind: "agent",
            turnId: ev.turnId,
            agentId: evAgentId,
            runtime: runtimeMeta?.runtime,
            modelId: runtimeMeta?.modelId ?? null,
            text: ev.delta,
            streaming: true,
            tools: [],
            footer: null,
          },
        ];
      });
      return;
    }
    if (ev.type === "agent.tool_use") {
      const evAgentId = (ev as { agentId?: string }).agentId;
      const runtimeMeta = turnRuntimeRef.current.get(ev.turnId);
      updateMessages((msgs) => {
        const label = summariseTool(ev.tool, ev.input);
        for (let i = msgs.length - 1; i >= 0; i--) {
          const m = msgs[i];
          if (m.kind !== "agent") continue;
          if (m.turnId !== ev.turnId) break;
          if (m.agentId === evAgentId) {
            const next = msgs.slice();
            next[i] = {
              ...m,
              runtime: runtimeMeta?.runtime ?? m.runtime,
              modelId: runtimeMeta?.modelId ?? m.modelId ?? null,
              tools: [...m.tools, label],
            };
            return next;
          }
          break;
        }
        return [
          ...msgs,
          {
            kind: "agent",
            turnId: ev.turnId,
            agentId: evAgentId,
            runtime: runtimeMeta?.runtime,
            modelId: runtimeMeta?.modelId ?? null,
            text: "",
            streaming: true,
            tools: [label],
            footer: null,
          },
        ];
      });
      return;
    }
    if (ev.type === "agent.done") {
      updateMessages((msgs) => {
        const footer = formatDoneFooter(ev);
        for (let i = msgs.length - 1; i >= 0; i--) {
          const m = msgs[i];
          if (m.kind !== "agent") continue;
          if (m.turnId !== ev.turnId) break;
          const next = msgs.slice();
          next[i] = { ...m, streaming: false, footer };
          return next;
        }
        return msgs;
      });
      turnRuntimeRef.current.delete(ev.turnId);
      setTurnInFlight(null);
      setReviewingActive(false);
      return;
    }
    if (ev.type === "agent.error") {
      const evAgentId = (ev as { agentId?: string }).agentId;
      const runtimeMeta = turnRuntimeRef.current.get(ev.turnId);
      updateMessages((msgs) => [
        ...msgs,
        {
          kind: "error",
          turnId: ev.turnId,
          agentId: evAgentId,
          runtime: runtimeMeta?.runtime,
          modelId: runtimeMeta?.modelId ?? null,
          text: ev.message,
        },
      ]);
      turnRuntimeRef.current.delete(ev.turnId);
      setTurnInFlight(null);
      setReviewingActive(false);
      return;
    }

    if (ev.type === "file.changed") {
      setPaths((prev) => {
        if (ev.event === "add" && !prev.includes(ev.path)) return [...prev, ev.path].sort();
        if (ev.event === "unlink") return prev.filter((p) => p !== ev.path);
        return prev;
      });
      markChanged(ev.path);
      if (ev.event === "change" && ev.path === selectedPathRef.current) {
        const dirty = fileContentRef.current !== fileContentBaseRef.current;
        if (!dirty) {
          void refreshOpenFile(ev.path);
        }
      }
      return;
    }
  }

  useEffect(() => { handleEventRef.current = handleEvent; });

  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    if (!stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const el = consoleOutputRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [consoleEntries]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      if (!isPreviewConsoleMessage(event.data)) return;
      appendConsoleEntry({
        level: event.data.level,
        values: event.data.values,
        timestamp: event.data.timestamp,
        url: event.data.url,
      });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (!previewCaptureActive) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      previewCaptureStartRef.current = null;
      setPreviewCaptureActive(false);
      setPreviewCaptureSelection(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [previewCaptureActive]);

  function onChatScroll(e: React.UIEvent<HTMLUListElement>) {
    const el = e.currentTarget;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 48;
  }

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    async function loadOnce() {
      const res = await fetch(`/api/projects/${id}`);
      if (!res.ok) return;
      const data = (await res.json()) as { project: Project };
      if (cancelled) return;
      setProject(data.project);
      setChatSessions(data.project.chatSessions);
      const initialSession = data.project.chatSessions[0] ?? data.project.chatSession;
      activateSession(initialSession);
      if (initialSession && data.project.status !== "PROVISIONING") {
        const sessionRes = await fetch(`/api/projects/${id}/sessions/${initialSession.id}`);
        if (sessionRes.ok && !cancelled) {
          const sessionData = (await sessionRes.json()) as {
            session: ChatSession & { messages: DbMessage[] };
          };
          const { messages: dbMessages, ...session } = sessionData.session;
          activateSession(session);
          updateMessages(messagesFromDb(dbMessages));
          setDraftAttachments([]);
          setAttachmentError(null);
        }
      }
      if (data.project.status === "PROVISIONING") {
        timer = window.setTimeout(loadOnce, POLL_INTERVAL_MS);
      }
    }
    loadOnce();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [id]);

  async function reloadProjectSnapshot(): Promise<Project> {
    const res = await fetch(`/api/projects/${id}`, { cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as { project?: Project; error?: string };
    if (!res.ok || !data.project) {
      throw new Error(data.error ?? `HTTP ${res.status}`);
    }
    setProject(data.project);
    setChatSessions(data.project.chatSessions);
    activateSession(data.project.chatSessions[0] ?? data.project.chatSession);
    return data.project;
  }

  async function restartSandbox() {
    if (sandboxRestarting || turnInFlight !== null) return;
    setSandboxRestarting(true);
    setSandboxRestartError(null);
    setBrokerReadyProjectId(null);
    setWsStatus("idle");
    setWorkspaceWs(null);
    wsRef.current?.close();
    try {
      const res = await fetch(`/api/projects/${id}/restart`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) {
        throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      }
      await reloadProjectSnapshot();
      setPaths([]);
      setRecentlyChanged(new Set());
      setSelectedPath(null);
      setFileContent(null);
      setFileContentBase(null);
      setFileListError(null);
      setDevIndicatorEnabled(null);
      setPreviewReloadKey((key) => key + 1);
    } catch (err) {
      setSandboxRestartError(err instanceof Error ? err.message : "restart failed");
      await reloadProjectSnapshot().catch(() => {});
    } finally {
      setSandboxRestarting(false);
    }
  }

  useEffect(() => {
    if (project?.status !== "RUNNING") return;
    const base = process.env.NEXT_PUBLIC_WS_PROXY_URL ?? "ws://localhost:4100";
    let unmounted = false;
    let reconnectAttempt = 0;
    let reconnectTimer: number | null = null;
    let currentWs: WebSocket | null = null;

    const connect = () => {
      if (unmounted) return;
      setWsStatus("connecting");
      const ws = new WebSocket(`${base}/p/${id}`);
      currentWs = ws;
        wsRef.current = ws;
      ws.onopen = () => {
        if (unmounted) return;
        reconnectAttempt = 0;
        setWsStatus("open");
        setWorkspaceWs(ws);
        setBrokerReadyProjectId(id);
        void (async () => {
          await requestFileList();
          await loadDevIndicatorSetting();
          await syncPreviewConsoleBridge().catch(() => undefined);
        })();
      };
      ws.onerror = () => {
        if (unmounted) return;
        setFileListError((prev) => prev ?? "File list failed: websocket error");
        setFileListLoading(false);
      };
      ws.onclose = () => {
        if (unmounted) return;
        setWsStatus("closed");
        setWorkspaceWs((current) => (current === ws ? null : current));
        setFileListLoading(false);
        for (const [requestId, entry] of pendingRef.current) {
          clearTimeout(entry.timer);
          entry.reject(new Error("ws closed"));
          pendingRef.current.delete(requestId);
        }
        reconnectAttempt += 1;
        const delay = Math.min(1000 * 2 ** Math.min(reconnectAttempt - 1, 4), 10_000);
        console.log(`[ws] close — reconnecting in ${delay}ms (attempt ${reconnectAttempt})`);
        reconnectTimer = window.setTimeout(connect, delay);
      };
      ws.onmessage = (ev) => {
        let parsed: ProxyToBrowser;
        try {
          parsed = JSON.parse(ev.data as string) as ProxyToBrowser;
        } catch {
          return;
        }
        if (isAgentStreamEvent(parsed)) return;
        handleEventRef.current(parsed);
      };
    };

    connect();

    return () => {
      unmounted = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      setWorkspaceWs((current) => (current === currentWs ? null : current));
      currentWs?.close();
    };
  }, [
    project?.status,
    project?.daytonaSandboxId,
    id,
    requestFileList,
    loadDevIndicatorSetting,
    syncPreviewConsoleBridge,
  ]);

  useEffect(() => {
    if (project?.status !== "RUNNING") return;
    let cancelled = false;
    let timer: number | null = null;
    const poll = () => {
      void refreshRunEvents()
        .catch(() => undefined)
        .finally(() => {
          if (cancelled) return;
          timer = window.setTimeout(poll, EVENT_POLL_INTERVAL_MS);
        });
    };
    poll();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [project?.status, refreshRunEvents]);

  useEffect(() => {
    if (!supportsOpenRouterModelPicker(selectedRuntime)) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void loadOpenRouterModels();
    });
    return () => {
      cancelled = true;
    };
  }, [loadOpenRouterModels, selectedRuntime]);

  useEffect(() => {
    queueMicrotask(() => {
      if (mountedRef.current) setSelectedLibraryPresetId(activeOpenHandsLibraryPresetId);
    });
  }, [activeOpenHandsLibraryPresetId]);

  useEffect(() => {
    if (selectedRuntime !== "openhands") return;
    let cancelled = false;
    fetch("/api/library?type=WORKFLOW_PRESET")
      .then((response) => (response.ok ? response.json() : { items: [] }))
      .then((body: { items?: LibraryPresetApiItem[] }) => {
        if (!cancelled) setLibraryPresets((body.items ?? []).filter(isSelectableLibraryPreset));
      })
      .catch(() => {
        if (!cancelled) setLibraryPresets([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRuntime]);

  async function onSelectFile(path: string) {
    if (path === selectedPath) return;
    setSelectedPath(path);
    setFileContent(null);
    setFileContentBase(null);
    setSaveIndicator("idle");
    setSaveError(null);
    setTab("code");
    const requestId = crypto.randomUUID();
    try {
      const reply = await sendRequest<Extract<ProxyToBrowser, { type: "file.content" }>>(
        { type: "file.read", requestId, path },
        requestId,
      );
      if (reply.error) {
        setSaveIndicator("error");
        setSaveError(reply.error);
        return;
      }
      if (typeof reply.content === "string") {
        setFileContent(reply.content);
        setFileContentBase(reply.content);
      }
    } catch {
      setSaveIndicator("error");
      setSaveError("request timeout");
    }
  }

  const onSave = useCallback(async () => {
    const path = selectedPathRef.current;
    const content = fileContentRef.current;
    if (!path || content === null) return;
    if (turnInFlight !== null) return;
    const requestId = crypto.randomUUID();
    setSaveIndicator("idle");
    setSaveError(null);
    try {
      const reply = await sendRequest<Extract<ProxyToBrowser, { type: "file.write.result" }>>(
        { type: "file.write", requestId, path, content },
        requestId,
      );
      if (reply.ok) {
        setFileContentBase(content);
        setSaveIndicator("saved");
        window.setTimeout(() => setSaveIndicator((s) => (s === "saved" ? "idle" : s)), 1500);
      } else {
        setSaveIndicator("error");
        setSaveError(reply.reason ?? "unknown");
      }
    } catch {
      setSaveIndicator("error");
      setSaveError("request timeout");
    }
  }, [sendRequest, turnInFlight]);

  async function toggleDevIndicator() {
    if (turnInFlight !== null || devIndicatorSaving) return;
    const configPath = resolveNextConfigPath(pathsRef.current);
    const requestId = crypto.randomUUID();
    setDevIndicatorSaving(true);
    setDevIndicatorError(null);
    try {
      const read = await sendRequest<Extract<ProxyToBrowser, { type: "file.content" }>>(
        { type: "file.read", requestId, path: configPath },
        requestId,
      );
      const currentConfig = typeof read.content === "string" ? read.content : nextConfigContent();
      const nextConfig = setNextDevIndicators(currentConfig, false);
      await writeProjectFile(configPath, nextConfig);
      await syncDevtoolsProjectFiles(false);
      await applyDevIndicatorRuntime(false);
      setDevIndicatorEnabled(false);
      setPaths((prev) => (
        prev.includes(configPath) ? prev : [...prev, configPath].sort()
      ));
      if (selectedPathRef.current === configPath) {
        setFileContent(nextConfig);
        setFileContentBase(nextConfig);
      }
      setPreviewReloadKey((key) => key + 1);
    } catch (err) {
      setDevIndicatorError(err instanceof Error ? err.message : "failed");
    } finally {
      setDevIndicatorSaving(false);
    }
  }

  function setSessionRuntimeModel(modelId: string) {
    const session = activeSessionRef.current;
    const runtime = selectedRuntimeRef.current;
    if (!session || !supportsOpenRouterModelPicker(runtime)) return;

    const runtimeState = runtimeStateForSession(session, runtime);
    const providerSessionId = runtimeState?.providerSessionId ?? crypto.randomUUID();
    void syncRuntimeState(runtime, providerSessionId, modelId);
  }

  function retryOpenRouterModels() {
    modelsRequestStartedRef.current = false;
    void loadOpenRouterModels(true);
  }

  function previewCaptureBounds(): CaptureRect | null {
    const frame = previewFrameRef.current;
    if (!frame) return null;
    const rect = frame.getBoundingClientRect();
    return {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    };
  }

  function previewCaptureSelectionFromPointer(
    start: CapturePoint,
    current: CapturePoint,
  ): { viewport: CaptureRect; local: CaptureRect } | null {
    const bounds = previewCaptureBounds();
    if (!bounds) return null;
    const viewport = normalizeDragRect(start, current, bounds);
    return {
      viewport,
      local: {
        x: viewport.x - bounds.x,
        y: viewport.y - bounds.y,
        width: viewport.width,
        height: viewport.height,
      },
    };
  }

  async function addPreviewCapture(selection: CaptureRect) {
    if (draftAttachmentsRef.current.length >= MAX_CHAT_IMAGES) {
      setAttachmentError(`You can attach up to ${MAX_CHAT_IMAGES} images`);
      return;
    }

    setPreviewCaptureBusy(true);
    setPreviewCaptureActive(false);
    setAttachmentError(null);
    try {
      const dataUrl = await captureViewportSelectionAsPngDataUrl(selection);
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const attachment = imageAttachmentFromDataUrl(dataUrl, `preview-capture-${timestamp}.png`);
      if (attachment.size > MAX_CHAT_IMAGE_BYTES) {
        setAttachmentError(`Screenshot is larger than ${formatBytes(MAX_CHAT_IMAGE_BYTES)}`);
        return;
      }
      setDraftAttachments((prev) => [...prev, attachment].slice(0, MAX_CHAT_IMAGES));
    } catch (err) {
      const message = err instanceof DOMException && err.name === "NotAllowedError"
        ? "Screen capture was cancelled"
        : err instanceof Error
          ? err.message
          : "Screen capture failed";
      setAttachmentError(message);
    } finally {
      setPreviewCaptureBusy(false);
    }
  }

  function togglePreviewCapture() {
    if (previewCaptureBusy) return;
    previewCaptureStartRef.current = null;
    setPreviewCaptureSelection(null);
    setPreviewCaptureActive((active) => !active);
  }

  function onPreviewCapturePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (previewCaptureBusy || e.button !== 0) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY };
    previewCaptureStartRef.current = start;
    e.currentTarget.setPointerCapture(e.pointerId);
    setPreviewCaptureSelection(previewCaptureSelectionFromPointer(start, start));
  }

  function onPreviewCapturePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const start = previewCaptureStartRef.current;
    if (!start || previewCaptureBusy) return;
    setPreviewCaptureSelection(previewCaptureSelectionFromPointer(start, { x: e.clientX, y: e.clientY }));
  }

  function finishPreviewCapturePointer(e: ReactPointerEvent<HTMLDivElement>) {
    const start = previewCaptureStartRef.current;
    if (!start) return;
    e.preventDefault();
    previewCaptureStartRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    const selection = previewCaptureSelectionFromPointer(start, { x: e.clientX, y: e.clientY });
    setPreviewCaptureSelection(null);
    if (!selection || !isUsableCaptureRect(selection.viewport)) {
      setAttachmentError("Capture area is too small");
      return;
    }
    void addPreviewCapture(selection.viewport);
  }

  async function addImageFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    const rejected: string[] = [];
    const current = draftAttachmentsRef.current;
    const slots = Math.max(0, MAX_CHAT_IMAGES - current.length);
    const candidates = files
      .filter((file) => {
        if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
          rejected.push(`${file.name || "file"} is not a supported image`);
          return false;
        }
        if (file.size > MAX_CHAT_IMAGE_BYTES) {
          rejected.push(`${file.name || "image"} is larger than ${formatBytes(MAX_CHAT_IMAGE_BYTES)}`);
          return false;
        }
        return true;
      })
      .slice(0, slots);

    if (files.length > candidates.length + rejected.length || slots === 0) {
      rejected.push(`You can attach up to ${MAX_CHAT_IMAGES} images`);
    }

    if (candidates.length === 0) {
      setAttachmentError(rejected[0] ?? "No supported images found");
      return;
    }

    try {
      const next = await Promise.all(candidates.map(readImageFile));
      setDraftAttachments((prev) => [...prev, ...next].slice(0, MAX_CHAT_IMAGES));
      setAttachmentError(rejected[0] ?? null);
    } catch (err) {
      setAttachmentError(err instanceof Error ? err.message : "Image could not be read");
    }
  }

  function onPromptPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData.files).filter((file) => ACCEPTED_IMAGE_TYPES.has(file.type));
    if (files.length > 0) {
      void addImageFiles(files);
    }
  }

  function onChatDragOver(e: DragEvent<HTMLElement>) {
    if (!hasImageDataTransferItems(e.dataTransfer.items)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDraggingImages(true);
  }

  function onChatDragLeave(e: DragEvent<HTMLElement>) {
    const next = e.relatedTarget;
    if (next instanceof Node && e.currentTarget.contains(next)) return;
    setDraggingImages(false);
  }

  function onChatDrop(e: DragEvent<HTMLElement>) {
    if (!hasImageFiles(e.dataTransfer.files)) return;
    e.preventDefault();
    setDraggingImages(false);
    void addImageFiles(e.dataTransfer.files);
  }

  function removeDraftAttachment(id: string) {
    setDraftAttachments((prev) => prev.filter((attachment) => attachment.id !== id));
    setAttachmentError(null);
  }

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    const attachments = draftAttachmentsRef.current;
    const text = prompt.trim() || (attachments.length > 0 ? "Use the attached image as context." : "");
    const session = activeSessionRef.current;
    const runtime = selectedRuntimeRef.current;
    const runtimeState = runtimeStateForSession(session, runtime);
    const providerSessionId = runtimeState?.providerSessionId ?? crypto.randomUUID();
    const modelId = runtimeState?.modelId ?? null;
    if (!text || !session) return;
    if (attachments.length > 0) {
      setAttachmentError("Image attachments are not supported for queued durable runs yet");
      return;
    }
    const res = await fetch(`/api/projects/${id}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: session.id,
        prompt: text,
        runtime,
        providerSessionId,
        ...(modelId ? { modelId } : {}),
        ...(runtime === "openhands" && selectedLibraryPresetId ? { libraryPresetItemId: selectedLibraryPresetId } : {}),
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { runId?: string; error?: string };
    if (!res.ok || !data.runId) {
      updateMessages((msgs) => [
        ...msgs,
        {
          kind: "error",
          turnId: null,
          text: data.error ?? `Run could not be queued (HTTP ${res.status})`,
        },
      ]);
      return;
    }
    const runId = data.runId;

    turnRuntimeRef.current.set(runId, { runtime, modelId });
    updateMessages((msgs) => [...msgs, { kind: "user", turnId: runId, text }]);
    if (!turnInFlightRef.current) {
      setTurnInFlight(runId);
    }
    setPrompt("");
    setDraftAttachments([]);
    setAttachmentError(null);
    void refreshChatSessions();
    void refreshRunEvents();
  }

  function onAbort() {
    if (!turnInFlight) return;
    fetch(`/api/projects/${id}/runs/${turnInFlight}/cancel`, {
      method: "POST",
    }).catch(() => undefined);
  }

  if (!project) {
    return (
      <WorkspaceLoadingState
        title="Opening workspace..."
        description="Checking project status before the editor loads."
      />
    );
  }

  if (project.status === "PROVISIONING") {
    return (
      <WorkspaceLoadingState
        title="Opening workspace..."
        description="Project services are starting. The workspace will open automatically."
      />
    );
  }

  if (project.status !== "RUNNING") {
    return (
      <main className="flex min-h-dvh flex-1 items-center justify-center bg-background p-6">
        <section className="w-full max-w-xl rounded-lg border border-destructive/25 bg-card p-6 shadow-sm">
          <Button asChild variant="ghost" className="mb-5 w-fit">
            <Link href="/">
              <ArrowLeft />
              Back
            </Link>
          </Button>
          <div className="flex items-start gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-destructive/25 bg-destructive/10">
              <AlertTriangle className="size-5 text-red-200" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-red-100">
                Project {project.status.toLowerCase()}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">The workspace is not available right now.</p>
            </div>
          </div>
        {project.provisioningError && (
          <pre className="mt-4 max-w-full overflow-auto rounded-md border border-destructive/25 bg-background p-3 text-left font-mono text-xs text-red-100">
            {project.provisioningError}
          </pre>
        )}
        </section>
      </main>
    );
  }

  if (brokerReadyProjectId !== id) {
    return (
      <WorkspaceLoadingState
        title="Opening workspace..."
        description="Project services are almost ready. The workspace will open automatically."
      />
    );
  }

  const dirty = fileContent !== null && fileContent !== fileContentBase;
  const envDirty = envContentBase !== null && envContent !== envContentBase;
  const envSaveEnabled = envDirty || envSyncPending;
  const editorReadOnly = turnInFlight !== null;
  const wsOpen = wsStatus === "open";
  const showModelPicker = supportsOpenRouterModelPicker(selectedRuntime);
  const selectedModelId = selectedModelForSession(activeSession, selectedRuntime);

  return (
    <main className="fixed inset-0 flex h-dvh flex-col overflow-hidden bg-background">
      <header className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Button asChild variant="ghost" size="icon" aria-label="Back to projects">
            <Link href="/">
              <ArrowLeft />
            </Link>
          </Button>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-base font-semibold">{project.name}</h1>
              <Badge variant="success">running</Badge>
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              {wsOpen ? (
                <Wifi className="size-3.5 text-emerald-300" aria-hidden="true" />
              ) : (
                <WifiOff className="size-3.5" aria-hidden="true" />
              )}
              <span>WS: {wsStatus}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {sandboxRestartError && (
            <span
              role="status"
              className="hidden max-w-xs truncate text-xs text-red-200 sm:inline"
              title={sandboxRestartError}
            >
              {sandboxRestartError}
            </span>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Restart sandbox"
            title="Restart sandbox"
            disabled={sandboxRestarting || turnInFlight !== null}
            onClick={() => void restartSandbox()}
          >
            {sandboxRestarting ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          </Button>
          <Button
            type="button"
            variant={agentConfigOpen ? "secondary" : "ghost"}
            size="icon-sm"
            aria-label="Edit agent config"
            title="Edit agent config"
            disabled={wsStatus !== "open"}
            aria-pressed={agentConfigOpen}
            onClick={openAgentConfigPanel}
          >
            <Settings2 />
          </Button>
          <Badge variant={turnInFlight ? "warning" : "outline"} className="hidden sm:inline-flex">
            {turnInFlight ? "agent busy" : "ready"}
          </Badge>
        </div>
      </header>

      <div ref={workspaceRef} className="flex min-h-0 flex-1 overflow-hidden">
        <section
          className={cn(
            "relative flex min-h-0 min-w-[280px] flex-col overflow-hidden border-r border-border bg-card max-md:min-w-0 max-md:flex-[0_0_42%]",
            draggingImages && "ring-2 ring-inset ring-primary",
          )}
          style={{ flexBasis: `${chatWidthPct}%` }}
          onDragOver={onChatDragOver}
          onDragLeave={onChatDragLeave}
          onDrop={onChatDrop}
        >
          {draggingImages && (
            <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-lg border border-dashed border-primary bg-background/75 text-sm font-medium text-primary">
              Drop images to attach
            </div>
          )}
          <div className="flex min-h-12 shrink-0 items-center justify-between border-b border-border px-3">
            <div className="flex items-center gap-2">
              <MessageSquare className="size-4 text-primary" aria-hidden="true" />
              <h2 className="max-w-[12rem] truncate text-sm font-semibold">
                {activeSession?.title ?? "Chat"}
              </h2>
              {activeSession && (
                <Badge variant="outline" className="hidden sm:inline-flex">
                  {runtimeLabel(selectedRuntime)}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              {turnInFlight && <Badge variant="warning">streaming</Badge>}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="New chat"
                disabled={turnInFlight !== null}
                onClick={createChatSession}
              >
                <Plus />
              </Button>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-border bg-background/45 px-3 py-2">
            <History className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {chatSessions.map((s) => (
              <Button
                key={s.id}
                type="button"
                variant={activeSession?.id === s.id ? "secondary" : "ghost"}
                size="sm"
                disabled={turnInFlight !== null || sessionLoading}
                onClick={() => void loadChatSession(s.id)}
                className="max-w-44 shrink-0 justify-start"
                title={s.title}
              >
                <span className="truncate">{s.title}</span>
                {s._count.messages > 0 && (
                  <span className="ml-1 text-xs text-muted-foreground">{s._count.messages}</span>
                )}
              </Button>
            ))}
          </div>
          <div className="flex shrink-0 flex-col gap-2 border-b border-border bg-background/45 px-3 py-2">
            <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
              {project.availableRuntimes.map((option) => {
                const active = selectedRuntime === option.value;
                return (
                  <Button
                    key={option.value}
                    type="button"
                    variant={active ? "secondary" : "ghost"}
                    size="sm"
                    disabled={turnInFlight !== null || sessionLoading || !activeSession}
                    onClick={() => void setSessionDefaultRuntime(option.value)}
                    className="shrink-0"
                  >
                    {option.label}
                  </Button>
                );
              })}
            </div>
            {showModelPicker && (
              <div className="flex min-w-0 items-center gap-2">
                <ModelPicker
                  models={openRouterModels}
                  selectedModelId={selectedModelId}
                  loading={modelsLoading}
                  disabled={turnInFlight !== null || sessionLoading || !activeSession}
                  onSelect={setSessionRuntimeModel}
                />
                {modelsError && (
                  <>
                    <span
                      role="status"
                      aria-live="polite"
                      className="min-w-0 flex-1 truncate text-xs text-red-200"
                      title={modelsError}
                    >
                      Models unavailable: {modelsError}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      disabled={modelsLoading}
                      onClick={retryOpenRouterModels}
                      className="shrink-0"
                    >
                      Retry
                    </Button>
                  </>
                )}
              </div>
            )}
            {selectedRuntime === "openhands" && libraryPresets.length > 0 ? (
              <PresetPicker
                presets={libraryPresets}
                selectedId={selectedLibraryPresetId}
                disabled={turnInFlight !== null || sessionLoading}
                onSelect={selectLibraryPreset}
              />
            ) : null}
          </div>
          <ul
            ref={chatScrollRef}
            onScroll={onChatScroll}
            className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 text-sm [scrollbar-gutter:stable]"
          >
            {messages.length === 0 && (
              <li className="rounded-lg border border-border bg-background p-4 text-sm text-muted-foreground">
                <div className="mb-2 flex items-center gap-2 font-medium text-foreground">
                  <Bot className="size-4 text-primary" aria-hidden="true" />
                  {runtimeLabel(selectedRuntime)} is ready
                </div>
                Ask for a change and watch files update in the editor.
              </li>
            )}
            {messages.map((m, idx) => (
              <Message key={(m.turnId ?? "err") + ":" + idx} m={m} />
            ))}
          </ul>
          <form onSubmit={onSubmit} className="flex shrink-0 flex-col gap-2 border-t border-border bg-background/55 p-3">
            <label className="sr-only" htmlFor="agent-prompt">Prompt</label>
            <Textarea
              id="agent-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onPaste={onPromptPaste}
              placeholder={`Tell ${runtimeLabel(selectedRuntime)} what to change...`}
              rows={3}
              disabled={!activeSession}
              className="min-h-28"
            />
            {draftAttachments.length > 0 && (
              <ul className="grid grid-cols-2 gap-2">
                {draftAttachments.map((attachment) => (
                  <li
                    key={attachment.id}
                    className="group relative overflow-hidden rounded-md border border-border bg-card"
                  >
                    <div
                      role="img"
                      aria-label={attachment.name}
                      className="h-20 w-full bg-cover bg-center"
                      style={{ backgroundImage: `url(${attachment.dataUrl})` }}
                    />
                    <div className="flex min-w-0 items-center gap-1.5 px-2 py-1">
                      <ImagePlus className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
                      <span className="truncate text-xs text-muted-foreground" title={attachment.name}>
                        {attachment.name}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon-xs"
                      aria-label={`Remove ${attachment.name}`}
                      className="absolute right-1 top-1 opacity-95"
                      onClick={() => removeDraftAttachment(attachment.id)}
                    >
                      <X />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {attachmentError && (
              <div className="text-xs text-red-200">{attachmentError}</div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {turnInFlight
                  ? reviewingActive
                    ? "Reviewing..."
                    : "Task running"
                  : wsOpen
                    ? draftAttachments.length > 0
                      ? `${draftAttachments.length} image${draftAttachments.length === 1 ? "" : "s"} attached`
                      : "Connected"
                    : "Waiting for websocket"}
              </span>
              <div className="flex gap-2">
                {turnInFlight && (
                  <Button
                    type="button"
                    onClick={onAbort}
                    variant="outline"
                    size="sm"
                    className="border-destructive/30 text-red-200 hover:bg-destructive/10 hover:text-red-100"
                  >
                    <Square />
                    Abort
                  </Button>
                )}
                <Button
                  type="submit"
                  disabled={
                    (!prompt.trim() && draftAttachments.length === 0) ||
                    !activeSession
                  }
                  size="sm"
                >
                  <Send />
                  {turnInFlight ? "Queue" : "Send"}
                </Button>
              </div>
            </div>
          </form>
        </section>

        <div
          className="w-1.5 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary focus-visible:bg-primary focus-visible:outline-none"
          onPointerDown={onResizeStart}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") {
              e.preventDefault();
              setChatWidthPct((v) => Math.max(MIN_CHAT_WIDTH_PCT, v - 2));
            }
            if (e.key === "ArrowRight") {
              e.preventDefault();
              setChatWidthPct((v) => Math.min(MAX_CHAT_WIDTH_PCT, v + 2));
            }
          }}
          role="separator"
          tabIndex={0}
          aria-label="Resize chat panel"
          aria-orientation="vertical"
          aria-valuemin={MIN_CHAT_WIDTH_PCT}
          aria-valuemax={MAX_CHAT_WIDTH_PCT}
          aria-valuenow={Math.round(chatWidthPct)}
        />

        <RightPane
          tab={tab}
          onTabChange={setTab}
          code={
            <div className="relative flex h-full w-full bg-background">
              <aside className="w-64 shrink-0 overflow-auto border-r border-border bg-card">
                <div className="flex min-h-11 items-center justify-between border-b border-border px-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Code2 className="size-4 text-primary" />
                    Files
                  </div>
                  <Button
                    type="button"
                    onClick={requestFileList}
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Refresh files"
                  >
                    <RefreshCw className={fileListLoading ? "animate-spin" : ""} />
                  </Button>
                </div>
                <FileTree
                  paths={paths}
                  selectedPath={selectedPath}
                  loading={fileListLoading}
                  error={fileListError}
                  recentlyChanged={recentlyChanged}
                  onSelect={onSelectFile}
                  onRetry={requestFileList}
                />
              </aside>
              <div className="flex min-w-0 flex-1">
                <CodeEditor
                  path={selectedPath}
                  content={fileContent}
                  readOnly={editorReadOnly}
                  dirty={dirty}
                  saveIndicator={saveIndicator}
                  saveError={saveError}
                  onContentChange={(c) => setFileContent(c)}
                  onSave={onSave}
                />
              </div>
              {envPanelOpen && (
                <aside className="flex w-[min(24rem,42vw)] min-w-80 shrink-0 flex-col border-l border-border bg-card max-lg:absolute max-lg:inset-0 max-lg:z-20 max-lg:w-full max-lg:min-w-0 max-lg:max-w-none max-lg:shadow-lg">
                  <div className="flex min-h-11 items-center justify-between gap-2 border-b border-border px-3">
                    <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
                      <KeyRound className="size-4 shrink-0 text-primary" aria-hidden="true" />
                      <span className="truncate">Env</span>
                      {envSaveEnabled && (
                        <span
                          className="size-1.5 shrink-0 rounded-full bg-amber-400"
                          aria-label={envDirty ? "Unsaved changes" : "Sandbox sync pending"}
                        />
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Close env editor"
                      onClick={() => setEnvPanelOpen(false)}
                    >
                      <X />
                    </Button>
                  </div>
                  <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
                    <label htmlFor="project-env-content" className="text-xs font-medium text-muted-foreground">
                      {PROJECT_ENV_PATH}
                    </label>
                    <Textarea
                      id="project-env-content"
                      value={envContent}
                      onChange={(e) => setEnvContent(e.target.value)}
                      disabled={envLoading || envSaving || turnInFlight !== null}
                      spellCheck={false}
                      placeholder={envLoading ? "Loading environment..." : "KEY=value"}
                      className="min-h-0 flex-1 resize-none font-mono text-xs leading-5"
                    />
                    {envError && (
                      <div role="alert" className="text-xs text-red-200">
                        {envError}
                      </div>
                    )}
                    {envSyncWarning && (
                      <div role="status" className="text-xs text-amber-200">
                        {envSyncWarning}
                      </div>
                    )}
                    <div className="flex min-h-8 items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-xs text-muted-foreground">
                        {envLoading
                          ? "Loading..."
                          : envSaving
                            ? "Saving..."
                            : envDirty
                              ? "Unsaved changes"
                              : envSyncPending
                                ? "Sandbox sync pending"
                              : envContentBase === null
                                ? "Not loaded"
                                : "Saved"}
                      </span>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={envLoading || envSaving || turnInFlight !== null || !envSaveEnabled}
                        onClick={() => void saveProjectEnv()}
                      >
                        {envSaving ? <Loader2 className="animate-spin" /> : <Save />}
                        Save
                      </Button>
                    </div>
                  </div>
                </aside>
              )}
              {agentConfigOpen && (
                <ProjectAgentConfigPanel
                  config={agentConfig}
                  loading={agentConfigLoading}
                  saving={agentConfigSaving}
                  error={agentConfigError}
                  syncWarning={agentConfigSyncWarning}
                  disabled={turnInFlight !== null}
                  onClose={() => setAgentConfigOpen(false)}
                  onReload={() => void loadAgentConfig()}
                  onSave={(next) => void saveAgentConfig(next)}
                  onLocalChange={setAgentConfig}
                />
              )}
            </div>
          }
          terminal={
            tab === "terminal" ? (
              <div className="flex min-h-0 flex-1 flex-col bg-background">
                <div className="flex min-h-11 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-3">
                  <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
                    <Terminal className="size-4 shrink-0 text-primary" aria-hidden="true" />
                    <span className="truncate">Terminal</span>
                  </div>
                  <Badge variant={terminalStatus === "ready" ? "success" : "outline"}>
                    {terminalStatus}
                  </Badge>
                </div>
                <XtermTerminal
                  ws={workspaceWs}
                  wsOpen={wsOpen}
                  disabled={turnInFlight !== null}
                  event={terminalEvent}
                  clearSignal={terminalClearSignal}
                  closeSignal={terminalCloseSignal}
                  reconnectSignal={terminalReconnectSignal}
                  onStatusChange={setTerminalStatus}
                />
              </div>
            ) : null
          }
          console={
            <div className="flex min-h-0 flex-1 flex-col bg-background">
              <div className="flex min-h-11 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-3">
                <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
                  <ScrollText className="size-4 shrink-0 text-primary" aria-hidden="true" />
                  <span className="truncate">Preview console</span>
                </div>
                <Badge variant="outline">{consoleEntries.length}</Badge>
              </div>
              <div
                ref={consoleOutputRef}
                className="min-h-0 flex-1 overflow-auto p-3 font-mono text-xs leading-5 [scrollbar-gutter:stable]"
                aria-live="polite"
              >
                {consoleEntries.length === 0 ? (
                  <div className="text-muted-foreground">No console output yet.</div>
                ) : (
                  <div className="space-y-2">
                    {consoleEntries.map((entry) => (
                      <div
                        key={entry.id}
                        className={cn(
                          "grid grid-cols-[4.75rem_4rem_minmax(0,1fr)] gap-2 rounded-md border border-border bg-card/45 px-2 py-1.5",
                          entry.level === "warn" && "border-amber-400/30 text-amber-100",
                          entry.level === "error" && "border-red-400/30 text-red-100",
                        )}
                      >
                        <span className="select-none text-muted-foreground">
                          {timestampLabel(entry.timestamp)}
                        </span>
                        <span className="select-none uppercase text-muted-foreground">
                          {entry.level}
                        </span>
                        <div className="min-w-0">
                          <pre className="whitespace-pre-wrap break-words">
                            {entry.values.join(" ")}
                          </pre>
                          <div className="truncate text-[11px] text-muted-foreground" title={entry.url}>
                            {toRelativePath(entry.url)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          }
          codeActions={
            <>
              <Button
                type="button"
                variant={agentConfigOpen ? "secondary" : "ghost"}
                size="xs"
                disabled={wsStatus !== "open"}
                aria-pressed={agentConfigOpen}
                aria-label="Edit agent config"
                onClick={openAgentConfigPanel}
              >
                <Settings2 />
                Agent config
              </Button>
              <Button
                type="button"
                variant={envPanelOpen ? "secondary" : "ghost"}
                size="xs"
                disabled={wsStatus !== "open"}
                aria-pressed={envPanelOpen}
                aria-label="Edit project environment"
                onClick={openEnvPanel}
              >
                <KeyRound />
                Env
              </Button>
            </>
          }
          terminalActions={
            <>
              {terminalStatus === "ready" && (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => setTerminalCloseSignal((value) => value + 1)}
                >
                  <Square />
                  Stop
                </Button>
              )}
              {terminalStatus === "closed" && (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={!wsOpen || turnInFlight !== null}
                  onClick={() => setTerminalReconnectSignal((value) => value + 1)}
                >
                  <RefreshCw />
                  Reconnect
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={terminalStatus === "offline"}
                onClick={() => setTerminalClearSignal((value) => value + 1)}
              >
                <Trash2 />
                Clear
              </Button>
            </>
          }
          consoleActions={
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={consoleEntries.length === 0}
              onClick={() => setConsoleEntries([])}
            >
              <Trash2 />
              Clear
            </Button>
          }
          previewActions={
            project.previewUrl ? (
              <>
                <Button
                  type="button"
                  variant={previewCaptureActive ? "secondary" : "ghost"}
                  size="xs"
                  disabled={turnInFlight !== null || previewCaptureBusy}
                  aria-pressed={previewCaptureActive}
                  aria-label="Capture preview region"
                  title="Capture preview region"
                  onClick={togglePreviewCapture}
                >
                  {previewCaptureBusy ? <Loader2 className="animate-spin" /> : <Camera />}
                  Capture
                </Button>
                <Button
                  type="button"
                  variant={envPanelOpen ? "secondary" : "ghost"}
                  size="xs"
                  disabled={wsStatus !== "open"}
                  aria-pressed={envPanelOpen}
                  aria-label="Edit project environment"
                  onClick={openEnvPanel}
                >
                  <KeyRound />
                  Env
                </Button>
                <Button
                  type="button"
                  variant={agentConfigOpen ? "secondary" : "ghost"}
                  size="xs"
                  disabled={wsStatus !== "open"}
                  aria-pressed={agentConfigOpen}
                  aria-label="Edit agent config"
                  onClick={openAgentConfigPanel}
                >
                  <Settings2 />
                  Agent config
                </Button>
                <div
                  role="group"
                  aria-label="Preview viewport"
                  className="flex items-center gap-0.5 rounded-md border border-border bg-background p-0.5"
                >
                  {(Object.keys(DEVICE_FRAME) as DeviceView[]).map((d) => {
                    const { label, Icon } = DEVICE_FRAME[d];
                    const active = device === d;
                    return (
                      <Button
                        key={d}
                        type="button"
                        onClick={() => setDevice(d)}
                        variant={active ? "secondary" : "ghost"}
                        size="icon-xs"
                        aria-label={label}
                        aria-pressed={active}
                      >
                        <Icon />
                      </Button>
                    );
                  })}
                </div>
                <Button
                  type="button"
                  onClick={toggleDevIndicator}
                  variant="ghost"
                  size="xs"
                  disabled={wsStatus !== "open" || turnInFlight !== null || devIndicatorSaving}
                  aria-pressed={false}
                  aria-label="Ensure Next.js debug badge is hidden"
                  title={
                    devIndicatorError
                      ? `Next badge: ${devIndicatorError}`
                      : devIndicatorEnabled === false
                        ? "Next.js debug badge is hidden"
                        : "Hide Next.js debug badge"
                  }
                >
                  {devIndicatorSaving ? <Loader2 className="animate-spin" /> : <Bug />}
                  Debug off
                </Button>
                <div
                  className="flex min-w-0 max-w-xs items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground"
                  title={project.previewUrl}
                >
                  <Globe2 className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
                  <span className="truncate font-mono">{toRelativePath(project.previewUrl)}</span>
                </div>
                <Button asChild variant="ghost" size="icon-sm" aria-label="Open preview in new tab">
                  <a href={project.previewUrl} target="_blank" rel="noreferrer">
                    <ExternalLink />
                  </a>
                </Button>
              </>
            ) : null
          }
          preview={
            project.previewUrl ? (
              <div className="flex min-w-0 min-h-0 flex-1 items-center justify-center overflow-auto bg-muted/40 p-3 sm:p-6">
                <div
                  ref={previewFrameRef}
                  className={cn(
                    "relative overflow-hidden rounded-lg bg-white shadow-xl ring-1 ring-border transition-[width,height,max-width,max-height] duration-200",
                    device === "desktop" && "h-full w-full",
                    device === "tablet" && "aspect-[834/1112] h-full max-h-[1112px] max-w-full",
                    device === "mobile" && "aspect-[390/844] h-full max-h-[844px] max-w-full",
                  )}
                >
                  <iframe
                    key={previewReloadKey}
                    src={project.previewUrl}
                    className="h-full w-full border-0 bg-white"
                    sandbox="allow-scripts allow-same-origin allow-forms"
                    title="project preview"
                  />
                  {previewCaptureActive && (
                    <div
                      className={cn(
                        "absolute inset-0 z-20 cursor-crosshair bg-black/10",
                        previewCaptureBusy && "cursor-wait",
                      )}
                      onPointerDown={onPreviewCapturePointerDown}
                      onPointerMove={onPreviewCapturePointerMove}
                      onPointerUp={finishPreviewCapturePointer}
                      onPointerCancel={finishPreviewCapturePointer}
                    >
                      <span className="sr-only" aria-live="polite">
                        Preview capture mode active
                      </span>
                      {previewCaptureSelection && (
                        <div
                          className="absolute border-2 border-primary bg-primary/15 shadow-[0_0_0_9999px_rgb(0_0_0/0.18)]"
                          style={{
                            left: `${previewCaptureSelection.local.x}px`,
                            top: `${previewCaptureSelection.local.y}px`,
                            width: `${previewCaptureSelection.local.width}px`,
                            height: `${previewCaptureSelection.local.height}px`,
                          }}
                        />
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex w-full flex-1 flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
                <div className="flex size-12 items-center justify-center rounded-lg border border-border bg-secondary">
                  <Globe2 className="size-5" aria-hidden="true" />
                </div>
                No preview URL.
              </div>
            )
          }
        />
      </div>
    </main>
  );
}
