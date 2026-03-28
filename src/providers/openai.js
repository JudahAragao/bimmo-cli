import OpenAI from 'openai';
import { BaseProvider } from './base.js';
import { tools } from '../agent.js';

export class OpenAIProvider extends BaseProvider {
  constructor(config) {
    super(config);
    
    const extraHeaders = {};
    if (this.config.baseURL?.includes('openrouter.ai')) {
      extraHeaders['HTTP-Referer'] = 'https://github.com/JudahAragao/bimmo-cli';
      extraHeaders['X-Title'] = 'bimmo-cli';
    }

    this.client = new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseURL,
      defaultHeaders: extraHeaders
    });
  }

  formatMessages(messages) {
    return messages.map(msg => {
      if (typeof msg.content === 'string' || msg.content === null) return msg;
      
      if (Array.isArray(msg.content)) {
        const content = msg.content.map(part => {
          if (part.type === 'text') return { type: 'text', text: part.text };
          if (part.type === 'image') return {
            type: 'image_url',
            image_url: { url: `data:${part.mimeType};base64,${part.data}` }
          };
          return part;
        });
        return { ...msg, content };
      }
      return msg;
    });
  }

  async sendMessage(messages, options = {}, toolCallCount = 0) {
    const MAX_TOOL_CALLS = 10;
    const formattedMessages = this.formatMessages(messages);
    
    const openAiTools = tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }
    }));

    const requestOptions = {
      model: this.config.model,
      messages: formattedMessages,
      temperature: 0.7
    };

    if (openAiTools.length > 0) {
      requestOptions.tools = openAiTools;
      requestOptions.tool_choice = 'auto';
    }

    const response = await this.client.chat.completions.create(requestOptions, { signal: options.signal });

    const message = response.choices[0].message;

    if (message.tool_calls) {
      if (toolCallCount >= MAX_TOOL_CALLS) {
        return "Erro: Limite de chamadas de ferramentas atingido (segurança). Verifique se a IA entrou em loop.";
      }

      const toolResults = [];
      for (const toolCall of message.tool_calls) {
        if (options.signal?.aborted) throw new Error('Abortado pelo usuário');
        
        const tool = tools.find(t => t.name === toolCall.function.name);
        if (tool) {
          const args = JSON.parse(toolCall.function.arguments);
          const result = await tool.execute(args, options);
          
          toolResults.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: String(result)
          });
        }
      }

      const nextMessages = [...formattedMessages, message, ...toolResults];
      return this.sendMessage(nextMessages, options, toolCallCount + 1);
    }

    return message.content;
  }
}
