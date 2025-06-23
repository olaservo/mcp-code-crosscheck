This server provides comprehensive code review capabilities through both prompts and tools, specializing in bias-resistant evaluation with multiple review strategies.

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
- 'fetch_commit'/'fetch_pr_commits': GitHub CLI fallback tools, use only when GitHub MCP server unavailable
