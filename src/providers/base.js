export class BaseProvider {
  constructor(config) {
    this.config = config;
  }

  async sendMessage(messages, options = {}) {
    throw new Error('Método sendMessage deve ser implementado');
  }
}
