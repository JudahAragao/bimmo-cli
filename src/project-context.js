import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

/**
 * Coleta o contexto completo do projeto para a IA.
 * Inclui estrutura de arquivos, arquivos de instrução e configurações do .bimmorc
 */
export function getProjectContext() {
  const cwd = process.cwd();
  let context = "=== CONTEXTO DO PROJETO ===\n";

  // 1. Tentar ler .bimmorc.json para regras customizadas
  const bimmoRcPath = path.join(cwd, '.bimmorc.json');
  if (fs.existsSync(bimmoRcPath)) {
    try {
      const rc = JSON.parse(fs.readFileSync(bimmoRcPath, 'utf-8'));
      context += `Regras de Projeto (.bimmorc):\n${JSON.stringify(rc, null, 2)}\n\n`;
    } catch (e) {}
  }

  // 2. Tentar ler arquivos de instruções comuns (Claude, Gemini, etc)
  const instructionFiles = ['CLAUDE.md', 'INSTRUCTIONS.md', '.bimmo-context.md', 'CONTRIBUTING.md'];
  for (const file of instructionFiles) {
    const p = path.join(cwd, file);
    if (fs.existsSync(p)) {
      context += `Instruções de ${file}:\n${fs.readFileSync(p, 'utf-8')}\n\n`;
    }
  }

  // 3. Adicionar estrutura de diretórios (Quantizada/Resumida)
  try {
    const tree = execSync('find . -maxdepth 2 -not -path "*/.*" -not -path "./node_modules*"', { encoding: 'utf-8' });
    context += `Estrutura de Arquivos (Resumo):\n${tree}\n`;
  } catch (e) {
    context += "Estrutura de arquivos indisponível.\n";
  }

  context += `\n=== INSTRUÇÕES DO SISTEMA ===
Você é o bimmo-cli, um assistente de desenvolvimento avançado.
Você possui ferramentas para interagir com o sistema e a internet:
1. read_file: Sempre use esta ferramenta para ler o conteúdo de um arquivo antes de editá-lo ou para entender o contexto do código.
2. write_file: Use para criar ou modificar arquivos. Mostre apenas as mudanças necessárias.
3. run_command: Use para executar comandos shell (npm test, build, lint, etc).
4. search_internet: Se o usuário pedir algo que você não sabe ou que requer dados atualizados, use esta ferramenta para pesquisar na web.

Sempre explique brevemente o que você vai fazer antes de chamar uma ferramenta.
Suas respostas devem ser em Markdown.\n`;

  return context;
}
