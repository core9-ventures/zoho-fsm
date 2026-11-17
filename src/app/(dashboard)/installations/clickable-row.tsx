"use client";

import { useRouter } from "next/navigation";
import { TableRow } from "@/components/ui/table";

/** A table row that opens `href` when clicked anywhere (links inside it still work on their own). */
export function ClickableRow({ href, children }: { href: string; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <TableRow
      className="cursor-pointer"
      tabIndex={0}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a,button")) return;
        router.push(href);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target === e.currentTarget) router.push(href);
      }}
    >
      {children}
    </TableRow>
  );
}
