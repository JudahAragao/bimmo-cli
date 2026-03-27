import { GoogleGenerativeAI } from '@google/generative-ai';
import { BaseProvider } from './base.js';
import { tools } from '../agent.js';

export class GeminiProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.genAI = new GoogleGenerativeAI(this.config.apiKey);
  }

  formatContent(content) {
    if (typeof content === 'string') return [{ text: content }];
    return content.map(part => {
      if (part.type === 'text') return { text: part.text };
      if (part.type === 'image') return {
        inlineData: { mimeType: part.mimeType, data: part.data }
      };
      return part;
    });
  }

  async sendMessage(messages, options = {}) {
    const systemPrompt = messages.find(m => m.role === 'system')?.content;
    const history = messages
      .filter(m => m.role !== 'system')
      .slice(0, -1)
      .map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: this.formatContent(msg.content)
      }));

    const lastMessageContent = this.formatContent(messages[messages.length - 1].content);

    const geminiTools = tools.map(t => ({
      functionDeclarations: [{
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }]
    }));

    const model = this.genAI.getGenerativeModel({ 
      model: this.config.model,
      systemInstruction: systemPrompt,
      tools: geminiTools
    });

    const chat = model.startChat({
      history: history,
      generationConfig: { temperature: 0.7, maxOutputTokens: 8192 },
    });

    const result = await chat.sendMessage(lastMessageContent);
    const response = await result.response;
    
    const call = response.candidates[0].content.parts.find(p => p.functionCall);
    if (call) {
      if (options.signal?.aborted) throw new Error('Abortado pelo usuário');
      
      const tool = tools.find(t => t.name === call.functionCall.name);
      if (tool) {
        const toolResult = await tool.execute(call.functionCall.args);
        
        const resultResponse = await chat.sendMessage([{
          functionResponse: {
            name: call.functionCall.name,
            response: { content: toolResult }
          }
        }]);
        return resultResponse.response.text();
      }
    }

    return response.text();
  }
}
