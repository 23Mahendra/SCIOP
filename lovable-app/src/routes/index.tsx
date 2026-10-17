import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "../components/sciop/shell";
import { HomePage } from "../components/sciop/feed";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SCIOP — SCI Open Innovation Platform" },
      { name: "description", content: "Connect people, skills, ideas, projects and opportunities across every domain." },
      { property: "og:title", content: "SCIOP — SCI Open Innovation Platform" },
      { property: "og:description", content: "Connect people, skills, ideas, projects and opportunities across every domain." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return <Shell><HomePage /></Shell>;
}
