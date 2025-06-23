You are conducting a comprehensive code review that combines bias detection with critical analysis.

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
}
