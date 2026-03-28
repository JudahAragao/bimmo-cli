import React, { useState, useEffect, useMemo, useRef } from 'react';
import { render, Box, Text, useInput, useApp, Static } from 'ink';
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

// Cores e Temas
const THEME = {
  green: '#00ff9d',
  lavender: '#c084fc',
  gray: '#6272a4',
  yellow: '#f1fa8c',
  red: '#ff5555',
  cyan: '#8be9fd',
  border: '#44475a'
};

marked.setOptions({
  renderer: new TerminalRenderer({
    heading: chalk.hex(THEME.lavender).bold,
    code: chalk.hex(THEME.green),
    strong: chalk.bold,
    em: chalk.italic
  })
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// A localização do package.json depende de onde este arquivo está (src ou dist)
const pkgPath = fs.existsSync(path.join(__dirname, '../package.json')) 
  ? path.join(__dirname, '../package.json')
  : path.join(__dirname, '../../package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
const version = pkg.version;

const h = React.createElement;

// --- COMPONENTES ---

const Divider = ({ borderColor = THEME.border }) => {
  const width = Math.max(10, (process.stdout.columns || 80) - 4);
  return h(Box, { paddingY: 0, paddingX: 2 },
    h(Text, { color: borderColor }, '─'.repeat(width))
  );
};

const Header = ({ config }) => (
  h(Box, { flexDirection: 'column', marginBottom: 1 },
    h(Text, { color: THEME.lavender, bold: true }, figlet.textSync('bimmo', { font: 'Small' })),
    h(Box, { borderStyle: 'round', borderColor: THEME.border, paddingX: 1, justifyContent: 'space-between' },
      h(Text, { color: THEME.green }, `v${version}`),
      h(Box, null,
        h(Text, { color: THEME.gray }, `${config.activeProfile || 'Default'} `),
        h(Text, { color: THEME.lavender }, '•'),
        h(Text, { color: THEME.cyan }, ` ${config.model}`)
      )
    )
  )
);

const Message = ({ role, content, displayContent, type, diff, output, message, config, isToolMessage }) => {
  const isUser = role === 'user';
  const color = isUser ? THEME.green : role === 'system' ? THEME.yellow : THEME.lavender;
  const label = isUser ? '› VOCÊ' : role === 'system' ? '› SISTEMA' : '› bimmo';

  if (type === 'header') {
    return h(Header, { config });
  }

  if (isToolMessage) {
    return h(Box, { flexDirection: 'column', marginBottom: 1, paddingLeft: 2 },
      h(Box, { marginBottom: diff || output ? 0 : 0 },
        h(Text, { color: THEME.yellow, bold: true }, `› ${message || 'FERRAMENTA'} `),
      ),
      diff && h(Box, { 
        flexDirection: 'column', 
        paddingX: 1, 
        paddingY: 1,
        borderStyle: 'single', 
        borderColor: THEME.gray,
        marginTop: 1
      },
        diff.split('\n').map((line, i) => h(Text, { key: i }, line))
      ),
      output && h(Box, { 
        marginTop: 1, 
        paddingX: 1, 
        borderStyle: 'single', 
        borderColor: THEME.gray,
        dimColor: true 
      },
        h(Text, { color: THEME.gray, dimColor: true }, output)
      )
    );
  }

  const renderUserContent = (text) => {
    if (typeof text !== 'string') return text;
    const parts = text.split(/(@[\w\.\-\/]+)/g);
    return parts.map((part, i) => {
      if (part.startsWith('@')) {
        return h(Text, { key: i, color: THEME.yellow, bold: true }, part);
      }
      return h(Text, { key: i }, part);
    });
  };
  
  return h(Box, { flexDirection: 'column', marginBottom: 1 },
    h(Box, null,
      h(Text, { color, bold: true }, label),
      role === 'system' && !type && h(Text, { color: THEME.yellow }, ' [AVISO]')
    ),
    h(Box, { paddingLeft: 2 },
      h(Text, null, 
        role === 'assistant' 
          ? marked.parse(content).trim() 
          : renderUserContent(displayContent || content)
      )
    )
  );
};

const AutocompleteSuggestions = ({ suggestions, selectedIndex }) => (
  h(Box, { flexDirection: 'column', borderStyle: 'round', borderColor: THEME.border, paddingX: 1, marginBottom: 1 },
    h(Text, { color: THEME.gray, dimColor: true, italic: true }, 'Sugestões (↑↓ navega, TAB seleciona):'),
    suggestions.map((f, i) => (
      h(Box, { key: i },
        h(Text, { 
          backgroundColor: i === selectedIndex ? THEME.green : undefined,
          color: i === selectedIndex ? '#000000' : THEME.gray,
          bold: i === selectedIndex 
        },
          `${i === selectedIndex ? ' › ' : '   '}${f.isDir ? '📁' : '📄'} ${f.rel}${f.isDir ? '/' : ''} `
        )
      )
    ))
  )
);

const FooterStatus = ({ mode, activePersona, exitCounter }) => (
  h(Box, { marginTop: 1, flexDirection: 'column' },
    h(Divider, { borderColor: THEME.border }),
    h(Box, { justifyContent: 'space-between', paddingX: 1 },
      h(Box, null,
        h(Text, { color: THEME.gray }, `Modo: `),
        h(Text, { color: mode === 'edit' ? THEME.red : mode === 'plan' ? THEME.cyan : THEME.lavender, bold: true }, mode.toUpperCase()),
        activePersona && h(Text, { color: THEME.yellow }, ` (${activePersona})`)
      ),
      h(Text, { color: THEME.gray, dimColor: true }, `📁 ${path.basename(process.cwd())}`),
      exitCounter === 1 
        ? h(Text, { color: THEME.yellow, bold: true }, ' Pressione Ctrl+C novamente para sair ')
        : h(Text, { color: THEME.gray, italic: true }, ' /help para comandos ')
    )
  )
);

const ToolDisplay = ({ status }) => {
  if (!status) return null;
  const { type, message } = status;
  
  if (type === 'diff' || type === 'command_output') return null;

  return h(Box, { flexDirection: 'column', borderStyle: 'round', borderColor: THEME.gray, paddingX: 1, marginBottom: 1 },
    h(Box, null,
      h(Text, { color: THEME.yellow, bold: true }, `[${type.toUpperCase()}] `),
      h(Text, null, message)
    )
  );
};

const ConfirmationPrompt = ({ confirmation }) => {
  if (!confirmation) return null;
  return h(Box, { borderStyle: 'bold', borderColor: THEME.yellow, paddingX: 1, marginBottom: 1 },
    h(Text, { bold: true }, `${confirmation.message} `),
    h(Text, { color: THEME.green }, '(Y) Sim '),
    h(Text, { color: THEME.red }, '/ (N) Não')
  );
};

// --- APP PRINCIPAL ---

const BimmoApp = ({ initialConfig }) => {
  const { exit } = useApp();
  const [config, setConfig] = useState(initialConfig);
  const [mode, setMode] = useState('chat');
  const [activePersona, setActivePersona] = useState(null);
  const [messages, setMessages] = useState([]);
  const [staticMessages, setStaticMessages] = useState([]); 
  const [input, setInput] = useState('');
  const [inputKey, setInputKey] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isThinking, setIsThinking] = useState(false);
  const [thinkingMessage, setThinkingMessage] = useState('bimmo pensando...');
  const [toolStatus, setToolStatus] = useState(null); 
  const [confirmation, setConfirmation] = useState(null); 
  const confirmationRef = useRef(null);
  const [exitCounter, setExitCounter] = useState(0);
  const exitCounterRef = useRef(0);
  const isThinkingRef = useRef(false);
  const [provider, setProvider] = useState(() => createProvider(initialConfig));
  const abortControllerRef = useRef(null);

  useEffect(() => {
    isThinkingRef.current = isThinking;
  }, [isThinking]);

  useEffect(() => {
    confirmationRef.current = confirmation;
  }, [confirmation]);

  useEffect(() => {
    const ctx = getProjectContext();
    setMessages([{ role: 'system', content: ctx }]);
    setStaticMessages([
      { role: 'system', type: 'header', config: initialConfig },
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
      if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) return [];
      
      const files = fs.readdirSync(absDir)
        .filter(f => f.startsWith(filter) && !f.startsWith('.') && f !== 'node_modules')
        .map(f => {
          const fullPath = path.join(absDir, f);
          const isDir = fs.statSync(fullPath).isDirectory();
          return { 
            name: f, 
            isDir, 
            rel: path.join(dir === '.' ? '' : dir, f) 
          };
        });

      return files.sort((a, b) => {
        if (a.isDir && !b.isDir) return -1;
        if (!a.isDir && b.isDir) return 1;
        return a.name.localeCompare(b.name);
      }).slice(0, 10);
    } catch (e) { return []; }
  }, [input]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [filePreview.length]);

  const handleSubmit = async (val) => {
    const rawInput = val.trim();
    if (!rawInput) return;
    setInput('');
    const parts = rawInput.split(' ');
    const cmd = parts[0].toLowerCase();

    if (cmd === '/exit') exit();
    if (cmd === '/clear') {
      const ctx = getProjectContext();
      setStaticMessages([
        { role: 'system', type: 'header', config: config },
        { role: 'assistant', content: 'Chat limpo.' }
      ]);
      setMessages([{ role: 'system', content: ctx }]);
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

    if (cmd === '/help') {
      setStaticMessages(prev => [...prev, { role: 'assistant', content: `**Comandos Disponíveis:**\n\n- \`/chat\`, \`/plan\`, \`/edit\`: Alternar modos\n- \`/model <nome>\`: Trocar modelo atual\n- \`/switch <perfil>\`: Trocar perfil de API\n- \`/use <agente>\`: Usar agente especializado\n- \`/clear\`: Limpar histórico\n- \`/exit\`: Sair do bimmo\n- \`@arquivo\`: Referenciar arquivo local` }]);
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
    setStaticMessages(prev => [...prev, userMsg]);
    setMessages(prev => [...prev, userMsg]);

    try {
      let finalMessages = [...messages, userMsg];
      if (activePersona && config.agents[activePersona]) {
        const agent = config.agents[activePersona];
        finalMessages = [{ role: 'system', content: `Sua tarefa: ${agent.role}\n\n${getProjectContext()}` }, ...finalMessages.filter(m => m.role !== 'system')];
      }
      
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      const options = {
        signal: abortController.signal,
        onStatus: (status) => {
          if (status.type === 'diff' || status.type === 'command_output') {
            setStaticMessages(prev => [...prev, { role: 'system', isToolMessage: true, ...status }]);
          } else {
            setToolStatus(status);
            if (status.message) setThinkingMessage(status.message);
          }
        },
        onConfirm: (message) => {
          setToolStatus(null);
          setThinkingMessage('Aguardando sua decisão...');
          return new Promise((resolve) => {
            setConfirmation({ message, resolve });
          });
        }
      };

      const response = await provider.sendMessage(finalMessages, options);
      const assistantMsg = { role: 'assistant', content: response };
      setStaticMessages(prev => [...prev, assistantMsg]);
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      if (err.name === 'AbortError' || err.message === 'Abortado pelo usuário') {
        // Interrupção silenciosa
      } else {
        const errMsg = { role: 'system', content: `Erro: ${err.message}` };
        setStaticMessages(prev => [...prev, errMsg]);
        setMessages(prev => [...prev, errMsg]);
      }
    } finally {
      setIsThinking(false);
      abortControllerRef.current = null;
      setToolStatus(null);
      setConfirmation(null);
      setThinkingMessage('bimmo pensando...');
    }
  };

  useInput((char, key) => {
    if (confirmationRef.current) {
      if (char.toLowerCase() === 'y' || key.return) {
        const resolve = confirmationRef.current.resolve;
        setConfirmation(null);
        setThinkingMessage('Aplicando mudanças...');
        resolve(true);
      } else if (char.toLowerCase() === 'n' || key.escape) {
        const resolve = confirmationRef.current.resolve;
        setConfirmation(null);
        setThinkingMessage('bimmo pensando...');
        resolve(false);
      }
      return;
    }

    if (key.ctrl && char === 'c') {
      if (isThinkingRef.current) {
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
        }
        setIsThinking(false);
        const interruptMsg = { role: 'system', content: 'Interrompido pelo usuário.' };
        setStaticMessages(prev => [...prev, interruptMsg]);
        setMessages(prev => [...prev, interruptMsg]);
        setExitCounter(0);
        exitCounterRef.current = 0;
        return;
      } 
      
      exitCounterRef.current++;
      if (exitCounterRef.current === 1) {
        setExitCounter(1);
        setTimeout(() => {
          exitCounterRef.current = 0;
          setExitCounter(0);
        }, 3000);
      } else {
        process.exit(0);
      }
      return;
    }
    if (key.tab && filePreview.length > 0) {
      const selected = filePreview[selectedIndex] || filePreview[0];
      const words = input.split(' ');
      words[words.length - 1] = `@${selected.rel}${selected.isDir ? '/' : ''}`;
      setInput(words.join(' '));
      setInputKey(prev => prev + 1);
    }

    if (filePreview.length > 0) {
      if (key.downArrow) {
        setSelectedIndex(prev => (prev + 1) % filePreview.length);
      }
      if (key.upArrow) {
        setSelectedIndex(prev => (prev - 1 + filePreview.length) % filePreview.length);
      }
    }
  });

  return (
    h(Box, { flexDirection: 'column', paddingX: 2, paddingY: 1, minHeight: 15 },
      h(Box, { flexDirection: 'column', flexGrow: 1, marginBottom: 1 },
        h(Static, { items: staticMessages }, (m, i) => h(Message, { key: `static-${i}`, ...m }))
      ),

      isThinking && h(Box, { marginBottom: 1, flexDirection: 'column' },
        h(Box, null,
          h(Text, { color: THEME.lavender },
            h(Spinner, { type: 'dots' }),
            h(Text, { italic: true }, ` ${thinkingMessage}`)
          )
        ),
        h(ToolDisplay, { status: toolStatus }),
        h(ConfirmationPrompt, { confirmation })
      ),

      filePreview.length > 0 && h(AutocompleteSuggestions, { suggestions: filePreview, selectedIndex }),

      // Preview do texto digitado com realce para @arquivos
      input.includes('@') && h(Box, { paddingX: 3, marginBottom: 0 },
        h(Text, { dimColor: true }, '› '),
        input.split(/(@[\w\.\-\/]+)/g).map((part, i) => (
          h(Text, { key: i, color: part.startsWith('@') ? THEME.yellow : THEME.gray, bold: part.startsWith('@') }, part)
        ))
      ),

      h(Box, { borderStyle: 'round', borderColor: isThinking ? THEME.gray : THEME.lavender, paddingX: 1 },
        h(Text, { bold: true, color: mode === 'edit' ? THEME.red : mode === 'plan' ? THEME.cyan : THEME.lavender },
          `${activePersona ? `[${activePersona.toUpperCase()}] ` : ''}› `
        ),
        h(TextInput, { 
          key: inputKey,
          value: input, 
          onChange: setInput, 
          onSubmit: handleSubmit, 
          placeholder: 'Diga algo ou use / para comandos...',
          focus: !isThinking && !confirmation
        })
      ),
      
      h(FooterStatus, { mode, activePersona, exitCounter })
    )
  );
};

export async function startInteractive() {
  const config = getConfig();
  if (!config.provider || !config.apiKey) {
    console.log(chalk.yellow('\n⚠️  Provedor não configurado.'));
    console.log(chalk.gray('Execute "bimmo config" para configurar sua chave de API.\n'));
    process.exit(0);
  }

  process.stdout.write('\x1Bc');
  render(h(BimmoApp, { initialConfig: config }), { exitOnCtrlC: false });
}
