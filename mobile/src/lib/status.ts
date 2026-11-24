export const STATUS_LABEL: Record<string, string> = {
  NEW: "New",
  SCHEDULED: "Scheduled",
  IN_PROGRESS: "In progress",
  ON_HOLD: "On hold",
  COMPLETED: "Completed",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

export const statusTone = (s: string) =>
  s === "IN_PROGRESS" ? "blue" : s === "ON_HOLD" ? "amber" : s === "COMPLETED" || s === "CLOSED" ? "green" : "muted";
