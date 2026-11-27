/**
 * Plain explanations for changes the server refused. The server answers with a short code (and its own sentence);
 * a queued change may be refused hours after it was made, because the office changed the job or the record in the
 * meantime. Nothing is deleted when that happens: the technician sees what was refused, why, and what they can do.
 */

export type Explanation = {
  /** One short line: what happened. */
  title: string;
  /** What it means for the technician. */
  advice: string;
  /** Sending it again could work (the situation may change); false when it never can. */
  canRetry: boolean;
};

const BY_CODE: Record<string, Explanation> = {
  JOB_CANCELLED: {
    title: "The office cancelled this job.",
    advice: "Your change was not applied. Your notes and photos below are still on the phone until you delete them.",
    canRetry: false,
  },
  JOB_REASSIGNED: {
    title: "The office gave this job to another technician.",
    advice: "Your change was not applied. Keep your notes if you want to pass them on, then delete the change.",
    canRetry: false,
  },
  JOB_DELETED: {
    title: "The office deleted this job.",
    advice: "Your change was not applied. Keep your notes if you need them, then delete the change.",
    canRetry: false,
  },
  JOB_UNSCHEDULED: {
    title: "This job is no longer scheduled for you.",
    advice: "Your change was not applied. Ask the office if it should be yours again.",
    canRetry: true,
  },
  JOB_ALREADY_COMPLETED: {
    title: "This job was already completed.",
    advice: "Someone finished it before your change arrived, so it was not applied.",
    canRetry: false,
  },
  JOB_STATUS_CHANGED: {
    title: "The job moved on while you were offline.",
    advice: "Its status is no longer what your change expected. Open the job to see where it stands, then do it again if it is still needed.",
    canRetry: false,
  },
  INSTALLATION_NOT_FOUND: {
    title: "This installation was deleted, or is no longer yours.",
    advice: "Your change was not applied. Keep any text you need, then delete the change.",
    canRetry: false,
  },
  INSTALLATION_ALREADY_COMPLETED: {
    title: "This installation is already completed.",
    advice: "It was finished before your change arrived. Ask the office to put it back on hold if it needs more work.",
    canRetry: false,
  },
  DEPENDS_ON_FAILED: {
    title: "An earlier change it depends on was not accepted.",
    advice: "Fix or delete the earlier change first.",
    canRetry: false,
  },
  FILE_MISSING: {
    title: "The photo or video is no longer on the phone.",
    advice: "Take it again. This entry can be deleted.",
    canRetry: false,
  },
  VALIDATION_ERROR: {
    title: "The server did not accept the values.",
    advice: "Open the record, correct the marked fields and save again.",
    canRetry: false,
  },
};

/** What to tell the technician about a refused change. Unknown codes show the server's own sentence. */
export function explain(code: string | null, message: string | null): Explanation {
  const known = code ? BY_CODE[code] : undefined;
  if (known) return known;
  return {
    title: message || "The server did not accept this change.",
    advice: "You can try again, or delete the change.",
    canRetry: true,
  };
}
