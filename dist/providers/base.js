class BaseProvider {
  constructor(config) {
    this.config = config;
  }
  async sendMessage(messages, options = {}) {
    throw new Error("M\xE9todo sendMessage deve ser implementado");
  }
}
export {
  BaseProvider
};
