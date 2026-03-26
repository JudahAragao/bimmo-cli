import { tavily } from '@tavily/core';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { getConfig } from './config.js';

const config = getConfig();
const tvly = config.tavilyKey ? tavily({ apiKey: config.tavilyKey }) : null;

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
    execute: async ({ query }) => {
      if (!tvly) return 'Erro: Chave de API da Tavily não configurada. Use /config para configurar.';
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
    execute: async ({ path: filePath }) => {
      try {
        return fs.readFileSync(filePath, 'utf-8');
      } catch (err) {
        return `Erro ao ler arquivo: ${err.message}`;
      }
    }
  },
  {
    name: 'write_file',
    description: 'Cria ou sobrescreve um arquivo com um conteúdo específico.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Camin de destino' },
        content: { type: 'string', description: 'Conteúdo do arquivo' }
      },
      required: ['path', 'content']
    },
    execute: async ({ path: filePath, content }) => {
      try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, content);
        return `Arquivo ${filePath} criado com sucesso.`;
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
        command: { type: 'string', description: 'Comando shell a ser executado' }
      },
      required: ['command']
    },
    execute: async ({ command }) => {
      try {
        const output = execSync(command, { encoding: 'utf-8', timeout: 30000 });
        return output || 'Comando executado sem retorno visual.';
      } catch (err) {
        return `Erro ao executar comando: ${err.stderr || err.message}`;
      }
    }
  }
];

export async function handleToolCalls(toolCalls) {
  const results = [];
  for (const call of toolCalls) {
    const tool = tools.find(t => t.name === call.name);
    if (tool) {
      console.log(`\n  ${tool.name === 'search_internet' ? '🌐' : '🛠️'}  Executando: ${tool.name}...`);
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
