import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SCIOP — Sci Open Innovation Platform" },
      { name: "description", content: "Connect people, skills, ideas, projects and opportunities across every domain." },
      { property: "og:title", content: "SCIOP — Sci Open Innovation Platform" },
      { property: "og:description", content: "Connect people, skills, ideas, projects and opportunities across every domain." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-center">
      <p className="text-sm uppercase tracking-[0.3em] text-muted-foreground">Sci Open Innovation Platform</p>
      <h1 className="max-w-3xl text-5xl font-semibold tracking-tight text-foreground md:text-7xl">
        People. Skills. Ideas. Projects. Opportunities.
      </h1>
      <p className="max-w-xl text-lg text-muted-foreground">
        SCIOP is coming together — the foundation is in place and the full experience is being built next.
      </p>
    </main>
  );
}