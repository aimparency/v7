import { ListResourcesRequestSchema, ReadResourceRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { trpc } from "./client.js";
import { PROJECT_PATH_PARAMETER, PROJECT_PATH_MISSING_ERROR, SUBDIR_NAME } from "./constants.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";

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

export function registerResources(server: Server) {
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        {
          uri: `aim://{uuid}?${PROJECT_PATH_PARAMETER}`,
          name: "Single aim",
          description: "Get a specific aim's text, status, and relationships. Replace {uuid} with actual aim ID. It's advised to know an aims supported aims recursively to fully understand it. Aims can have different states",
          mimeType: "application/json",
        },
        {
          uri: `aim://{uuid}/supporting_connections?${PROJECT_PATH_PARAMETER}`,
          name: `Supporting connections (Children)`,
          description: `Get all aims that support this aim (dependencies/prerequisites)`,
          mimeType: `application/json`,
        },
        {
          uri: `aim://{uuid}/supported_aims?${PROJECT_PATH_PARAMETER}`,
          name: `Supported aims (Parents)`,
          description: `Get all aims that this aim supports (aims that depend on this aim)`,
          mimeType: `application/json`,
        },
        {
          uri: `aims://all?${PROJECT_PATH_PARAMETER}`,
          name: `All aims`,
          description: `List all aims in the project with their full details`,
          mimeType: `application/json`,
        },
        {
          uri: `phase://{uuid}?${PROJECT_PATH_PARAMETER}`,
          name: `Single phase`,
          description: `Get a phase's name, date range, parent, and committed aims. Replace {uuid} with actual phase ID. A phase is a temporal window in which aims can be focused. Phases can have subphases, think YEAR>MONTHS>WEEKS for example. Phases help to focus on a set of aims in a given frame of time. Phases on the same level (siblings) are rather sequential.`,
          mimeType: `application/json`,
        },
        {
          uri: `phase://{uuid}/aims?${PROJECT_PATH_PARAMETER}`,
          name: `Phase aims`,
          description: `Get full details of all aims committed to this phase`,
          mimeType: `application/json`,
        },
        {
          uri: `phases://all?${PROJECT_PATH_PARAMETER}`,
          name: `All phases`,
          description: `List all phases in the project (root and sub-phases)`,
          mimeType: `application/json`,
        },
        {
          uri: `phases://{parent-uuid}/children?${PROJECT_PATH_PARAMETER}`,
          name: `Sub-phases`,
          description: `List all child phases of a specific parent phase`,
          mimeType: `application/json`,
        },
        {
          uri: `project://meta?${PROJECT_PATH_PARAMETER}`,
          name: `Project info`,
          description: `Get project name and color`,
          mimeType: `application/json`,
        },
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
          const aims = await trpc.aim.list.query({ projectPath });
          return {
            contents: [
              {
                uri,
                mimeType: "application/json",
                text: JSON.stringify(aims, null, 2),
              },
            ],
          };
        }

        const aim = await trpc.aim.get.query({ projectPath, aimId: parsed.id! });

        if (parsed.subpath === "supporting_connections") {
          const connections = aim.supportingConnections || [];
          const supportingAims = await Promise.all(
            connections.map((conn) => trpc.aim.get.query({ projectPath, aimId: conn.aimId }))
          );
          return {
            contents: [
              {
                uri,
                mimeType: "application/json",
                text: JSON.stringify(supportingAims, null, 2),
              },
            ],
          };
        }

        if (parsed.subpath === "supported_aims") {
          const supported = aim.supportedAims || [];
          const supportedAims = await Promise.all(
            supported.map((id) => trpc.aim.get.query({ projectPath, aimId: id }))
          );
          return {
            contents: [
              {
                uri,
                mimeType: "application/json",
                text: JSON.stringify(supportedAims, null, 2),
              },
            ],
          };
        }

        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(aim, null, 2),
            },
          ],
        };
      }

      if (parsed.type === "aims" && parsed.id === "all") {
        const statusParam = url.searchParams.get("status");
        const phaseIdParam = url.searchParams.get("phaseId");
        
        const aims = await trpc.aim.list.query({
          projectPath,
          status: statusParam ? statusParam.split(',') : undefined,
          phaseId: phaseIdParam || undefined
        });
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(aims, null, 2),
            },
          ],
        };
      }

      if (parsed.type === "phase") {
        const phase = await trpc.phase.get.query({ projectPath, phaseId: parsed.id! });

        if (parsed.subpath === "aims") {
          const aims = await Promise.all(
            phase.commitments.map((id) => trpc.aim.get.query({ projectPath, aimId: id }))
          );
          return {
            contents: [
              {
                uri,
                mimeType: "application/json",
                text: JSON.stringify(aims, null, 2),
              },
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
          const phases = await trpc.phase.list.query({ projectPath });
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
          const phases = await trpc.phase.list.query({ projectPath, parentPhaseId: parsed.id });
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
        const meta = await trpc.project.getMeta.query({ projectPath });
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
            text: `Error reading resource: ${errorMessage}\n\nMake sure to include projectPath as a query parameter, e.g.:\naim://uuid?projectPath=/abs/path/to/project/${SUBDIR_NAME}`,
          },
        ],
      };
    }
  });
}