import Anthropic from '@anthropic-ai/sdk';
import { BaseProvider } from './base.js';
import { tools } from '../agent.js';

export class AnthropicProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.client = new Anthropic({
      apiKey: this.config.apiKey
    });
  }

  formatContent(content) {
    if (typeof content === 'string') return content;
    return content.map(part => {
      if (part.type === 'text') return { type: 'text', text: part.text };
      if (part.type === 'image') return {
        type: 'image',
        source: { type: 'base64', media_type: part.mimeType, data: part.data }
      };
      return part;
    });
  }

  async sendMessage(messages, options = {}) {
    const systemMessage = messages.find(m => m.role === 'system');
    const userMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role,
        content: this.formatContent(m.content)
      }));

    const anthropicTools = tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters
    }));

    const response = await this.client.messages.create({
      model: this.config.model,
      max_tokens: 4096,
      system: systemMessage ? systemMessage.content : undefined,
      messages: userMessages,
      tools: anthropicTools,
      temperature: 0.7
    }, { signal: options.signal });

    if (response.stop_reason === 'tool_use') {
      const toolUse = response.content.find(p => p.type === 'tool_use');
      const tool = tools.find(t => t.name === toolUse.name);
      
      if (tool) {
        if (options.signal?.aborted) throw new Error('Abortado pelo usuário');
        const result = await tool.execute(toolUse.input);
        
        const nextMessages = [
          ...messages,
          { role: 'assistant', content: response.content },
          {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: String(result)
            }]
          }
        ];
        
        return this.sendMessage(nextMessages, options);
      }
    }

    return response.content[0].text;
  }
}
