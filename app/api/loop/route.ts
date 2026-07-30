import { unlink, writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { NextResponse } from "next/server";
import ffmpegPath from "ffmpeg-static";

export const runtime = "nodejs";

function asNumber(value: FormDataEntryValue | null) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function estimateSize(size: number, originalSeconds: number, targetSeconds: number) {
  if (!size || !originalSeconds || !targetSeconds) return 0;
  return Math.round((size * targetSeconds) / originalSeconds);
}

export async function POST(request: Request) {
  if (!ffmpegPath) {
    return NextResponse.json({ error: "FFmpeg indisponível." }, { status: 500 });
  }

  const binary = ffmpegPath;
  const formData = await request.formData();
  const file = formData.get("video");
  const targetSeconds = asNumber(formData.get("targetSeconds"));
  const sourceSeconds = asNumber(formData.get("sourceSeconds"));

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Envie um vídeo válido." }, { status: 400 });
  }

  if (!targetSeconds || targetSeconds > 7200) {
    return NextResponse.json({ error: "Defina uma duração entre 1 e 7200 segundos." }, { status: 400 });
  }

  const tempDir = path.join(os.tmpdir(), "looply");
  await mkdir(tempDir, { recursive: true });
  const inputPath = path.join(tempDir, `${crypto.randomUUID()}-${file.name}`);
  const outputPath = path.join(tempDir, `${crypto.randomUUID()}-loop.mp4`);
  const bytes = Buffer.from(await file.arrayBuffer());

  await writeFile(inputPath, bytes);

  const result = await new Promise<{ ok: boolean; stderr: string }>((resolve) => {
    const child = spawn(binary, [
      "-y",
      "-stream_loop",
      "-1",
      "-i",
      inputPath,
      "-t",
      String(targetSeconds),
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      outputPath,
    ], { stdio: ["ignore", "ignore", "pipe"] });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => resolve({ ok: code === 0, stderr }));
  });

  if (!result.ok) {
    await Promise.allSettled([unlink(inputPath), unlink(outputPath)]);
    return NextResponse.json(
      { error: "Não consegui processar o vídeo.", details: result.stderr.slice(-1000) },
      { status: 500 },
    );
  }

  const output = await readFile(outputPath);
  const estimatedBytes = estimateSize(file.size, sourceSeconds, targetSeconds);

  await Promise.allSettled([unlink(inputPath), unlink(outputPath)]);

  return new NextResponse(output, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Disposition": `attachment; filename="${file.name.replace(/\.[^.]+$/, "")}-loop.mp4"`,
      "X-Looply-Estimated-Bytes": String(estimatedBytes),
    },
  });
}
