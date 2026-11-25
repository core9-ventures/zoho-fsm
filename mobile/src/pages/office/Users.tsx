import { useState } from "react";
import { Mail, Phone } from "lucide-react";
import { useParams } from "react-router-dom";
import { ApiError, usersApi, type UserDto } from "../../api";
import { ListScreen } from "../../components/ListScreen";
import { useAsync } from "../../data/useAsync";
import { formatDateTime } from "../../lib/format";
import { Badge, Button, Field, LoadError, Modal, Spinner, inputClass } from "../../ui/kit";
import { KV, PageHeader, Row, Section } from "../../ui/parts";
import { useToast } from "../../ui/toast";
import { passwordPolicy } from "@/modules/auth/auth.schema";
import { STAFF_ROLES } from "@/modules/users/users.schema";

const ROLE_LABEL: Record<string, string> = { ADMIN: "Admin", DISPATCHER: "Dispatcher", TECHNICIAN: "Technician" };
const roleName = (u: Pick<UserDto, "role" | "customRoleName">) => u.customRoleName ?? ROLE_LABEL[u.role] ?? u.role;

export function Users() {
  return (
    <ListScreen<UserDto>
      title="Users"
      subtitle={(n) => `${n} found`}
      searchPlaceholder="Search name or email"
      filters={[
        {
          key: "role",
          label: "Role",
          options: [{ value: "", label: "All roles" }, ...STAFF_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] ?? r }))],
        },
        {
          key: "status",
          label: "Status",
          options: [
            { value: "all", label: "All" },
            { value: "active", label: "Active" },
            { value: "inactive", label: "Inactive" },
          ],
          initial: "all",
        },
      ]}
      fetchPage={(q) => usersApi.list(q)}
      itemKey={(u) => u.id}
      empty="No users match."
      renderItem={(u) => (
        <Row to={`/users/${u.id}`}>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{u.fullName}</p>
            <Badge>{roleName(u)}</Badge>
            {!u.isActive && <Badge tone="amber">Inactive</Badge>}
          </div>
          <p className="text-muted-foreground truncate text-sm">{u.email}</p>
          <p className="text-muted-foreground text-xs">{u.lastLoginAt ? `Last sign-in ${formatDateTime(u.lastLoginAt)}` : "Has not signed in yet"}</p>
        </Row>
      )}
    />
  );
}

/** One user: details and technician profile, switch the account on or off, set a new password (Admin). */
export function UserDetail() {
  const { id = "" } = useParams();
  const toast = useToast();
  const { data: u, error, loading, reload } = useAsync(() => usersApi.get(id), [id]);

  const [busy, setBusy] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [pwError, setPwError] = useState("");
  const [switchOpen, setSwitchOpen] = useState(false);

  if (!u) return loading ? <Spinner /> : error ? <LoadError error={error} onRetry={() => void reload()} /> : null;
  const user = u;

  async function setActive(on: boolean) {
    setBusy(true);
    try {
      await usersApi.setActive(user.id, on);
      toast.success(on ? "Account switched on." : "Account switched off.");
      setSwitchOpen(false);
      await reload();
    } catch (e) {
      setSwitchOpen(false);
      toast.error(e instanceof ApiError ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    const parsed = passwordPolicy.safeParse(password);
    if (!parsed.success) return setPwError(parsed.error.issues[0]?.message ?? "Choose a stronger password.");
    setBusy(true);
    try {
      await usersApi.resetPassword(user.id, password);
      toast.success("New password saved. Tell the user.");
      setResetOpen(false);
      setPassword("");
      setPwError("");
    } catch (e) {
      setPwError(e instanceof ApiError ? (e.fieldErrors.password?.[0] ?? e.message) : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const p = user.technicianProfile;

  return (
    <div className="space-y-4">
      <PageHeader title={user.fullName} subtitle={roleName(user)} back={{ to: "/users", label: "Users" }} />
      <div className="flex flex-wrap gap-2">
        <Badge tone={user.isActive ? "green" : "amber"}>{user.isActive ? "Active" : "Inactive"}</Badge>
      </div>

      <Section title="Details">
        <KV
          rows={[
            ["Email", user.email],
            ["Phone", user.phone],
            ["Last sign-in", user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "Never"],
            ["Created", formatDateTime(user.createdAt)],
          ]}
        />
        <div className="flex flex-wrap gap-2">
          {user.phone && (
            <a href={`tel:${user.phone}`} className="flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium">
              <Phone className="size-4" /> Call
            </a>
          )}
          <a href={`mailto:${user.email}`} className="flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium">
            <Mail className="size-4" /> Email
          </a>
        </div>
      </Section>

      {p && (
        <Section title="Technician profile">
          <KV
            rows={[
              ["Working hours", `${p.workStart}–${p.workEnd}`],
              ["Working days", p.workingDays.join(", ")],
              ["Skills", p.skills.join(", ")],
              ["Hourly rate", String(p.hourlyRate)],
              ["Map color", <span key="c" className="inline-flex items-center gap-2"><span className="size-3 rounded-full" style={{ background: p.color }} />{p.color}</span>],
            ]}
          />
        </Section>
      )}

      <div className="grid gap-2">
        <Button variant="outline" onClick={() => { setPassword(""); setPwError(""); setResetOpen(true); }}>
          Set a new password
        </Button>
        <Button variant={user.isActive ? "danger" : "primary"} onClick={() => (user.isActive ? setSwitchOpen(true) : void setActive(true))} busy={busy && !switchOpen}>
          {user.isActive ? "Switch account off" : "Switch account on"}
        </Button>
      </div>

      <Modal
        open={switchOpen}
        title="Switch this account off?"
        description={`${user.fullName} will not be able to sign in until you switch it on again.`}
        onClose={() => !busy && setSwitchOpen(false)}
        footer={
          <>
            <Button variant="danger" busy={busy} onClick={() => void setActive(false)}>
              Switch off
            </Button>
            <Button variant="outline" onClick={() => setSwitchOpen(false)} disabled={busy}>
              Cancel
            </Button>
          </>
        }
      />

      <Modal
        open={resetOpen}
        title="Set a new password"
        description="At least 8 characters with an uppercase letter, a lowercase letter, a number and a symbol. Tell the user the new password yourself."
        onClose={() => !busy && setResetOpen(false)}
        footer={
          <>
            <Button busy={busy} onClick={() => void resetPassword()}>
              Save password
            </Button>
            <Button variant="outline" onClick={() => setResetOpen(false)} disabled={busy}>
              Cancel
            </Button>
          </>
        }
      >
        <Field label="New password" htmlFor="new-password" error={pwError}>
          <input
            id="new-password"
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (pwError) setPwError("");
            }}
            className={inputClass}
          />
        </Field>
      </Modal>
    </div>
  );
}
