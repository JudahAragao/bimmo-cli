import React, { useState, useEffect, useMemo } from "react";
import { render, Box, Text, useInput, useApp, Static } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import chalk from "chalk";
import figlet from "figlet";
import { marked } from "marked";
import TerminalRenderer from "marked-terminal";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getConfig, updateActiveModel, switchProfile } from "./config.js";
import { createProvider } from "./providers/factory.js";
import { getProjectContext } from "./project-context.js";
import { editState } from "./agent.js";
import { SwarmOrchestrator } from "./orchestrator.js";
const THEME = {
  green: "#00ff9d",
  lavender: "#c084fc",
  gray: "#6272a4",
  yellow: "#f1fa8c",
  red: "#ff5555",
  cyan: "#8be9fd",
  border: "#44475a"
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
const pkgPath = fs.existsSync(path.join(__dirname, "../package.json")) ? path.join(__dirname, "../package.json") : path.join(__dirname, "../../package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
const version = pkg.version;
const h = React.createElement;
const Divider = ({ borderColor = THEME.border }) => {
  const width = Math.max(10, (process.stdout.columns || 80) - 4);
  return h(
    Box,
    { paddingY: 0, paddingX: 2 },
    h(Text, { color: borderColor }, "\u2500".repeat(width))
  );
};
const Header = ({ config }) => h(
  Box,
  { flexDirection: "column", marginBottom: 1 },
  h(Text, { color: THEME.lavender, bold: true }, figlet.textSync("bimmo", { font: "Small" })),
  h(
    Box,
    { borderStyle: "round", borderColor: THEME.border, paddingX: 1, justifyContent: "space-between" },
    h(Text, { color: THEME.green }, `v${version}`),
    h(
      Box,
      null,
      h(Text, { color: THEME.gray }, `${config.activeProfile || "Default"} `),
      h(Text, { color: THEME.lavender }, "\u2022"),
      h(Text, { color: THEME.cyan }, ` ${config.model}`)
    )
  )
);
const Message = ({ role, content, displayContent }) => {
  const isUser = role === "user";
  const color = isUser ? THEME.green : THEME.lavender;
  const label = isUser ? "\u203A VOC\xCA" : "\u203A bimmo";
  return h(
    Box,
    { flexDirection: "column", marginBottom: 1 },
    h(
      Box,
      null,
      h(Text, { color, bold: true }, label),
      role === "system" && h(Text, { color: THEME.yellow }, " [SISTEMA]")
    ),
    h(
      Box,
      { paddingLeft: 2 },
      h(
        Text,
        null,
        role === "assistant" ? marked.parse(content).trim() : displayContent || content
      )
    )
  );
};
const AutocompleteSuggestions = ({ suggestions, selectedIndex }) => h(
  Box,
  { flexDirection: "column", borderStyle: "round", borderColor: THEME.border, paddingX: 1, marginBottom: 1 },
  h(Text, { color: THEME.gray, dimColor: true, italic: true }, "Sugest\xF5es (\u2191\u2193 navega, TAB seleciona):"),
  suggestions.map((f, i) => h(
    Text,
    { key: i, color: i === selectedIndex ? THEME.green : THEME.gray, bold: i === selectedIndex },
    `${i === selectedIndex ? "\u203A " : "  "}${f.isDir ? "\u{1F4C1}" : "\u{1F4C4}"} ${f.rel}${f.isDir ? "/" : ""}`
  ))
);
const FooterStatus = ({ mode, activePersona, exitCounter }) => h(
  Box,
  { marginTop: 1, flexDirection: "column" },
  h(Divider, { borderColor: THEME.border }),
  h(
    Box,
    { justifyContent: "space-between", paddingX: 1 },
    h(
      Box,
      null,
      h(Text, { color: THEME.gray }, `Modo: `),
      h(Text, { color: mode === "edit" ? THEME.red : mode === "plan" ? THEME.cyan : THEME.lavender, bold: true }, mode.toUpperCase()),
      activePersona && h(Text, { color: THEME.yellow }, ` (${activePersona})`)
    ),
    h(Text, { color: THEME.gray, dimColor: true }, `\u{1F4C1} ${path.basename(process.cwd())}`),
    exitCounter === 1 ? h(Text, { color: THEME.yellow, bold: true }, " Pressione Ctrl+C novamente para sair ") : h(Text, { color: THEME.gray, italic: true }, " /help para comandos ")
  )
);
const BimmoApp = ({ initialConfig }) => {
  const { exit } = useApp();
  const [config, setConfig] = useState(initialConfig);
  const [mode, setMode] = useState("chat");
  const [activePersona, setActivePersona] = useState(null);
  const [messages, setMessages] = useState([]);
  const [staticMessages, setStaticMessages] = useState([]);
  const [input, setInput] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isThinking, setIsThinking] = useState(false);
  const [thinkingMessage, setThinkingMessage] = useState("bimmo pensando...");
  const [exitCounter, setExitCounter] = useState(0);
  const [provider, setProvider] = useState(() => createProvider(initialConfig));
  useEffect(() => {
    const ctx = getProjectContext();
    setMessages([
      { role: "system", content: ctx },
      { role: "assistant", content: `Ol\xE1! Sou o **bimmo v${version}**. Como posso ajudar hoje?

Digite \`/help\` para ver os comandos.` }
    ]);
  }, []);
  const filePreview = useMemo(() => {
    if (!input.includes("@")) return [];
    const words = input.split(" ");
    const lastWord = words[words.length - 1];
    if (!lastWord.startsWith("@")) return [];
    try {
      const p = lastWord.slice(1);
      const dir = p.includes("/") ? p.substring(0, p.lastIndexOf("/")) : ".";
      const filter = p.includes("/") ? p.substring(p.lastIndexOf("/") + 1) : p;
      const absDir = path.resolve(process.cwd(), dir);
      if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) return [];
      const files = fs.readdirSync(absDir).filter((f) => f.startsWith(filter) && !f.startsWith(".") && f !== "node_modules").map((f) => {
        const fullPath = path.join(absDir, f);
        const isDir = fs.statSync(fullPath).isDirectory();
        return {
          name: f,
          isDir,
          rel: path.join(dir === "." ? "" : dir, f)
        };
      });
      return files.sort((a, b) => {
        if (a.isDir && !b.isDir) return -1;
        if (!a.isDir && b.isDir) return 1;
        return a.name.localeCompare(b.name);
      }).slice(0, 10);
    } catch (e) {
      return [];
    }
  }, [input]);
  useEffect(() => {
    setSelectedIndex(0);
  }, [filePreview.length]);
  const handleSubmit = async (val) => {
    const rawInput = val.trim();
    if (!rawInput) return;
    setInput("");
    const parts = rawInput.split(" ");
    const cmd = parts[0].toLowerCase();
    if (cmd === "/exit") exit();
    if (cmd === "/clear") {
      setStaticMessages([]);
      setMessages([{ role: "system", content: getProjectContext() }, { role: "assistant", content: "Chat limpo." }]);
      return;
    }
    if (["/chat", "/plan", "/edit"].includes(cmd)) {
      setMode(cmd.slice(1));
      if (cmd === "/edit") editState.autoAccept = parts[1] === "auto";
      return;
    }
    if (cmd === "/model") {
      const newModel = parts[1];
      if (newModel) {
        updateActiveModel(newModel);
        const newCfg = getConfig();
        setConfig(newCfg);
        setProvider(createProvider(newCfg));
        setMessages((prev) => [...prev, { role: "system", content: `Modelo alterado para: ${newModel}` }]);
      }
      return;
    }
    if (cmd === "/switch") {
      const profile = parts[1];
      if (switchProfile(profile)) {
        const newCfg = getConfig();
        setConfig(newCfg);
        setProvider(createProvider(newCfg));
        setMessages((prev) => [...prev, { role: "system", content: `Perfil alterado para: ${profile}` }]);
      }
      return;
    }
    if (cmd === "/use") {
      const agentName = parts[1];
      const agents = config.agents || {};
      if (agentName === "normal") {
        setActivePersona(null);
      } else if (agents[agentName]) {
        setActivePersona(agentName);
        setMode(agents[agentName].mode || "chat");
      }
      return;
    }
    if (cmd === "/help") {
      setMessages((prev) => [...prev, { role: "assistant", content: `**Comandos Dispon\xEDveis:**

- \`/chat\`, \`/plan\`, \`/edit\`: Alternar modos
- \`/model <nome>\`: Trocar modelo atual
- \`/switch <perfil>\`: Trocar perfil de API
- \`/use <agente>\`: Usar agente especializado
- \`/clear\`: Limpar hist\xF3rico
- \`/exit\`: Sair do bimmo
- \`@arquivo\`: Referenciar arquivo local` }]);
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
            const content = fs.readFileSync(filePath, "utf-8");
            processedInput = processedInput.replace(match, `

[Arquivo: ${filePath}]
\`\`\`
${content}
\`\`\`
`);
          }
        } catch (e) {
        }
      }
    }
    const userMsg = { role: "user", content: processedInput, displayContent: rawInput };
    if (messages.length > 5) {
      setStaticMessages((prev) => [...prev, ...messages.slice(0, -5)]);
      setMessages((prev) => [...prev.slice(-5), userMsg]);
    } else {
      setMessages((prev) => [...prev, userMsg]);
    }
    try {
      let finalMessages = [...staticMessages, ...messages, userMsg];
      if (activePersona && config.agents[activePersona]) {
        const agent = config.agents[activePersona];
        finalMessages = [{ role: "system", content: `Sua tarefa: ${agent.role}

${getProjectContext()}` }, ...finalMessages.filter((m) => m.role !== "system")];
      }
      const response = await provider.sendMessage(finalMessages);
      setMessages((prev) => [...prev, { role: "assistant", content: response }]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: "system", content: `Erro: ${err.message}` }]);
    } finally {
      setIsThinking(false);
    }
  };
  useInput((input2, key) => {
    if (key.ctrl && input2 === "c") {
      if (isThinking) setIsThinking(false);
      else {
        if (exitCounter === 0) {
          setExitCounter(1);
          setTimeout(() => setExitCounter(0), 2e3);
        } else {
          exit();
        }
      }
    }
    if (key.tab && filePreview.length > 0) {
      const selected = filePreview[selectedIndex] || filePreview[0];
      const words = input2.split(" ");
      words[words.length - 1] = `@${selected.rel}${selected.isDir ? "/" : ""}`;
      setInput(words.join(" "));
    }
    if (filePreview.length > 0) {
      if (key.downArrow) {
        setSelectedIndex((prev) => (prev + 1) % filePreview.length);
      }
      if (key.upArrow) {
        setSelectedIndex((prev) => (prev - 1 + filePreview.length) % filePreview.length);
      }
    }
  });
  return h(
    Box,
    { flexDirection: "column", paddingX: 2, paddingY: 1, minHeight: 15 },
    h(Header, { config }),
    h(
      Box,
      { flexDirection: "column", flexGrow: 1, marginBottom: 1 },
      h(Static, { items: staticMessages }, (m, i) => h(Message, { key: `static-${i}`, ...m })),
      messages.filter((m) => m.role !== "system").map((m, i) => h(Message, { key: i, ...m }))
    ),
    isThinking && h(
      Box,
      { marginBottom: 1 },
      h(
        Text,
        { color: THEME.lavender },
        h(Spinner, { type: "dots" }),
        h(Text, { italic: true }, ` ${thinkingMessage}`)
      )
    ),
    filePreview.length > 0 && h(AutocompleteSuggestions, { suggestions: filePreview, selectedIndex }),
    h(
      Box,
      { borderStyle: "round", borderColor: isThinking ? THEME.gray : THEME.lavender, paddingX: 1 },
      h(
        Text,
        { bold: true, color: mode === "edit" ? THEME.red : mode === "plan" ? THEME.cyan : THEME.lavender },
        `${activePersona ? `[${activePersona.toUpperCase()}] ` : ""}\u203A `
      ),
      h(TextInput, {
        value: input,
        onChange: setInput,
        onSubmit: handleSubmit,
        placeholder: "Diga algo ou use / para comandos..."
      })
    ),
    h(FooterStatus, { mode, activePersona, exitCounter })
  );
};
async function startInteractive() {
  const config = getConfig();
  if (!config.provider || !config.apiKey) {
    console.log(chalk.yellow("\n\u26A0\uFE0F  Provedor n\xE3o configurado."));
    console.log(chalk.gray('Execute "bimmo config" para configurar sua chave de API.\n'));
    process.exit(0);
  }
  process.stdout.write("\x1Bc");
  render(h(BimmoApp, { initialConfig: config }));
}
export {
  startInteractive
};
