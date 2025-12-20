import { GetPromptRequestSchema, ListPromptsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { trpc } from "./client.js";
import { PROJECT_PATH_PROMPT_ARGUMENT } from "./constants.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";

export function registerPrompts(server: Server) {
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
          name: "plan_phase",
          description: "Help plan which aims to commit to a phase based on dependencies and status",
          arguments: [
            PROJECT_PATH_PROMPT_ARGUMENT,
            {
              name: "phaseId",
              description: "UUID of the phase to plan",
              required: true,
            },
          ],
        },
        {
          name: "review_progress",
          description: "Review phase commitments vs aim statuses and suggest next actions",
          arguments: [
            PROJECT_PATH_PROMPT_ARGUMENT,
            {
              name: "phaseId",
              description: "UUID of the phase to review",
              required: true,
            },
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
        {
          name: "consolidate_aims",
          description: "Analyze all aims to find duplicates and suggest consolidations",
          arguments: [
            PROJECT_PATH_PROMPT_ARGUMENT,
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

          const aim = await trpc.aim.get.query({ projectPath, aimId });

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
          const aims = await trpc.aim.list.query({ projectPath });

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

        case "plan_phase": {
          const phaseId = args.phaseId as string;
          if (!phaseId) {
            throw new Error("phaseId argument is required");
          }

          const phase = await trpc.phase.get.query({ projectPath, phaseId });

          return {
            description: `Help plan commitments for phase "${phase.name}"`,
            messages: [
              {
                role: "user",
                content: {
                  type: "text",
                  text: `Help me plan which aims to commit to this phase:

**Phase:**
- Name: ${phase.name}
- Duration: ${new Date(phase.from).toLocaleDateString()} to ${new Date(phase.to).toLocaleDateString()}
- Current commitments: ${phase.commitments.length} aims

**Instructions:**
1. Review all available aims using aims://all?projectPath=${projectPath}
2. Consider:
   - Aim dependencies (don't commit aims before their dependencies are done)
   - Current aim statuses (prioritize 'open' aims)
   - Phase duration (is there enough time?)
   - Already committed aims in this phase
3. Suggest which aims to commit using the commit_aim_to_phase tool
4. Explain the reasoning for each suggestion

Project path: ${projectPath}
Phase ID: ${phaseId}`,
                },
              },
            ],
          };
        }

        case "review_progress": {
          const phaseId = args.phaseId as string;
          if (!phaseId) {
            throw new Error("phaseId argument is required");
          }

          const phase = await trpc.phase.get.query({ projectPath, phaseId });

          return {
            description: `Review progress for phase "${phase.name}"`,
            messages: [
              {
                role: "user",
                content: {
                  type: "text",
                  text: `Review the progress of this phase and suggest next actions:

**Phase:**
- Name: ${phase.name}
- Duration: ${new Date(phase.from).toLocaleDateString()} to ${new Date(phase.to).toLocaleDateString()}
- Committed aims: ${phase.commitments.length}

**Instructions:**
1. Use phase://${phaseId}/aims?projectPath=${projectPath} to get all committed aims
2. Analyze the status of each aim:
   - Count: open, done, cancelled, partially, failed
   - Identify blocked aims (dependencies not met)
   - Identify aims ready to work on
3. Calculate progress percentage
4. Suggest:
   - Which aim to focus on next
   - Whether any aims should be moved to a different phase
   - Whether the phase timeline is realistic
5. Provide a concise progress report

Project path: ${projectPath}
Phase ID: ${phaseId}`,
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

          const aim = await trpc.aim.get.query({ projectPath, aimId });

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

        case "consolidate_aims": {
          const aims = await trpc.aim.list.query({ projectPath });

          return {
            description: "Analyze all aims to find duplicates and suggest consolidations",
            messages: [
              {
                role: "user",
                content: {
                  type: "text",
                  text: `Please analyze the entire aim database to find duplicates or highly related aims that should be consolidated:

**Total Aims:** ${aims.length}

**Instructions:**
1. Use the aims://all?projectPath=${projectPath} resource to get the full list of aims (if not already in context)
2. Identify groups of aims that are:
   - Duplicates (same or very similar text)
   - Highly related (e.g., "Implement X" and "Add X feature")
   - Fragmented (multiple small aims that should be sub-aims of a larger one)
3. For each group, propose a consolidation strategy:
   - **Merge:** Create a new parent aim or select the best existing one as the master.
   - **Link:** Connect related aims using supportingConnections/supportedAims.
   - **Prune:** Delete or cancel redundant aims.
4. Execute the consolidation plan using the available tools (create_aim, update_aim, delete_aim, connect_aims).
5. Explain your actions and the reasoning behind each consolidation.

Project path: ${projectPath}`,
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