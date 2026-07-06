export type IntakeStatusTone = "idle" | "info" | "warning" | "error" | "success";

export type IntakeStatus = {
  message: string;
  tone: IntakeStatusTone;
};

export function resolveIntakeStatus({
  input,
  detectedCount,
  pageProbeError,
  formatError,
}: {
  input: string;
  detectedCount: number;
  pageProbeError: string | null;
  formatError: (message: string, fallback?: string) => string;
}): IntakeStatus {
  if (pageProbeError) {
    return {
      message: formatError(pageProbeError, "Could not sniff this page."),
      tone: "error",
    };
  }

  const hasText = input.trim().length > 0;

  if (hasText && detectedCount === 0) {
    return {
      message: "That doesn't look like a link. Paste a URL, magnet, or torrent link.",
      tone: "warning",
    };
  }

  if (detectedCount > 0) {
    const countLabel = detectedCount === 1 ? "1 link ready" : `${detectedCount} links ready`;
    return {
      message: `${countLabel} — press Fetch to add.`,
      tone: "info",
    };
  }

  return {
    message: "Paste a link above — video, gallery, or torrent.",
    tone: "idle",
  };
}
