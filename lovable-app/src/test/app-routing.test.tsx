import { QueryClient } from "@tanstack/react-query";
import { createRouter, rootRouteId } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { routeTree } from "@/routeTree.gen";

describe("SCIOP route coverage", () => {
  const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

  it("matches the home page", () => {
    const matches = router.matchRoutes("/");
    expect(matches.at(-1)?.routeId).not.toBe(rootRouteId);
  });

  it.each([
    "/explore",
    "/people",
    "/people/member-123",
    "/opportunities",
    "/opportunities/opportunity-123",
    "/projects",
    "/projects/project-123",
    "/ideas",
    "/ideas/idea-123",
    "/communities",
    "/communities/community-123",
    "/messages",
    "/notifications",
    "/profile",
    "/settings",
    "/saved",
    "/admin",
    "/auth",
    "/reset",
    "/connections",
    "/posts/post-123",
  ])("matches %s", (path) => {
    const matches = router.matchRoutes(path);
    expect(matches.at(-1)?.routeId, `No route matched ${path}`).not.toBe(rootRouteId);
  });
});
