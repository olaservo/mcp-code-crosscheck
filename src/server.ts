import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  CreateMessageRequest,
  CreateMessageResultSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
  Tool,
  ToolSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

import {
  ReviewCodeInputSchema,
  DetectModelInputSchema,
  FetchCommitInputSchema,
  FetchPRCommitsInputSchema,
  ReviewType,
  ReviewStrategy,
} from "./types.js";
import {
  createModelPreferences,
  createFallbackHints,
  detectModelFromCoAuthors,
  fetchCommit,
  fetchPRCommits,
} from "./utils.js";

const ToolInputSchema = ToolSchema.shape.inputSchema;
type ToolInput = z.infer<typeof ToolInputSchema>;

// Tool names
enum ToolName {
  REVIEW_CODE = "review_code",
  DETECT_MODEL_FROM_AUTHORS = "detect_model_from_authors",
  FETCH_COMMIT = "fetch_commit",
  FETCH_PR_COMMITS = "fetch_pr_commits",
}

// Prompt names
enum PromptName {
  CODE_REVIEW = "code_review",
  SERVER_INSTRUCTIONS = "server_instructions",
}

// Get the directory path for the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Cached prompts loaded from markdown files
let cachedPrompts: {
  adversarial: string;
  biasAware: string;
  instructions: string;
} | null = null;

// Function to load prompts from markdown files
function loadPrompts() {
  if (cachedPrompts) {
    return cachedPrompts;
  }

  const promptsDir = join(__dirname, 'prompts');
  
  const adversarial = readFileSync(join(promptsDir, 'adversarial-reviewer.md'), 'utf-8').trim();
  const biasAware = readFileSync(join(promptsDir, 'bias-aware-reviewer.md'), 'utf-8').trim();
  const instructions = readFileSync(join(promptsDir, 'server-instructions.md'), 'utf-8').trim();
  
  cachedPrompts = {
    adversarial,
    biasAware,
    instructions,
  };
  
  return cachedPrompts;
}


// Simple switch function to get the appropriate prompt
function getReviewerPrompt(strategy: ReviewStrategy): string {
  const prompts = loadPrompts();
  switch (strategy) {
    case "adversarial":
      return prompts.adversarial;
    case "bias_aware":
      return prompts.biasAware;
  }
}

// Input schema for manual review prompts
const ManualReviewSchema = z.object({
  code: z.string().optional().describe("Code snippet to review (optional if using file context)"),
});

export const createServer = () => {
  // Load prompts at server creation time
  const prompts = loadPrompts();
  
  const server = new Server(
    {
      name: "mcp-code-crosscheck",
      version: "0.0.1",
    },
    {
      capabilities: {
        tools: {},
        prompts: {},
      },
      instructions: prompts.instructions,
    }
  );

  // Helper method to request sampling from client
  const requestSampling = async (
    code: string,
    generationModel: string,
    reviewStrategy: ReviewStrategy,
    language?: string,
    context?: string,
    reviewType: ReviewType = "general"
  ) => {
    const preferences = createModelPreferences(generationModel);
    const fallbackHints = createFallbackHints(generationModel);
    
    // Combine metadata-based preferences with fallback hints
    const modelPreferences = {
      ...preferences,
      hints: fallbackHints, // Provide fallback hints for clients that don't support metadata
      metadata: {
        ...preferences.metadata,
        reviewStrategy: reviewStrategy
      }
    };

    const codeBlock = language ? `\`\`\`${language}\n${code}\n\`\`\`` : `\`\`\`\n${code}\n\`\`\``;
    const contextText = context ? `\n\nContext: ${context}` : "";
    const promptText = `Review this ${language || 'code'} and identify potential issues:${contextText}\n\n${codeBlock}`;

    // Get strategy-specific system prompt
    const systemPrompt = getReviewerPrompt(reviewStrategy);

    const request: CreateMessageRequest = {
      method: "sampling/createMessage",
      params: {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: promptText,
            },
          },
        ],
        systemPrompt,
        modelPreferences,
        maxTokens: 2000,
        temperature: 0.2,
      },
    };

    return await server.request(request, CreateMessageResultSchema);
  };

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools: Tool[] = [
      {
        name: ToolName.REVIEW_CODE,
        description: "Review code with bias mitigation using cross-model evaluation via client sampling. Default 'bias_aware' mode focuses on correctness with low false positives. Optional 'adversarial' mode provides thorough review but expect some false positives. Use adversarial for security-critical code or when you want maximum scrutiny.",
        inputSchema: zodToJsonSchema(ReviewCodeInputSchema) as ToolInput,
      },
      {
        name: ToolName.DETECT_MODEL_FROM_AUTHORS,
        description: "Detect AI model from commit author information. Use this with data from GitHub sources.",
        inputSchema: zodToJsonSchema(DetectModelInputSchema) as ToolInput,
      },
      {
        name: ToolName.FETCH_COMMIT,
        description: "Fetch commit details using GitHub CLI. Fallback tool - prefer GitHub MCP server if available.",
        inputSchema: zodToJsonSchema(FetchCommitInputSchema) as ToolInput,
      },
      {
        name: ToolName.FETCH_PR_COMMITS,
        description: "Fetch PR commits using GitHub CLI. Fallback tool - prefer GitHub MCP server if available.",
        inputSchema: zodToJsonSchema(FetchPRCommitsInputSchema) as ToolInput,
      },
    ];

    return { tools };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === ToolName.REVIEW_CODE) {
      const validatedArgs = ReviewCodeInputSchema.parse(args);
      const { code, generationModel, language, context, reviewType = "general", reviewStrategy = "bias_aware" } = validatedArgs;

      try {
        // Request review from client using sampling
        const result = await requestSampling(code, generationModel, reviewStrategy, language, context, reviewType);
        
        // Extract the response text
        const responseText = typeof result.content === 'string' ? result.content : 
                           Array.isArray(result.content) ? result.content.find(c => c.type === 'text')?.text || '' :
                           result.content.text || '';

        // Add strategy indicator and warning for adversarial mode
        const strategyIndicator = reviewStrategy === "adversarial" 
          ? "⚠️ Adversarial review completed - Some findings may be overly critical"
          : "✓ Bias-aware review completed";

        // Return the markdown response with appended metadata
        return {
          content: [
            {
              type: "text",
              text: responseText,
            },
            {
              type: "text",
              text: `\n\n---\n**${strategyIndicator}**\n\n**Metadata:**\n- Review Model: ${result.model || "unknown"}\n- Generation Model: ${generationModel}\n- Strategy: ${reviewStrategy}`,
            },
          ],
        };
      } catch (error) {
        // Generate manual cross-model instructions when sampling fails
        const fallbackHints = createFallbackHints(generationModel);
        const recommendedModels = fallbackHints.map(h => h.name).join(', ');
        
        const codeBlock = language ? `\`\`\`${language}\n${code}\n\`\`\`` : `\`\`\`\n${code}\n\`\`\``;
        const contextText = context ? `\n\nContext: ${context}` : "";
        const systemPrompt = getReviewerPrompt(reviewStrategy || "bias_aware");
        const reviewPrompt = `${systemPrompt}\n\nReview this ${language || 'code'} and identify potential issues:${contextText}\n\n${codeBlock}`;

        return {
          content: [
            {
              type: "text",
              text: `## Sampling Failed - Manual Cross-Model Review Required

**Error:** ${error instanceof Error ? error.message : String(error)}

**To ensure bias-resistant review, please run this prompt with ${recommendedModels} instead of ${generationModel}:**

---

${reviewPrompt}

---

**Instructions:**
1. Copy the prompt above
2. Switch to a different model (recommended: ${recommendedModels})
3. Run the prompt with the different model
4. This ensures bias-resistant evaluation by avoiding the model that generated the code (${generationModel})

**Why this matters:** Using the same model for both generation and review can introduce self-preference bias. Cross-model evaluation helps identify issues the original model might miss.`,
            },
          ],
          structuredContent: {
            samplingFailed: true,
            generationModel,
            recommendedModels: fallbackHints.map(h => h.name),
            manualPrompt: reviewPrompt,
            error: error instanceof Error ? error.message : String(error)
          },
        };
      }
    }

    if (name === ToolName.DETECT_MODEL_FROM_AUTHORS) {
      const validatedArgs = DetectModelInputSchema.parse(args);
      const { authors } = validatedArgs;

      try {
        const detectedModel = detectModelFromCoAuthors(authors);
        
        return {
          content: [
            {
              type: "text",
              text: detectedModel 
                ? `Detected AI model: ${detectedModel}` 
                : "No AI model detected from the provided authors",
            },
          ],
          structuredContent: {
            detectedModel: detectedModel || null,
            authors: authors.length,
          },
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error detecting model: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }

    if (name === ToolName.FETCH_COMMIT) {
      const validatedArgs = FetchCommitInputSchema.parse(args);
      const { commitHash, repo } = validatedArgs;

      try {
        const commit = await fetchCommit(commitHash, repo);
        
        return {
          content: [
            {
              type: "text",
              text: `## Commit Details\n\n**Hash:** ${commit.oid}\n**Author:** ${commit.authors[0]?.name}\n**Date:** ${commit.authoredDate}\n**Message:** ${commit.messageHeadline}\n\n${commit.messageBody}`,
            },
          ],
          structuredContent: commit,
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error fetching commit: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }

    if (name === ToolName.FETCH_PR_COMMITS) {
      const validatedArgs = FetchPRCommitsInputSchema.parse(args);
      const { prNumber, repo } = validatedArgs;

      try {
        const commits = await fetchPRCommits(prNumber, repo);
        
        return {
          content: [
            {
              type: "text",
              text: `## PR #${prNumber} Commits\n\nFound ${commits.length} commits:\n\n${commits.map(c => `- ${c.oid.substring(0, 7)}: ${c.messageHeadline} (${c.authors[0]?.name})`).join('\n')}`,
            },
          ],
          structuredContent: { commits, count: commits.length },
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error fetching PR commits: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }

    throw new Error(`Unknown tool: ${name}`);
  });


  // List available prompts
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return {
      prompts: [
        {
          name: PromptName.CODE_REVIEW,
          description: "Comprehensive code review covering security, performance, and maintainability. Returns structured markdown with 1-3 scale metrics.",
          arguments: [
            {
              name: "code",
              description: "Code snippet to review (optional if using file context)",
              required: false,
            },
          ],
        },
        {
          name: PromptName.SERVER_INSTRUCTIONS,
          description: "Get comprehensive server usage instructions, capabilities, and workflow guidance.  This is a fallback for when the client does not support server instructions.",
          arguments: [],
        },
      ],
    };
  });

  // Handle prompt requests
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === PromptName.CODE_REVIEW) {
      const validatedArgs = ManualReviewSchema.parse(args);
      
      const codeSection = validatedArgs.code 
        ? `\n\nReview this code:\n\n\`\`\`\n${validatedArgs.code}\n\`\`\``
        : "\n\nReview the code in the current context for potential issues";
      
      // Use adversarial strategy as default for the general prompt
      const prompt = getReviewerPrompt("adversarial") + codeSection;
      
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: prompt,
            },
          },
        ],
      };
    }

    if (name === PromptName.SERVER_INSTRUCTIONS) {
      // Return the loaded server instructions
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: prompts.instructions,
            },
          },
        ],
      };
    }

    throw new Error(`Unknown prompt: ${name}`);
  });

  const cleanup = async () => {
    // No cleanup needed for this server
  };

  return { server, cleanup };
};
