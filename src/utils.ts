import { ModelPreferences, ReviewType, GitHubCommit, GitHubPRCommits, GitHubCommitAuthor } from "./types.js";
import { execSync } from "child_process";

/**
 * Check if two models have overlapping characteristics that suggest they're from the same family
 * Uses regex patterns to detect common base names, providers, and versions
 */
export function hasModelOverlap(model1: string, model2: string): boolean {
  const m1 = model1.toLowerCase();
  const m2 = model2.toLowerCase();
  
  // Extract base model names using regex
  const baseModelPattern = /^(gpt|claude|gemini|llama|mistral|phi|codestral|deepseek|qwen)/i;
  const m1Base = m1.match(baseModelPattern)?.[1];
  const m2Base = m2.match(baseModelPattern)?.[1];
  
  // If both have recognizable base names, check if they match
  if (m1Base && m2Base) {
    return m1Base === m2Base;
  }
  
  // Extract provider/company patterns
  const providerPattern = /(openai|anthropic|google|meta|microsoft|mistral|deepseek|alibaba)/i;
  const m1Provider = m1.match(providerPattern)?.[1];
  const m2Provider = m2.match(providerPattern)?.[1];
  
  // If both have the same provider and share significant text, consider them overlapping
  if (m1Provider && m2Provider && m1Provider === m2Provider) {
    return true;
  }
  
  // Check for shared significant substrings (at least 4 characters)
  const significantParts1 = m1.match(/[a-z]{4,}/g) || [];
  const significantParts2 = m2.match(/[a-z]{4,}/g) || [];
  
  for (const part1 of significantParts1) {
    for (const part2 of significantParts2) {
      if (part1 === part2) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Check if a candidate model should be excluded based on the generation model
 */
export function shouldExcludeModel(generationModel: string, candidateModel: string): boolean {
  // Exact match exclusion
  if (generationModel === candidateModel) return true;
  
  // Overlap-based exclusion using regex patterns
  return hasModelOverlap(generationModel, candidateModel);
}

/**
 * Create model preferences that exclude the generation model
 */
export function createModelPreferences(generationModel: string): ModelPreferences {
  return {
    // Set priorities based on review needs
    intelligencePriority: 0.8,  // We want capable models for thorough review
    speedPriority: 0.5,         // Moderate speed priority
    costPriority: 0.3,          // Less concerned about cost for quality reviews
    
    // Custom metadata to help client avoid same model
    metadata: {
      excludeModel: generationModel,
      excludeFamily: generationModel.toLowerCase(), // Store the full model name for overlap checking
      reviewContext: "bias_resistant_code_review"
    }
  };
}

/**
 * Create fallback hints for clients that don't support exclusion metadata
 */
export function createFallbackHints(generationModel: string): Array<{ name: string }> {
  const modelLower = generationModel.toLowerCase();
  
  // Provide broad hints that encourage diversity based on regex patterns
  if (modelLower.includes('gpt') || modelLower.includes('openai')) {
    return [
      { name: 'claude' },
      { name: 'gemini' }
    ];
  } else if (modelLower.includes('claude') || modelLower.includes('anthropic')) {
    return [
      { name: 'gpt' },
      { name: 'gemini' },
      { name: 'openai' }
    ];
  } else if (modelLower.includes('gemini') || modelLower.includes('google')) {
    return [
      { name: 'claude' },
      { name: 'gpt' },
      { name: 'openai' }
    ];
  } else if (modelLower.includes('llama') || modelLower.includes('meta')) {
    return [
      { name: 'claude' },
      { name: 'gpt' },
      { name: 'gemini' }
    ];
  }
  
  // For unknown models, suggest major alternatives
  return [
    { name: 'claude' },
    { name: 'gpt' },
    { name: 'gemini' }
  ];
}

/**
 * Create a critical reviewer system prompt based on review type
 */
export function createCriticalReviewerPrompt(reviewType: ReviewType = "general"): string {
  const basePrompt = `You are a senior engineer reviewing code from a competing team. Your performance review specifically rewards finding issues others miss. This review is critical for the project's security and success.

Review the code and:
1. Identify at least 2 potential bugs or edge cases
2. Suggest 1 alternative implementation approach
3. Rate these specific aspects (1-5):
   - Error handling completeness
   - Performance under load
   - Security vulnerabilities
   - Maintainability concerns

If you cannot find legitimate issues, explain what testing would be needed to verify correctness.`;

  const typeSpecificGuidance = {
    security: `
Focus especially on:
- Input validation and sanitization: List any specific input validation gaps
- Authentication and authorization flaws: Identify access control weaknesses
- Data exposure risks: Name any sensitive data that could be leaked
- Injection vulnerabilities: Specify injection attack vectors
- Cryptographic issues: Point out weak encryption or hashing practices
- Dependencies: Flag any concerning security-related imports or packages`,
    
    performance: `
Focus especially on:
- Algorithmic complexity: Identify the slowest operation and its time complexity
- Memory usage patterns: Point out potential memory leaks or excessive allocation
- I/O operations efficiency: Name specific I/O bottlenecks
- Caching opportunities: Suggest what should be cached
- Scalability bottlenecks: Identify what will break under load
- Testing: What performance testing is missing to verify scalability?`,
    
    maintainability: `
Focus especially on:
- Code readability and clarity: Identify confusing or unclear sections
- Modularity and separation of concerns: Point out tight coupling issues
- Documentation completeness: What documentation is missing?
- Testing coverage gaps: Name 2 unhandled scenarios that need tests
- Technical debt indicators: Identify code that will be hard to modify
- Dependencies: Any concerning imports that add unnecessary complexity?`,
    
    general: `
Provide a balanced review covering security, performance, and maintainability aspects.
For each area, be specific:
- Security: List any input validation gaps
- Performance: Identify the slowest operation  
- Error Cases: Name 2 unhandled scenarios
- Testing: What's missing from test coverage?
- Dependencies: Any concerning imports or packages?`
  };

  const outputFormat = `
Provide your response in the following JSON format:
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

  return basePrompt + typeSpecificGuidance[reviewType] + outputFormat;
}

/**
 * Get review template content for a specific review type
 */
export function getReviewTemplate(reviewType: ReviewType): string {
  return createCriticalReviewerPrompt(reviewType);
}

/**
 * Parse JSON response from LLM, with error handling
 */
export function parseReviewResponse(response: string): any {
  try {
    // Try to extract JSON from response if it's wrapped in markdown or other text
    const jsonMatch = response.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
    const jsonString = jsonMatch ? jsonMatch[1] : response.trim();
    
    return JSON.parse(jsonString);
  } catch (error) {
    throw new Error(`Failed to parse review response as JSON: ${error}`);
  }
}

/**
 * Detect AI model from commit co-authors
 */
export function detectModelFromCoAuthors(authors: GitHubCommitAuthor[]): string | null {
  for (const author of authors) {
    const name = author.name.toLowerCase();
    const email = author.email.toLowerCase();
    const login = author.login.toLowerCase();
    
    // Claude detection
    if (name.includes('claude') || email.includes('anthropic.com') || login.includes('claude')) {
      return 'claude';
    }
    
    // GPT/OpenAI detection
    if (name.includes('gpt') || name.includes('openai') || email.includes('openai.com') || login.includes('gpt')) {
      return 'gpt-4';
    }
    
    // GitHub Copilot detection
    if (name.includes('copilot') || email.includes('github.com') && login.includes('copilot')) {
      return 'github-copilot';
    }
    
    // Gemini/Google detection
    if (name.includes('gemini') || name.includes('bard') || email.includes('google.com')) {
      return 'gemini';
    }
    
    // Add more patterns as needed
  }
  
  return null;
}

/**
 * Fetch PR commits using GitHub CLI
 */
export async function fetchPRCommits(prNumber: string, repo?: string): Promise<GitHubCommit[]> {
  try {
    const repoFlag = repo ? `--repo ${repo}` : '';
    const command = `gh pr view ${prNumber} ${repoFlag} --json commits`;
    
    const output = execSync(command, { encoding: 'utf8' });
    const data: GitHubPRCommits = JSON.parse(output);
    
    return data.commits;
  } catch (error) {
    throw new Error(`Failed to fetch PR commits: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Fetch single commit using GitHub CLI
 */
export async function fetchCommit(commitHash: string, repo?: string): Promise<GitHubCommit> {
  try {
    const repoFlag = repo ? `--repo ${repo}` : '';
    const command = `gh api repos/${repo || 'OWNER/REPO'}/commits/${commitHash}`;
    
    const output = execSync(command, { encoding: 'utf8' });
    const data = JSON.parse(output);
    
    // Convert GitHub API format to our format
    const commit: GitHubCommit = {
      authoredDate: data.commit.author.date,
      authors: [
        {
          email: data.commit.author.email,
          id: data.author?.id || '',
          login: data.author?.login || '',
          name: data.commit.author.name
        }
      ],
      committedDate: data.commit.committer.date,
      messageBody: data.commit.message.split('\n').slice(1).join('\n'),
      messageHeadline: data.commit.message.split('\n')[0],
      oid: data.sha
    };
    
    // Parse co-authors from commit message
    const coAuthorPattern = /Co-Authored-By:\s*([^<]+)<([^>]+)>/gi;
    let match;
    while ((match = coAuthorPattern.exec(data.commit.message)) !== null) {
      const name = match[1].trim();
      const email = match[2].trim();
      
      commit.authors.push({
        email,
        id: '',
        login: name.toLowerCase().replace(/\s+/g, '-'),
        name
      });
    }
    
    return commit;
  } catch (error) {
    throw new Error(`Failed to fetch commit: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Detect generation model from PR or commit
 */
export async function detectGenerationModel(
  prNumber?: string,
  commitHash?: string,
  repo?: string,
  providedModel?: string
): Promise<string> {
  // 1. Try PR detection first
  if (prNumber) {
    try {
      const commits = await fetchPRCommits(prNumber, repo);
      
      // Check commits until we find one with co-author info
      for (const commit of commits) {
        const detectedModel = detectModelFromCoAuthors(commit.authors);
        if (detectedModel) {
          return detectedModel;
        }
      }
    } catch (error) {
      console.warn(`Failed to detect model from PR ${prNumber}:`, error);
    }
  }
  
  // 2. Try single commit detection
  if (commitHash) {
    try {
      const commit = await fetchCommit(commitHash, repo);
      const detectedModel = detectModelFromCoAuthors(commit.authors);
      if (detectedModel) {
        return detectedModel;
      }
    } catch (error) {
      console.warn(`Failed to detect model from commit ${commitHash}:`, error);
    }
  }
  
  // 3. Fall back to provided parameter
  if (providedModel) {
    return providedModel;
  }
  
  // 4. Error if neither available
  throw new Error("Could not detect generation model. Please provide generationModel parameter or commit/PR information with co-author data.");
}
