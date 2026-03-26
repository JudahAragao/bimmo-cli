import OpenAI from 'openai';
import { BaseProvider } from './base.js';

export class GrokProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.client = new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseURL || 'https://api.x.ai/v1'
    });
  }

  formatMessages(messages) {
    return messages.map(msg => {
      if (typeof msg.content === 'string') {
        return msg;
      }
      
      const content = msg.content.map(part => {
        if (part.type === 'text') {
          return { type: 'text', text: part.text };
        } else if (part.type === 'image') {
          return {
            type: 'image_url',
            image_url: {
              url: `data:${part.mimeType};base64,${part.data}`
            }
          };
        }
      });

      return { ...msg, content };
    });
  }

  async sendMessage(messages) {
    const formattedMessages = this.formatMessages(messages);
    
    const response = await this.client.chat.completions.create({
      model: this.config.model,
      messages: formattedMessages,
      temperature: 0.7
    });

    return response.choices[0].message.content;
  }
}