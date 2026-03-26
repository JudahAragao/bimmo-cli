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

marked.use(new TerminalRenderer({
  heading: chalk.hex('#c084fc').bold,
  code: chalk.hex('#00ff9d'),
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
              processedContent.push({
                type: 'image',
                mimeType,
                data: base64Image,
                fileName: path.basename(filePath)
              });
            } else {
              const textContent = fs.readFileSync(filePath, 'utf-8');
              processedContent.push({
                type: 'text',
                text: `\n--- Arquivo: ${path.basename(filePath)} ---\n${textContent}\n--- Fim do arquivo ---\n`
              });
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
  
  if (!hasImage) {
    return processedContent.map(c => c.text).join(' ');
  }

  const finalContent = [];
  let currentText = "";

  for (const item of processedContent) {
    if (item.type === 'text') {
      currentText += (currentText ? " " : "") + item.text;
    } else {
      if (currentText) {
        finalContent.push({ type: 'text', text: currentText });
        currentText = "";
      }
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
      if (agent) {
        messages.push({ role: 'system', content: `Sua persona atual é: ${agent.name}. Sua tarefa: ${agent.role}` });
      }
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
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'input',
          message: modeIndicator + green('Você'),
          prefix: '→',
        }
      ]);
      input = answers.input;
    } catch (e) {
      continue;
    }

    // Mostra o diretório atual logo abaixo do input do usuário
    console.log(gray(` 📁 ${process.cwd()}`));

    const rawInput = input.trim();
    const cmd = rawInput.toLowerCase();

    if (cmd === '/exit' || cmd === 'exit' || cmd === 'sair') {
      console.log(lavender('\n👋 BIMMO encerrando sessão. Até logo!\n'));
      process.exit(0);
    }

    if (cmd === '/chat') { currentMode = 'chat'; console.log(lavender('✓ Modo CHAT.\n')); continue; }
    if (cmd === '/plan') { currentMode = 'plan'; console.log(yellow('✓ Modo PLAN.\n')); continue; }
    
    if (cmd === '/edit') { 
      currentMode = 'edit'; 
      console.log(chalk.red(`⚠️  Modo EDIT ativado (Sub-modo atual: ${editState.autoAccept ? 'AUTO' : 'MANUAL'}).\n`)); 
      continue; 
    }
    if (cmd === '/edit auto') {
      currentMode = 'edit';
      editState.autoAccept = true;
      console.log(chalk.red('⚠️  Modo EDIT (AUTO) ativado. Mudanças serão aplicadas sem perguntar.\n'));
      continue;
    }
    if (cmd === '/edit manual') {
      currentMode = 'edit';
      editState.autoAccept = false;
      console.log(chalk.red('⚠️  Modo EDIT (MANUAL) ativado. Pedirei permissão para cada mudança.\n'));
      continue;
    }

    if (cmd.startsWith('/switch ')) {
      const profileName = rawInput.split(' ')[1];
      if (profileName && switchProfile(profileName)) {
        config = getConfig();
        provider = createProvider(config);
        console.log(green(`\n✓ Perfil "${bold(profileName)}" ativado!`));
        continue;
      }
      console.log(chalk.red(`\n✖ Perfil não encontrado.\n`));
      continue;
    }

    if (cmd.startsWith('/use ')) {
      const agentName = rawInput.split(' ')[1];
      const agents = config.agents || {};
      if (agentName === 'normal' || agentName === 'default') {
        activePersona = null;
        console.log(lavender(`\n✓ Voltando para o Modo Normal.\n`));
        resetMessages();
        continue;
      }
      if (agents[agentName]) {
        activePersona = agentName;
        const agent = agents[agentName];
        if (switchProfile(agent.profile)) {
          config = getConfig();
          provider = createProvider(config);
        }
        currentMode = agent.mode || 'chat';
        console.log(green(`\n✓ Agora você está falando com o Agente: ${bold(agentName)}`));
        console.log(gray(`   Task: ${agent.role.substring(0, 100)}...\n`));
        resetMessages();
      } else {
        console.log(chalk.red(`\n✖ Agente "${agentName}" não encontrado.\n`));
      }
      continue;
    }

    if (cmd === '/clear') {
      resetMessages();
      console.clear();
      console.log(lavender('✓ Histórico limpo, contexto preservado.\n'));
      continue;
    }

    if (cmd === '/help') {
      console.log(gray(`
Comandos de Modo:
  /chat            → Modo conversa
  /plan            → Modo planejamento
  /edit [auto/manual] → Modo edição (padrão manual)
  /use [agente]    → Usar um Agente Especialista
  /use normal      → Voltar para o chat normal
  /swarm           → Rodar fluxos complexos

Gerenciamento:
  /switch [nome]   → Mudar perfil de IA completo
  /model [nome]    → Mudar modelo atual
  /config          → Perfis e Agentes
  /init            → Inicializar .bimmorc.json
  @arquivo         → Ler arquivo ou imagem
      `));
      continue;
    }

    if (cmd === '/config') { await configure(); config = getConfig(); provider = createProvider(config); continue; }

    if (cmd === '/init') {
      const bimmoRcPath = path.join(process.cwd(), '.bimmorc.json');
      if (fs.existsSync(bimmoRcPath)) {
        const { overwrite } = await inquirer.prompt([{
          type: 'confirm',
          name: 'overwrite',
          message: 'O arquivo .bimmorc.json já existe. Deseja sobrescrever?',
          default: false
        }]);
        if (!overwrite) continue;
      }
      const initialConfig = {
        projectName: path.basename(process.cwd()),
        rules: ["Siga as convenções existentes.", "Prefira código modular."],
        preferredTech: [],
        ignorePatterns: ["node_modules", ".git"]
      };
      fs.writeFileSync(bimmoRcPath, JSON.stringify(initialConfig, null, 2));
      console.log(green(`\n✅ .bimmorc.json criado com sucesso.\n`));
      
      resetMessages();
      continue;
    }

    if (cmd === '/swarm') {
      const agents = config.agents || {};
      const agentList = Object.keys(agents);
      if (agentList.length < 2) {
        console.log(chalk.yellow('\nCrie pelo menos 2 Agentes em /config primeiro.\n'));
        continue;
      }
      const { swarmAction } = await inquirer.prompt([{
        type: 'list',
        name: 'swarmAction',
        message: 'Tipo de Enxame:',
        choices: ['Sequencial (A → B)', 'Hierárquico (Líder + Workers)', 'Voltar']
      }]);
      if (swarmAction === 'Voltar') continue;
      const { goal } = await inquirer.prompt([{ type: 'input', name: 'goal', message: 'Objetivo do enxame:' }]);
      
      try {
        let result;
        if (swarmAction.includes('Sequencial')) {
          const { selectedAgents } = await inquirer.prompt([{ type: 'checkbox', name: 'selectedAgents', message: 'Ordem dos agentes:', choices: agentList }]);
          result = await orchestrator.runSequential(selectedAgents, goal);
        } else {
          const { manager } = await inquirer.prompt([{ type: 'list', name: 'manager', message: 'Líder:', choices: agentList }]);
          const { workers } = await inquirer.prompt([{ type: 'checkbox', name: 'workers', message: 'Workers:', choices: agentList.filter(a => a !== manager) }]);
          result = await orchestrator.runHierarchical(manager, workers, goal);
        }
        console.log(lavender('\n=== RESULTADO FINAL ===\n') + marked(result));
      } catch (e) {
        console.error(chalk.red(`\nErro: ${e.message}`));
      }
      continue;
    }

    if (rawInput === '') continue;

    const controller = new AbortController();
    const localInterruptHandler = () => controller.abort();
    
    // Switch de SIGINT para modo processamento
    process.removeListener('SIGINT', globalSigIntHandler);
    process.on('SIGINT', localInterruptHandler);

    let modeInstr = "";
    if (currentMode === 'plan') modeInstr = "\n[MODO PLAN] Apenas analise.";
    else if (currentMode === 'edit') modeInstr = `\n[MODO EDIT] Você tem permissão para usar ferramentas. (Auto-Accept: ${editState.autoAccept ? 'ON' : 'OFF'})`;

    const content = await processInput(rawInput);
    messages.push({ 
      role: 'user', 
      content: typeof content === 'string' ? content + modeInstr : [...content, { type: 'text', text: modeInstr }]
    });

    const spinner = ora({
      text: lavender(`bimmo pensando... (Ctrl+C para interromper)`),
      color: currentMode === 'edit' ? 'red' : 'magenta'
    }).start();

    try {
      let responseText = await provider.sendMessage(messages, { signal: controller.signal });
      spinner.stop();

      // LIMPEZA AGRESSIVA DE HTML
      const cleanedText = responseText
        .replace(/<br\s*\/?>/gi, '\n') // Converte <br> em newline real
        .replace(/<p>/gi, '')          // Remove tags <p> iniciais
        .replace(/<\/p>/gi, '\n\n')    // Converte </p> em double newline
        .replace(/<\/?[^>]+(>|$)/g, ""); // Remove QUALQUER outra tag residual

      messages.push({ role: 'assistant', content: responseText });
      console.log('\n' + lavender('bimmo ') + getModeStyle());
      console.log(lavender('─'.repeat(50)));
      console.log(marked(cleanedText.trim()));
      console.log(gray('─'.repeat(50)) + '\n');
    } catch (err) {
      spinner.stop();
      if (controller.signal.aborted || err.name === 'AbortError') {
        console.log(yellow('\n\n⚠️  Operação interrompida pelo usuário.\n'));
        messages.pop();
      } else {
        console.error(chalk.red('\n✖ Erro:') + ' ' + err.message + '\n');
      }
    } finally {
      // Restaura o modo global de saída
      process.removeListener('SIGINT', localInterruptHandler);
      process.on('SIGINT', globalSigIntHandler);
    }
  }
}
