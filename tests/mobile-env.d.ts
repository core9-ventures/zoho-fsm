// The phone app reads its server address from Vite's `import.meta.env`; the unit tests import some of its files.
interface ImportMeta {
  readonly env: Record<string, string | undefined>;
}
