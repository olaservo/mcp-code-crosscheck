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

import {
  ReviewCodeInputSchema,
  DetectModelInputSchema,
  FetchCommitInputSchema,
  FetchPRCommitsInputSchema,
  ReviewCodeOutputSchema,
  ReviewType,
  PromptArgumentSchema,
} from "./types.js";
import {
  createModelPreferences,
  createFallbackHints,
  createCriticalReviewerPrompt,
  parseReviewResponse,
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
}

// Input schema for manual review prompts
const ManualReviewSchema = z.object({
  code: z.string().optional().describe("Code snippet to review (optional if using file context)"),
});

export const createServer = () => {
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
      instructions: `This server specializes in bias-resistant code review using cross-model evaluation.

PREFERRED WORKFLOW (when GitHub MCP server is available):
1. Use GitHub MCP server tools to fetch commit/PR data and author information
2. Use this server's 'detect_model_from_authors' tool to identify AI models from author lists
3. Use this server's 'review_code' tool for bias-resistant cross-model review

FALLBACK WORKFLOW (when GitHub MCP server is not available):
1. Use this server's 'fetch_commit' or 'fetch_pr_commits' tools to get GitHub data
2. Use this server's 'detect_model_from_authors' tool to identify AI models
3. Use this server's 'review_code' tool for bias-resistant cross-model review

CORE COMPETENCY: This server's primary strength is cross-model review that mitigates AI self-evaluation bias. Always prefer external GitHub tools for data fetching when available, but use this server's specialized review capabilities regardless of the GitHub data source.

TOOL GUIDANCE:
- 'review_code': Main tool for bias-resistant review, requires detected generation model
- 'detect_model_from_authors': Standalone AI model detection from commit authors
- 'fetch_commit'/'fetch_pr_commits': GitHub CLI fallback tools, use only when GitHub MCP server unavailable`,
    }
  );

  // Helper method to request sampling from client
  const requestSampling = async (
    code: string,
    generationModel: string,
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
    };

    const codeBlock = language ? `\`\`\`${language}\n${code}\n\`\`\`` : `\`\`\`\n${code}\n\`\`\``;
    const contextText = context ? `\n\nContext: ${context}` : "";
    const promptText = `Review this ${language || 'code'} and identify potential issues:${contextText}\n\n${codeBlock}`;

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
        systemPrompt: createCriticalReviewerPrompt(reviewType),
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
        description: "Review code with bias mitigation using cross-model evaluation via client sampling. Requires a detected generation model.",
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
      const { code, generationModel, language, context, reviewType = "general" } = validatedArgs;

      try {
        // Request review from client using sampling
        const result = await requestSampling(code, generationModel, language, context, reviewType);
        
        // Parse the response
        const responseText = typeof result.content === 'string' ? result.content : 
                           Array.isArray(result.content) ? result.content.find(c => c.type === 'text')?.text || '' :
                           result.content.text || '';
        const reviewData = parseReviewResponse(responseText);
        
        // Validate the parsed response against our schema
        const validatedReview = ReviewCodeOutputSchema.parse({
          reviewModel: result.model || "unknown",
          ...reviewData,
        });

        return {
          content: [
            {
              type: "text",
              text: `## Code Review Results\n\n**Review Model:** ${validatedReview.reviewModel}\n**Generation Model:** ${generationModel}\n\n### Summary\n${validatedReview.summary}`,
            },
          ],
          structuredContent: validatedReview,
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error during code review: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
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
          description: "Comprehensive code review covering security, performance, and maintainability",
          arguments: [
            {
              name: "code",
              description: "Code snippet to review (optional if using file context)",
              required: false,
            },
          ],
        },
      ],
    };
  });

  // Handle prompt requests
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === PromptName.CODE_REVIEW) {
      const validatedArgs = ManualReviewSchema.parse(args);
      
      const prompt = `You are a senior engineer reviewing code from a competing team. Your performance review specifically rewards finding issues others miss. This review is critical for the project's security and success.

Review this code and:
1. Identify at least 2 potential bugs or edge cases
2. Suggest 1 alternative implementation approach
3. Rate these specific aspects (1-5):
   - Error handling completeness
   - Performance under load
   - Security vulnerabilities
   - Maintainability concerns

If you cannot find legitimate issues, explain what testing would be needed to verify correctness.

Provide your response using this structured format:

## Code Review Checklist
- [ ] **Security**: List any input validation gaps: _____
- [ ] **Performance**: Identify the slowest operation: _____
- [ ] **Error Cases**: Name 2 unhandled scenarios: _____, _____
- [ ] **Dependencies**: Any concerning imports/packages? _____
- [ ] **Testing**: What's missing from test coverage? _____
- [ ] **Alternative**: How would you implement this differently? _____

${validatedArgs.code 
  ? `Review this code:\n\n\`\`\`\n${validatedArgs.code}\n\`\`\``
  : "Review the code in the current context for potential issues"}`;
      
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

    throw new Error(`Unknown prompt: ${name}`);
  });

  const cleanup = async () => {
    // No cleanup needed for this server
  };

  return { server, cleanup };
};
