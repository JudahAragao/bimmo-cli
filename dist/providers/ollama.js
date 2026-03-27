import ollama from "ollama";
import { BaseProvider } from "./base.js";
class OllamaProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.client = ollama;
  }
  formatMessages(messages) {
    return messages.map((msg) => {
      if (typeof msg.content === "string") return msg;
      const images = msg.content.filter((part) => part.type === "image").map((part) => part.data);
      const text = msg.content.filter((part) => part.type === "text").map((part) => part.text).join(" ");
      return {
        role: msg.role,
        content: text,
        images: images.length > 0 ? images : void 0
      };
    });
  }
  async sendMessage(messages, options = {}) {
    const formattedMessages = this.formatMessages(messages);
    const response = await this.client.chat({
      model: this.config.model,
      messages: formattedMessages,
      stream: false,
      options: {
        temperature: 0.7
      }
    }, { signal: options.signal });
    const text = response.message?.content;
    if (!text) {
      throw new Error("Resposta inv\xE1lida do Ollama");
    }
    return text;
  }
}
export {
  OllamaProvider
};
