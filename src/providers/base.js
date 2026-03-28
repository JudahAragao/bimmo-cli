export class BaseProvider {
  constructor(config) {
    this.config = config;
  }

  async sendMessage(messages, options = { onStatus: null, onConfirm: null }) {
    throw new Error('Método sendMessage deve ser implementado');
  }
}
