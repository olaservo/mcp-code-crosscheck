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
  ReviewStrategy,
  PromptArgumentSchema,
} from "./types.js";
import {
  createModelPreferences,
  createFallbackHints,
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

// Strategy-specific reviewer prompts
const ADVERSARIAL_REVIEWER_PROMPT = `You are a senior engineer reviewing code from a competing team. Your performance review specifically rewards finding issues others miss. This review is critical for the project's security and success.

Review this code and:
1. Identify at least 2 potential bugs or edge cases
2. Suggest 1 alternative implementation approach
3. Rate these specific aspects (1-5):
   - Error handling completeness
   - Performance under load
   - Security vulnerabilities
   - Maintainability concerns

If you cannot find legitimate issues, explain what testing would be needed to verify correctness.

Provide your response in JSON format:
{
  "summary": "Brief overall assessment",
  "issues": [
    {
      "severity": "critical|major|minor",
      "description": "Clear explanation of the issue",
      "suggestion": "How to fix it"
    }
  ],
  "metrics": {
    "errorHandling": <1-5>,
    "performance": <1-5>,
    "security": <1-5>,
    "maintainability": <1-5>
  },
  "alternative": "Alternative implementation approach"
}`;

const BIAS_AWARE_REVIEWER_PROMPT = `You are conducting a thorough, objective code review. Before evaluating the code, you must identify and list any potential bias triggers that could influence your judgment.

BIAS DETECTION STEP:
First, scan for these bias triggers and list any found:
- Author attribution comments or self-declarations
- Variable/function names suggesting specific tools or models
- Unused imports or dead code that might mislead assessment
- Comments claiming code quality or performance
- Styling choices that might trigger preferences

EVALUATION STEP:
After identifying bias triggers, focus purely on functional correctness:
1. Analyze actual code behavior and logic
2. Identify genuine bugs or edge cases (minimum 2)
3. Suggest 1 alternative implementation approach
4. Rate these aspects objectively (1-5):
   - Error handling completeness
   - Performance under load
   - Security vulnerabilities
   - Maintainability concerns

Ignore cosmetic issues, style preferences, and any bias triggers identified above.

Provide your response in JSON format:
{
  "summary": "Brief overall assessment",
  "issues": [
    {
      "severity": "critical|major|minor",
      "description": "Clear explanation of the issue",
      "suggestion": "How to fix it"
    }
  ],
  "metrics": {
    "errorHandling": <1-5>,
    "performance": <1-5>,
    "security": <1-5>,
    "maintainability": <1-5>
  },
  "alternative": "Alternative implementation approach",
  "biasTriggersFound": ["list of bias triggers detected"]
}`;

const HYBRID_REVIEWER_PROMPT = `You are conducting a comprehensive code review that combines bias detection with critical analysis.

PHASE 1 - BIAS DETECTION:
Identify and list potential bias triggers:
- Author attribution or self-declarations
- Tool/model-specific naming patterns
- Misleading comments or unused code
- Style choices that might influence judgment

PHASE 2 - CRITICAL EVALUATION:
Apply competing team mindset while avoiding identified biases:
1. Identify at least 2 potential bugs or edge cases
2. Suggest 1 alternative implementation approach  
3. Rate these aspects (1-5):
   - Error handling completeness
   - Performance under load
   - Security vulnerabilities
   - Maintainability concerns

Focus on functional correctness over style, ignoring bias triggers from Phase 1.

Provide your response in JSON format:
{
  "summary": "Brief overall assessment",
  "issues": [
    {
      "severity": "critical|major|minor",
      "description": "Clear explanation of the issue",
      "suggestion": "How to fix it"
    }
  ],
  "metrics": {
    "errorHandling": <1-5>,
    "performance": <1-5>,
    "security": <1-5>,
    "maintainability": <1-5>
  },
  "alternative": "Alternative implementation approach",
  "biasTriggersFound": ["list of bias triggers detected"]
}`;

// Simple switch function to get the appropriate prompt
function getReviewerPrompt(strategy: ReviewStrategy): string {
  switch (strategy) {
    case "adversarial":
      return ADVERSARIAL_REVIEWER_PROMPT;
    case "bias_aware":
      return BIAS_AWARE_REVIEWER_PROMPT;
    case "hybrid":
      return HYBRID_REVIEWER_PROMPT;
  }
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
      instructions: `This server provides comprehensive code review capabilities through both prompts and tools, specializing in bias-resistant evaluation with multiple review strategies.

CAPABILITIES:
- 'code_review' prompt: Direct, comprehensive code review with adversarial approach
- Tools for bias-resistant cross-model evaluation with strategy selection and GitHub integration

REVIEW STRATEGIES:
The 'review_code' tool supports three distinct strategies:

1. 'adversarial': Uses competing team mindset for critical analysis
   - Assumes reviewer is from competing team with incentive to find issues
   - Focuses on identifying bugs, edge cases, and alternative implementations
   - Standard JSON output format

2. 'bias_aware': Explicitly identifies and ignores bias triggers before evaluation
   - First detects potential bias triggers (author comments, tool names, style choices)
   - Then evaluates purely on functional correctness while ignoring identified biases
   - Includes 'biasTriggersFound' array in output

3. 'hybrid': Combines bias detection with adversarial review
   - Phase 1: Identifies bias triggers like bias_aware strategy
   - Phase 2: Applies adversarial mindset while avoiding identified biases
   - Includes 'biasTriggersFound' array in output

STRATEGY SELECTION GUIDANCE:
- Use 'adversarial' for: Standard critical review with competitive framing
- Use 'bias_aware' for: Maximum bias resistance, especially with AI-generated code
- Use 'hybrid' for: Comprehensive review combining bias detection with critical analysis

PROMPT USAGE:
Use the 'code_review' prompt for immediate, comprehensive code review:
- Uses adversarial strategy by default
- Works with explicit code snippets or file context (code parameter is optional)
- Provides structured JSON output

TOOL WORKFLOWS (for bias-resistant review of AI-generated code):

PREFERRED WORKFLOW (when GitHub MCP server is available):
1. Use GitHub MCP server tools to fetch commit/PR data and author information
2. Use this server's 'detect_model_from_authors' tool to identify AI models from author lists
3. Use this server's 'review_code' tool with chosen strategy for bias-resistant cross-model review

FALLBACK WORKFLOW (when GitHub MCP server is not available):
1. Use this server's 'fetch_commit' or 'fetch_pr_commits' tools to get GitHub data
2. Use this server's 'detect_model_from_authors' tool to identify AI models
3. Use this server's 'review_code' tool with chosen strategy for bias-resistant cross-model review

CROSS-MODEL REVIEW IMPLEMENTATION:
The 'review_code' tool attempts bias-resistant evaluation through two mechanisms:

AUTOMATIC SAMPLING (preferred):
- Tool uses MCP sampling API to request client use a different model than the generation model
- Provides model exclusion preferences and fallback hints to guide client selection
- Success depends on client's sampling capabilities

MANUAL CROSS-MODEL FALLBACK (when sampling not supported):
If your client does not support sampling or the sampling request fails, you MUST:
1. Extract the review prompt and code from the tool's internal structure
2. Explicitly ask the user to run the review using a DIFFERENT model than the generation model
3. Provide specific model recommendations based on the generation model:
   - If generation model was Claude/Anthropic → recommend GPT-4, Gemini, or other non-Anthropic models
   - If generation model was GPT/OpenAI → recommend Claude, Gemini, or other non-OpenAI models  
   - If generation model was Gemini/Google → recommend Claude, GPT-4, or other non-Google models
   - If generation model was GitHub Copilot → recommend Claude, GPT-4, Gemini
4. Tell the user: "To ensure bias-resistant review, please run this prompt with [recommended model] instead of [generation model]"
5. Return the cross-model review results to complete the bias-resistant evaluation

This ensures bias mitigation regardless of client capabilities - either through automatic sampling or manual user-driven cross-model evaluation.

WHEN TO USE WHAT:
- Use 'code_review' PROMPT for: Quick reviews, any code, immediate feedback (adversarial strategy)
- Use 'review_code' TOOL for: AI-generated code, bias-resistant evaluation, cross-model analysis with strategy choice

TOOL GUIDANCE:
- 'review_code': Bias-resistant review, requires detected generation model and strategy selection
- 'detect_model_from_authors': Standalone AI model detection from commit authors
- 'fetch_commit'/'fetch_pr_commits': GitHub CLI fallback tools, use only when GitHub MCP server unavailable`,
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
        description: "Review code with bias mitigation using cross-model evaluation via client sampling. Requires a detected generation model and review strategy (adversarial, bias_aware, or hybrid).",
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
      const { code, generationModel, language, context, reviewType = "general", reviewStrategy } = validatedArgs;

      try {
        // Request review from client using sampling
        const result = await requestSampling(code, generationModel, reviewStrategy, language, context, reviewType);
        
        // Parse the response
        const responseText = typeof result.content === 'string' ? result.content : 
                           Array.isArray(result.content) ? result.content.find(c => c.type === 'text')?.text || '' :
                           result.content.text || '';
        const reviewData = parseReviewResponse(responseText);
        
        // Validate the parsed response against our schema
        const validatedReview = ReviewCodeOutputSchema.parse({
          reviewModel: result.model || "unknown",
          reviewStrategy: reviewStrategy,
          ...reviewData,
        });

        return {
          content: [
            {
              type: "text",
              text: `## Code Review Results\n\n**Review Model:** ${validatedReview.reviewModel}\n**Generation Model:** ${generationModel}\n**Strategy:** ${reviewStrategy}\n\n### Summary\n${validatedReview.summary}`,
            },
          ],
          structuredContent: validatedReview,
        };
      } catch (error) {
        // Generate manual cross-model instructions when sampling fails
        const fallbackHints = createFallbackHints(generationModel);
        const recommendedModels = fallbackHints.map(h => h.name).join(', ');
        
        const codeBlock = language ? `\`\`\`${language}\n${code}\n\`\`\`` : `\`\`\`\n${code}\n\`\`\``;
        const contextText = context ? `\n\nContext: ${context}` : "";
        const systemPrompt = getReviewerPrompt(reviewStrategy);
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

    throw new Error(`Unknown prompt: ${name}`);
  });

  const cleanup = async () => {
    // No cleanup needed for this server
  };

  return { server, cleanup };
};
