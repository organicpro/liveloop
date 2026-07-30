import { access, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import ffmpegStaticPath from "ffmpeg-static";

export const runtime = "nodejs";

function asNumber(value: FormDataEntryValue | null) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function estimateSize(size: number, sourceSeconds: number, targetSeconds: number) {
  if (!size || !sourceSeconds || !targetSeconds) return 0;
  return Math.round((size * targetSeconds) / sourceSeconds);
}

function safeName(name: string) {
  return name.replace(/[^a-z0-9._-]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "video";
}

async function resolveFfmpeg() {
  const localBinary = path.join(process.cwd(), "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  await access(localBinary).then(() => true, () => false);
  try {
    await access(localBinary);
    return localBinary;
  } catch {
    return ffmpegStaticPath;
  }
}

async function runFfmpeg(binary: string, args: string[], timeoutMs: number) {
  return await new Promise<{ ok: boolean; stderr: string; timedOut: boolean }>((resolve) => {
    let child;
    let stderr = "";
    let settled = false;

    try {
      child = spawn(binary, args, { stdio: ["ignore", "ignore", "pipe"] });
    } catch (error) {
      resolve({ ok: false, stderr: error instanceof Error ? error.message : String(error), timedOut: false });
      return;
    }

    const finish = (payload: { ok: boolean; stderr: string; timedOut: boolean }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(payload);
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ ok: false, stderr, timedOut: true });
    }, timeoutMs);

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      finish({ ok: false, stderr: error.message, timedOut: false });
    });

    child.on("close", (code) => {
      finish({ ok: code === 0, stderr, timedOut: false });
    });
  });
}

export async function POST(request: Request) {
  const binary = await resolveFfmpeg();
  if (!binary) {
    return NextResponse.json({ error: "FFmpeg indisponivel." }, { status: 500 });
  }

  const formData = await request.formData();
  const file = formData.get("video");
  const targetSeconds = asNumber(formData.get("targetSeconds"));
  const sourceSeconds = asNumber(formData.get("sourceSeconds"));

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Envie um video valido." }, { status: 400 });
  }

  if (!targetSeconds || targetSeconds > 7200) {
    return NextResponse.json({ error: "Defina uma duracao entre 1 e 7200 segundos." }, { status: 400 });
  }

  if (file.size > 250 * 1024 * 1024) {
    return NextResponse.json({ error: "Para este teste local, envie videos de ate 250 MB." }, { status: 400 });
  }

  const tempDir = path.join(os.tmpdir(), "extender-video-ia");
  await mkdir(tempDir, { recursive: true });

  const baseName = safeName(file.name.replace(/\.[^.]+$/, ""));
  const inputPath = path.join(tempDir, `${crypto.randomUUID()}-${safeName(file.name)}`);
  const outputPath = path.join(tempDir, `${crypto.randomUUID()}-${baseName}-extendido.mp4`);

  await writeFile(inputPath, Buffer.from(await file.arrayBuffer()));

  const timeoutMs = Math.max(90_000, Math.min(600_000, targetSeconds * 2500));
  let result = await runFfmpeg(binary, [
    "-y", "-stream_loop", "-1", "-i", inputPath, "-t", String(targetSeconds),
    "-map", "0:v:0?", "-map", "0:a:0?", "-c", "copy", "-movflags", "+faststart", outputPath,
  ], timeoutMs);

  if (!result.ok) {
    await unlink(outputPath).catch(() => undefined);
    result = await runFfmpeg(binary, [
      "-y", "-stream_loop", "-1", "-i", inputPath, "-t", String(targetSeconds),
      "-map", "0:v:0?", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "ultrafast",
      "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k",
      "-movflags", "+faststart", outputPath,
    ], timeoutMs);
  }

  if (!result.ok) {
    await Promise.allSettled([unlink(inputPath), unlink(outputPath)]);
    const error = result.timedOut ? "O processamento passou do tempo limite local." : "Nao consegui extender o video.";
    return NextResponse.json({ error, details: result.stderr.slice(-1200) }, { status: 500 });
  }

  const output = await readFile(outputPath);
  const estimatedBytes = estimateSize(file.size, sourceSeconds, targetSeconds);

  await Promise.allSettled([unlink(inputPath), unlink(outputPath)]);

  return new NextResponse(output, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Disposition": `attachment; filename="${baseName}-extendido.mp4"`,
      "X-Extender-Estimated-Bytes": String(estimatedBytes),
    },
  });
}