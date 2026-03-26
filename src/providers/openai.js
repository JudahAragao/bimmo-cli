import OpenAI from 'openai';
import { BaseProvider } from './base.js';
import { tools } from '../agent.js';

export class OpenAIProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.client = new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseURL
    });
  }

  formatMessages(messages) {
    return messages.map(msg => {
      if (typeof msg.content === 'string') return msg;
      
      const content = msg.content.map(part => {
        if (part.type === 'text') return { type: 'text', text: part.text };
        if (part.type === 'image') return {
          type: 'image_url',
          image_url: { url: `data:${part.mimeType};base64,${part.data}` }
        };
      });
      return { ...msg, content };
    });
  }

  async sendMessage(messages) {
    const formattedMessages = this.formatMessages(messages);
    
    // Converte tools do agent.js para o formato da OpenAI
    const openAiTools = tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }
    }));

    const response = await this.client.chat.completions.create({
      model: this.config.model,
      messages: formattedMessages,
      tools: openAiTools,
      tool_choice: 'auto'
    });

    const message = response.choices[0].message;

    if (message.tool_calls) {
      const toolResults = [];
      for (const toolCall of message.tool_calls) {
        const tool = tools.find(t => t.name === toolCall.function.name);
        if (tool) {
          console.log(`\n  ${tool.name === 'search_internet' ? '🌐' : '🛠️'}  Executando: ${tool.name}...`);
          const args = JSON.parse(toolCall.function.arguments);
          const result = await tool.execute(args);
          
          toolResults.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: String(result)
          });
        }
      }

      // Adiciona a chamada da tool e o resultado ao histórico
      const nextMessages = [...formattedMessages, message, ...toolResults];
      
      // Chamada recursiva para processar a resposta final da IA com o resultado da tool
      return this.sendMessage(nextMessages);
    }

    return message.content;
  }
}