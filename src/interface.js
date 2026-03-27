import React, { useState, useEffect, useMemo } from 'react';
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

const green = '#00ff9d';
const lavender = '#c084fc';
const gray = '#6272a4';
const yellow = '#f1fa8c';
const red = '#ff5555';
const cyan = '#8be9fd';

marked.use(new TerminalRenderer({
  heading: chalk.hex(lavender).bold,
  code: chalk.hex(green),
  strong: chalk.bold,
  em: chalk.italic,
  html: () => '', 
}));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf-8'));
const version = pkg.version;

const h = React.createElement;

const Header = ({ config }) => (
  h(Box, { flexDirection: 'column', marginBottom: 1 },
    h(Text, { color: lavender }, figlet.textSync('bimmo')),
    h(Box, { borderStyle: 'single', borderColor: lavender, paddingX: 1, justifyContent: 'space-between' },
      h(Text, { color: green, bold: true }, `v${version}`),
      h(Box, null,
        h(Text, { color: gray }, `${config.activeProfile || 'Default'} `),
        h(Text, { color: lavender }, '•'),
        h(Text, { color: gray }, ` ${config.model}`)
      )
    )
  )
);

const MessageList = ({ messages }) => (
  h(Box, { flexDirection: 'column', flexGrow: 1 },
    messages.filter(m => m.role !== 'system').slice(-10).map((m, i) => (
      h(Box, { key: i, flexDirection: 'column', marginBottom: 1 },
        h(Box, null,
          h(Text, { bold: true, color: m.role === 'user' ? green : lavender },
            m.role === 'user' ? '› Você' : '› bimmo'
          ),
          m.role === 'system' && h(Text, { color: yellow }, ' [SISTEMA]')
        ),
        h(Box, { paddingLeft: 2 },
          h(Text, null, 
            m.role === 'assistant' 
              ? marked.parse(m.content).trim() 
              : (m.displayContent || m.content)
          )
        )
      )
    ))
  )
);

const Autocomplete = ({ suggestions }) => (
  h(Box, { flexDirection: 'column', borderStyle: 'round', borderColor: gray, paddingX: 1, marginBottom: 1 },
    h(Text, { color: gray, dimColor: true, italic: true }, 'Sugestões (TAB para completar):'),
    suggestions.map((f, i) => (
      h(Text, { key: i, color: i === 0 ? green : gray },
        `${f.isDir ? '📁' : '📄'} ${f.rel}${f.isDir ? '/' : ''}`
      )
    ))
  )
);

const Footer = ({ exitCounter }) => (
  h(Box, { marginTop: 1, justifyContent: 'space-between', paddingX: 1 },
    h(Text, { color: gray, dimColor: true }, `📁 ${path.relative(process.env.HOME || '', process.cwd())}`),
    exitCounter === 1 && h(Text, { color: yellow, bold: true }, ' Pressione Ctrl+C novamente para sair'),
    h(Box, null,
      h(Text, { color: gray, dimColor: true, italic: true }, '↑↓ para histórico • /help para comandos')
    )
  )
);

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

  useEffect(() => {
    const ctx = getProjectContext();
    setMessages([
      { role: 'system', content: ctx },
      { role: 'assistant', content: `Olá! Sou o **bimmo v${version}**. Como posso ajudar hoje?\n\nDigite \`/help\` para ver os comandos.` }
    ]);
  }, []);

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
    const parts = rawInput.split(' ');
    const cmd = parts[0].toLowerCase();

    if (cmd === '/exit') exit();
    if (cmd === '/clear') {
      setMessages([{ role: 'system', content: getProjectContext() }, { role: 'assistant', content: 'Chat limpo.' }]);
      return;
    }
    if (['/chat', '/plan', '/edit'].includes(cmd)) {
      setMode(cmd.slice(1));
      if (cmd === '/edit') editState.autoAccept = parts[1] === 'auto';
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
      }
      return;
    }

    if (cmd === '/use') {
      const agentName = parts[1];
      const agents = config.agents || {};
      if (agentName === 'normal') {
        setActivePersona(null);
      } else if (agents[agentName]) {
        setActivePersona(agentName);
        setMode(agents[agentName].mode || 'chat');
      }
      return;
    }

    if (cmd === '/swarm') {
      const orchestrator = new SwarmOrchestrator(config);
      setIsThinking(true);
      setThinkingMessage('Enxame em ação...');
      try {
        let response;
        if (parts[1] === 'seq') response = await orchestrator.runSequential(parts[2].split(','), parts.slice(3).join(' '));
        if (parts[1] === 'run') response = await orchestrator.runHierarchical(parts[2], parts[3].split(','), parts.slice(4).join(' '));
        setMessages(prev => [...prev, { role: 'user', content: rawInput }, { role: 'assistant', content: response }]);
      } catch (err) {
        setMessages(prev => [...prev, { role: 'system', content: `Erro no enxame: ${err.message}` }]);
      } finally {
        setIsThinking(false);
      }
      return;
    }

    if (cmd === '/help') {
      setMessages(prev => [...prev, { role: 'assistant', content: `**Comandos:** /chat, /plan, /edit, /switch, /model, /use, /swarm, /clear, /exit, @arquivo` }]);
      return;
    }

    setIsThinking(true);
    let processedInput = rawInput;
    const fileMatches = rawInput.match(/@[\w\.\-\/]+/g);
    if (fileMatches) {
      for (const match of fileMatches) {
        const filePath = match.slice(1);
        try {
          if (fs.existsSync(filePath)) {
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
        finalMessages = [{ role: 'system', content: `Sua tarefa: ${agent.role}\n\n${getProjectContext()}` }, ...newMessages.filter(m => m.role !== 'system')];
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
      if (isThinking) setIsThinking(false);
      else {
        if (exitCounter === 0) { setExitCounter(1); setTimeout(() => setExitCounter(0), 2000); }
        else exit();
      }
    }
    if (key.tab && filePreview.length > 0) {
      const words = input.split(' ');
      words[words.length - 1] = `@${filePreview[0].rel}${filePreview[0].isDir ? '/' : ''}`;
      setInput(words.join(' '));
    }
  });

  return (
    h(Box, { flexDirection: 'column', paddingX: 1, minHeight: 10 },
      h(Header, { config }),
      h(MessageList, { messages }),
      isThinking && h(Box, { marginBottom: 1 },
        h(Text, { color: lavender },
          h(Spinner, { type: 'dots' }),
          h(Text, { italic: true }, ` ${thinkingMessage}`)
        )
      ),
      filePreview.length > 0 && h(Autocomplete, { suggestions: filePreview }),
      h(Box, { borderStyle: 'round', borderColor: isThinking ? gray : lavender, paddingX: 1 },
        h(Text, { bold: true, color: mode === 'edit' ? red : mode === 'plan' ? cyan : lavender },
          `${activePersona ? `[${activePersona.toUpperCase()}] ` : ''}[${mode.toUpperCase()}] › `
        ),
        h(TextInput, { value: input, onChange: setInput, onSubmit: handleSubmit, placeholder: 'Como posso ajudar hoje?' })
      ),
      h(Footer, { exitCounter })
    )
  );
};

export async function startInteractive() {
  const config = getConfig();
  if (!config.provider || !config.apiKey) {
    console.log(chalk.yellow('Provedor não configurado. Execute "bimmo config" primeiro.'));
    process.exit(0);
  }
  process.stdout.write('\x1Bc');
  render(h(BimmoApp, { initialConfig: config }));
}
