import { SPACE_TOOL_PROPERTY } from "../constants.js";
import { fetchSpaceAtHost } from "shared";
import type { ToolDefinition } from "./types.js";
import { applyShares, describeSplits, shareUpdate, splitsSection, validatePercent } from "./shares.js";

export const repoTools: ToolDefinition[] = [
  {
    name: "import_github_issues",
    description: "Start or top up the space from a GitHub repository's open issues: one parent idea 'Open GitHub issues of owner/repo' with each issue as a child (title, body, issue URL, labels as tags). Pull requests are skipped; re-running only adds issues not imported yet. Public repos need no token; GITHUB_TOKEN in the backend's environment reaches private ones. Afterwards, connect the parent to the mission it serves and estimate value/cost of the issues worth doing.",
    inputSchema: {
      type: "object",
      properties: {
        space: SPACE_TOOL_PROPERTY,
        repository: { type: "string", description: "owner/repo or a github.com URL" },
      },
      required: ["space", "repository"],
    },
    handler: async (args, trpcClient) => {
      const result = await trpcClient.idea.importGithubIssues.mutate({
        space: args.space as string,
        repository: args.repository as string,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  },
  {
    name: "import_spec_tasks",
    description: "Start or top up the space from spec-driven checklists (GitHub spec-kit specs/*/tasks.md, spec-workflow-mcp .spec-workflow/specs/*/tasks.md): one parent idea per tasks.md, one child per top-level task, [x] as implemented and [-] as partially. Re-running adds new tasks and moves ideas of tasks ticked since forward (never back). Afterwards, connect each parent to the mission it serves and estimate value/cost.",
    inputSchema: {
      type: "object",
      properties: {
        space: SPACE_TOOL_PROPERTY,
        specPath: { type: "string", description: "A tasks.md file or a directory to search, relative to the repository root (e.g. 'specs' or '.')" },
      },
      required: ["space", "specPath"],
    },
    handler: async (args, trpcClient) => {
      const result = await trpcClient.idea.importSpecTasks.mutate({
        space: args.space as string,
        specPath: args.specPath as string,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  },
  {
    name: "find_spaces_on_disk",
    description: "The spaces (.bowman folders) on this machine: path, name and repoId of each. Without repoId or name it lists them (nearby folders and the home folder, a few levels deep) with how alive each is (ideas, open, lastChange; counts only, never their content) and whether your space links it already (linked). To find a space that moved, give its repoId: a match is the same space wherever it went (matchedBy: id); a name only suggests folders of that name (matchedBy: name), maybe another space. A linked repo whose folder moved is pointed at the new one with register_linked_repo targetPath. Only on a server without accounts (this machine's own).",
    inputSchema: {
      type: "object",
      properties: {
        repoId: { type: "string", description: "The id of the space to find (its meta.json repoId, as list_linked_repos shows it)" },
        name: { type: "string", description: "A folder or space name to suggest matches for" },
        roots: { type: "array", items: { type: "string" }, description: "Absolute folders to search. Default: the backend's folder, its parent and the home folder" },
        maxDepth: { type: "number", description: "How many folder levels below each root. Default 6 when looking for a space, else 3" },
        space: { type: "string", description: "Your space, to mark the spaces it links already. Default: this session's space" },
      },
      required: [],
    },
    handler: async (args, trpcClient) => {
      const looking = Boolean(args.repoId || args.name);
      const { rootsScanned, projects } = await trpcClient.project.discoverLocalProjects.query({
        ...(args.roots ? { roots: args.roots as string[] } : {}),
        maxDepth: (args.maxDepth as number | undefined) ?? (looking ? 6 : 3),
        limit: looking ? 20 : 200,
        ...(args.repoId ? { repoId: args.repoId as string } : {}),
        ...(args.name ? { name: args.name as string } : {}),
        details: !looking,
      });
      const linked = new Set(args.space && !looking
        ? (await trpcClient.linkedRepo.list.query({ space: args.space as string }).catch(() => [])).map((repo) => repo.repoId)
        : []);
      const spaces = projects.map(({ path, name, repoId, matchedBy, ideas, open, lastChange }) => ({
        path, ...(name ? { name } : {}), repoId: repoId ?? "none", ...(matchedBy ? { matchedBy } : {}),
        ...(ideas !== undefined ? { ideas, open, ...(lastChange ? { lastChange } : {}) } : {}),
        ...(repoId && linked.has(repoId) ? { linked: true } : {}),
      }));
      return { content: [{ type: "text", text: JSON.stringify({ rootsScanned, spaces }, null, 2) }] };
    },
  },
  {
    name: "list_linked_repos",
    description: "List the repos this project can link an idea to: repoId, name, and whether the repo is checked out on this machine (resolved). Call it to get the repoId that link_repo needs.",
    inputSchema: {
      type: "object",
      properties: {
        space: SPACE_TOOL_PROPERTY,
      },
      required: ["space"],
    },
    handler: async (args, trpcClient) => {
      const repos = await trpcClient.linkedRepo.list.query({
        space: args.space as string,
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
    description: "Make another Aimparency space linkable from this one. Give host, the space's address on the server hosting it (https://<server>/spaces/<space>), or targetPath for a project checked out on this machine. Needed once per space, before the first link_repo to it. name: what this space calls it, when the space's own name is unclear here; with repoId and name alone it renames an existing link.",
    inputSchema: {
      type: "object",
      properties: {
        space: SPACE_TOOL_PROPERTY,
        host: { type: "string", description: "The space's address on its Aimparency server, as opened in the browser: https://<server>/spaces/<space>" },
        targetPath: { type: "string", description: "Absolute path to the other project's .bowman dir (or its repo root), for a local checkout" },
        url: { type: "string", description: "Optional relocation hint, e.g. the git remote, so collaborators can find the repo" },
        access: { type: "string", enum: ["read", "write"], description: "Machine-local access intent for the linked checkout. Default read." },
        name: { type: "string", description: "The name this space shows for it. Default: the linked space's own name; a name given once stays on re-registering." },
        repoId: { type: "string", description: "With name and no host/targetPath: rename this already linked repo" },
      },
      required: ["space"],
    },
    handler: async (args, trpcClient) => {
      const space = args.space as string;
      const name = typeof args.name === "string" ? args.name : undefined;
      if (typeof args.host === "string") {
        const target = await fetchSpaceAtHost(args.host);
        let link = await trpcClient.linkedRepo.linkHost.mutate({ space, ...target });
        if (name) link = await trpcClient.linkedRepo.rename.mutate({ space, repoId: link.repoId, name });
        return {
          content: [{ type: "text", text: `Linked space "${link.name}" at ${link.host} (${link.repoId}). Use link_repo with that repoId to attach it to an idea.` }],
        };
      }
      if (typeof args.targetPath !== "string") {
        if (typeof args.repoId === "string" && name) {
          const link = await trpcClient.linkedRepo.rename.mutate({ space, repoId: args.repoId, name });
          return { content: [{ type: "text", text: `Linked repo ${link.repoId} is now shown as "${link.name}".` }] };
        }
        throw new Error("Give host (https://<server>/spaces/<space>) or targetPath, or repoId and name to rename a link.");
      }
      const repo = await trpcClient.linkedRepo.register.mutate({
        space,
        targetPath: args.targetPath as string,
        url: args.url as string | undefined,
        access: (args.access as "read" | "write" | undefined) ?? "read",
        name,
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
    description: "Declare that a WHOLE external repo supports this idea — a black-box dependency. Targets a repo, never an idea inside it: there is no cross-repo idea link by design. Idempotent per repoId (re-linking updates share/hypothesis). Value flows out of this idea into the repo, and the other repo keeps no back-reference. The reply shows the idea's split in percent.",
    inputSchema: {
      type: "object",
      properties: {
        space: SPACE_TOOL_PROPERTY,
        ideaId: { type: "string", description: "The LOCAL idea being supported" },
        repoId: { type: "string", description: "Linked repo UUID from list_linked_repos" },
        share: { type: "number", description: "Percent of this idea's value flowing into the repo, like a child link's share. Children and repos not named keep their proportions." },
        weight: { type: "number", description: "Raw relative weight; prefer share. Default 1." },
        hypothesis: { type: "string", description: "Why that repo supports this idea" },
      },
      required: ["space", "ideaId", "repoId"],
    },
    handler: async (args, trpcClient) => {
      const projectPath = args.space as string;
      const repoId = args.repoId as string;

      // Fail loudly on an unregistered repoId: idea.linkRepo would happily
      // store an edge pointing at nothing, which renders as a nameless
      // black box and silently drains value into a dead sink.
      const repos = await trpcClient.linkedRepo.list.query({ space: projectPath });
      const repo = repos.find((r) => r.repoId === repoId);
      if (!repo) {
        const known = repos.map((r) => `${r.repoId} (${r.name})`).join(", ") || "none";
        throw new Error(
          `Repo ${repoId} is not in this project's linked-repo registry. Register it first with register_linked_repo. Known repos: ${known}`
        );
      }

      const ideaId = args.ideaId as string;
      const share = args.share === undefined ? undefined : validatePercent(args.share, "share", false);
      if (share !== undefined) {
        // Check the share against the idea with the link in place before writing anything.
        const idea = await trpcClient.idea.get.query({ space: projectPath, ideaId });
        const linked = idea.supportingRepos?.some((link) => link.repoId === repoId);
        applyShares(
          linked ? idea : { ...idea, supportingRepos: [...(idea.supportingRepos ?? []), { repoId, weight: 1, relativePosition: [0, 0] }] },
          { shares: new Map([[repoId, share]]) },
        );
      }
      await trpcClient.idea.linkRepo.mutate({
        space: projectPath,
        ideaId,
        repoId,
        weight: args.weight as number | undefined,
        hypothesis: args.hypothesis as string | undefined,
      });
      if (share !== undefined) {
        const idea = await trpcClient.idea.get.query({ space: projectPath, ideaId });
        await trpcClient.idea.update.mutate({ space: projectPath, ideaId, idea: shareUpdate(idea, { shares: new Map([[repoId, share]]) }) });
      }
      return {
        content: [
          {
            type: "text",
            text: `Linked idea ${ideaId} to repo "${repo.name}" (${repoId})${repo.resolved || repo.host ? "" : " — note: that repo is neither checked out on this machine nor linked by its server address, so it renders as an unresolved stub"}` +
              splitsSection(await describeSplits(trpcClient, projectPath, [ideaId], repoId)),
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
        space: SPACE_TOOL_PROPERTY,
        ideaId: { type: "string" },
        repoId: { type: "string" },
      },
      required: ["space", "ideaId", "repoId"],
    },
    handler: async (args, trpcClient) => {
      await trpcClient.idea.unlinkRepo.mutate({
        space: args.space as string,
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
