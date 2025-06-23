import { z } from "zod";

// Review strategy type
export type ReviewStrategy = "adversarial" | "bias_aware" | "hybrid";

// Input schema for review_code tool
export const ReviewCodeInputSchema = z.object({
  code: z.string().describe("The code to review"),
  generationModel: z.string().describe("Model that generated the code (use detect_model_from_authors tool to get this)"),
  language: z.string().optional().describe("Programming language"),
  context: z.string().optional().describe("Additional context about the code"),
  reviewType: z.enum(["security", "performance", "maintainability", "general"]).optional().describe("Type of review to perform"),
  reviewStrategy: z.enum(["adversarial", "bias_aware", "hybrid"]).describe("Review strategy to use")
});

export type ReviewCodeInput = z.infer<typeof ReviewCodeInputSchema>;

// Input schema for detect_model_from_authors tool
export const DetectModelInputSchema = z.object({
  authors: z.array(z.object({
    name: z.string().optional(),
    email: z.string().optional(),
    login: z.string().optional(),
    id: z.union([z.string(), z.number()]).optional(),
    // Allow any additional fields from GitHub API responses
  }).passthrough()).describe("List of commit authors in any format - the tool will extract available information for AI model detection")
});

export type DetectModelInput = z.infer<typeof DetectModelInputSchema>;

// Input schema for fetch_commit tool
export const FetchCommitInputSchema = z.object({
  commitHash: z.string().describe("Git commit hash to fetch"),
  repo: z.string().optional().describe("GitHub repository (owner/repo format, defaults to current repo)")
});

export type FetchCommitInput = z.infer<typeof FetchCommitInputSchema>;

// Input schema for fetch_pr_commits tool
export const FetchPRCommitsInputSchema = z.object({
  prNumber: z.string().describe("GitHub PR number to fetch commits from"),
  repo: z.string().optional().describe("GitHub repository (owner/repo format, defaults to current repo)")
});

export type FetchPRCommitsInput = z.infer<typeof FetchPRCommitsInputSchema>;


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
