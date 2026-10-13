import { createFileRoute } from "@tanstack/react-router";
import { Settings } from "@/components/studio/settings";

export const Route = createFileRoute("/ayarlar")({
  component: Settings,
});
