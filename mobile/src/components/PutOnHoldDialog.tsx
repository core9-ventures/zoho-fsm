import { useState } from "react";
import { ApiError, officeInstallations } from "../api";
import { Button, Field, Modal, inputClass } from "../ui/kit";
import { useToast } from "../ui/toast";

/**
 * The office puts a completed installation back on hold (for example a wrong photo). It then shows in the
 * technician's On hold section with this reason, and the technician fixes it and completes it again.
 */
export function PutOnHoldDialog({
  installation,
  onClose,
  onDone,
}: {
  installation: { id: string; vehicleNo: string } | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (!installation) return;
    if (!reason.trim()) return setError("Tell the technician what to fix.");
    setBusy(true);
    try {
      await officeInstallations.putOnHold(installation.id, reason.trim());
      toast.success("Put on hold. It now shows in the technician's On hold section.");
      setReason("");
      setError("");
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? (e.fieldErrors.reason?.[0] ?? e.message) : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={installation !== null}
      title={`Put ${installation?.vehicleNo || "this installation"} on hold`}
      description="The technician will see it in their On hold section with your reason, and can change the photos or details and complete it again."
      onClose={() => !busy && onClose()}
      footer={
        <>
          <Button busy={busy} onClick={() => void confirm()}>
            Put on hold
          </Button>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        </>
      }
    >
      <Field label="Reason" htmlFor="office-hold-reason" error={error}>
        <textarea
          id="office-hold-reason"
          rows={3}
          maxLength={300}
          placeholder="e.g. Wrong cabin photo, please retake"
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            if (error) setError("");
          }}
          className={inputClass}
        />
      </Field>
    </Modal>
  );
}
