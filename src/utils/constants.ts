export const BUFFER_PERCENTAGE = 0.1; // 10% safety buffer

// Claude models - all paid plans have 200k context
export const CLAUDE_MODELS: { [key: string]: number | "variable" } = {
  // Current Claude models
  'claude-sonnet-4': 200000,
  'claude-opus-4.1': 200000,
  'claude-opus-4': 200000,
  'claude-3.7-sonnet': 200000,
  // Legacy but still shows up
  'claude-3.5-sonnet': 200000,
  'claude-3.5-haiku': 200000,
  'claude-opus-3': 200000,
};

// ChatGPT Free plan models
export const GPT_MODELS_FREE: { [key: string]: number } = {
  'gpt-5-fast': 16000
};

// ChatGPT Plus plan models
export const GPT_MODELS_PLUS: { [key: string]: number } = {
  'gpt-5-fast': 32000,
  'gpt-5-thinking': 196000,
  'o3': 200000,
  'o4-mini': 200000,
  'gpt-4o': 128000,
  'gpt-4.1': 32000,
};

// ChatGPT Pro plan models
export const GPT_MODELS_PRO: { [key: string]: number } = {
  'gpt-5-fast': 128000,
  'gpt-5-thinking': 196000,
  'gpt-5-pro': 196000,
  'o3': 200000,
  'o4-mini': 200000,
  'gpt-4o': 128000,
  'gpt-4.1': 128000,
};


export const COLOR_THRESHOLDS = {
  GREEN: 0.7,   // 0-70%
  YELLOW: 0.9,  // 70-90%
  RED: 1.0      // 90-100%
};

export const COLORS = {
  GREEN: '#22c55e',
  YELLOW: '#eab308',
  RED: '#ef4444',
  OVERFLOW: '#dc2626'
};
