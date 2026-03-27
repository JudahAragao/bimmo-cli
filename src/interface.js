import chalk from 'chalk';
import figlet from 'figlet';
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

marked.use(new TerminalRenderer({
  heading: chalk.hex('#c084fc').bold,
  code: chalk.hex('#00ff9d'),
  strong: chalk.bold,
  em: chalk.italic,
  html: () => '', 
}));

const green = chalk.hex('#00ff9d');
const lavender = chalk.hex('#c084fc');
const gray = chalk.gray;
const bold = chalk.bold;
const yellow = chalk.yellow;

let currentMode = 'chat'; 
let activePersona = null; 
let exitCounter = 0;
let exitTimer = null;

/**
 * Coleta arquivos para preview e completion (Nível Gemini-CLI)
 */
function getFilesForPreview(partialPath) {
  try {
    let p = partialPath.startsWith('@') ? partialPath.slice(1) : partialPath;
    let searchDir = '.';
    let filter = '';

    if (p.includes('/')) {
      const lastSlash = p.lastIndexOf('/');
      searchDir = p.substring(0, lastSlash) || '.';
      filter = p.substring(lastSlash + 1);
    } else {
      searchDir = '.';
      filter = p;
    }

    const absoluteSearchDir = path.resolve(process.cwd(), searchDir);
    if (!fs.existsSync(absoluteSearchDir)) return [];

    const files = fs.readdirSync(absoluteSearchDir);
    return files
      .filter(f => f.startsWith(filter) && !f.startsWith('.') && f !== 'node_modules')
      .map(f => {
        const rel = path.join(searchDir === '.' ? '' : searchDir, f);
        const isDir = fs.statSync(path.join(absoluteSearchDir, f)).isDirectory();
        return { name: rel, isDir };
      });
  } catch (e) { return []; }
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
  if (!config.provider || !config.apiKey) {
    console.log(lavender(figlet.textSync('bimmo')));
    await configure(); return startInteractive();
  }

  let provider = createProvider(config);
  const orchestrator = new SwarmOrchestrator(config);
  let messages = [];

  const resetMessages = () => {
    messages = [{ role: 'system', content: getProjectContext() }];
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

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    completer: (line) => {
      const words = line.split(' ');
      const lastWord = words[words.length - 1];
      if (lastWord.startsWith('@')) {
        const hits = getFilesForPreview(lastWord).map(h => `@${h.name}`);
        return [hits, lastWord];
      }
      return [[], line];
    }
  });

  let currentPreviewLines = 0;

  const clearPreview = () => {
    if (currentPreviewLines > 0) {
      // Move para baixo, limpa cada linha e volta
      for (let i = 0; i < currentPreviewLines; i++) {
        process.stdout.write('\n');
        readline.clearLine(process.stdout, 0);
      }
      readline.moveCursor(process.stdout, 0, -currentPreviewLines);
      currentPreviewLines = 0;
    }
  };

  const showPreview = () => {
    clearPreview();
    const words = rl.line.split(' ');
    const lastWord = words[words.length - 1];
    
    if (lastWord.startsWith('@')) {
      const files = getFilesForPreview(lastWord);
      if (files.length > 0) {
        // Salva a posição do cursor
        process.stdout.write('\u001b[s'); 
        
        process.stdout.write('\n');
        const displayFiles = files.slice(0, 10);
        displayFiles.forEach(f => {
          process.stdout.write(gray(`  ${f.isDir ? '📁' : '📄'} ${f.name}\n`));
        });
        currentPreviewLines = displayFiles.length + 1;
        
        // Restaura a posição do cursor
        process.stdout.write('\u001b[u');
      }
    }
  };

  const displayPrompt = () => {
    const personaLabel = activePersona ? `[${activePersona.toUpperCase()}]` : '';
    let modeLabel = `[${currentMode.toUpperCase()}]`;
    if (currentMode === 'edit') modeLabel = editState.autoAccept ? '[EDIT(AUTO)]' : '[EDIT(MANUAL)]';
    
    console.log(`${gray(`📁 ${process.cwd()}`)}`);
    rl.setPrompt(lavender.bold(personaLabel) + (currentMode === 'edit' ? chalk.red.bold(modeLabel) : lavender.bold(modeLabel)) + green(' > '));
    rl.prompt();
  };

  process.stdin.on('keypress', (s, key) => {
    if (key && (key.name === 'return' || key.name === 'enter')) return;
    setImmediate(() => showPreview());
  });

  rl.on('SIGINT', () => {
    if (exitCounter === 0) {
      exitCounter++;
      process.stdout.write(`\n${gray('(Pressione Ctrl+C novamente para sair)')}\n`);
      exitTimer = setTimeout(() => { exitCounter = 0; }, 2000);
      displayPrompt();
    } else { process.exit(0); }
  });

  displayPrompt();

  rl.on('line', async (input) => {
    clearPreview();
    const rawInput = input.trim();
    if (rawInput === '') { displayPrompt(); return; }

    const cmd = rawInput.toLowerCase();
    if (cmd === '/exit' || cmd === 'sair') process.exit(0);
    if (cmd === '/chat') { currentMode = 'chat'; displayPrompt(); return; }
    if (cmd === '/plan') { currentMode = 'plan'; displayPrompt(); return; }
    if (cmd === '/edit' || cmd === '/edit manual') { currentMode = 'edit'; editState.autoAccept = false; displayPrompt(); return; }
    if (cmd === '/edit auto') { currentMode = 'edit'; editState.autoAccept = true; displayPrompt(); return; }
    if (cmd === '/clear') { resetMessages(); console.clear(); displayPrompt(); return; }
    
    if (cmd === '/init') {
      console.log(chalk.cyan('\n🚀 Gerando .bimmorc.json...\n'));
      const initPrompt = `Analise o projeto e crie o .bimmorc.json estruturado. Use write_file.`;
      const spinner = ora({ text: lavender(`bimmo pensando...`), color: 'red' }).start();
      try {
        const res = await provider.sendMessage([...messages, { role: 'user', content: initPrompt }]);
        spinner.stop();
        console.log(marked.parse(cleanAIResponse(res)));
      } catch (e) { spinner.stop(); console.error(chalk.red(e.message)); }
      resetMessages(); displayPrompt(); return;
    }

    if (cmd === '/config') {
      rl.pause(); await configure(); config = getConfig(); provider = createProvider(config); rl.resume();
      displayPrompt(); return;
    }

    // PROCESSAMENTO IA
    const controller = new AbortController();
    const abortHandler = () => controller.abort();
    process.removeListener('SIGINT', () => {}); 
    process.on('SIGINT', abortHandler);

    let modeInstr = "";
    if (currentMode === 'plan') modeInstr = "\n[MODO PLAN] Apenas analise.";
    else if (currentMode === 'edit') modeInstr = `\n[MODO EDIT] Auto-Accept: ${editState.autoAccept ? 'ON' : 'OFF'}`;

    const processedContent = [];
    const words = rawInput.split(' ');
    for (const word of words) {
      if (word.startsWith('@')) {
        const filePath = word.slice(1);
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          processedContent.push({ type: 'text', text: `\n[ARQUIVO: ${filePath}]\n${fs.readFileSync(filePath, 'utf-8')}\n` });
        } else { processedContent.push({ type: 'text', text: word }); }
      } else { processedContent.push({ type: 'text', text: word }); }
    }

    messages.push({ role: 'user', content: [...processedContent, { type: 'text', text: modeInstr }] });
    const spinner = ora({ text: lavender(`bimmo pensando...`), color: currentMode === 'edit' ? 'red' : 'magenta' }).start();

    try {
      let responseText = await provider.sendMessage(messages, { signal: controller.signal });
      spinner.stop();
      console.log(`\n${lavender('bimmo ')}${currentMode.toUpperCase()}`);
      console.log(lavender('─'.repeat(50)));
      process.stdout.write(marked.parse(cleanAIResponse(responseText)));
      console.log(gray('\n' + '─'.repeat(50)));
      messages.push({ role: 'assistant', content: responseText });
    } catch (err) {
      spinner.stop();
      if (controller.signal.aborted) { console.log(yellow(`\n⚠️  Interrompido.`)); messages.pop(); }
      else { console.error(chalk.red(`\n✖ Erro: ${err.message}`)); }
    } finally {
      process.removeListener('SIGINT', abortHandler);
      displayPrompt();
    }
  });
}
