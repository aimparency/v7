import type { BackendClient } from "./client.js";
import { ListResourcesRequestSchema, ReadResourceRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { trpc } from "./client.js";
import { PROJECT_PATH_PARAMETER, PROJECT_PATH_MISSING_ERROR } from "./constants.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { AIMPARENCY_DIR_NAME } from "shared";
import { formatIdea, formatIdeas } from "./tools/format.js";

// Helper to parse resource URIs
function parseResourceUri(uri: string): { type: string; id?: string; subpath?: string } {
  // Remove query parameters before parsing
  const uriWithoutQuery = uri.split('?')[0];
  const match = uriWithoutQuery.match(/^(\w+):\/\/([^/]+)(?:\/(.+))?$/);
  if (!match) {
    throw new Error(`Invalid resource URI: ${uri}`);
  }
  return {
    type: match[1],
    id: match[2],
    subpath: match[3],
  };
}

export function registerResources(server: Server, caller: BackendClient) {
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        { uri: `idea://{uuid}?${PROJECT_PATH_PARAMETER}`, name: "Idea", mimeType: "application/json" },
        { uri: `idea://{uuid}/supporting_connections?${PROJECT_PATH_PARAMETER}`, name: "Idea children", mimeType: "application/json" },
        { uri: `idea://{uuid}/supported_ideas?${PROJECT_PATH_PARAMETER}`, name: "Idea parents", mimeType: "application/json" },
        { uri: `ideas://all?${PROJECT_PATH_PARAMETER}`, name: "All ideas", mimeType: "application/json" },
        { uri: `phase://{uuid}?${PROJECT_PATH_PARAMETER}`, name: "Phase", mimeType: "application/json" },
        { uri: `phase://{uuid}/ideas?${PROJECT_PATH_PARAMETER}`, name: "Phase ideas", mimeType: "application/json" },
        { uri: `phases://all?${PROJECT_PATH_PARAMETER}`, name: "All phases", mimeType: "application/json" },
        { uri: `phases://{parent-uuid}/children?${PROJECT_PATH_PARAMETER}`, name: "Sub-phases", mimeType: "application/json" },
        { uri: `project://meta?${PROJECT_PATH_PARAMETER}`, name: "Project meta", mimeType: "application/json" },
      ],
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    const parsed = parseResourceUri(uri);

    try {
      // Extract projectPath from URI query parameter (e.g., idea://uuid?projectPath=/path/to/project)
      const url = new URL(uri, "http://dummy");
      const projectPath = url.searchParams.get("projectPath");

      if (!projectPath) {
        throw new Error(PROJECT_PATH_MISSING_ERROR);
      }

      if (parsed.type === "idea") {
        if (parsed.id === "all") {
          const ideas = await caller.idea.list.query({ projectPath });
          return {
            contents: [
              {
                uri,
                mimeType: "application/json",
                text: JSON.stringify(formatIdeas(ideas), null, 2),
              },
            ],
          };
        }

        const idea = await caller.idea.get.query({ projectPath, ideaId: parsed.id! });

        if (parsed.subpath === "supporting_connections") {
          const connections = idea.supportingConnections || [];
          const supportingIdeas = await Promise.all(
            connections.map((conn) => caller.idea.get.query({ projectPath, ideaId: conn.ideaId }))
          );
          return {
            contents: [
              {
                uri,
                mimeType: "application/json",
                text: JSON.stringify(formatIdeas(supportingIdeas), null, 2),
              },
            ],
          };
        }

        if (parsed.subpath === "supported_ideas") {
          const supported = idea.supportedIdeas || [];
          const supportedIdeas = await Promise.all(
            supported.map((id: string) => caller.idea.get.query({ projectPath, ideaId: id }))
          );
          return {
            contents: [
              {
                uri,
                mimeType: "application/json",
                text: JSON.stringify(formatIdeas(supportedIdeas), null, 2),
              },
            ],
          };
        }

        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(formatIdea(idea), null, 2),
            },
          ],
        };
      }

      if (parsed.type === "ideas" && parsed.id === "all") {
        const statusParam = url.searchParams.get("status");
        const phaseIdParam = url.searchParams.get("phaseId");
        
        const ideas = await caller.idea.list.query({
          projectPath,
          status: statusParam ? statusParam.split(',') : undefined,
          phaseId: phaseIdParam || undefined
        });
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
                              text: JSON.stringify(formatIdeas(ideas), null, 2),            },
          ],
        };
      }

      if (parsed.type === "phase") {
        const phase = await caller.phase.get.query({ projectPath, phaseId: parsed.id! });

        if (parsed.subpath === "ideas") {
          const ideas = await Promise.all(
            phase.commitments.map((id: string) => caller.idea.get.query({ projectPath, ideaId: id }))
          );
          return {
            contents: [
              {
                uri,
                mimeType: "application/json",
                                text: JSON.stringify(formatIdeas(ideas), null, 2),              },
            ],
          };
        }

        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(phase, null, 2),
            },
          ],
        };
      }

      if (parsed.type === "phases") {
        if (parsed.id === "all") {
          const phases = await caller.phase.list.query({ projectPath });
          return {
            contents: [
              {
                uri,
                mimeType: "application/json",
                text: JSON.stringify(phases, null, 2),
              },
            ],
          };
        }

        if (parsed.subpath === "children") {
          const phases = await caller.phase.list.query({ projectPath, parentPhaseId: parsed.id });
          return {
            contents: [
              {
                uri,
                mimeType: "application/json",
                text: JSON.stringify(phases, null, 2),
              },
            ],
          };
        }
      }

      if (parsed.type === "project" && parsed.id === "meta") {
        const meta = await caller.project.getMeta.query({ projectPath });
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(meta, null, 2),
            },
          ],
        };
      }

      throw new Error(`Unknown resource: ${uri}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        contents: [
          {
            uri,
            mimeType: "text/plain",
            text: `Error reading resource: ${errorMessage}\n\nMake sure to include projectPath as a query parameter, e.g.:\nidea://uuid?projectPath=/abs/path/to/project/${AIMPARENCY_DIR_NAME}`,
          },
        ],
      };
    }
  });
}