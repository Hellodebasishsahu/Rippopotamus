import type { IntakeStatus } from "../app/intakeStatus";

export function IntakeStatusBar({ status }: { status: IntakeStatus }) {
  return (
    <p className={`intake-status intake-status-${status.tone}`} role="status" aria-live="polite">
      {status.tone !== "idle" && (
        <span className="intake-status-glyph" aria-hidden />
      )}
      <span className="intake-status-text">{status.message}</span>
    </p>
  );
}

