import { z } from "zod";

// Input schema for review_code tool
export const ReviewCodeInputSchema = z.object({
  code: z.string().describe("The code to review"),
  generationModel: z.string().optional().describe("Model that generated the code (optional if commitHash or prNumber provided)"),
  language: z.string().optional().describe("Programming language"),
  context: z.string().optional().describe("Additional context about the code"),
  commitHash: z.string().optional().describe("Git commit hash to detect generation model from co-authors"),
  prNumber: z.string().optional().describe("GitHub PR number to detect generation model from co-authors"),
  repo: z.string().optional().describe("GitHub repository (owner/repo format, defaults to current repo)")
});

export type ReviewCodeInput = z.infer<typeof ReviewCodeInputSchema>;

// Input schema for review_commit tool
export const ReviewCommitInputSchema = z.object({
  commitHash: z.string().describe("Git commit hash to review"),
  repo: z.string().optional().describe("GitHub repository (owner/repo format, defaults to current repo)"),
  generationModel: z.string().optional().describe("Model that generated the code (fallback if not detected from co-authors)"),
  reviewType: z.enum(["security", "performance", "maintainability", "general"]).optional().describe("Type of review to perform")
});

export type ReviewCommitInput = z.infer<typeof ReviewCommitInputSchema>;

// Input schema for review_pr tool
export const ReviewPRInputSchema = z.object({
  prNumber: z.string().describe("GitHub PR number to review"),
  repo: z.string().optional().describe("GitHub repository (owner/repo format, defaults to current repo)"),
  generationModel: z.string().optional().describe("Model that generated the code (fallback if not detected from co-authors)"),
  reviewType: z.enum(["security", "performance", "maintainability", "general"]).optional().describe("Type of review to perform")
});

export type ReviewPRInput = z.infer<typeof ReviewPRInputSchema>;

// Output schema for review_code tool
export const ReviewIssueSchema = z.object({
  severity: z.enum(["critical", "major", "minor"]).describe("Issue severity level"),
  description: z.string().describe("Clear explanation of the issue"),
  suggestion: z.string().describe("How to fix the issue")
});

export const ReviewMetricsSchema = z.object({
  errorHandling: z.number().min(1).max(5).describe("Error handling completeness (1-5)"),
  performance: z.number().min(1).max(5).describe("Performance under load (1-5)"),
  security: z.number().min(1).max(5).describe("Security vulnerabilities (1-5)"),
  maintainability: z.number().min(1).max(5).describe("Maintainability concerns (1-5)")
});

export const ReviewCodeOutputSchema = z.object({
  reviewModel: z.string().describe("Model used for review"),
  summary: z.string().describe("Brief overall assessment"),
  issues: z.array(ReviewIssueSchema).describe("List of identified issues"),
  metrics: ReviewMetricsSchema.describe("Quantitative assessment metrics"),
  alternative: z.string().describe("Alternative implementation approach")
});

export type ReviewCodeOutput = z.infer<typeof ReviewCodeOutputSchema>;

// Review template types
export type ReviewType = "security" | "performance" | "maintainability" | "general";

// GitHub CLI integration types
export interface GitHubCommitAuthor {
  email: string;
  id: string;
  login: string;
  name: string;
}

export interface GitHubCommit {
  authoredDate: string;
  authors: GitHubCommitAuthor[];
  committedDate: string;
  messageBody: string;
  messageHeadline: string;
  oid: string;
}

export interface GitHubPRCommits {
  commits: GitHubCommit[];
}

// Model family extraction and exclusion types
export interface ModelPreferences {
  hints?: Array<{ name: string }>;
  intelligencePriority?: number;
  speedPriority?: number;
  costPriority?: number;
  metadata?: {
    excludeModel: string;
    excludeFamily: string;
    reviewContext: string;
  };
}

// Prompt argument schema
export const PromptArgumentSchema = z.object({
  name: z.string(),
  description: z.string(),
  required: z.boolean().default(false)
});

export type PromptArgument = z.infer<typeof PromptArgumentSchema>;
