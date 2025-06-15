import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  CreateMessageRequest,
  CreateMessageResultSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  Tool,
  ToolSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import {
  ReviewCodeInputSchema,
  ReviewCodeOutputSchema,
  ReviewType,
  PromptArgumentSchema,
} from "./types.js";
import {
  createModelPreferences,
  createFallbackHints,
  createCriticalReviewerPrompt,
  getReviewTemplate,
  parseReviewResponse,
} from "./utils.js";

const ToolInputSchema = ToolSchema.shape.inputSchema;
type ToolInput = z.infer<typeof ToolInputSchema>;

// Tool names
enum ToolName {
  REVIEW_CODE = "review_code",
}

// Prompt names
enum PromptName {
  QUICK_SECURITY_REVIEW = "quick_security_review",
  PERFORMANCE_REVIEW = "performance_review",
  MAINTAINABILITY_REVIEW = "maintainability_review",
}

// Input schema for manual review prompts
const ManualReviewSchema = z.object({
  code: z.string().describe("Code snippet to review"),
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
        resources: {},
        prompts: {},
      },
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
        description: "Review code with bias mitigation using cross-model evaluation via client sampling",
        inputSchema: zodToJsonSchema(ReviewCodeInputSchema) as ToolInput,
      },
    ];

    return { tools };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === ToolName.REVIEW_CODE) {
      const validatedArgs = ReviewCodeInputSchema.parse(args);
      const { code, generationModel, language, context } = validatedArgs;

      try {
        // Request review from client using sampling
        const result = await requestSampling(code, generationModel, language, context);
        
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

    throw new Error(`Unknown tool: ${name}`);
  });

  // List available resources
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        {
          uri: "review://templates/security",
          name: "Security Review Template",
          mimeType: "text/plain",
          description: "System prompt template for security-focused code reviews",
        },
        {
          uri: "review://templates/performance",
          name: "Performance Review Template",
          mimeType: "text/plain",
          description: "System prompt template for performance-focused code reviews",
        },
        {
          uri: "review://templates/maintainability",
          name: "Maintainability Review Template",
          mimeType: "text/plain",
          description: "System prompt template for maintainability-focused code reviews",
        },
        {
          uri: "review://templates/general",
          name: "General Review Template",
          mimeType: "text/plain",
          description: "System prompt template for general code reviews",
        },
      ],
    };
  });

  // List resource templates
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
    return {
      resourceTemplates: [
        {
          uriTemplate: "review://templates/{type}",
          name: "Review Templates",
          description: "System prompt templates for different types of code reviews",
        },
      ],
    };
  });

  // Read resources
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;

    if (uri.startsWith("review://templates/")) {
      const reviewType = uri.split("/").pop() as ReviewType;
      
      if (["security", "performance", "maintainability", "general"].includes(reviewType)) {
        const template = getReviewTemplate(reviewType);
        
        return {
          contents: [
            {
              uri,
              name: `${reviewType.charAt(0).toUpperCase() + reviewType.slice(1)} Review Template`,
              mimeType: "text/plain",
              text: template,
            },
          ],
        };
      }
    }

    throw new Error(`Unknown resource: ${uri}`);
  });

  // List available prompts
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return {
      prompts: [
        {
          name: PromptName.QUICK_SECURITY_REVIEW,
          description: "Quickly review code for security issues",
          arguments: [
            {
              name: "code",
              description: "Code snippet to review",
              required: true,
            },
          ],
        },
        {
          name: PromptName.PERFORMANCE_REVIEW,
          description: "Review code for performance issues",
          arguments: [
            {
              name: "code",
              description: "Code snippet to review",
              required: true,
            },
          ],
        },
        {
          name: PromptName.MAINTAINABILITY_REVIEW,
          description: "Review code for maintainability issues",
          arguments: [
            {
              name: "code",
              description: "Code snippet to review",
              required: true,
            },
          ],
        },
      ],
    };
  });

  // Handle prompt requests
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === PromptName.QUICK_SECURITY_REVIEW) {
      const validatedArgs = ManualReviewSchema.parse(args);
      const systemPrompt = createCriticalReviewerPrompt("security");
      
      return {
        messages: [
          {
            role: "system",
            content: {
              type: "text",
              text: systemPrompt,
            },
          },
          {
            role: "user",
            content: {
              type: "text",
              text: `Review this code for security issues:\n\n\`\`\`\n${validatedArgs.code}\n\`\`\``,
            },
          },
        ],
      };
    }

    if (name === PromptName.PERFORMANCE_REVIEW) {
      const validatedArgs = ManualReviewSchema.parse(args);
      const systemPrompt = createCriticalReviewerPrompt("performance");
      
      return {
        messages: [
          {
            role: "system",
            content: {
              type: "text",
              text: systemPrompt,
            },
          },
          {
            role: "user",
            content: {
              type: "text",
              text: `Review this code for performance issues:\n\n\`\`\`\n${validatedArgs.code}\n\`\`\``,
            },
          },
        ],
      };
    }

    if (name === PromptName.MAINTAINABILITY_REVIEW) {
      const validatedArgs = ManualReviewSchema.parse(args);
      const systemPrompt = createCriticalReviewerPrompt("maintainability");
      
      return {
        messages: [
          {
            role: "system",
            content: {
              type: "text",
              text: systemPrompt,
            },
          },
          {
            role: "user",
            content: {
              type: "text",
              text: `Review this code for maintainability issues:\n\n\`\`\`\n${validatedArgs.code}\n\`\`\``,
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
