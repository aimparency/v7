import { PROJECT_PATH_TOOL_PROPERTY } from "../constants.js";
import type { ToolDefinition } from "./types.js";

export const repoTools: ToolDefinition[] = [
  {
    name: "list_linked_repos",
    description: "List the repos this project can link an idea to: repoId, name, and whether the repo is checked out on this machine (resolved). Call it to get the repoId that link_repo needs.",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: PROJECT_PATH_TOOL_PROPERTY,
      },
      required: ["projectPath"],
    },
    handler: async (args, trpcClient) => {
      const repos = await trpcClient.linkedRepo.list.query({
        projectPath: args.projectPath as string,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              repos.map((r) => ({
                repoId: r.repoId,
                name: r.name,
                ...(r.url ? { url: r.url } : {}),
                resolved: r.resolved,
                ...(r.localPath ? { localPath: r.localPath } : {}),
              })),
              null,
              2
            ),
          },
        ],
      };
    },
  },
  {
    name: "register_linked_repo",
    description: "Make another locally checked-out Aimparency project linkable from this one (records its repoId, name and local path). Needed once per repo, before the first link_repo to it.",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: PROJECT_PATH_TOOL_PROPERTY,
        targetPath: { type: "string", description: "Absolute path to the other project's .bowman dir (or its repo root)" },
        url: { type: "string", description: "Optional relocation hint, e.g. the git remote, so collaborators can find the repo" },
        access: { type: "string", enum: ["read", "write"], description: "Machine-local access intent for the linked checkout. Default read." },
      },
      required: ["projectPath", "targetPath"],
    },
    handler: async (args, trpcClient) => {
      const repo = await trpcClient.linkedRepo.register.mutate({
        projectPath: args.projectPath as string,
        targetPath: args.targetPath as string,
        url: args.url as string | undefined,
        access: (args.access as "read" | "write" | undefined) ?? "read",
      });
      return {
        content: [
          {
            type: "text",
            text: `Registered linked repo "${repo.name}" (${repo.repoId}). Use link_repo with that repoId to attach it to an idea.`,
          },
        ],
      };
    },
  },
  {
    name: "link_repo",
    description: "Declare that a WHOLE external repo supports this idea — a black-box dependency. Targets a repo, never an idea inside it: there is no cross-repo idea link by design. Idempotent per repoId (re-linking updates weight/explanation). Value flows out of this idea into the repo, and the other repo keeps no back-reference.",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: PROJECT_PATH_TOOL_PROPERTY,
        ideaId: { type: "string", description: "The LOCAL idea being supported" },
        repoId: { type: "string", description: "Linked repo UUID from list_linked_repos" },
        weight: { type: "number", description: "Share of this idea's value flowing into the repo, like any child edge. Default 1." },
        explanation: { type: "string", description: "Why that repo supports this idea" },
      },
      required: ["projectPath", "ideaId", "repoId"],
    },
    handler: async (args, trpcClient) => {
      const projectPath = args.projectPath as string;
      const repoId = args.repoId as string;

      // Fail loudly on an unregistered repoId: idea.linkRepo would happily
      // store an edge pointing at nothing, which renders as a nameless
      // black box and silently drains value into a dead sink.
      const repos = await trpcClient.linkedRepo.list.query({ projectPath });
      const repo = repos.find((r) => r.repoId === repoId);
      if (!repo) {
        const known = repos.map((r) => `${r.repoId} (${r.name})`).join(", ") || "none";
        throw new Error(
          `Repo ${repoId} is not in this project's linked-repo registry. Register it first with register_linked_repo. Known repos: ${known}`
        );
      }

      await trpcClient.idea.linkRepo.mutate({
        projectPath,
        ideaId: args.ideaId as string,
        repoId,
        weight: args.weight as number | undefined,
        explanation: args.explanation as string | undefined,
      });
      return {
        content: [
          {
            type: "text",
            text: `Linked idea ${args.ideaId} to repo "${repo.name}" (${repoId})${repo.resolved ? "" : " — note: that repo is not checked out on this machine, so it renders as an unresolved stub"}`,
          },
        ],
      };
    },
  },
  {
    name: "unlink_repo",
    description: "Remove an idea→repo black-box link. Leaves the repo in the linked-repo registry.",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: PROJECT_PATH_TOOL_PROPERTY,
        ideaId: { type: "string" },
        repoId: { type: "string" },
      },
      required: ["projectPath", "ideaId", "repoId"],
    },
    handler: async (args, trpcClient) => {
      await trpcClient.idea.unlinkRepo.mutate({
        projectPath: args.projectPath as string,
        ideaId: args.ideaId as string,
        repoId: args.repoId as string,
      });
      return {
        content: [
          {
            type: "text",
            text: `Unlinked repo ${args.repoId} from idea ${args.ideaId}`,
          },
        ],
      };
    },
  },
];
