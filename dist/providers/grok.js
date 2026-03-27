import OpenAI from "openai";
import { BaseProvider } from "./base.js";
import { tools } from "../agent.js";
class GrokProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.client = new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseURL || "https://api.x.ai/v1"
    });
  }
  formatMessages(messages) {
    return messages.map((msg) => {
      if (typeof msg.content === "string" || msg.content === null) {
        return msg;
      }
      if (Array.isArray(msg.content)) {
        const content = msg.content.map((part) => {
          if (part.type === "text") return { type: "text", text: part.text };
          if (part.type === "image") return {
            type: "image_url",
            image_url: { url: `data:${part.mimeType};base64,${part.data}` }
          };
          return part;
        });
        return { ...msg, content };
      }
      return msg;
    });
  }
  async sendMessage(messages, options = {}) {
    const formattedMessages = this.formatMessages(messages);
    const response = await this.client.chat.completions.create({
      model: this.config.model,
      messages: formattedMessages,
      temperature: 0.7
    }, { signal: options.signal });
    return response.choices[0].message.content;
  }
}
export {
  GrokProvider
};
