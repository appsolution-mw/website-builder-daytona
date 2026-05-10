"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const WHISPER_API_URL =
  process.env.NEXT_PUBLIC_WHISPER_API_URL?.trim() || "https://whisper-api.mwcp.eu";

// MediaRecorder picks the first supported mime; whisper-faster handles
// any of these via ffmpeg on the server side.
const PREFERRED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg",
];

type DictationState = "idle" | "recording" | "transcribing";

type DictationButtonProps = {
  disabled?: boolean;
  onTranscript: (text: string) => void;
  onError?: (message: string) => void;
};

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const candidate of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return undefined;
}

function fileExtensionFor(mimeType: string): string {
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("mp4") || mimeType.includes("m4a")) return "m4a";
  if (mimeType.includes("ogg")) return "ogg";
  return "audio";
}

export function DictationButton({ disabled, onTranscript, onError }: DictationButtonProps) {
  const [state, setState] = useState<DictationState>("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    // Resolve mic availability after hydration so the button renders the
    // same on the server (assume supported) and the client (real check).
    // getUserMedia is only exposed in secure contexts — https or localhost.
    // LAN IP over plain http does NOT qualify and the API is undefined.
    const isSecure =
      typeof window !== "undefined" &&
      (window.isSecureContext ||
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1");
    const hasApi = typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
    setSupported(isSecure && hasApi);
  }, []);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  }, []);

  async function transcribe(blob: Blob, mimeType: string): Promise<void> {
    setState("transcribing");
    try {
      const formData = new FormData();
      formData.append("file", blob, `recording.${fileExtensionFor(mimeType)}`);
      const res = await fetch(`${WHISPER_API_URL}/transcribe`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        throw new Error(`Whisper request failed (HTTP ${res.status})`);
      }
      const data = (await res.json()) as { text?: string };
      const text = data.text?.trim();
      if (text) {
        onTranscript(text);
      } else {
        onError?.("Empty transcription");
      }
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Transcription failed");
    } finally {
      setState("idle");
    }
  }

  async function startRecording(): Promise<void> {
    if (!supported) {
      onError?.("Microphone is not available in this browser");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const effectiveMime = mimeType ?? recorder.mimeType ?? "audio/webm";
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        const blob = new Blob(chunksRef.current, { type: effectiveMime });
        chunksRef.current = [];
        if (blob.size === 0) {
          setState("idle");
          return;
        }
        void transcribe(blob, effectiveMime);
      };
      recorderRef.current = recorder;
      recorder.start();
      setState("recording");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Microphone access denied";
      onError?.(message);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setState("idle");
    }
  }

  function stopRecording(): void {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  }

  function onClick(): void {
    if (!supported) {
      onError?.(
        "Voice input requires HTTPS or localhost — browsers block microphone access on plain-http LAN IPs.",
      );
      return;
    }
    if (state === "idle") void startRecording();
    else if (state === "recording") stopRecording();
  }

  const title = !supported
    ? "Voice input needs HTTPS or localhost"
    : state === "recording" ? "Stop recording"
      : state === "transcribing" ? "Transcribing…"
        : "Dictate via voice";

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      disabled={disabled || state === "transcribing"}
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={state === "recording"}
      className={cn(
        "text-muted-foreground hover:text-foreground",
        state === "recording" && "text-red-300 hover:text-red-200",
        !supported && "opacity-60",
      )}
    >
      {state === "transcribing" ? (
        <Loader2 className="animate-spin" />
      ) : state === "recording" ? (
        <Square className="fill-current" />
      ) : (
        <Mic />
      )}
    </Button>
  );
}
