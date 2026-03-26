import chalk from 'chalk';
import figlet from 'figlet';
import inquirer from 'inquirer';
import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';
import ora from 'ora';
import fs from 'fs';
import path from 'path';
import mime from 'mime-types';
import readline from 'readline';
import { fileURLToPath } from 'url';

import { getConfig, configure, updateActiveModel, switchProfile } from './config.js';
import { createProvider } from './providers/factory.js';
import { getProjectContext } from './project-context.js';
import { SwarmOrchestrator } from './orchestrator.js';
import { editState } from './agent.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf-8'));
const version = pkg.version;

// Configuração do renderizador - Forçamos o escape de HTML para garantir que tags não apareçam
marked.use(new TerminalRenderer({
  heading: chalk.hex('#c084fc').bold,
  code: chalk.hex('#00ff9d'),
}));

marked.setOptions({
  sanitize: true, // Depreciado mas ajuda em versões antigas
  headerIds: false,
  mangle: false
});

const green = chalk.hex('#00ff9d');
const lavender = chalk.hex('#c084fc');
const gray = chalk.gray;
const bold = chalk.bold;
const yellow = chalk.yellow;

let currentMode = 'chat'; 
let activePersona = null; 
let exitCounter = 0;
let exitTimer = null;

async function processInput(input) {
  const parts = input.split(' ');
  const processedContent = [];
  
  for (const part of parts) {
    if (part.startsWith('@')) {
      const filePath = part.slice(1);
      try {
        if (fs.existsSync(filePath)) {
          const stats = fs.statSync(filePath);
          if (stats.isFile()) {
            const mimeType = mime.lookup(filePath) || 'application/octet-stream';
            if (mimeType.startsWith('image/')) {
              const base64Image = fs.readFileSync(filePath, { encoding: 'base64' });
              processedContent.push({ type: 'image', mimeType, data: base64Image, fileName: path.basename(filePath) });
            } else {
              const textContent = fs.readFileSync(filePath, 'utf-8');
              processedContent.push({ type: 'text', text: `\n--- Arquivo: ${path.basename(filePath)} ---\n${textContent}\n--- Fim do arquivo ---\n` });
            }
          }
        } else {
          processedContent.push({ type: 'text', text: part });
        }
      } catch (err) {
        processedContent.push({ type: 'text', text: part });
      }
    } else {
      processedContent.push({ type: 'text', text: part });
    }
  }

  const hasImage = processedContent.some(c => c.type === 'image');
  if (!hasImage) return processedContent.map(c => c.text).join(' ');

  const finalContent = [];
  let currentText = "";
  for (const item of processedContent) {
    if (item.type === 'text') {
      currentText += (currentText ? " " : "") + item.text;
    } else {
      if (currentText) { finalContent.push({ type: 'text', text: currentText }); currentText = ""; }
      finalContent.push(item);
    }
  }
  if (currentText) finalContent.push({ type: 'text', text: currentText });
  return finalContent;
}

function getModeStyle() {
  const personaLabel = activePersona ? `[${activePersona.toUpperCase()}]` : '';
  switch (currentMode) {
    case 'plan': return yellow.bold(`${personaLabel}[PLAN] `);
    case 'edit': 
      const editSubMode = editState.autoAccept ? '(AUTO)' : '(MANUAL)';
      return chalk.red.bold(`${personaLabel}[EDIT${editSubMode}] `);
    default: return lavender.bold(`${personaLabel}[CHAT] `);
  }
}

/**
 * LIMPEZA ABSOLUTA DE HTML
 * Remove tags HTML antes da renderização Markdown.
 */
function cleanAIResponse(text) {
  if (!text) return "";
  
  let cleaned = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<li>/gi, '* ')
    .replace(/<\/li>/gi, '\n');

  // Regex extremamente agressiva para remover qualquer tag restante
  cleaned = cleaned.replace(/<[^>]*>?/gm, '');

  // Decodifica entidades comuns
  const entities = {
    '&nbsp;': ' ', '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&apos;': "'"
  };
  return cleaned.replace(/&[a-z0-9#]+;/gi, (match) => entities[match] || match).trim();
}

export async function startInteractive() {
  let config = getConfig();

  if (!config.provider || !config.apiKey) {
    console.log(lavender(figlet.textSync('bimmo')));
    console.log(gray('\nBem-vindo! Vamos configurar seus perfis de IA.\n'));
    await configure(); 
    return startInteractive();
  }

  let provider = createProvider(config);
  const orchestrator = new SwarmOrchestrator(config);
  let messages = [];

  const resetMessages = () => {
    messages = [];
    const projectContext = getProjectContext();
    messages.push({ role: 'system', content: projectContext });
    if (activePersona) {
      const agent = (config.agents || {})[activePersona];
      if (agent) messages.push({ role: 'system', content: `Sua persona atual é: ${agent.name}. Sua tarefa: ${agent.role}` });
    }
  };

  resetMessages();

  console.clear();
  console.log(lavender(figlet.textSync('bimmo')));
  console.log(lavender(` v${version} `.padStart(60, '─')));
  console.log(green(`   Perfil: ${bold(config.activeProfile || 'Padrão')} • IA: ${bold(config.provider.toUpperCase())}`));
  console.log(green(`   Modelo: ${bold(config.model)}`));
  console.log(gray('   /chat | /plan | /edit | /swarm | /use [agente] | /help'));
  console.log(lavender('─'.repeat(60)) + '\n');

  console.log(lavender('👋 Olá! Estou pronto. No que posso ajudar?\n'));

  const globalSigIntHandler = () => {
    exitCounter++;
    if (exitCounter === 1) {
      process.stdout.write(gray('\n(Pressione Ctrl+C novamente para sair)\n'));
      if (exitTimer) clearTimeout(exitTimer);
      exitTimer = setTimeout(() => { exitCounter = 0; }, 2000);
    } else {
      process.stdout.write(lavender('\n👋 BIMMO encerrando sessão. Até logo!\n'));
      process.exit(0);
    }
  };

  process.on('SIGINT', globalSigIntHandler);
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);

  while (true) {
    const modeIndicator = getModeStyle();
    let input;
    try {
      const answers = await inquirer.prompt([{ type: 'input', name: 'input', message: modeIndicator + green('Você'), prefix: '→' }]);
      input = answers.input;
    } catch (e) { continue; }

    console.log(gray(` 📁 ${process.cwd()}`));
    const rawInput = input.trim();
    const cmd = rawInput.toLowerCase();

    // COMANDOS CLI (Tratados antes de enviar para IA)
    if (cmd === '/exit' || cmd === 'exit' || cmd === 'sair') { process.exit(0); }
    
    if (cmd === '/chat') { currentMode = 'chat'; console.log(lavender('✓ Modo CHAT.\n')); continue; }
    if (cmd === '/plan') { currentMode = 'plan'; console.log(yellow('✓ Modo PLAN.\n')); continue; }
    
    if (cmd === '/edit') { currentMode = 'edit'; console.log(chalk.red(`⚠️  Modo EDIT ativado.\n`)); continue; }
    if (cmd === '/edit auto') { currentMode = 'edit'; editState.autoAccept = true; console.log(chalk.red('⚠️  Modo EDIT (AUTO) ativado.\n')); continue; }
    if (cmd === '/edit manual') { currentMode = 'edit'; editState.autoAccept = false; console.log(chalk.red('⚠️  Modo EDIT (MANUAL) ativado.\n')); continue; }

    if (cmd === '/init') {
      const bimmoRcPath = path.join(process.cwd(), '.bimmorc.json');
      if (fs.existsSync(bimmoRcPath)) {
        const { overwrite } = await inquirer.prompt([{ type: 'confirm', name: 'overwrite', message: 'O arquivo .bimmorc.json já existe. Sobrescrever?', default: false }]);
        if (!overwrite) continue;
      }
      const initialConfig = {
        projectName: path.basename(process.cwd()),
        rules: ["Siga as convenções existentes.", "Prefira código modular."],
        ignorePatterns: ["node_modules", ".git"]
      };
      fs.writeFileSync(bimmoRcPath, JSON.stringify(initialConfig, null, 2));
      console.log(green(`\n✅ .bimmorc.json criado com sucesso.\n`));
      resetMessages();
      continue;
    }

    if (cmd.startsWith('/switch ')) {
      const profileName = rawInput.split(' ')[1];
      if (profileName && switchProfile(profileName)) {
        config = getConfig(); provider = createProvider(config);
        console.log(green(`\n✓ Perfil "${bold(profileName)}" ativado!`));
        continue;
      }
      console.log(chalk.red(`\n✖ Perfil não encontrado.\n`)); continue;
    }

    if (cmd.startsWith('/use ')) {
      const agentName = rawInput.split(' ')[1];
      const agents = config.agents || {};
      if (agentName === 'normal' || agentName === 'default') { activePersona = null; resetMessages(); continue; }
      if (agents[agentName]) {
        activePersona = agentName;
        const agent = agents[agentName];
        if (switchProfile(agent.profile)) { config = getConfig(); provider = createProvider(config); }
        currentMode = agent.mode || 'chat';
        console.log(green(`\n✓ Ativado Agente: ${bold(agentName)}`));
        resetMessages();
      } else { console.log(chalk.red(`\n✖ Agente não encontrado.\n`)); }
      continue;
    }

    if (cmd === '/clear') { resetMessages(); console.clear(); continue; }

    if (cmd === '/help') {
      console.log(gray(`\nComandos:\n /chat | /plan | /edit [auto/manual] | /init\n /switch [nome] | /model [nome] | /use [agente]\n /config | /clear | @arquivo\n`));
      continue;
    }

    if (cmd === '/config') { await configure(); config = getConfig(); provider = createProvider(config); continue; }

    if (rawInput === '') continue;

    // Enviar para a IA
    const controller = new AbortController();
    const localInterruptHandler = () => controller.abort();
    process.removeListener('SIGINT', globalSigIntHandler);
    process.on('SIGINT', localInterruptHandler);

    let modeInstr = "";
    if (currentMode === 'plan') modeInstr = "\n[MODO PLAN] Apenas analise.";
    else if (currentMode === 'edit') modeInstr = `\n[MODO EDIT] Auto-Accept: ${editState.autoAccept ? 'ON' : 'OFF'}`;

    const content = await processInput(rawInput);
    messages.push({ role: 'user', content: typeof content === 'string' ? content + modeInstr : [...content, { type: 'text', text: modeInstr }] });

    const spinner = ora({ text: lavender(`bimmo pensando... (Ctrl+C para interromper)`), color: currentMode === 'edit' ? 'red' : 'magenta' }).start();

    try {
      let responseText = await provider.sendMessage(messages, { signal: controller.signal });
      spinner.stop();

      const cleanedText = cleanAIResponse(responseText);
      messages.push({ role: 'assistant', content: responseText });

      console.log('\n' + lavender('bimmo ') + getModeStyle());
      console.log(lavender('─'.repeat(50)));
      console.log(marked(cleanedText));
      console.log(gray('─'.repeat(50)) + '\n');
    } catch (err) {
      spinner.stop();
      if (controller.signal.aborted || err.name === 'AbortError') {
        console.log(yellow('\n⚠️  Interrompido.\n'));
        messages.pop();
      } else {
        console.error(chalk.red('\n✖ Erro:') + ' ' + err.message + '\n');
      }
    } finally {
      process.removeListener('SIGINT', localInterruptHandler);
      process.on('SIGINT', globalSigIntHandler);
    }
  }
}
