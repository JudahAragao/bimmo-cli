import React, { useState, useEffect, useMemo, useRef } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import chalk from 'chalk';
import figlet from 'figlet';
import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { getConfig, updateActiveModel, switchProfile } from './config.js';
import { createProvider } from './providers/factory.js';
import { getProjectContext } from './project-context.js';
import { editState } from './agent.js';
import { SwarmOrchestrator } from './orchestrator.js';

// Configuração do renderizador Markdown para o terminal
marked.use(new TerminalRenderer({
  heading: chalk.hex('#c084fc').bold,
  code: chalk.hex('#00ff9d'),
  strong: chalk.bold,
  em: chalk.italic,
  html: () => '', 
}));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf-8'));
const version = pkg.version;

const green = '#00ff9d';
const lavender = '#c084fc';
const gray = '#6272a4';
const yellow = '#f1fa8c';
const red = '#ff5555';
const cyan = '#8be9fd';

const BimmoApp = ({ initialConfig }) => {
  const { exit } = useApp();
  const [config, setConfig] = useState(initialConfig);
  const [mode, setMode] = useState('chat');
  const [activePersona, setActivePersona] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [thinkingMessage, setThinkingMessage] = useState('bimmo pensando...');
  const [exitCounter, setExitCounter] = useState(0);
  const [provider, setProvider] = useState(() => createProvider(initialConfig));

  // Inicializa com o contexto do projeto
  useEffect(() => {
    const ctx = getProjectContext();
    setMessages([{ role: 'system', content: ctx }]);
    
    // Welcome message
    setMessages(prev => [...prev, { 
      role: 'assistant', 
      content: `Olá! Sou o **bimmo v${version}**. Como posso ajudar hoje?\n\nDigite \`/help\` para ver os comandos disponíveis.` 
    }]);
  }, []);

  // Lógica de Autocomplete em tempo real para @arquivos
  const filePreview = useMemo(() => {
    if (!input.includes('@')) return [];
    const words = input.split(' ');
    const lastWord = words[words.length - 1];
    if (!lastWord.startsWith('@')) return [];

    try {
      const p = lastWord.slice(1);
      const dir = p.includes('/') ? p.substring(0, p.lastIndexOf('/')) : '.';
      const filter = p.includes('/') ? p.substring(p.lastIndexOf('/') + 1) : p;
      const absDir = path.resolve(process.cwd(), dir);
      if (!fs.existsSync(absDir)) return [];

      return fs.readdirSync(absDir)
        .filter(f => f.startsWith(filter) && !f.startsWith('.') && f !== 'node_modules')
        .slice(0, 5)
        .map(f => ({ 
          name: f, 
          isDir: fs.statSync(path.join(absDir, f)).isDirectory(), 
          rel: path.join(dir === '.' ? '' : dir, f) 
        }));
    } catch (e) { return []; }
  }, [input]);

  const handleSubmit = async (val) => {
    const rawInput = val.trim();
    if (!rawInput) return;
    setInput('');

    const lowerInput = rawInput.toLowerCase();
    const parts = rawInput.split(' ');
    const cmd = parts[0].toLowerCase();

    // COMANDOS INTERNOS
    if (cmd === '/exit' || cmd === 'sair') exit();
    
    if (cmd === '/clear') {
      const ctx = getProjectContext();
      setMessages([{ role: 'system', content: ctx }, { role: 'assistant', content: 'Chat limpo.' }]);
      return;
    }

    if (cmd === '/chat') { setMode('chat'); return; }
    if (cmd === '/plan') { setMode('plan'); return; }
    if (cmd === '/edit') { 
      setMode('edit'); 
      editState.autoAccept = parts[1] === 'auto';
      return; 
    }

    if (cmd === '/model') {
      const newModel = parts[1];
      if (newModel) {
        updateActiveModel(newModel);
        const newCfg = getConfig();
        setConfig(newCfg);
        setProvider(createProvider(newCfg));
        setMessages(prev => [...prev, { role: 'system', content: `Modelo alterado para: ${newModel}` }]);
      }
      return;
    }

    if (cmd === '/switch') {
      const profile = parts[1];
      if (switchProfile(profile)) {
        const newCfg = getConfig();
        setConfig(newCfg);
        setProvider(createProvider(newCfg));
        setMessages(prev => [...prev, { role: 'system', content: `Perfil alterado para: ${profile}` }]);
      } else {
        setMessages(prev => [...prev, { role: 'system', content: `Perfil "${profile}" não encontrado.` }]);
      }
      return;
    }

    if (cmd === '/use') {
      const agentName = parts[1];
      const agents = config.agents || {};
      if (agentName === 'normal') {
        setActivePersona(null);
        setMessages(prev => [...prev, { role: 'system', content: 'Modo normal ativado.' }]);
      } else if (agents[agentName]) {
        const agent = agents[agentName];
        setActivePersona(agentName);
        setMode(agent.mode || 'chat');
        if (agent.profile && agent.profile !== config.activeProfile) {
           switchProfile(agent.profile);
           const newCfg = getConfig();
           setConfig(newCfg);
           setProvider(createProvider(newCfg));
        }
        setMessages(prev => [...prev, { role: 'system', content: `Agente "${agentName}" ativo.` }]);
      } else {
        setMessages(prev => [...prev, { role: 'system', content: `Agente "${agentName}" não encontrado.` }]);
      }
      return;
    }

    if (cmd === '/swarm') {
      const swarmType = parts[1];
      const orchestrator = new SwarmOrchestrator(config);
      setIsThinking(true);
      setThinkingMessage('Enxame em ação...');

      try {
        let response;
        if (swarmType === 'seq') {
          const agents = parts[2].split(',');
          const goal = parts.slice(3).join(' ');
          response = await orchestrator.runSequential(agents, goal);
        } else if (swarmType === 'run') {
          const manager = parts[2];
          const workers = parts[3].split(',');
          const goal = parts.slice(4).join(' ');
          response = await orchestrator.runHierarchical(manager, workers, goal);
        }
        setMessages(prev => [...prev, { role: 'user', content: rawInput }, { role: 'assistant', content: response }]);
      } catch (err) {
        setMessages(prev => [...prev, { role: 'system', content: `Erro no enxame: ${err.message}` }]);
      } finally {
        setIsThinking(false);
        setThinkingMessage('bimmo pensando...');
      }
      return;
    }

    if (cmd === '/help') {
      const helpText = `
**Comandos Disponíveis:**
  \`/chat\` | \`/plan\` | \`/edit [auto|manual]\` - Muda o modo
  \`/switch [perfil]\` - Alterna perfis
  \`/model [modelo]\` - Altera o modelo
  \`/use [agente|normal]\` - Ativa um agente
  \`/swarm seq [agente1,agente2] [objetivo]\` - Enxame sequencial
  \`/swarm run [líder] [worker1,worker2] [objetivo]\` - Enxame hierárquico
  \`/clear\` - Limpa o chat
  \`/exit\` - Encerra o bimmo
  \`@arquivo\` - Inclui conteúdo de arquivo
      `;
      setMessages(prev => [...prev, { role: 'assistant', content: helpText }]);
      return;
    }

    // ENVIO PARA IA
    setIsThinking(true);
    
    let processedInput = rawInput;
    const fileMatches = rawInput.match(/@[\w\.\-\/]+/g);
    if (fileMatches) {
      for (const match of fileMatches) {
        const filePath = match.slice(1);
        try {
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const content = fs.readFileSync(filePath, 'utf-8');
            processedInput = processedInput.replace(match, `\n\n[Arquivo: ${filePath}]\n\`\`\`\n${content}\n\`\`\`\n`);
          }
        } catch (e) {}
      }
    }

    const userMsg = { role: 'user', content: processedInput, displayContent: rawInput };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);

    try {
      let finalMessages = newMessages;
      if (activePersona && config.agents[activePersona]) {
        const agent = config.agents[activePersona];
        finalMessages = [
          { role: 'system', content: `Sua tarefa: ${agent.role}\n\n${getProjectContext()}` },
          ...newMessages.filter(m => m.role !== 'system')
        ];
      }

      const response = await provider.sendMessage(finalMessages);
      setMessages(prev => [...prev, { role: 'assistant', content: response }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'system', content: `Erro: ${err.message}` }]);
    } finally {
      setIsThinking(false);
    }
  };

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      if (isThinking) {
        setIsThinking(false);
      } else {
        if (exitCounter === 0) {
          setExitCounter(1);
          setTimeout(() => setExitCounter(0), 2000);
        } else {
          exit();
        }
      }
    }
    
    if (key.tab && filePreview.length > 0) {
      const words = input.split(' ');
      words[words.length - 1] = `@${filePreview[0].rel}${filePreview[0].isDir ? '/' : ''}`;
      setInput(words.join(' '));
    }
  });

  return (
    <Box flexDirection="column" paddingX={1} minHeight={10}>
      {/* HEADER */}
      <Box flexDirection="column" marginBottom={1}>
        <Text color={lavender}>{figlet.textSync('bimmo', { font: 'small' })}</Text>
        <Box borderStyle="single" borderColor={lavender} paddingX={1} justifyContent="space-between">
          <Text color={green} bold>v{version}</Text>
          <Box>
            <Text color={gray}>{config.activeProfile || 'Default'} </Text>
            <Text color={lavender}>•</Text>
            <Text color={gray}> {config.model}</Text>
          </Box>
        </Box>
      </Box>

      {/* MENSAGENS */}
      <Box flexDirection="column" flexGrow={1}>
        {messages.filter(m => m.role !== 'system').slice(-10).map((m, i) => (
          <Box key={i} flexDirection="column" marginBottom={1}>
            <Box>
              <Text bold color={m.role === 'user' ? green : lavender}>
                {m.role === 'user' ? '› Você' : '› bimmo'}
              </Text>
              {m.role === 'system' && <Text color={yellow}> [SISTEMA]</Text>}
            </Box>
            <Box paddingLeft={2}>
              <Text>
                {m.role === 'assistant' 
                  ? marked.parse(m.content).trim() 
                  : (m.displayContent || m.content)}
              </Text>
            </Box>
          </Box>
        ))}
      </Box>

      {/* STATUS / THINKING */}
      {isThinking && (
        <Box marginBottom={1}>
          <Text color={lavender}>
            <Spinner type="dots" /> <Text italic>{thinkingMessage}</Text>
          </Text>
        </Box>
      )}

      {/* AUTOCOMPLETE PREVIEW */}
      {filePreview.length > 0 && (
        <Box flexDirection="column" borderStyle="round" borderColor={gray} paddingX={1} marginBottom={1}>
          <Text color={gray} dimColor italic>Sugestões (TAB para completar):</Text>
          {filePreview.map((f, i) => (
            <Text key={i} color={i === 0 ? green : gray}>
              {f.isDir ? '📁' : '📄'} {f.rel}{f.isDir ? '/' : ''}
            </Text>
          ))}
        </Box>
      )}

      {/* PROMPT */}
      <Box borderStyle="round" borderColor={isThinking ? gray : lavender} paddingX={1}>
        <Text bold color={mode === 'edit' ? red : mode === 'plan' ? cyan : lavender}>
          {activePersona ? `[${activePersona.toUpperCase()}] ` : ''}
          [{mode.toUpperCase()}] ›{' '}
        </Text>
        <TextInput 
          value={input} 
          onChange={setInput} 
          onSubmit={handleSubmit} 
          placeholder="Como posso ajudar hoje?"
        />
      </Box>

      {/* FOOTER */}
      <Box marginTop={1} justifyContent="space-between" paddingX={1}>
        <Text color={gray} dimColor>📁 {path.relative(process.env.HOME || '', process.cwd())}</Text>
        {exitCounter === 1 && <Text color={yellow} bold> Pressione Ctrl+C novamente para sair</Text>}
        <Box>
          <Text color={gray} dimColor italic>↑↓ para histórico (em breve) • /help para comandos</Text>
        </Box>
      </Box>
    </Box>
  );
};

export async function startInteractive() {
  const config = getConfig();
  if (!config.provider || !config.apiKey) {
    console.log(chalk.yellow('Provedor não configurado. Execute "bimmo config" primeiro.'));
    process.exit(0);
  }
  process.stdout.write('\x1Bc');
  render(<BimmoApp initialConfig={config} />);
}
