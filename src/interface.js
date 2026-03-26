import chalk from 'chalk';
import figlet from 'figlet';
import inquirer from 'inquirer';
import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';
import ora from 'ora';
import fs from 'fs';
import path from 'path';
import mime from 'mime-types';

import { getConfig, configure, updateActiveModel, switchProfile } from './config.js';
import { createProvider } from './providers/factory.js';
import { getProjectContext } from './project-context.js';

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
    console.log(lavender(figlet.textSync('bimmo', { font: 'slant' })));
    console.log(gray('\nBem-vindo! Vamos configurar seus perfis de IA.\n'));
    await configure(); 
    return startInteractive();
  }

  let provider = createProvider(config);
  const messages = [];

  // 1. Injeta o sistema de contexto inteligente do projeto
  const projectContext = getProjectContext();
  messages.push({ 
    role: 'system', 
    content: projectContext 
  });

  console.clear();
  console.log(lavender(figlet.textSync('bimmo', { font: 'small' })));
  console.log(lavender('─'.repeat(60)));
  console.log(green(`   Perfil Ativo: ${bold(config.activeProfile || 'Padrão')} (${config.provider.toUpperCase()})`));
  console.log(green(`   Modelo: ${bold(config.model)}`));
  console.log(gray('   /chat | /plan | /edit | /switch [perfil] | /model [novo] | /help'));
  console.log(lavender('─'.repeat(60)) + '\n');

  console.log(lavender('👋 Olá! Sou seu agente BIMMO. No que posso atuar?\n'));

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
      break;
    }

    if (cmd === '/chat') { currentMode = 'chat'; console.log(lavender('✓ Modo CHAT.\n')); continue; }
    if (cmd === '/plan') { currentMode = 'plan'; console.log(yellow('✓ Modo PLAN.\n')); continue; }
    if (cmd === '/edit') { currentMode = 'edit'; console.log(chalk.red('⚠️  Modo EDIT.\n')); continue; }

    // /switch [perfil] -> Troca Perfil + Chave + Provedor + Modelo instantaneamente
    if (cmd.startsWith('/switch ')) {
      const profileName = rawInput.split(' ')[1];
      if (profileName && switchProfile(profileName)) {
        config = getConfig(); // Atualiza config local
        provider = createProvider(config); // Recria provedor com nova chave/url
        console.log(green(`\n✓ Trocado para o perfil "${bold(profileName)}"!`));
        console.log(gray(`   IA: ${config.provider.toUpperCase()} | Modelo: ${config.model}\n`));
      } else {
        console.log(chalk.red(`\n✖ Perfil "${profileName}" não encontrado.\n`));
      }
      continue;
    }

    // /model [modelo] -> Troca apenas o modelo do Perfil atual
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
  /switch [nome]   → Mudar PERFIL (Troca Chave/API/IA completa)
  /model [nome]    → Mudar apenas o MODELO da IA atual
  /init            → Inicializar .bimmorc.json neste projeto
  /config          → Gerenciar perfis e chaves
  /clear           → Resetar conversa (mantém contexto base)
  @caminho         → Anexar arquivos ou imagens
      `));
      continue;
    }

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
        rules: [
          "Siga as convenções de código existentes.",
          "Prefira código limpo e modular.",
          "Sempre valide mudanças antes de aplicar no modo EDIT."
        ],
        preferredTech: [],
        architecture: "Não especificada",
        ignorePatterns: ["node_modules", "dist", ".git"]
      };

      fs.writeFileSync(bimmoRcPath, JSON.stringify(initialConfig, null, 2));
      console.log(green(`\n✅ Arquivo .bimmorc.json criado com sucesso em: ${bold(bimmoRcPath)}\n`));
      
      // Recarrega o contexto para a conversa atual
      messages.push({ 
        role: 'system', 
        content: `Novo contexto inicializado via /init:\n${JSON.stringify(initialConfig, null, 2)}` 
      });
      continue;
    }

    if (cmd === '/config') { await configure(); config = getConfig(); provider = createProvider(config); continue; }

    if (rawInput === '') continue;

    // Injeção dinâmica de instruções de modo
    let modeInstr = "";
    if (currentMode === 'plan') modeInstr = "\n[MODO PLAN] Descreva e analise, mas NÃO altere arquivos.";
    else if (currentMode === 'edit') modeInstr = "\n[MODO EDIT] Você tem permissão para usar write_file e run_command AGORA.";

    const content = await processInput(rawInput);
    messages.push({ 
      role: 'user', 
      content: typeof content === 'string' ? content + modeInstr : [...content, { type: 'text', text: modeInstr }]
    });

    const spinner = ora({
      text: lavender(`bimmo (${currentMode}) pensando...`),
      color: currentMode === 'edit' ? 'red' : 'magenta'
    }).start();

    try {
      const responseText = await provider.sendMessage(messages);
      spinner.stop();
      messages.push({ role: 'assistant', content: responseText });

      console.log('\n' + lavender('bimmo') + getModeStyle());
      console.log(lavender('─'.repeat(50)));
      console.log(marked(responseText));
      console.log(gray('─'.repeat(50)) + '\n');
    } catch (err) {
      spinner.stop();
      console.error(chalk.red('✖ Erro Crítico:') + ' ' + err.message + '\n');
    }
  }
}