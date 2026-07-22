/** Known OpenAI-compatible providers for the "Add LLM" form. */
export interface ProviderPreset {
  id: string;
  name: string;
  baseUrl: string;
  exampleModel: string;
  keyHint: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    exampleModel: "openrouter/auto",
    keyHint: "openrouter.ai/keys",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    exampleModel: "deepseek-chat",
    keyHint: "platform.deepseek.com",
  },
  {
    id: "kimi",
    name: "Kimi (Moonshot)",
    baseUrl: "https://api.moonshot.ai/v1",
    exampleModel: "kimi-k2-0905-preview",
    keyHint: "platform.moonshot.ai",
  },
  {
    id: "glm",
    name: "GLM (Z.ai)",
    baseUrl: "https://api.z.ai/api/paas/v4",
    exampleModel: "glm-4.6",
    keyHint: "z.ai / bigmodel.cn",
  },
  {
    id: "grok",
    name: "Grok (xAI)",
    baseUrl: "https://api.x.ai/v1",
    exampleModel: "grok-4",
    keyHint: "console.x.ai",
  },
  {
    id: "gemini",
    name: "Gemini (Google)",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    exampleModel: "gemini-2.5-flash",
    keyHint: "aistudio.google.com",
  },
  {
    id: "sakana",
    name: "Sakana Fugu",
    baseUrl: "https://api.sakana.ai/v1",
    exampleModel: "fugu-ultra",
    keyHint: "console.sakana.ai",
  },
  {
    id: "custom",
    name: "Custom (any OpenAI-compatible API)",
    baseUrl: "",
    exampleModel: "",
    keyHint: "your provider's dashboard",
  },
];
