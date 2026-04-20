import { GetPromptRequestSchema, ListPromptsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { trpc } from "./client.js";
import { PROJECT_PATH_PROMPT_ARGUMENT } from "./constants.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";

export function registerPrompts(server: Server, caller: any) {
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return {
      prompts: [
        {
          name: "breakdown",
          description: "Break a complex aim into 3-5 smaller sub-aims and establish dependency relationships between them",
          arguments: [
            PROJECT_PATH_PROMPT_ARGUMENT,
            {
              name: "aimId",
              description: "UUID of the aim to break down",
              required: true,
            },
          ],
        },
        {
          name: "analyze_dependencies",
          description: "Analyze aim relationships and suggest improvements",
          arguments: [
            PROJECT_PATH_PROMPT_ARGUMENT,
          ],
        },
        {
          name: "hypothesis_test",
          description: "Structure an aim as a testable hypothesis with success criteria",
          arguments: [
            PROJECT_PATH_PROMPT_ARGUMENT,
            {
              name: "aimId",
              description: "UUID of the aim to structure as hypothesis",
              required: true,
            },
          ],
        },
      ],
    };
  });

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      if (!args) {
        throw new Error("Arguments are required for prompts");
      }

      const projectPath = args.projectPath as string;
      if (!projectPath) {
        throw new Error("projectPath argument is required");
      }

      switch (name) {
        case "breakdown": {
          const aimId = args.aimId as string;
          if (!aimId) {
            throw new Error("aimId argument is required");
          }

          const aim = await caller.aim.get.query({ projectPath, aimId });

          return {
            description: `Break down aim "${aim.text}" into smaller sub-aims`,
            messages: [
              {
                role: "user",
                content: {
                  type: "text",
                  text: `I need help breaking down this aim into smaller, manageable sub-aims:

**Current Aim:**
- ID: ${aim.id}
- Text: ${aim.text}
- Status: ${aim.status.state}

**Instructions:**
1. Analyze the aim and identify 3-5 logical sub-aims that together accomplish the parent aim
2. For each sub-aim, determine if it depends on other sub-aims (create supportingConnections/supportedAims relationships)
3. Create each sub-aim using the create_aim tool
4. Link each sub-aim to the parent aim by:
   - Adding the parent aim's ID to the sub-aim's supportedAims array
   - Adding the sub-aim's ID to the parent aim's supportingConnections array (use update_aim)
5. Explain the breakdown strategy and dependency reasoning

Project path: ${projectPath}`,
                },
              },
            ],
          };
        }

        case "analyze_dependencies": {
          const aims = await caller.aim.list.query({ projectPath });

          return {
            description: "Analyze aim dependencies and suggest improvements",
            messages: [
              {
                role: "user",
                content: {
                  type: "text",
                  text: `Please analyze the aim dependency graph for this project:

**Total Aims:** ${aims.length}

**Instructions:**
1. Use the aims://all?projectPath=${projectPath} resource to get all aims
2. For each aim, check its supportingConnections (children) and supportedAims (parents) relationships
3. Identify:
   - Circular dependencies (if any)
   - Aims with no dependencies that could be worked on now
   - Bottleneck aims (many aims depend on them)
   - Orphaned aims (no relationships to other aims)
4. Suggest improvements to the dependency structure
5. Recommend which aims should be prioritized based on the dependency analysis

Project path: ${projectPath}`,
                },
              },
            ],
          };
        }

        case "hypothesis_test": {
          const aimId = args.aimId as string;
          if (!aimId) {
            throw new Error("aimId argument is required");
          }

          const aim = await caller.aim.get.query({ projectPath, aimId });

          return {
            description: `Structure aim "${aim.text}" as a testable hypothesis`,
            messages: [
              {
                role: "user",
                content: {
                  type: "text",
                  text: `Help me structure this aim as a testable hypothesis with clear success criteria:

**Current Aim:**
- Text: ${aim.text}
- Status: ${aim.status.state}

**Instructions:**
1. Reformulate the aim as a hypothesis (if needed)
2. Define 3-5 concrete, measurable success criteria
3. Identify what evidence would prove/disprove the hypothesis
4. Suggest sub-aims that represent experiments or tests
5. Update the aim's text and status.comment to reflect this structure using update_aim

Use this format:
**Hypothesis:** [Clear, testable statement]
**Success Criteria:**
- [ ] Criterion 1
- [ ] Criterion 2
...

**Evidence Required:** [What data/outcomes prove success]

**Experiments:** [Sub-aims to test hypothesis]

Project path: ${projectPath}
Aim ID: ${aimId}`,
                },
              },
            ],
          };
        }

        default:
          throw new Error(`Unknown prompt: ${name}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Error generating prompt: ${errorMessage}\n\nMake sure the projectPath and any required IDs are valid.`
      );
    }
  });
}
