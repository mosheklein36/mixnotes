export const AUDIO_EXTENSIONS = ["mp3", "wav"] as const;

const SUFFIX_PATTERNS: RegExp[] = [
  /[\s_-]*\(\d+\)$/i,
  /[\s_-]+v\d+$/i,
  /[\s_-]+(final|master|mix|mixdown)$/i,
];

export function stripExtension(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/** "Summer Anthem v2_master.mp3" -> "Summer Anthem" */
export function deriveProjectName(filename: string): string {
  const original = stripExtension(filename).trim();
  let name = original;
  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of SUFFIX_PATTERNS) {
      const next = name.replace(pattern, "").trim();
      if (next !== name && next.length > 0) {
        name = next;
        changed = true;
      }
    }
  }
  return name || original;
}

export function isAudioFile(filename: string): boolean {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  if (base.startsWith(".") || base.startsWith("~")) return false;
  const ext = base.slice(base.lastIndexOf(".") + 1).toLowerCase();
  return (AUDIO_EXTENSIONS as readonly string[]).includes(ext);
}

export function audioContentType(filename: string): string {
  return filename.toLowerCase().endsWith(".wav") ? "audio/wav" : "audio/mpeg";
}
