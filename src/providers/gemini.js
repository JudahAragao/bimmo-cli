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
    });
  }

  async sendMessage(messages) {
    const systemPrompt = messages.find(m => m.role === 'system')?.content;
    const history = messages
      .filter(m => m.role !== 'system')
      .slice(0, -1)
      .map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: this.formatContent(msg.content)
      }));

    const lastMessageContent = this.formatContent(messages[messages.length - 1].content);

    // Converte tools do agent.js para o formato do Gemini
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
    
    // Processamento de Tool Calls no Gemini
    const call = response.candidates[0].content.parts.find(p => p.functionCall);
    if (call) {
      const tool = tools.find(t => t.name === call.functionCall.name);
      if (tool) {
        console.log(`\n  ${tool.name === 'search_internet' ? '🌐' : '🛠️'}  Executando: ${tool.name}...`);
        const result = await tool.execute(call.functionCall.args);
        
        // No Gemini, enviamos o resultado de volta para o chat
        const resultResponse = await chat.sendMessage([{
          functionResponse: {
            name: call.functionCall.name,
            response: { content: result }
          }
        }]);
        return resultResponse.response.text();
      }
    }

    return response.text();
  }
}