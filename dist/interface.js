// src/interface.jsx
import React, { useState, useEffect, useMemo, useRef } from "react";
import { render, Box, Text, useInput, useApp } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import chalk4 from "chalk";
import figlet from "figlet";
import { marked } from "marked";
import TerminalRenderer from "marked-terminal";
import fs3 from "fs";
import path3 from "path";
import { fileURLToPath } from "url";

// src/config.js
import Conf from "conf";
import inquirer from "inquirer";
import chalk from "chalk";
var config = new Conf({ projectName: "bimmo-cli" });
function getConfig() {
  return config.store;
}
function updateActiveModel(newModel) {
  config.set("model", newModel);
  const active = config.get("activeProfile");
  if (active) {
    const profiles = config.get("profiles");
    profiles[active].model = newModel;
    config.set("profiles", profiles);
  }
}
function switchProfile(name) {
  const profiles = config.get("profiles") || {};
  if (profiles[name]) {
    const p = profiles[name];
    config.set("provider", p.provider);
    config.set("apiKey", p.apiKey);
    config.set("model", p.model);
    config.set("baseURL", p.baseURL);
    config.set("activeProfile", name);
    return true;
  }
  return false;
}

// src/providers/openai.js
import OpenAI from "openai";

// src/providers/base.js
var BaseProvider = class {
  constructor(config3) {
    this.config = config3;
  }
  async sendMessage(messages, options = {}) {
    throw new Error("M\xE9todo sendMessage deve ser implementado");
  }
};

// src/agent.js
import { tavily } from "@tavily/core";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import * as diff from "diff";
import chalk2 from "chalk";
import inquirer2 from "inquirer";
var config2 = getConfig();
var tvly = config2.tavilyKey ? tavily({ apiKey: config2.tavilyKey }) : null;
var editState = {
  autoAccept: false
};
var tools = [
  {
    name: "search_internet",
    description: "Pesquisa informa\xE7\xF5es atualizadas na internet sobre qualquer assunto.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "O termo de busca" }
      },
      required: ["query"]
    },
    execute: async ({ query }) => {
      if (!tvly) return "Erro: Chave de API da Tavily n\xE3o configurada. Use /config para configurar.";
      console.log(chalk2.blue(`
  \u{1F310}  Pesquisando na web: ${chalk2.bold(query)}...`));
      const searchResponse = await tvly.search(query, {
        searchDepth: "advanced",
        maxResults: 5
      });
      return JSON.stringify(searchResponse.results.map((r) => ({
        title: r.title,
        url: r.url,
        content: r.content
      })));
    }
  },
  {
    name: "read_file",
    description: "L\xEA o conte\xFAdo de um arquivo no sistema.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Caminho do arquivo" }
      },
      required: ["path"]
    },
    execute: async ({ path: filePath }) => {
      try {
        console.log(chalk2.blue(`
  \u{1F4D6}  Lendo arquivo: ${chalk2.bold(filePath)}...`));
        return fs.readFileSync(filePath, "utf-8");
      } catch (err) {
        return `Erro ao ler arquivo: ${err.message}`;
      }
    }
  },
  {
    name: "write_file",
    description: "Cria ou sobrescreve um arquivo com um conte\xFAdo espec\xEDfico.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Caminho de destino" },
        content: { type: "string", description: "Conte\xFAdo do arquivo" }
      },
      required: ["path", "content"]
    },
    execute: async ({ path: filePath, content }) => {
      try {
        const absolutePath = path.resolve(filePath);
        const oldContent = fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, "utf-8") : "";
        const differences = diff.diffLines(oldContent, content);
        console.log(`
${chalk2.cyan("\u{1F4DD} Altera\xE7\xF5es propostas em:")} ${chalk2.bold(filePath)}`);
        console.log(chalk2.gray("\u2500".repeat(50)));
        let hasChanges = false;
        differences.forEach((part) => {
          if (part.added || part.removed) hasChanges = true;
          const color = part.added ? chalk2.green : part.removed ? chalk2.red : chalk2.gray;
          const prefix = part.added ? "+" : part.removed ? "-" : " ";
          if (part.added || part.removed) {
            const lines = part.value.split("\n");
            lines.forEach((line) => {
              if (line || part.value.endsWith("\n")) {
                process.stdout.write(color(`${prefix} ${line}
`));
              }
            });
          } else {
            const lines = part.value.split("\n").filter((l) => l.trim() !== "");
            if (lines.length > 4) {
              process.stdout.write(color(`  ${lines[0]}
  ...
  ${lines[lines.length - 1]}
`));
            } else if (lines.length > 0) {
              lines.forEach((line) => process.stdout.write(color(`  ${line}
`)));
            }
          }
        });
        console.log(chalk2.gray("\u2500".repeat(50)));
        if (!hasChanges) {
          return "Nenhuma mudan\xE7a detectada no arquivo.";
        }
        if (!editState.autoAccept) {
          const { approve } = await inquirer2.prompt([{
            type: "list",
            name: "approve",
            message: "Deseja aplicar estas altera\xE7\xF5es?",
            choices: [
              { name: "\u2705 Sim", value: "yes" },
              { name: "\u274C N\xE3o", value: "no" },
              { name: "\u26A1 Sim para tudo (Auto-Accept)", value: "all" }
            ]
          }]);
          if (approve === "no") return "Altera\xE7\xE3o rejeitada pelo usu\xE1rio.";
          if (approve === "all") editState.autoAccept = true;
        }
        const dir = path.dirname(absolutePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(absolutePath, content);
        return `Arquivo ${filePath} atualizado com sucesso.`;
      } catch (err) {
        return `Erro ao escrever arquivo: ${err.message}`;
      }
    }
  },
  {
    name: "run_command",
    description: "Executa um comando shell no sistema.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Comando shell a ser executado" }
      },
      required: ["command"]
    },
    execute: async ({ command }) => {
      try {
        console.log(chalk2.yellow(`
  \u26A1  Comando proposto: ${chalk2.bold(command)}`));
        if (!editState.autoAccept) {
          const { approve } = await inquirer2.prompt([{
            type: "list",
            name: "approve",
            message: "Executar este comando?",
            choices: [
              { name: "\u2705 Sim", value: "yes" },
              { name: "\u274C N\xE3o", value: "no" },
              { name: "\u26A1 Sim para tudo (Auto-Accept)", value: "all" }
            ]
          }]);
          if (approve === "no") return "Comando rejeitado pelo usu\xE1rio.";
          if (approve === "all") editState.autoAccept = true;
        }
        const output = execSync(command, { encoding: "utf-8", timeout: 6e4 });
        return output || "Comando executado com sucesso (sem retorno).";
      } catch (err) {
        return `Erro ao executar comando: ${err.stderr || err.message}`;
      }
    }
  }
];

// src/providers/openai.js
var OpenAIProvider = class extends BaseProvider {
  constructor(config3) {
    super(config3);
    const extraHeaders = {};
    if (this.config.baseURL?.includes("openrouter.ai")) {
      extraHeaders["HTTP-Referer"] = "https://github.com/JudahAragao/bimmo-cli";
      extraHeaders["X-Title"] = "bimmo-cli";
    }
    this.client = new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseURL,
      defaultHeaders: extraHeaders
    });
  }
  formatMessages(messages) {
    return messages.map((msg) => {
      if (typeof msg.content === "string" || msg.content === null) return msg;
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
    const openAiTools = tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }
    }));
    const requestOptions = {
      model: this.config.model,
      messages: formattedMessages,
      temperature: 0.7
    };
    if (openAiTools.length > 0) {
      requestOptions.tools = openAiTools;
      requestOptions.tool_choice = "auto";
    }
    const response = await this.client.chat.completions.create(requestOptions, { signal: options.signal });
    const message = response.choices[0].message;
    if (message.tool_calls) {
      const toolResults = [];
      for (const toolCall of message.tool_calls) {
        if (options.signal?.aborted) throw new Error("Abortado pelo usu\xE1rio");
        const tool = tools.find((t) => t.name === toolCall.function.name);
        if (tool) {
          const args = JSON.parse(toolCall.function.arguments);
          const result = await tool.execute(args);
          toolResults.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: String(result)
          });
        }
      }
      const nextMessages = [...formattedMessages, message, ...toolResults];
      return this.sendMessage(nextMessages, options);
    }
    return message.content;
  }
};

// src/providers/anthropic.js
import Anthropic from "@anthropic-ai/sdk";
var AnthropicProvider = class extends BaseProvider {
  constructor(config3) {
    super(config3);
    this.client = new Anthropic({
      apiKey: this.config.apiKey
    });
  }
  formatContent(content) {
    if (typeof content === "string") return content;
    return content.map((part) => {
      if (part.type === "text") return { type: "text", text: part.text };
      if (part.type === "image") return {
        type: "image",
        source: { type: "base64", media_type: part.mimeType, data: part.data }
      };
      return part;
    });
  }
  async sendMessage(messages, options = {}) {
    const systemMessage = messages.find((m) => m.role === "system");
    const userMessages = messages.filter((m) => m.role !== "system").map((m) => ({
      role: m.role,
      content: this.formatContent(m.content)
    }));
    const anthropicTools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters
    }));
    const response = await this.client.messages.create({
      model: this.config.model,
      max_tokens: 4096,
      system: systemMessage ? systemMessage.content : void 0,
      messages: userMessages,
      tools: anthropicTools,
      temperature: 0.7
    }, { signal: options.signal });
    if (response.stop_reason === "tool_use") {
      const toolUse = response.content.find((p) => p.type === "tool_use");
      const tool = tools.find((t) => t.name === toolUse.name);
      if (tool) {
        if (options.signal?.aborted) throw new Error("Abortado pelo usu\xE1rio");
        const result = await tool.execute(toolUse.input);
        const nextMessages = [
          ...messages,
          { role: "assistant", content: response.content },
          {
            role: "user",
            content: [{
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: String(result)
            }]
          }
        ];
        return this.sendMessage(nextMessages, options);
      }
    }
    return response.content[0].text;
  }
};

// src/providers/grok.js
import OpenAI2 from "openai";
var GrokProvider = class extends BaseProvider {
  constructor(config3) {
    super(config3);
    this.client = new OpenAI2({
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
};

// src/providers/gemini.js
import { GoogleGenerativeAI } from "@google/generative-ai";
var GeminiProvider = class extends BaseProvider {
  constructor(config3) {
    super(config3);
    this.genAI = new GoogleGenerativeAI(this.config.apiKey);
  }
  formatContent(content) {
    if (typeof content === "string") return [{ text: content }];
    return content.map((part) => {
      if (part.type === "text") return { text: part.text };
      if (part.type === "image") return {
        inlineData: { mimeType: part.mimeType, data: part.data }
      };
      return part;
    });
  }
  async sendMessage(messages, options = {}) {
    const systemPrompt = messages.find((m) => m.role === "system")?.content;
    const history = messages.filter((m) => m.role !== "system").slice(0, -1).map((msg) => ({
      role: msg.role === "user" ? "user" : "model",
      parts: this.formatContent(msg.content)
    }));
    const lastMessageContent = this.formatContent(messages[messages.length - 1].content);
    const geminiTools = tools.map((t) => ({
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
      history,
      generationConfig: { temperature: 0.7, maxOutputTokens: 8192 }
    });
    const result = await chat.sendMessage(lastMessageContent);
    const response = await result.response;
    const call = response.candidates[0].content.parts.find((p) => p.functionCall);
    if (call) {
      if (options.signal?.aborted) throw new Error("Abortado pelo usu\xE1rio");
      const tool = tools.find((t) => t.name === call.functionCall.name);
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
};

// src/providers/ollama.js
import ollama from "ollama";
var OllamaProvider = class extends BaseProvider {
  constructor(config3) {
    super(config3);
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
};

// src/providers/factory.js
function createProvider(config3) {
  switch (config3.provider) {
    case "openai":
      return new OpenAIProvider(config3);
    case "anthropic":
      return new AnthropicProvider(config3);
    case "grok":
      return new GrokProvider(config3);
    case "gemini":
      return new GeminiProvider(config3);
    case "ollama":
      return new OllamaProvider(config3);
    case "openrouter":
      return new OpenAIProvider(config3);
    case "deepseek":
      return new OpenAIProvider(config3);
    case "zai":
      return new OpenAIProvider(config3);
    default:
      throw new Error(`Provider ${config3.provider} n\xE3o suportado ainda.`);
  }
}

// src/project-context.js
import fs2 from "fs";
import path2 from "path";
import { execSync as execSync2 } from "child_process";
function getProjectContext() {
  const cwd = process.cwd();
  let context = "=== CONTEXTO DO PROJETO ===\n";
  const bimmoRcPath = path2.join(cwd, ".bimmorc.json");
  if (fs2.existsSync(bimmoRcPath)) {
    try {
      const rc = JSON.parse(fs2.readFileSync(bimmoRcPath, "utf-8"));
      context += `Regras de Projeto (.bimmorc):
${JSON.stringify(rc, null, 2)}

`;
    } catch (e) {
    }
  }
  const instructionFiles = ["CLAUDE.md", "INSTRUCTIONS.md", ".bimmo-context.md", "CONTRIBUTING.md"];
  for (const file of instructionFiles) {
    const p = path2.join(cwd, file);
    if (fs2.existsSync(p)) {
      context += `Instru\xE7\xF5es de ${file}:
${fs2.readFileSync(p, "utf-8")}

`;
    }
  }
  try {
    const tree = execSync2('find . -maxdepth 2 -not -path "*/.*" -not -path "./node_modules*"', { encoding: "utf-8" });
    context += `Estrutura de Arquivos (Resumo):
${tree}
`;
  } catch (e) {
    context += "Estrutura de arquivos indispon\xEDvel.\n";
  }
  return context;
}

// src/orchestrator.js
import chalk3 from "chalk";
import ora from "ora";
var SwarmOrchestrator = class {
  constructor(config3) {
    this.config = config3;
    this.agents = config3.agents || {};
    this.profiles = config3.profiles || {};
  }
  /**
   * Executa uma tarefa sequencialmente através de uma lista de agentes.
   * O output de um agente vira o contexto do próximo.
   */
  async runSequential(agentNames, goal, options = {}) {
    let currentContext = goal;
    const results = [];
    console.log(chalk3.cyan(`
\u{1F680} Iniciando Enxame Sequencial: ${agentNames.join(" \u2192 ")}
`));
    for (const name of agentNames) {
      const agent = this.agents[name];
      if (!agent) throw new Error(`Agente ${name} n\xE3o encontrado.`);
      const profile = this.profiles[agent.profile];
      if (!profile) throw new Error(`Perfil ${agent.profile} do agente ${name} n\xE3o encontrado.`);
      const agentConfig = {
        ...profile,
        model: agent.modelOverride || profile.model
      };
      const provider = createProvider(agentConfig);
      const spinner = ora({
        text: chalk3.magenta(`Agente [${name}] trabalhando...`),
        color: agent.mode === "edit" ? "red" : "magenta"
      }).start();
      const messages = [
        { role: "system", content: `Voc\xEA \xE9 o agente ${name}. Sua tarefa espec\xEDfica \xE9: ${agent.role}

MODO ATUAL: ${agent.mode.toUpperCase()}
${getProjectContext()}` },
        { role: "user", content: `CONTEXTO ATUAL:
${currentContext}

OBJETIVO DO ENXAME:
${goal}

Por favor, execute sua parte e retorne o resultado final processado.` }
      ];
      try {
        const response = await provider.sendMessage(messages, { signal: options.signal });
        spinner.succeed(chalk3.green(`Agente [${name}] conclu\xEDdo.`));
        currentContext = response;
        results.push({ agent: name, output: response });
      } catch (err) {
        spinner.fail(chalk3.red(`Agente [${name}] falhou: ${err.message}`));
        throw err;
      }
    }
    return currentContext;
  }
  /**
   * Executa uma tarefa hierárquica.
   * Um Manager recebe o objetivo, define o que cada Worker deve fazer, e consolida.
   */
  async runHierarchical(managerName, workerNames, goal, options = {}) {
    console.log(chalk3.cyan(`
\u{1F451} Iniciando Enxame Hier\xE1rquico (L\xEDder: ${managerName})
`));
    const managerOutput = await this.runSequential([managerName], `Analise o objetivo abaixo e descreva o que cada um dos seguintes agentes deve fazer: ${workerNames.join(", ")}.

OBJETIVO: ${goal}`);
    console.log(chalk3.blue(`
\u{1F477} Workers entrando em a\xE7\xE3o...
`));
    const workerPromises = workerNames.map(
      (name) => this.runSequential([name], `Baseado no plano do Manager:
${managerOutput}

Execute sua tarefa para o objetivo: ${goal}`, options)
    );
    const workerResults = await Promise.all(workerPromises);
    const finalResult = await this.runSequential([managerName], `Aqui est\xE3o os resultados dos workers:
${workerResults.join("\n---\n")}

Por favor, consolide tudo em um resultado final perfeito para o objetivo: ${goal}`, options);
    return finalResult;
  }
};

// src/interface.jsx
var green = "#00ff9d";
var lavender = "#c084fc";
var gray = "#6272a4";
var yellow = "#f1fa8c";
var red = "#ff5555";
var cyan = "#8be9fd";
marked.use(new TerminalRenderer({
  heading: chalk4.hex(lavender).bold,
  code: chalk4.hex(green),
  strong: chalk4.bold,
  em: chalk4.italic,
  html: () => ""
}));
var __filename = fileURLToPath(import.meta.url);
var __dirname = path3.dirname(__filename);
var pkg = JSON.parse(fs3.readFileSync(path3.join(__dirname, "../package.json"), "utf-8"));
var version = pkg.version;
var Header = ({ config: config3 }) => /* @__PURE__ */ React.createElement(Box, { flexDirection: "column", marginBottom: 1 }, /* @__PURE__ */ React.createElement(Text, { color: lavender }, figlet.textSync("bimmo")), /* @__PURE__ */ React.createElement(Box, { borderStyle: "single", borderColor: lavender, paddingX: 1, justifyContent: "space-between" }, /* @__PURE__ */ React.createElement(Text, { color: green, bold: true }, "v", version), /* @__PURE__ */ React.createElement(Box, null, /* @__PURE__ */ React.createElement(Text, { color: gray }, config3.activeProfile || "Default", " "), /* @__PURE__ */ React.createElement(Text, { color: lavender }, "\u2022"), /* @__PURE__ */ React.createElement(Text, { color: gray }, " ", config3.model))));
var MessageList = ({ messages }) => /* @__PURE__ */ React.createElement(Box, { flexDirection: "column", flexGrow: 1 }, messages.filter((m) => m.role !== "system").slice(-10).map((m, i) => /* @__PURE__ */ React.createElement(Box, { key: i, flexDirection: "column", marginBottom: 1 }, /* @__PURE__ */ React.createElement(Box, null, /* @__PURE__ */ React.createElement(Text, { bold: true, color: m.role === "user" ? green : lavender }, m.role === "user" ? "\u203A Voc\xEA" : "\u203A bimmo"), m.role === "system" && /* @__PURE__ */ React.createElement(Text, { color: yellow }, " [SISTEMA]")), /* @__PURE__ */ React.createElement(Box, { paddingLeft: 2 }, /* @__PURE__ */ React.createElement(Text, null, m.role === "assistant" ? marked.parse(m.content).trim() : m.displayContent || m.content)))));
var Autocomplete = ({ suggestions }) => /* @__PURE__ */ React.createElement(Box, { flexDirection: "column", borderStyle: "round", borderColor: gray, paddingX: 1, marginBottom: 1 }, /* @__PURE__ */ React.createElement(Text, { color: gray, dimColor: true, italic: true }, "Sugest\xF5es (TAB para completar):"), suggestions.map((f, i) => /* @__PURE__ */ React.createElement(Text, { key: i, color: i === 0 ? green : gray }, f.isDir ? "\u{1F4C1}" : "\u{1F4C4}", " ", f.rel, f.isDir ? "/" : "")));
var Footer = ({ exitCounter }) => /* @__PURE__ */ React.createElement(Box, { marginTop: 1, justifyContent: "space-between", paddingX: 1 }, /* @__PURE__ */ React.createElement(Text, { color: gray, dimColor: true }, "\u{1F4C1} ", path3.relative(process.env.HOME || "", process.cwd())), exitCounter === 1 && /* @__PURE__ */ React.createElement(Text, { color: yellow, bold: true }, " Pressione Ctrl+C novamente para sair"), /* @__PURE__ */ React.createElement(Box, null, /* @__PURE__ */ React.createElement(Text, { color: gray, dimColor: true, italic: true }, "\u2191\u2193 para hist\xF3rico \u2022 /help para comandos")));
var BimmoApp = ({ initialConfig }) => {
  const { exit } = useApp();
  const [config3, setConfig] = useState(initialConfig);
  const [mode, setMode] = useState("chat");
  const [activePersona, setActivePersona] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [thinkingMessage, setThinkingMessage] = useState("bimmo pensando...");
  const [exitCounter, setExitCounter] = useState(0);
  const [provider, setProvider] = useState(() => createProvider(initialConfig));
  useEffect(() => {
    const ctx = getProjectContext();
    setMessages([
      { role: "system", content: ctx },
      { role: "assistant", content: `Ol\xE1! Sou o **bimmo v${version}**. Como posso ajudar hoje?

Digite \`/help\` para ver os comandos.` }
    ]);
  }, []);
  const filePreview = useMemo(() => {
    if (!input.includes("@")) return [];
    const words = input.split(" ");
    const lastWord = words[words.length - 1];
    if (!lastWord.startsWith("@")) return [];
    try {
      const p = lastWord.slice(1);
      const dir = p.includes("/") ? p.substring(0, p.lastIndexOf("/")) : ".";
      const filter = p.includes("/") ? p.substring(p.lastIndexOf("/") + 1) : p;
      const absDir = path3.resolve(process.cwd(), dir);
      if (!fs3.existsSync(absDir)) return [];
      return fs3.readdirSync(absDir).filter((f) => f.startsWith(filter) && !f.startsWith(".") && f !== "node_modules").slice(0, 5).map((f) => ({
        name: f,
        isDir: fs3.statSync(path3.join(absDir, f)).isDirectory(),
        rel: path3.join(dir === "." ? "" : dir, f)
      }));
    } catch (e) {
      return [];
    }
  }, [input]);
  const handleSubmit = async (val) => {
    const rawInput = val.trim();
    if (!rawInput) return;
    setInput("");
    const parts = rawInput.split(" ");
    const cmd = parts[0].toLowerCase();
    if (cmd === "/exit") exit();
    if (cmd === "/clear") {
      setMessages([{ role: "system", content: getProjectContext() }, { role: "assistant", content: "Chat limpo." }]);
      return;
    }
    if (["/chat", "/plan", "/edit"].includes(cmd)) {
      setMode(cmd.slice(1));
      if (cmd === "/edit") editState.autoAccept = parts[1] === "auto";
      return;
    }
    if (cmd === "/model") {
      const newModel = parts[1];
      if (newModel) {
        updateActiveModel(newModel);
        const newCfg = getConfig();
        setConfig(newCfg);
        setProvider(createProvider(newCfg));
        setMessages((prev) => [...prev, { role: "system", content: `Modelo alterado para: ${newModel}` }]);
      }
      return;
    }
    if (cmd === "/switch") {
      const profile = parts[1];
      if (switchProfile(profile)) {
        const newCfg = getConfig();
        setConfig(newCfg);
        setProvider(createProvider(newCfg));
        setMessages((prev) => [...prev, { role: "system", content: `Perfil alterado para: ${profile}` }]);
      }
      return;
    }
    if (cmd === "/use") {
      const agentName = parts[1];
      const agents = config3.agents || {};
      if (agentName === "normal") {
        setActivePersona(null);
      } else if (agents[agentName]) {
        setActivePersona(agentName);
        setMode(agents[agentName].mode || "chat");
      }
      return;
    }
    if (cmd === "/swarm") {
      const orchestrator = new SwarmOrchestrator(config3);
      setIsThinking(true);
      setThinkingMessage("Enxame em a\xE7\xE3o...");
      try {
        let response;
        if (parts[1] === "seq") response = await orchestrator.runSequential(parts[2].split(","), parts.slice(3).join(" "));
        if (parts[1] === "run") response = await orchestrator.runHierarchical(parts[2], parts[3].split(","), parts.slice(4).join(" "));
        setMessages((prev) => [...prev, { role: "user", content: rawInput }, { role: "assistant", content: response }]);
      } catch (err) {
        setMessages((prev) => [...prev, { role: "system", content: `Erro no enxame: ${err.message}` }]);
      } finally {
        setIsThinking(false);
      }
      return;
    }
    if (cmd === "/help") {
      setMessages((prev) => [...prev, { role: "assistant", content: `**Comandos:** /chat, /plan, /edit, /switch, /model, /use, /swarm, /clear, /exit, @arquivo` }]);
      return;
    }
    setIsThinking(true);
    let processedInput = rawInput;
    const fileMatches = rawInput.match(/@[\w\.\-\/]+/g);
    if (fileMatches) {
      for (const match of fileMatches) {
        const filePath = match.slice(1);
        try {
          if (fs3.existsSync(filePath)) {
            const content = fs3.readFileSync(filePath, "utf-8");
            processedInput = processedInput.replace(match, `

[Arquivo: ${filePath}]
\`\`\`
${content}
\`\`\`
`);
          }
        } catch (e) {
        }
      }
    }
    const userMsg = { role: "user", content: processedInput, displayContent: rawInput };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    try {
      let finalMessages = newMessages;
      if (activePersona && config3.agents[activePersona]) {
        const agent = config3.agents[activePersona];
        finalMessages = [{ role: "system", content: `Sua tarefa: ${agent.role}

${getProjectContext()}` }, ...newMessages.filter((m) => m.role !== "system")];
      }
      const response = await provider.sendMessage(finalMessages);
      setMessages((prev) => [...prev, { role: "assistant", content: response }]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: "system", content: `Erro: ${err.message}` }]);
    } finally {
      setIsThinking(false);
    }
  };
  useInput((input2, key) => {
    if (key.ctrl && input2 === "c") {
      if (isThinking) setIsThinking(false);
      else {
        if (exitCounter === 0) {
          setExitCounter(1);
          setTimeout(() => setExitCounter(0), 2e3);
        } else exit();
      }
    }
    if (key.tab && filePreview.length > 0) {
      const words = input2.split(" ");
      words[words.length - 1] = `@${filePreview[0].rel}${filePreview[0].isDir ? "/" : ""}`;
      setInput(words.join(" "));
    }
  });
  return /* @__PURE__ */ React.createElement(Box, { flexDirection: "column", paddingX: 1, minHeight: 10 }, /* @__PURE__ */ React.createElement(Header, { config: config3 }), /* @__PURE__ */ React.createElement(MessageList, { messages }), isThinking && /* @__PURE__ */ React.createElement(Box, { marginBottom: 1 }, /* @__PURE__ */ React.createElement(Text, { color: lavender }, /* @__PURE__ */ React.createElement(Spinner, { type: "dots" }), " ", /* @__PURE__ */ React.createElement(Text, { italic: true }, thinkingMessage))), filePreview.length > 0 && /* @__PURE__ */ React.createElement(Autocomplete, { suggestions: filePreview }), /* @__PURE__ */ React.createElement(Box, { borderStyle: "round", borderColor: isThinking ? gray : lavender, paddingX: 1 }, /* @__PURE__ */ React.createElement(Text, { bold: true, color: mode === "edit" ? red : mode === "plan" ? cyan : lavender }, activePersona ? `[${activePersona.toUpperCase()}] ` : "", "[", mode.toUpperCase(), "] \u203A", " "), /* @__PURE__ */ React.createElement(TextInput, { value: input, onChange: setInput, onSubmit: handleSubmit, placeholder: "Como posso ajudar hoje?" })), /* @__PURE__ */ React.createElement(Footer, { exitCounter }));
};
async function startInteractive() {
  const config3 = getConfig();
  if (!config3.provider || !config3.apiKey) {
    console.log(chalk4.yellow('Provedor n\xE3o configurado. Execute "bimmo config" primeiro.'));
    process.exit(0);
  }
  process.stdout.write("\x1Bc");
  render(/* @__PURE__ */ React.createElement(BimmoApp, { initialConfig: config3 }));
}
export {
  startInteractive
};
