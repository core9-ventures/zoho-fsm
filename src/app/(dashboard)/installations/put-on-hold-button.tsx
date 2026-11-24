"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { PauseCircle } from "lucide-react";
import { toast } from "sonner";
import { Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { putInstallationOnHoldAction } from "@/modules/installations/installations.actions";

/**
 * Office button: puts a completed installation back on hold so the technician can fix it (for example a wrong
 * photo). The reason is required; the technician sees it on the held record.
 */
export function PutOnHoldButton({
  id,
  vehicleNo,
  size = "sm",
}: {
  id: string;
  vehicleNo: string;
  size?: "sm" | "default";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  function confirm() {
    if (!reason.trim()) {
      setError("Tell the technician what to fix.");
      return;
    }
    start(async () => {
      const res = await putInstallationOnHoldAction(id, reason);
      if (!res.ok) {
        setError(res.fieldErrors?.reason?.[0] ?? res.error);
        return;
      }
      toast.success("Put on hold. It now shows in the technician's On hold section.");
      setOpen(false);
      setReason("");
      setError("");
      router.refresh();
    });
  }

  return (
    <>
      <Button type="button" variant="outline" size={size} onClick={() => setOpen(true)}>
        <PauseCircle /> Put on hold
      </Button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) setError("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Put {vehicleNo || "this installation"} on hold</DialogTitle>
            <DialogDescription>
              The technician will see it in their On hold section with your reason, and can change the photos or
              details and complete it again.
            </DialogDescription>
          </DialogHeader>
          <Field label="Reason" htmlFor="office-hold-reason" error={error}>
            <Textarea
              id="office-hold-reason"
              rows={3}
              maxLength={300}
              placeholder="e.g. Wrong cabin photo, please retake"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (error) setError("");
              }}
              autoFocus
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="button" onClick={confirm} disabled={pending}>
              {pending ? "Saving…" : "Put on hold"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
