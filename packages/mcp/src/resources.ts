import { ListResourcesRequestSchema, ReadResourceRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { trpc } from "./client.js";
import { PROJECT_PATH_PARAMETER, PROJECT_PATH_MISSING_ERROR } from "./constants.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { AIMPARENCY_DIR_NAME } from "shared";

function formatAim(aim: any) {
  if (aim.supportingConnections) {
    if (aim.supportingConnections.length === 0) {
        delete aim.supportingConnections;
    } else {
        aim.supportingConnections = aim.supportingConnections.map((conn: any) => {
          const { relativePosition, ...rest } = conn;
          return rest;
        });
    }
  }
  if (aim.supportedAims && aim.supportedAims.length === 0) delete aim.supportedAims;
  if (aim.committedIn && aim.committedIn.length === 0) delete aim.committedIn;
  if (aim.tags && aim.tags.length === 0) delete aim.tags;
  
  return aim;
}

function formatAims(aims: any[]) {
  return aims.map(formatAim);
}

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

export function registerResources(server: Server, caller: any) {
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        { uri: `aim://{uuid}?${PROJECT_PATH_PARAMETER}`, name: "Aim", mimeType: "application/json" },
        { uri: `aim://{uuid}/supporting_connections?${PROJECT_PATH_PARAMETER}`, name: "Aim children", mimeType: "application/json" },
        { uri: `aim://{uuid}/supported_aims?${PROJECT_PATH_PARAMETER}`, name: "Aim parents", mimeType: "application/json" },
        { uri: `aims://all?${PROJECT_PATH_PARAMETER}`, name: "All aims", mimeType: "application/json" },
        { uri: `phase://{uuid}?${PROJECT_PATH_PARAMETER}`, name: "Phase", mimeType: "application/json" },
        { uri: `phase://{uuid}/aims?${PROJECT_PATH_PARAMETER}`, name: "Phase aims", mimeType: "application/json" },
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
      // Extract projectPath from URI query parameter (e.g., aim://uuid?projectPath=/path/to/project)
      const url = new URL(uri, "http://dummy");
      const projectPath = url.searchParams.get("projectPath");

      if (!projectPath) {
        throw new Error(PROJECT_PATH_MISSING_ERROR);
      }

      if (parsed.type === "aim") {
        if (parsed.id === "all") {
          const aims = await caller.aim.list.query({ projectPath });
          return {
            contents: [
              {
                uri,
                mimeType: "application/json",
                text: JSON.stringify(formatAims(aims), null, 2),
              },
            ],
          };
        }

        const aim = await caller.aim.get.query({ projectPath, aimId: parsed.id! });

        if (parsed.subpath === "supporting_connections") {
          const connections = aim.supportingConnections || [];
          const supportingAims = await Promise.all(
            connections.map((conn: any) => caller.aim.get.query({ projectPath, aimId: conn.aimId }))
          );
          return {
            contents: [
              {
                uri,
                mimeType: "application/json",
                text: JSON.stringify(formatAims(supportingAims), null, 2),
              },
            ],
          };
        }

        if (parsed.subpath === "supported_aims") {
          const supported = aim.supportedAims || [];
          const supportedAims = await Promise.all(
            supported.map((id: string) => caller.aim.get.query({ projectPath, aimId: id }))
          );
          return {
            contents: [
              {
                uri,
                mimeType: "application/json",
                text: JSON.stringify(formatAims(supportedAims), null, 2),
              },
            ],
          };
        }

        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(formatAim(aim), null, 2),
            },
          ],
        };
      }

      if (parsed.type === "aims" && parsed.id === "all") {
        const statusParam = url.searchParams.get("status");
        const phaseIdParam = url.searchParams.get("phaseId");
        
        const aims = await caller.aim.list.query({
          projectPath,
          status: statusParam ? statusParam.split(',') : undefined,
          phaseId: phaseIdParam || undefined
        });
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
                              text: JSON.stringify(formatAims(aims), null, 2),            },
          ],
        };
      }

      if (parsed.type === "phase") {
        const phase = await caller.phase.get.query({ projectPath, phaseId: parsed.id! });

        if (parsed.subpath === "aims") {
          const aims = await Promise.all(
            phase.commitments.map((id: string) => caller.aim.get.query({ projectPath, aimId: id }))
          );
          return {
            contents: [
              {
                uri,
                mimeType: "application/json",
                                text: JSON.stringify(formatAims(aims), null, 2),              },
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
            text: `Error reading resource: ${errorMessage}\n\nMake sure to include projectPath as a query parameter, e.g.:\naim://uuid?projectPath=/abs/path/to/project/${AIMPARENCY_DIR_NAME}`,
          },
        ],
      };
    }
  });
}