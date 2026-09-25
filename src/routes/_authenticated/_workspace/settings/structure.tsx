import { createFileRoute } from "@tanstack/react-router";
import { StructurePage } from "@/components/workspace/StructurePage";
import { pageHead } from "@/routes/_authenticated/-workspace-shell";

export const Route = createFileRoute("/_authenticated/_workspace/settings/structure")({
  head: () => pageHead("settings-structure"),
  component: StructurePage,
});
