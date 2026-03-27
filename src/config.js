import Conf from 'conf';
import inquirer from 'inquirer';
import chalk from 'chalk';

const config = new Conf({ projectName: 'bimmo-cli' });

const providers = {
  openai: { baseURL: 'https://api.openai.com/v1', defaultModel: 'gpt-4o' },
  anthropic: { baseURL: 'https://api.anthropic.com/v1', defaultModel: 'claude-3-5-sonnet-20240620' },
  grok: { baseURL: 'https://api.x.ai/v1', defaultModel: 'grok-2-1212' },
  gemini: { baseURL: 'https://generativelanguage.googleapis.com/v1beta', defaultModel: 'gemini-2.0-flash' },
  ollama: { baseURL: 'http://localhost:11434/api', defaultModel: 'llama3.2' },
  openrouter: { baseURL: 'https://openrouter.ai/api/v1', defaultModel: 'google/gemini-2.0-flash-lite-preview-02-05:free' },
  deepseek: { baseURL: 'https://api.deepseek.com', defaultModel: 'deepseek-chat' },
  zai: { baseURL: 'https://api.z.ai/v1', defaultModel: 'glm-4' }
};

export async function configure() {
  console.log(chalk.cyan('🔧 Configuração do bimmo-cli\n'));

  const profiles = config.get('profiles') || {};
  const profileList = Object.keys(profiles);

  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'O que deseja fazer?',
      choices: [
        { name: 'Criar novo perfil de IA', value: 'create' },
        { name: 'Selecionar perfil ativo', value: 'select' },
        { name: 'Gerenciar Agentes Especialistas', value: 'agents' },
        { name: 'Configurar Idioma', value: 'language' },
        { name: 'Configurar chave Tavily', value: 'tavily' },
        { name: 'Sair', value: 'exit' }
      ]
    }
  ]);

  if (action === 'exit') return;

  if (action === 'language') {
    const { lang } = await inquirer.prompt([{
      type: 'list',
      name: 'lang',
      message: 'Escolha o idioma do sistema:',
      choices: [
        { name: 'Português (Brasil)', value: 'pt-BR' },
        { name: 'English', value: 'en-US' }
      ],
      default: config.get('language') || 'pt-BR'
    }]);
    config.set('language', lang);
    console.log(chalk.green(`✓ Idioma definido para: ${lang}`));
    return;
  }

  if (action === 'agents') return configureAgents();

  if (action === 'tavily') {
    const { tavilyKey } = await inquirer.prompt([{
      type: 'input',
      name: 'tavilyKey',
      message: 'Chave de API Tavily:',
      default: config.get('tavilyKey')
    }]);
    config.set('tavilyKey', tavilyKey);
    console.log(chalk.green('✓ Chave Tavily salva.'));
    return;
  }

  if (action === 'select') {
    if (profileList.length === 0) {
      console.log(chalk.yellow('Nenhum perfil encontrado. Crie um primeiro.'));
      return configure();
    }
    const { selected } = await inquirer.prompt([{
      type: 'list',
      name: 'selected',
      message: 'Escolha o perfil para ativar:',
      choices: profileList
    }]);
    const p = profiles[selected];
    config.set('provider', p.provider);
    config.set('apiKey', p.apiKey);
    config.set('model', p.model);
    config.set('baseURL', p.baseURL);
    config.set('activeProfile', selected);
    console.log(chalk.green(`✓ Perfil "${selected}" ativado!`));
    return;
  }

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'profileName',
      message: 'Dê um nome para este perfil:',
      validate: i => i.length > 0 || 'Nome obrigatório'
    },
    {
      type: 'list',
      name: 'provider',
      message: 'Qual provedor?',
      choices: Object.keys(providers)
    },
    {
      type: 'input',
      name: 'apiKey',
      message: 'API Key:',
      validate: i => i.length > 5 || 'Chave inválida'
    },
    {
      type: 'input',
      name: 'model',
      message: 'Modelo padrão (vazio para default):'
    },
    {
      type: 'input',
      name: 'customBaseURL',
      message: 'URL customizada (vazio para default):'
    }
  ]);

  const newProfile = {
    provider: answers.provider,
    apiKey: answers.apiKey,
    model: answers.model || providers[answers.provider].defaultModel,
    baseURL: answers.customBaseURL || providers[answers.provider].baseURL
  };

  profiles[answers.profileName] = newProfile;
  config.set('profiles', profiles);
  
  config.set('provider', newProfile.provider);
  config.set('apiKey', newProfile.apiKey);
  config.set('model', newProfile.model);
  config.set('baseURL', newProfile.baseURL);
  config.set('activeProfile', answers.profileName);

  console.log(chalk.green(`\n✅ Perfil "${answers.profileName}" criado e ativado!`));
}

async function configureAgents() {
  const agents = config.get('agents') || {};
  const profiles = config.get('profiles') || {};
  const profileList = Object.keys(profiles);

  const { action } = await inquirer.prompt([{
    type: 'list',
    name: 'action',
    message: 'Gerenciar Agentes:',
    choices: ['Criar Agente', 'Listar Agentes', 'Remover Agente', 'Voltar']
  }]);

  if (action === 'Voltar') return configure();

  if (action === 'Criar Agente') {
    if (profileList.length === 0) {
      console.log(chalk.red('Crie um perfil de IA primeiro.'));
      return configure();
    }

    const answers = await inquirer.prompt([
      { type: 'input', name: 'name', message: 'Nome do Agente (ex: Arquiteto, Revisor):' },
      { type: 'list', name: 'profile', message: 'Qual perfil este agente usará?', choices: profileList },
      { type: 'input', name: 'modelOverride', message: 'Sobrescrever modelo (vazio para manter o do perfil):' },
      { type: 'list', name: 'mode', message: 'Modo padrão:', choices: ['chat', 'plan', 'edit'] },
      { type: 'editor', name: 'role', message: 'Descreva a Task/Papel deste agente (System Prompt):' }
    ]);

    agents[answers.name] = answers;
    config.set('agents', agents);
    console.log(chalk.green(`✓ Agente "${answers.name}" criado!`));
  }

  if (action === 'Listar Agentes') {
    console.log(chalk.blue('\nAgentes Configurados:'));
    Object.keys(agents).forEach(name => {
      console.log(`- ${chalk.bold(name)} [${agents[name].profile}] (Modo: ${agents[name].mode})`);
    });
    console.log('');
  }

  return configureAgents();
}

export function getConfig() {
  return config.store;
}

export function updateActiveModel(newModel) {
  config.set('model', newModel);
  const active = config.get('activeProfile');
  if (active) {
    const profiles = config.get('profiles');
    profiles[active].model = newModel;
    config.set('profiles', profiles);
  }
}

export function switchProfile(name) {
  const profiles = config.get('profiles') || {};
  if (profiles[name]) {
    const p = profiles[name];
    config.set('provider', p.provider);
    config.set('apiKey', p.apiKey);
    config.set('model', p.model);
    config.set('baseURL', p.baseURL);
    config.set('activeProfile', name);
    return true;
  }
  return false;
}
