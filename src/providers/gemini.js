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
    
    const toolCalls = response.candidates[0].content.parts.filter(p => p.functionCall);
    if (toolCalls.length > 0) {
      if (options.signal?.aborted) throw new Error('Abortado pelo usuário');
      
      const functionResponses = [];
      for (const call of toolCalls) {
        const tool = tools.find(t => t.name === call.functionCall.name);
        if (tool) {
          const toolResult = await tool.execute(call.functionCall.args, options);
          functionResponses.push({
            functionResponse: {
              name: call.functionCall.name,
              response: { content: toolResult }
            }
          });
        }
      }

      const resultResponse = await chat.sendMessage(functionResponses);
      const nextResponse = await resultResponse.response;
      
      // Se o próximo turno também tiver chamadas de função, precisamos de recursão.
      // No entanto, a API do Gemini lida com o histórico dentro do chat.
      // Vamos verificar se há mais chamadas.
      const moreToolCalls = nextResponse.candidates[0].content.parts.filter(p => p.functionCall);
      if (moreToolCalls.length > 0) {
        // Para manter a simplicidade e recursão similar ao OpenAI:
        // Mas o sendMessage do Gemini retorna a resposta final.
        // Vamos tentar processar recursivamente se necessário.
        // A forma mais robusta é um loop.
        let currentResponse = nextResponse;
        while (currentResponse.candidates[0].content.parts.some(p => p.functionCall)) {
             const nextCalls = currentResponse.candidates[0].content.parts.filter(p => p.functionCall);
             const nextResponses = [];
             for (const call of nextCalls) {
                const t = tools.find(tool => tool.name === call.functionCall.name);
                if (t) {
                   const r = await t.execute(call.functionCall.args, options);
                   nextResponses.push({ functionResponse: { name: call.functionCall.name, response: { content: r } } });
                }
             }
             const rRes = await chat.sendMessage(nextResponses);
             currentResponse = await rRes.response;
        }
        return currentResponse.text();
      }
      
      return nextResponse.text();
    }

    return response.text();
  }
}
