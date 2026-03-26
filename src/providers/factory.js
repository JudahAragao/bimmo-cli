import { OpenAIProvider } from './openai.js';
import { AnthropicProvider } from './anthropic.js';
import { GrokProvider } from './grok.js';
import { GeminiProvider } from './gemini.js';
import { OllamaProvider } from './ollama.js';

export function createProvider(config) {
  switch (config.provider) {
    case 'openai': return new OpenAIProvider(config);
    case 'anthropic': return new AnthropicProvider(config);
    case 'grok': return new GrokProvider(config);
    case 'gemini': return new GeminiProvider(config);
    case 'ollama': return new OllamaProvider(config);
    case 'openrouter': return new OpenAIProvider(config);
    case 'deepseek': return new OpenAIProvider(config);
    case 'zai': return new OpenAIProvider(config);
    default:
      throw new Error(`Provider ${config.provider} não suportado ainda.`);
  }
}