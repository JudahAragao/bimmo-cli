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

// CONFIGURAÇÃO DO RENDERIZADOR (CORREÇÃO DEFINITIVA DO <P>)
const terminalRenderer = new TerminalRenderer({
  heading: chalk.hex('#c084fc').bold,
  code: chalk.hex('#00ff9d'),
  strong: chalk.bold,
  em: chalk.italic,
});

marked.setOptions({ renderer: terminalRenderer });

const green = chalk.hex('#00ff9d');
const lavender = chalk.hex('#c084fc');
const gray = chalk.gray;
const bold = chalk.bold;
const yellow = chalk.yellow;

let currentMode = 'chat'; 
let activePersona = null; 
let exitCounter = 0;
let exitTimer = null;

const i18n = {
  'pt-BR': {
    welcome: 'Olá! Estou pronto. No que posso ajudar?',
    thinking: 'bimmo pensando...',
    interrupted: 'Operação interrompida.',
    exitHint: '(Pressione Ctrl+C novamente para sair)',
    switchOk: 'Perfil ativado!',
    agentOk: 'Agente ativado:',
    modeEdit: 'Modo EDIT ativado.',
    help: '\nComandos:\n /chat | /plan | /edit | /init\n /switch [nome] | /model [nome]\n /use [agente] | /use normal\n /config | /clear | @arquivo\n'
  },
  'en-US': {
    welcome: 'Hello! I am ready. How can I help you?',
    thinking: 'bimmo thinking...',
    interrupted: 'Operation interrupted.',
    exitHint: '(Press Ctrl+C again to exit)',
    switchOk: 'Profile activated!',
    agentOk: 'Agent activated:',
    modeEdit: 'EDIT mode activated.',
    help: '\nCommands:\n /chat | /plan | /edit | /init\n /switch [name] | /model [name]\n /use [agent] | /use normal\n /config | /clear | @file\n'
  }
};

function getFilesForCompletion(partialPath) {
  try {
    const dir = path.dirname(partialPath.startsWith('@') ? partialPath.slice(1) : partialPath) || '.';
    const base = path.basename(partialPath.startsWith('@') ? partialPath.slice(1) : partialPath);
    const files = fs.readdirSync(path.resolve(process.cwd(), dir));
    return files
      .filter(f => f.startsWith(base) && !f.startsWith('.') && f !== 'node_modules')
      .map(f => path.join(dir, f));
  } catch (e) {
    return [];
  }
}

function cleanAIResponse(text) {
  if (!text) return "";
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<p>/gi, '')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]*>?/gm, '')
    .trim();
}

export async function startInteractive() {
  let config = getConfig();
  const lang = config.language || 'pt-BR';
  const t = i18n[lang] || i18n['pt-BR'];

  if (!config.provider || !config.apiKey) {
    console.log(lavender(figlet.textSync('bimmo')));
    await configure(); 
    return startInteractive();
  }

  let provider = createProvider(config);
  const orchestrator = new SwarmOrchestrator(config);
  let messages = [];

  const resetMessages = () => {
    messages = [];
    messages.push({ role: 'system', content: getProjectContext() });
    if (activePersona) {
      const agent = (config.agents || {})[activePersona];
      if (agent) messages.push({ role: 'system', content: `Persona: ${agent.name}. Task: ${agent.role}` });
    }
  };

  resetMessages();

  console.clear();
  console.log(lavender(figlet.textSync('bimmo')));
  console.log(lavender(` v${version} `.padStart(60, '─')));
  console.log(green(`   Perfil: ${bold(config.activeProfile || 'Padrão')} • IA: ${bold(config.provider.toUpperCase())}`));
  console.log(green(`   Modelo: ${bold(config.model)}`));
  console.log(lavender('─'.repeat(60)) + '\n');

  console.log(lavender(`👋 ${t.welcome}\n`));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    historySize: 100,
    completer: (line) => {
      const words = line.split(' ');
      const lastWord = words[words.length - 1];
      if (lastWord.startsWith('@')) {
        const hits = getFilesForCompletion(lastWord);
        return [hits.map(h => `@${h}`), lastWord];
      }
      return [[], line];
    }
  });

  // Handler de saída
  rl.on('SIGINT', () => {
    exitCounter++;
    if (exitCounter === 1) {
      console.log(`\n${gray(t.exitHint)}`);
      if (exitTimer) clearTimeout(exitTimer);
      exitTimer = setTimeout(() => { exitCounter = 0; }, 2000);
      displayPrompt();
    } else {
      console.log(lavender('\n👋 BIMMO encerrando sessão.\n'));
      process.exit(0);
    }
  });

  const displayPrompt = () => {
    const personaLabel = activePersona ? `[${activePersona.toUpperCase()}]` : '';
    let modeLabel = `[${currentMode.toUpperCase()}]`;
    if (currentMode === 'edit') modeLabel = editState.autoAccept ? '[EDIT(AUTO)]' : '[EDIT(MANUAL)]';
    
    console.log(`\n${gray(`📁 ${process.cwd()}`)}`);
    rl.setPrompt(lavender.bold(personaLabel) + (currentMode === 'edit' ? chalk.red.bold(modeLabel) : lavender.bold(modeLabel)) + green(' > '));
    rl.prompt();
  };

  displayPrompt();

  rl.on('line', async (input) => {
    const rawInput = input.trim();
    const cmd = rawInput.toLowerCase();

    if (rawInput === '') { displayPrompt(); return; }

    // COMANDOS INTERNOS
    if (cmd === '/exit' || cmd === 'sair') process.exit(0);
    if (cmd === '/chat') { currentMode = 'chat'; displayPrompt(); return; }
    if (cmd === '/plan') { currentMode = 'plan'; displayPrompt(); return; }
    if (cmd === '/edit' || cmd === '/edit manual') { currentMode = 'edit'; editState.autoAccept = false; displayPrompt(); return; }
    if (cmd === '/edit auto') { currentMode = 'edit'; editState.autoAccept = true; displayPrompt(); return; }
    
    if (cmd === '/clear') { resetMessages(); console.clear(); displayPrompt(); return; }
    if (cmd === '/help') { console.log(gray(t.help)); displayPrompt(); return; }
    
    if (cmd === '/init') {
      const bimmoRcPath = path.join(process.cwd(), '.bimmorc.json');
      const initialConfig = { projectName: path.basename(process.cwd()), rules: ["Clean code"], ignorePatterns: ["node_modules"] };
      fs.writeFileSync(bimmoRcPath, JSON.stringify(initialConfig, null, 2));
      console.log(green(`\n✅ .bimmorc.json criado.`));
      resetMessages();
      displayPrompt();
      return;
    }

    if (cmd === '/config') {
      rl.pause();
      await configure();
      config = getConfig();
      provider = createProvider(config);
      rl.resume();
      displayPrompt();
      return;
    }

    if (cmd.startsWith('/switch ')) {
      const pName = rawInput.split(' ')[1];
      if (switchProfile(pName)) {
        config = getConfig(); provider = createProvider(config);
        console.log(green(`\n✓ ${t.switchOk}`));
      } else { console.log(chalk.red(`\n✖ Perfil não encontrado.`)); }
      displayPrompt(); return;
    }

    if (cmd.startsWith('/use ')) {
      const aName = rawInput.split(' ')[1];
      if (aName === 'normal') { activePersona = null; resetMessages(); displayPrompt(); return; }
      const agents = config.agents || {};
      if (agents[aName]) {
        activePersona = aName;
        const agent = agents[aName];
        if (switchProfile(agent.profile)) { config = getConfig(); provider = createProvider(config); }
        currentMode = agent.mode || 'chat';
        console.log(green(`\n✓ ${t.agentOk} ${bold(aName)}`));
        resetMessages();
      } else { console.log(chalk.red(`\n✖ Agente não encontrado.`)); }
      displayPrompt(); return;
    }

    // PROCESSAMENTO IA
    const controller = new AbortController();
    const abortHandler = () => controller.abort();
    process.on('SIGINT', abortHandler);

    let modeInstr = "";
    if (currentMode === 'plan') modeInstr = "\n[MODO PLAN] Apenas analise.";
    else if (currentMode === 'edit') modeInstr = `\n[MODO EDIT] Auto-Accept: ${editState.autoAccept ? 'ON' : 'OFF'}`;

    // Processar anexos @
    const processedContent = [];
    const words = rawInput.split(' ');
    for (const word of words) {
      if (word.startsWith('@')) {
        const filePath = word.slice(1);
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          const content = fs.readFileSync(filePath, 'utf-8');
          processedContent.push({ type: 'text', text: `\n[ARQUIVO: ${filePath}]\n${content}\n` });
        } else { processedContent.push({ type: 'text', text: word }); }
      } else { processedContent.push({ type: 'text', text: word }); }
    }

    messages.push({ role: 'user', content: [...processedContent, { type: 'text', text: modeInstr }] });

    const spinner = ora({ text: lavender(`${t.thinking} (Ctrl+C para parar)`), color: currentMode === 'edit' ? 'red' : 'magenta' }).start();

    try {
      let responseText = await provider.sendMessage(messages, { signal: controller.signal });
      spinner.stop();

      const cleanedText = cleanAIResponse(responseText);
      messages.push({ role: 'assistant', content: responseText });

      console.log(`\n${lavender('bimmo ')}${currentMode.toUpperCase()}`);
      console.log(lavender('─'.repeat(50)));
      console.log(marked.parse(cleanedText)); // Usamos parse para garantir o renderer terminal
      console.log(gray('─'.repeat(50)));
    } catch (err) {
      spinner.stop();
      if (controller.signal.aborted) { console.log(yellow(`\n⚠️  ${t.interrupted}`)); messages.pop(); }
      else { console.error(chalk.red(`\n✖ Erro: ${err.message}`)); }
    } finally {
      process.removeListener('SIGINT', abortHandler);
      displayPrompt();
    }
  });
}
