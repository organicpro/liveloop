"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type State = "idle" | "loading" | "done" | "error";

type FfmpegBundle = {
  ffmpeg: any;
  fetchFile: (file: File | Blob) => Promise<Uint8Array>;
};

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
  const [addAudio, setAddAudio] = useState(true);
  const [audioMode, setAudioMode] = useState<"padrao" | "personalizado">("padrao");
  const [volume, setVolume] = useState(70);
  const [durationInput, setDurationInput] = useState("1m");
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState("Envie um vídeo e escolha a duração final.");
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [estimatedBytes, setEstimatedBytes] = useState(0);
  const [sourceSeconds, setSourceSeconds] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const ffmpegBundleRef = useRef<FfmpegBundle | null>(null);
  const ffmpegLoadRef = useRef<Promise<FfmpegBundle> | null>(null);

  const targetSeconds = useMemo(() => parseDuration(durationInput), [durationInput]);
  const ratio = sourceSeconds && targetSeconds ? targetSeconds / sourceSeconds : 0;

  useEffect(() => {
    if (file && sourceSeconds && targetSeconds) {
      const videoEstimate = Math.round((file.size * targetSeconds) / Math.max(1, sourceSeconds));
      const audioEstimate = addAudio && audioMode === "personalizado" && audioFile ? Math.round(audioFile.size * 0.1) : 0;
      setEstimatedBytes(videoEstimate + audioEstimate);
    }
  }, [file, sourceSeconds, targetSeconds, addAudio, audioMode, audioFile]);

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
      setMessage("Envie um vídeo e escolha a duração final.");
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
      video.onerror = () => reject(new Error("Não consegui ler a duração do vídeo."));
    });
    URL.revokeObjectURL(url);
    setSourceSeconds(video.duration);
    setMessage(`Vídeo carregado: ${formatDuration(video.duration)}.`);
  }

  async function inspectAudio(nextFile: File | null) {
    setAudioFile(nextFile);
    if (!nextFile) return;
    setMessage(`áudio personalizado carregado: ${nextFile.name}.`);
  }

  async function loadFfmpeg() {
    if (ffmpegBundleRef.current) return ffmpegBundleRef.current;
    if (!ffmpegLoadRef.current) {
      ffmpegLoadRef.current = (async () => {
        const [{ FFmpeg }, { toBlobURL, fetchFile }] = await Promise.all([
          import("@ffmpeg/ffmpeg"),
          import("@ffmpeg/util"),
        ]);

        const ffmpeg = new FFmpeg();
        ffmpeg.on("progress", ({ progress }) => {
          if (Number.isFinite(progress)) {
            setMessage(`Processando... ${Math.max(0, Math.min(100, Math.round(progress * 100)))}%`);
          }
        });

        const baseURL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd";
        setMessage("Carregando motor de vídeo...");
        await ffmpeg.load({
          coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
          wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
        });

        ffmpegBundleRef.current = { ffmpeg, fetchFile };
        return ffmpegBundleRef.current;
      })();
    }

    return ffmpegLoadRef.current;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || !targetSeconds || (addAudio && audioMode === "personalizado" && !audioFile)) {
      setState("error");
      setMessage(addAudio ? (audioMode === "personalizado" ? "Escolha vídeo, duração e áudio." : "Escolha vídeo e duração.") : "Escolha vídeo e duração.");
      return;
    }

    setState("loading");
    setMessage(addAudio ? "Preparando vídeo com áudio..." : "Preparando vídeo...");

    try {
      const bundle = await loadFfmpeg();
      const { ffmpeg, fetchFile } = bundle;

      await Promise.allSettled([ffmpeg.deleteFile("input.mp4"), ffmpeg.deleteFile("audio.m4a"), ffmpeg.deleteFile("output.mp4")]);
      await ffmpeg.writeFile("input.mp4", await fetchFile(file));

      const audioName = "audio.m4a";
      if (addAudio) {
        if (audioMode === "personalizado" && audioFile) {
          await ffmpeg.writeFile(audioName, await fetchFile(audioFile));
        } else {
          const defaultAudio = await fetch("/audio-padrao.m4a");
          if (!defaultAudio.ok) {
            throw new Error("Não consegui carregar o áudio padrão.");
          }
          await ffmpeg.writeFile(audioName, await fetchFile(await defaultAudio.blob()));
        }

        await ffmpeg.exec([
          "-y",
          "-stream_loop",
          "-1",
          "-i",
          "input.mp4",
          "-stream_loop",
          "-1",
          "-i",
          audioName,
          "-filter_complex",
          `[0:v:0]trim=duration=${targetSeconds},setpts=PTS-STARTPTS,scale=trunc(iw/2)*2:trunc(ih/2)*2[v];[1:a:0]atrim=duration=${targetSeconds},asetpts=PTS-STARTPTS,volume=${volume / 100}[a]`,
          "-map",
          "[v]",
          "-map",
          "[a]",
          "-t",
          String(targetSeconds),
          "-shortest",
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-movflags",
          "+faststart",
          "output.mp4",
        ]);
      } else {
        await ffmpeg.exec([
          "-y",
          "-stream_loop",
          "-1",
          "-i",
          "input.mp4",
          "-t",
          String(targetSeconds),
          "-map",
          "0:v:0?",
          "-map",
          "0:a:0?",
          "-c",
          "copy",
          "-movflags",
          "+faststart",
          "output.mp4",
        ]);
      }

      const data = await ffmpeg.readFile("output.mp4");
      const url = URL.createObjectURL(new Blob([data], { type: "video/mp4" }));
      setDownloadUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return url;
      });
      setState("done");
      setMessage(addAudio ? "Vídeo com áudio pronto para baixar." : "Vídeo pronto para baixar.");
      if (estimatedBytes) setEstimatedBytes(estimatedBytes);
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Não foi poss?vel estender o vídeo.");
    }
  }

  return (
    <main className="shell">
      <section className="hero">
        <div className="hero-copy">
          <div className="brand-mark">
            <img src="/logo-mark.png" alt="Logo Extendr" />
            <span>Extendr</span>
          </div>
          <div className="hero-badge">Extensor de vídeo</div>
          <h1>Estenda seu vídeo.</h1>
          <p className="lede">Escolha o tempo final, ajuste o áudio e baixe em MP4.</p>
          <div className="hero-pills" aria-label="Destaques">
            <span>Duração exata</span>
            <span>Controle de volume</span>
          </div>
        </div>

        <div className="stats" aria-label="Estimativa atual">
          <div>
            <span>Duração final</span>
            <strong>{targetSeconds ? formatDuration(targetSeconds) : "--"}</strong>
          </div>
          <div>
            <span>Vídeo original</span>
            <strong>{file ? formatDuration(sourceSeconds) : "--"}</strong>
          </div>
          <div>
            <span>Estimativa</span>
            <strong>{estimatedBytes ? formatBytes(estimatedBytes) : "--"}</strong>
          </div>
        </div>
      </section>

      <section className="workspace-card">
        <div className="panel-header">
          <div>
            <p className="section-kicker">Criar arquivo</p>
            <h2>Configure o vídeo</h2>
          </div>
          <span className={state === "done" ? "state-pill done" : state === "error" ? "state-pill error" : "state-pill"}>
            {state === "loading" ? `Processando ${elapsed}s` : state === "done" ? "Pronto" : state === "error" ? "Ajuste necessário" : "Aguardando arquivo"}
          </span>
        </div>

        <div className="tool-grid">
          <form onSubmit={handleSubmit} className="form tool-card">
            <label className="upload-card">
              <span>
                <strong>Vídeo</strong>
                <small>Envie o arquivo original.</small>
              </span>
              <input
                type="file"
                accept="video/*"
                onChange={(event) => inspectVideo(event.target.files?.[0] ?? null).catch((error) => {
                  setState("error");
                  setMessage(error instanceof Error ? error.message : "Não consegui ler o arquivo.");
                })}
              />
            </label>

            <div className="duration-row">
              <label>
                Duração final
                <input
                  type="text"
                  value={durationInput}
                  onChange={(event) => setDurationInput(event.target.value)}
                  placeholder="1m, 10m, 1h 30m"
                />
              </label>
              <div className="quick-times" aria-label="Atalhos de duração">
                {["1m", "10m", "30m", "1h"].map((value) => (
                  <button key={value} type="button" className="quick-button" onClick={() => setDurationInput(value)}>
                    {value}
                  </button>
                ))}
              </div>
            </div>

            <label className="switch-row">
              <span>
                <strong>Adicionar áudio</strong>
                <small>Ativa o som padrão ou um arquivo seu.</small>
              </span>
              <input
                type="checkbox"
                checked={addAudio}
                onChange={(event) => {
                  setAddAudio(event.target.checked);
                  if (!event.target.checked) {
                    setAudioFile(null);
                    setAudioMode("padrao");
                  }
                }}
              />
            </label>

            {addAudio ? (
              <div className="audio-panel">
                <div className="audio-mode">
                  <button type="button" className={audioMode === "padrao" ? "mode-button active" : "mode-button"} onClick={() => setAudioMode("padrao")}>Padrão</button>
                  <button type="button" className={audioMode === "personalizado" ? "mode-button active" : "mode-button"} onClick={() => setAudioMode("personalizado")}>Personalizado</button>
                </div>

                {audioMode === "personalizado" ? (
                  <label className="upload-card compact">
                    <span>
                      <strong>Arquivo de áudio</strong>
                      <small>Som ambiente, música ou voz.</small>
                    </span>
                    <input
                      type="file"
                      accept="audio/*"
                      onChange={(event) => inspectAudio(event.target.files?.[0] ?? null).catch((error) => {
                        setState("error");
                        setMessage(error instanceof Error ? error.message : "Não consegui ler o áudio.");
                      })}
                    />
                  </label>
                ) : (
                  <div className="default-audio-note">áudio padrão ativado.</div>
                )}

                <label className="volume-card">
                  <span>
                    Volume do áudio
                    <strong>{volume}%</strong>
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="150"
                    step="1"
                    value={volume}
                    onChange={(event) => setVolume(Number(event.target.value))}
                  />
                </label>
              </div>
            ) : null}

            <div className="helper">
              <span>Multiplicador: {ratio ? `${ratio.toFixed(1)}x` : "--"}</span>
              <span>{addAudio ? (audioMode === "padrao" ? "áudio padrão" : "áudio personalizado") : "S? vídeo"}</span>
            </div>

            <button className="primary-button" type="submit" disabled={!file || !targetSeconds || state === "loading" || (addAudio && audioMode === "personalizado" && !audioFile)}>
              {state === "loading" ? `Estendendo... ${elapsed}s` : "Estender vídeo"}
            </button>
          </form>

          <aside className="preview-card">
            <div className="logo-orb">
              <img src="/logo-mark.png" alt="" />
            </div>
            <h3>Resumo</h3>
            <ol>
              <li>O vídeo vai at? o tempo definido.</li>
              <li>O áudio entra no volume escolhido.</li>
              <li>O MP4 fica pronto para baixar.</li>
            </ol>
            <div className="estimate-box">
              <span>Estimativa</span>
              <strong>{estimatedBytes ? formatBytes(estimatedBytes) : "Envie um vídeo"}</strong>
              <small>Quanto maior o tempo, maior o arquivo.</small>
            </div>
          </aside>
        </div>

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
