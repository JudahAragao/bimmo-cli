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

import { getConfig, configure, updateActiveModel, switchProfile } from './config.js';
import { createProvider } from './providers/factory.js';
import { getProjectContext } from './project-context.js';
import { SwarmOrchestrator } from './orchestrator.js';

marked.use(new TerminalRenderer({
  heading: chalk.hex('#c084fc').bold,
  code: chalk.hex('#00ff9d'),
}));

const green = chalk.hex('#00ff9d');
const lavender = chalk.hex('#c084fc');
const gray = chalk.gray;
const bold = chalk.bold;
const yellow = chalk.yellow;

let currentMode = 'chat'; // 'chat', 'plan', 'edit'

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
  switch (currentMode) {
    case 'plan': return yellow.bold(' [PLAN] ');
    case 'edit': return chalk.red.bold(' [EDIT] ');
    default: return lavender.bold(' [CHAT] ');
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
  const messages = [];

  const projectContext = getProjectContext();
  messages.push({ 
    role: 'system', 
    content: projectContext 
  });

  console.clear();
  console.log(lavender(figlet.textSync('bimmo')));
  console.log(lavender('─'.repeat(60)));
  console.log(green(`   Perfil Ativo: ${bold(config.activeProfile || 'Padrão')} (${config.provider.toUpperCase()})`));
  console.log(green(`   Modelo: ${bold(config.model)}`));
  console.log(gray('   /chat | /plan | /edit | /swarm | /switch [perfil] | /model [novo] | /help'));
  console.log(lavender('─'.repeat(60)) + '\n');

  console.log(lavender('👋 Olá! Sou seu agente BIMMO. No que posso atuar?\n'));

  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);

  while (true) {
    const modeIndicator = getModeStyle();
    const { input } = await inquirer.prompt([
      {
        type: 'input',
        name: 'input',
        message: modeIndicator + green('Você'),
        prefix: '→',
      }
    ]);

    const rawInput = input.trim();
    const cmd = rawInput.toLowerCase();

    if (cmd === '/exit' || cmd === 'exit' || cmd === 'sair') {
      console.log(lavender('\n👋 BIMMO encerrando sessão. Até logo!\n'));
      process.exit(0);
    }

    if (cmd === '/chat') { currentMode = 'chat'; console.log(lavender('✓ Modo CHAT.\n')); continue; }
    if (cmd === '/plan') { currentMode = 'plan'; console.log(yellow('✓ Modo PLAN.\n')); continue; }
    if (cmd === '/edit') { currentMode = 'edit'; console.log(chalk.red('⚠️  Modo EDIT.\n')); continue; }

    if (cmd.startsWith('/switch ')) {
      const profileName = rawInput.split(' ')[1];
      if (profileName && switchProfile(profileName)) {
        config = getConfig();
        provider = createProvider(config);
        console.log(green(`\n✓ Trocado para o perfil "${bold(profileName)}"!`));
        console.log(gray(`   IA: ${config.provider.toUpperCase()} | Modelo: ${config.model}\n`));
      } else {
        console.log(chalk.red(`\n✖ Perfil "${profileName}" não encontrado.\n`));
      }
      continue;
    }

    if (cmd.startsWith('/model ')) {
      const newModel = rawInput.split(' ')[1];
      if (newModel) {
        updateActiveModel(newModel);
        config.model = newModel;
        provider = createProvider(config);
        console.log(green(`\n✓ Modelo atualizado para: ${bold(newModel)}\n`));
      }
      continue;
    }

    if (cmd === '/clear') {
      messages.length = 0;
      messages.push({ role: 'system', content: getProjectContext() });
      console.clear();
      console.log(lavender('✓ Histórico limpo, contexto preservado.\n'));
      continue;
    }

    if (cmd === '/help') {
      console.log(gray(`
Comandos Disponíveis:
  /chat /plan /edit → Mudar modo de operação
  /switch [nome]   → Mudar PERFIL (IA completa)
  /model [nome]    → Mudar apenas o MODELO atual
  /swarm           → Configurar e rodar enxames de agentes
  /config          → Gerenciar perfis e agentes
  /init            → Inicializar .bimmorc.json
  @caminho         → Anexar arquivos ou imagens
      `));
      continue;
    }

    if (cmd === '/config') { await configure(); config = getConfig(); provider = createProvider(config); continue; }

    if (cmd === '/swarm') {
      const agents = config.agents || {};
      const agentList = Object.keys(agents);

      if (agentList.length < 2) {
        console.log(chalk.yellow('\nVocê precisa de pelo menos 2 Agentes configurados para rodar um Enxame.\nUse /config para criar Agentes.\n'));
        continue;
      }

      const { swarmAction } = await inquirer.prompt([{
        type: 'list',
        name: 'swarmAction',
        message: 'Ação de Enxame:',
        choices: ['Rodar Enxame Sequencial', 'Rodar Enxame Hierárquico', 'Voltar']
      }]);

      if (swarmAction === 'Voltar') continue;

      const { goal } = await inquirer.prompt([{ type: 'input', name: 'goal', message: 'Qual o objetivo final deste enxame?' }]);

      if (swarmAction === 'Rodar Enxame Sequencial') {
        const { selectedAgents } = await inquirer.prompt([{
          type: 'checkbox',
          name: 'selectedAgents',
          message: 'Selecione os agentes e a ordem (mínimo 2):',
          choices: agentList
        }]);

        if (selectedAgents.length < 2) {
          console.log(chalk.red('\nSelecione pelo menos 2 agentes.\n'));
          continue;
        }

        try {
          const finalResult = await orchestrator.runSequential(selectedAgents, goal);
          console.log(lavender('\n=== RESULTADO FINAL DO ENXAME ===\n'));
          console.log(marked(finalResult));
        } catch (e) {
          console.error(chalk.red(`\nErro no Enxame: ${e.message}`));
        }
      }

      if (swarmAction === 'Rodar Enxame Hierárquico') {
        const { manager } = await inquirer.prompt([{ type: 'list', name: 'manager', message: 'Selecione o Agente Líder (Manager):', choices: agentList }]);
        const { workers } = await inquirer.prompt([{ type: 'checkbox', name: 'workers', message: 'Selecione os Workers:', choices: agentList.filter(a => a !== manager) }]);

        try {
          const finalResult = await orchestrator.runHierarchical(manager, workers, goal);
          console.log(lavender('\n=== RESULTADO FINAL DO ENXAME ===\n'));
          console.log(marked(finalResult));
        } catch (e) {
          console.error(chalk.red(`\nErro no Enxame: ${e.message}`));
        }
      }
      continue;
    }

    if (rawInput === '') continue;

    const controller = new AbortController();
    const interruptHandler = () => controller.abort();
    const keypressHandler = (str, key) => { if (key.name === 'escape' || (key.ctrl && key.name === 'c')) interruptHandler(); };
    process.on('SIGINT', interruptHandler);
    process.stdin.on('keypress', keypressHandler);

    let modeInstr = "";
    if (currentMode === 'plan') modeInstr = "\n[MODO PLAN] Descreva e analise, mas NÃO altere arquivos.";
    else if (currentMode === 'edit') modeInstr = "\n[MODO EDIT] Você tem permissão para usar write_file e run_command AGORA.";

    const content = await processInput(rawInput);
    messages.push({ 
      role: 'user', 
      content: typeof content === 'string' ? content + modeInstr : [...content, { type: 'text', text: modeInstr }]
    });

    const spinner = ora({
      text: lavender(`bimmo (${currentMode}) pensando... (Ctrl+C para interromper)`),
      color: currentMode === 'edit' ? 'red' : 'magenta'
    }).start();

    try {
      let responseText = await provider.sendMessage(messages, { signal: controller.signal });
      spinner.stop();
      const cleanedText = responseText.replace(/<\/?[^>]+(>|$)/g, "");
      messages.push({ role: 'assistant', content: responseText });
      console.log('\n' + lavender('bimmo') + getModeStyle());
      console.log(lavender('─'.repeat(50)));
      console.log(marked(cleanedText));
      console.log(gray('─'.repeat(50)) + '\n');
    } catch (err) {
      spinner.stop();
      if (controller.signal.aborted || err.name === 'AbortError') {
        console.log(yellow('\n\n⚠️  Operação interrompida pelo usuário.\n'));
        messages.pop();
      } else {
        console.error(chalk.red('\n✖ Erro Crítico:') + ' ' + err.message + '\n');
      }
    } finally {
      process.off('SIGINT', interruptHandler);
      process.stdin.off('keypress', keypressHandler);
    }
  }
}