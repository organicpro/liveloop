"use client";

import { useEffect, useMemo, useState } from "react";

type State = "idle" | "loading" | "done" | "error";

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`;
}

function parseDuration(input: string) {
  const value = input.trim();
  if (!value) return 0;
  if (/^\d+$/.test(value)) return Number(value) * 60;
  const match = value.match(/^(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?$/i);
  if (!match) return 0;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

function formatDuration(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}h ${m}m ${r}s`;
  if (m > 0) return `${m}m ${r}s`;
  return `${r}s`;
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [addAudio, setAddAudio] = useState(false);
  const [durationInput, setDurationInput] = useState("1m");
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState("Upload a video and set the final duration.");
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [estimatedBytes, setEstimatedBytes] = useState(0);
  const [sourceSeconds, setSourceSeconds] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  const targetSeconds = useMemo(() => parseDuration(durationInput), [durationInput]);
  const ratio = sourceSeconds && targetSeconds ? targetSeconds / sourceSeconds : 0;

  useEffect(() => {
    if (file && sourceSeconds && targetSeconds) {
      const videoEstimate = Math.round((file.size * targetSeconds) / Math.max(1, sourceSeconds));
      const audioEstimate = addAudio && audioFile ? audioFile.size : 0;
      setEstimatedBytes(videoEstimate + audioEstimate);
    }
  }, [file, sourceSeconds, targetSeconds, addAudio, audioFile]);

  useEffect(() => {
    if (state !== "loading") {
      setElapsed(0);
      return;
    }
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [state]);

  async function inspectVideo(nextFile: File | null) {
    setFile(nextFile);
    setDownloadUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    setState("idle");

    if (!nextFile) {
      setMessage("Upload a video and set the final duration.");
      setEstimatedBytes(0);
      setSourceSeconds(0);
      return;
    }

    const url = URL.createObjectURL(nextFile);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("Nao consegui ler a duracao do video."));
    });
    URL.revokeObjectURL(url);
    setSourceSeconds(video.duration);
    setMessage(`Video loaded. Original duration: ${formatDuration(video.duration)}.`);
  }

  async function inspectAudio(nextFile: File | null) {
    setAudioFile(nextFile);
    if (!nextFile) return;
    setMessage(`Audio loaded: ${nextFile.name}.`);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || !targetSeconds || (addAudio && !audioFile)) {
      setState("error");
      setMessage(addAudio ? "Choose a valid video, duration and audio file." : "Choose a valid video and duration.");
      return;
    }

    setState("loading");
    setMessage(addAudio ? "Extension and audio mix in progress." : "Extension in progress. Larger files may take a few minutes.");

    const formData = new FormData();
    formData.append("video", file);
    formData.append("targetSeconds", String(targetSeconds));
    formData.append("sourceSeconds", String(sourceSeconds || 0));
    formData.append("addAudioEnabled", addAudio ? "1" : "0");
    if (addAudio && audioFile) {
      formData.append("audio", audioFile);
    }

    const response = await fetch("/api/extend", { method: "POST", body: formData });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setState("error");
      setMessage(payload?.error ?? "Failed to extend the video.");
      return;
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    setDownloadUrl(url);
    setState("done");
    setMessage(addAudio ? "Extended video with audio ready for download." : "Extended video ready for download.");
    const headerEstimate = Number(response.headers.get("X-Extender-Estimated-Bytes") ?? 0);
    if (headerEstimate) setEstimatedBytes(headerEstimate);
  }

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Extendr</p>
          <h1>Video Extension Timer</h1>
          <p className="lede">Extend your video to the exact length.</p>
        </div>
        <div className="stats">
          <div>
            <span>Hours</span>
            <strong>{targetSeconds ? formatDuration(targetSeconds) : "--"}</strong>
          </div>
          <div>
            <span>Original video</span>
            <strong>{file ? formatDuration(sourceSeconds) : "--"}</strong>
          </div>
          <div>
            <span>Estimate</span>
            <strong>{estimatedBytes ? formatBytes(estimatedBytes) : "--"}</strong>
          </div>
        </div>
      </section>

      <section className="panel">
        <form onSubmit={handleSubmit} className="form">
          <label>
            Video
            <input
              type="file"
              accept="video/*"
              onChange={(event) => inspectVideo(event.target.files?.[0] ?? null).catch((error) => {
                setState("error");
                setMessage(error instanceof Error ? error.message : "Nao consegui ler o arquivo.");
              })}
            />
          </label>

          <label className="switch-row">
            <span>Add audio</span>
            <input
              type="checkbox"
              checked={addAudio}
              onChange={(event) => {
                setAddAudio(event.target.checked);
                if (!event.target.checked) {
                  setAudioFile(null);
                }
              }}
            />
          </label>

          {addAudio ? (
            <label>
              Audio file
              <input
                type="file"
                accept="audio/*"
                onChange={(event) => inspectAudio(event.target.files?.[0] ?? null).catch((error) => {
                  setState("error");
                  setMessage(error instanceof Error ? error.message : "Nao consegui ler o audio.");
                })}
              />
            </label>
          ) : null}

          <label>
            Final duration
            <input
              type="text"
              value={durationInput}
              onChange={(event) => setDurationInput(event.target.value)}
              placeholder="1m, 10m, 1h 30m"
            />
          </label>

          <div className="helper">
            <span>Shortcut: 10m, 1h 30m, 24m or whole minutes.</span>
            <span>Multiplier: {ratio ? `${ratio.toFixed(1)}x` : "--"}</span>
          </div>

          <button type="submit" disabled={!file || !targetSeconds || state === "loading" || (addAudio && !audioFile)}>
            {state === "loading" ? `Extending video... ${elapsed}s` : "Extend video"}
          </button>
        </form>

        <div className="status">
          <p>{message}</p>
          {downloadUrl ? (
            <a href={downloadUrl} download="extender-video-ia.mp4">
              Download MP4
            </a>
          ) : null}
        </div>
      </section>
    </main>
  );
}