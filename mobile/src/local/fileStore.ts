import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";

/**
 * Photos and videos that wait for a signal are kept as files in the app's private storage (not in the SQLite
 * database, which would grow heavy with video). One file per queued upload, named by the change's temporary id.
 * The first line of the file is the content type, the rest is the file in base64.
 */

const DIR = "outbox";
const path = (id: string) => `${DIR}/${id.replace(/[^a-zA-Z0-9-]/g, "_")}`;

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

const fromBase64 = (data: string, type: string) => {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
};

export const fileStore = {
  async save(id: string, blob: Blob): Promise<void> {
    await Filesystem.writeFile({
      path: path(id),
      directory: Directory.Data,
      encoding: Encoding.UTF8,
      recursive: true,
      data: `${blob.type || "application/octet-stream"}\n${await toBase64(blob)}`,
    });
  },

  /** The saved file, or null when it is not on the phone (never saved, or already uploaded and removed). */
  async read(id: string): Promise<Blob | null> {
    try {
      const res = await Filesystem.readFile({ path: path(id), directory: Directory.Data, encoding: Encoding.UTF8 });
      const text = typeof res.data === "string" ? res.data : await res.data.text();
      const cut = text.indexOf("\n");
      return fromBase64(text.slice(cut + 1), text.slice(0, cut));
    } catch {
      return null;
    }
  },

  /** Names of every file in the store (they are the temporary ids of the queued uploads). */
  async names(): Promise<string[]> {
    try {
      const res = await Filesystem.readdir({ path: DIR, directory: Directory.Data });
      return res.files.map((f) => f.name);
    } catch {
      return []; // nothing was ever stored
    }
  },

  async remove(id: string): Promise<void> {
    try {
      await Filesystem.deleteFile({ path: path(id), directory: Directory.Data });
    } catch {
      /* already gone */
    }
  },
};
