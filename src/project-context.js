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

  return context;
}
