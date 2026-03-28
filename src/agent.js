import { tavily } from '@tavily/core';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { getConfig } from './config.js';
import * as diff from 'diff';
import chalk from 'chalk';

const config = getConfig();
const tvly = config.tavilyKey ? tavily({ apiKey: config.tavilyKey }) : null;

export const editState = {
  autoAccept: false
};

export const tools = [
  {
    name: 'search_internet',
    description: 'Pesquisa informações atualizadas na internet sobre qualquer assunto.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'O termo de busca' }
      },
      required: ['query']
    },
    execute: async ({ query }, { onStatus }) => {
      if (!tvly) return 'Erro: Chave de API da Tavily não configurada.';
      onStatus?.({ type: 'search', message: `Pesquisando: ${query}` });
      const searchResponse = await tvly.search(query, {
        searchDepth: 'advanced',
        maxResults: 5
      });
      return JSON.stringify(searchResponse.results.map(r => ({
        title: r.title,
        url: r.url,
        content: r.content
      })));
    }
  },
  {
    name: 'read_file',
    description: 'Lê o conteúdo de um arquivo no sistema.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Caminho do arquivo' }
      },
      required: ['path']
    },
    execute: async ({ path: filePath }, { onStatus }) => {
      try {
        onStatus?.({ type: 'read', message: `Lendo: ${filePath}` });
        return fs.readFileSync(filePath, 'utf-8');
      } catch (err) {
        return `Erro ao ler arquivo: ${err.message}`;
      }
    }
  },
  {
    name: 'write_file',
    description: 'Cria ou sobrescreve um arquivo. SEMPRE mostre as mudanças antes de aplicar.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Caminho de destino' },
        content: { type: 'string', description: 'Conteúdo completo do arquivo' }
      },
      required: ['path', 'content']
    },
    execute: async ({ path: filePath, content }, { onStatus, onConfirm }) => {
      try {
        const absolutePath = path.resolve(filePath);
        onStatus?.({ type: 'write', message: `Analisando mudanças: ${filePath}` });
        
        const oldContent = fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf-8') : "";
        
        const differences = diff.diffLines(oldContent, content);
        let diffString = '';
        let hasChanges = false;
        let lineNoOld = 1;
        let lineNoNew = 1;

        // Cabeçalho do arquivo estilo Gemini/Claude
        diffString += `${chalk.bold.white('--- ' + filePath)}\n`;
        diffString += `${chalk.bold.white('+++ ' + filePath)}\n`;
        diffString += `${chalk.dim('────────────────────────────────────────────────────────────────────────────────')}\n`;

        differences.forEach((part) => {
          const prefix = part.added ? '+' : part.removed ? '-' : ' ';
          const lines = part.value.split('\n');
          if (lines[lines.length - 1] === '') lines.pop();

          if (part.added || part.removed) {
            hasChanges = true;
            lines.forEach(line => {
              const oldNum = prefix === '-' ? lineNoOld.toString().padStart(4) : '    ';
              const newNum = prefix === '+' ? lineNoNew.toString().padStart(4) : '    ';
              const color = prefix === '+' ? chalk.green : chalk.red;
              
              diffString += `${chalk.gray(oldNum)} ${chalk.gray(newNum)} ${color(prefix + ' ' + line)}\n`;
              
              if (prefix === '+') lineNoNew++; else lineNoOld++;
            });
          } else {
            // Contexto (linhas não alteradas)
            if (lines.length > 6) {
              // Mostra 3 no início
              for (let i = 0; i < 3; i++) {
                diffString += `${chalk.gray(lineNoOld.toString().padStart(4))} ${chalk.gray(lineNoNew.toString().padStart(4))}   ${lines[i]}\n`;
                lineNoOld++; lineNoNew++;
              }
              diffString += `${chalk.dim('.... ....   ' + (lines.length - 6) + ' linhas ocultas...')}\n`;
              lineNoOld += lines.length - 6;
              lineNoNew += lines.length - 6;
              // Mostra 3 no fim
              for (let i = lines.length - 3; i < lines.length; i++) {
                diffString += `${chalk.gray(lineNoOld.toString().padStart(4))} ${chalk.gray(lineNoNew.toString().padStart(4))}   ${lines[i]}\n`;
                lineNoOld++; lineNoNew++;
              }
            } else {
              lines.forEach(line => {
                diffString += `${chalk.gray(lineNoOld.toString().padStart(4))} ${chalk.gray(lineNoNew.toString().padStart(4))}   ${line}\n`;
                lineNoOld++; lineNoNew++;
              });
            }
          }
        });

        if (!hasChanges) return "Nenhuma mudança detectada.";

        onStatus?.({ 
          type: 'diff', 
          message: `MODIFICANDO: ${filePath}`, 
          diff: diffString 
        });

        if (!editState.autoAccept) {
          const approved = await onConfirm?.(`Deseja aplicar as mudanças em ${filePath}?`);
          if (!approved) return "Alteração rejeitada pelo usuário.";
        }

        onStatus?.({ type: 'write', message: `Escrevendo arquivo: ${filePath}` });
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
    name: 'run_command',
    description: 'Executa um comando shell no sistema.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Comando shell' }
      },
      required: ['command']
    },
    execute: async ({ command }, { onStatus, onConfirm }) => {
      try {
        onStatus?.({ type: 'command', message: `Executando: ${command}` });
        
        if (!editState.autoAccept) {
          const approved = await onConfirm?.(`Executar comando: ${command}?`);
          if (!approved) return "Comando rejeitado.";
        }

        const output = execSync(command, { encoding: 'utf-8', timeout: 60000 });
        onStatus?.({ type: 'command_output', message: 'Resultado do comando', output });
        return output || 'Comando executado com sucesso.';
      } catch (err) {
        return `Erro: ${err.stderr || err.message}`;
      }
    }
  }
];

export async function handleToolCalls(toolCalls) {
  const results = [];
  for (const call of toolCalls) {
    const tool = tools.find(t => t.name === call.name);
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
