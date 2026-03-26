# 🌿 bimmo-cli

**bimmo** é um assistente de IA universal para o seu terminal, com uma interface elegante em tons de **Verde & Lavanda**. Ele funciona como um agente autônomo e multimodal que gerencia o contexto do seu projeto e executa tarefas complexas.

---

## 📦 Instalação Global

Para ter o **bimmo** sempre disponível no seu terminal como um comando do sistema:

```bash
npm install -g bimmo-cli
```

Após a instalação, basta digitar `bimmo` em qualquer pasta:

```bash
bimmo
```

---

## ✨ Principais Funcionalidades

### 🤖 Agente Autônomo e Modos de Operação
- **/chat**: Conversa normal para tirar dúvidas.
- **/plan**: Analisa o código e descreve o plano de ação sem alterar nada.
- **/edit**: **Modo Auto-Edit**. A IA tem permissão para ler, criar, editar arquivos e rodar comandos shell para resolver problemas.

### 📁 Contexto Inteligente de Projeto
- **Auto-Indexação**: O bimmo mapeia a estrutura do seu projeto na inicialização.
- **Herança de Regras**: Detecta automaticamente arquivos `.bimmorc.json`, `CLAUDE.md` e `INSTRUCTIONS.md`.
- **Anexos com `@`**: Digite `@caminho/arquivo` para anexar códigos ou imagens à conversa.

### 🌐 Busca e Multi-Provedor
- **Busca na Web**: Integrado com Tavily API para pesquisas em tempo real.
- **Perfis**: Salve múltiplos perfis (OpenAI, Anthropic, Gemini, DeepSeek, Grok, Ollama, OpenRouter, Z.ai) e alterne instantaneamente com `/switch`.

---

## 🛠️ Comandos Rápidos no Chat

| Comando | Função |
| :--- | :--- |
| `/chat` | Modo conversa. |
| `/plan` | Modo planejamento (seguro). |
| `/edit` | Modo edição automática (agente). |
| `/init` | Cria o arquivo `.bimmorc.json` no projeto. |
| `/switch [nome]` | Troca de perfil (IA/Chave/Modelo). |
| `/model [nome]` | Troca apenas o modelo da IA atual. |
| `/config` | Gerenciar seus perfis e chaves de API. |
| `@arquivo` | Lê um arquivo ou imagem para o contexto. |

---

## 🚀 Publicando via GitHub (Automação)

Para publicar novas versões no NPM automaticamente usando o GitHub:

1. Suba seu código para um repositório no GitHub.
2. No NPM, gere um **Access Token (Automation)**.
3. No GitHub, vá em **Settings > Secrets > Actions** e adicione o secret `NPM_TOKEN`.
4. Sempre que você criar uma **"New Release"** no GitHub, o projeto será publicado no NPM e ficará disponível para `npm install -g`.

---

Feito com 💜 por Judah.
