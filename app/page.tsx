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
  const [durationInput, setDurationInput] = useState("1m");
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState("Envie um video e defina a duracao final.");
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [estimatedBytes, setEstimatedBytes] = useState(0);
  const [sourceSeconds, setSourceSeconds] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  const targetSeconds = useMemo(() => parseDuration(durationInput), [durationInput]);
  const ratio = sourceSeconds && targetSeconds ? targetSeconds / sourceSeconds : 0;

  useEffect(() => {
    if (file && sourceSeconds && targetSeconds) {
      setEstimatedBytes(Math.round((file.size * targetSeconds) / Math.max(1, sourceSeconds)));
    }
  }, [file, sourceSeconds, targetSeconds]);

  useEffect(() => {
    if (state !== "loading") {
      setElapsed(0);
      return;
    }
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [state]);

  async function inspectFile(nextFile: File | null) {
    setFile(nextFile);
    setDownloadUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    setState("idle");

    if (!nextFile) {
      setMessage("Envie um video e defina a duracao final.");
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
    setMessage(`Video carregado. Duracao original: ${formatDuration(video.duration)}.`);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || !targetSeconds) {
      setState("error");
      setMessage("Escolha um video e uma duracao valida.");
      return;
    }

    setState("loading");
    setMessage("Extensao em andamento. Arquivos grandes podem levar alguns minutos.");

    const formData = new FormData();
    formData.append("video", file);
    formData.append("targetSeconds", String(targetSeconds));
    formData.append("sourceSeconds", String(sourceSeconds || 0));

    const response = await fetch("/api/extend", { method: "POST", body: formData });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setState("error");
      setMessage(payload?.error ?? "Falha ao extender o video.");
      return;
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    setDownloadUrl(url);
    setState("done");
    setMessage("Video estendido pronto para download.");
    const headerEstimate = Number(response.headers.get("X-Extender-Estimated-Bytes") ?? 0);
    if (headerEstimate) setEstimatedBytes(headerEstimate);
  }

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Extender Video IA</p>
          <h1>Timer de extensao</h1>
          <p className="lede">Estenda seu video para a duracao exata.</p>
        </div>
        <div className="stats">
          <div>
            <span>Horas</span>
            <strong>{targetSeconds ? formatDuration(targetSeconds) : "--"}</strong>
          </div>
          <div>
            <span>Video original</span>
            <strong>{file ? formatDuration(sourceSeconds) : "--"}</strong>
          </div>
          <div>
            <span>Estimativa</span>
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
              onChange={(event) => inspectFile(event.target.files?.[0] ?? null).catch((error) => {
                setState("error");
                setMessage(error instanceof Error ? error.message : "Nao consegui ler o arquivo.");
              })}
            />
          </label>

          <label>
            Duracao final
            <input
              type="text"
              value={durationInput}
              onChange={(event) => setDurationInput(event.target.value)}
              placeholder="1m, 10m, 1h 30m"
            />
          </label>

          <div className="helper">
            <span>Atalho: 10m, 1h 30m, 24m ou minutos inteiros.</span>
            <span>Multiplicador: {ratio ? `${ratio.toFixed(1)}x` : "--"}</span>
          </div>

          <button type="submit" disabled={!file || !targetSeconds || state === "loading"}>
            {state === "loading" ? `Extendendo video... ${elapsed}s` : "Extender video"}
          </button>
        </form>

        <div className="status">
          <p>{message}</p>
          {downloadUrl ? (
            <a href={downloadUrl} download="extender-video-ia.mp4">
              Baixar MP4
            </a>
          ) : null}
        </div>
      </section>
    </main>
  );
}