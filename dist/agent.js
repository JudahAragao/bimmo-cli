import { tavily } from "@tavily/core";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { getConfig } from "./config.js";
import * as diff from "diff";
import chalk from "chalk";
import inquirer from "inquirer";
const config = getConfig();
const tvly = config.tavilyKey ? tavily({ apiKey: config.tavilyKey }) : null;
const editState = {
  autoAccept: false
};
const tools = [
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
      console.log(chalk.blue(`
  \u{1F310}  Pesquisando na web: ${chalk.bold(query)}...`));
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
        console.log(chalk.blue(`
  \u{1F4D6}  Lendo arquivo: ${chalk.bold(filePath)}...`));
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
${chalk.cyan("\u{1F4DD} Altera\xE7\xF5es propostas em:")} ${chalk.bold(filePath)}`);
        console.log(chalk.gray("\u2500".repeat(50)));
        let hasChanges = false;
        differences.forEach((part) => {
          if (part.added || part.removed) hasChanges = true;
          const color = part.added ? chalk.green : part.removed ? chalk.red : chalk.gray;
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
        console.log(chalk.gray("\u2500".repeat(50)));
        if (!hasChanges) {
          return "Nenhuma mudan\xE7a detectada no arquivo.";
        }
        if (!editState.autoAccept) {
          const { approve } = await inquirer.prompt([{
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
        console.log(chalk.yellow(`
  \u26A1  Comando proposto: ${chalk.bold(command)}`));
        if (!editState.autoAccept) {
          const { approve } = await inquirer.prompt([{
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
async function handleToolCalls(toolCalls) {
  const results = [];
  for (const call of toolCalls) {
    const tool = tools.find((t) => t.name === call.name);
    if (tool) {
      const result = await tool.execute(call.args);
      results.push({
        callId: call.id,
        name: call.name,
        result
      });
    }
  }
  return results;
}
export {
  editState,
  handleToolCalls,
  tools
};
