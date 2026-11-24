export const STATUS_LABEL: Record<string, string> = {
  NEW: "New",
  SCHEDULED: "Scheduled",
  DISPATCHED: "Dispatched",
  IN_PROGRESS: "In progress",
  ON_HOLD: "On hold",
  COMPLETED: "Completed",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

type Tone = "muted" | "amber" | "green" | "red" | "blue";

export const statusTone = (s: string): Tone =>
  s === "IN_PROGRESS" || s === "DISPATCHED" ? "blue" : s === "ON_HOLD" ? "amber" : s === "COMPLETED" || s === "CLOSED" ? "green" : s === "CANCELLED" ? "red" : "muted";

/** Priority badges: only High and Urgent are called out. */
export const priorityBadge = (p: string): { label: string; tone: Tone } | null =>
  p === "URGENT" ? { label: "Urgent", tone: "red" } : p === "HIGH" ? { label: "High", tone: "red" } : null;
