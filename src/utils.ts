import { ModelPreferences, ReviewType } from "./types.js";

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
- Input validation and sanitization
- Authentication and authorization flaws
- Data exposure risks
- Injection vulnerabilities
- Cryptographic issues`,
    
    performance: `
Focus especially on:
- Algorithmic complexity
- Memory usage patterns
- I/O operations efficiency
- Caching opportunities
- Scalability bottlenecks`,
    
    maintainability: `
Focus especially on:
- Code readability and clarity
- Modularity and separation of concerns
- Documentation completeness
- Testing coverage gaps
- Technical debt indicators`,
    
    general: `
Provide a balanced review covering security, performance, and maintainability aspects.`
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
