import chalk from 'chalk';
import ora from 'ora';
import { createProvider } from './providers/factory.js';
import { getProjectContext } from './project-context.js';

export class SwarmOrchestrator {
  constructor(config) {
    this.config = config;
    this.agents = config.agents || {};
    this.profiles = config.profiles || {};
  }

  /**
   * Executa uma tarefa sequencialmente através de uma lista de agentes.
   * O output de um agente vira o contexto do próximo.
   */
  async runSequential(agentNames, goal, options = {}) {
    let currentContext = goal;
    const results = [];

    console.log(chalk.cyan(`\n🚀 Iniciando Enxame Sequencial: ${agentNames.join(' → ')}\n`));

    for (const name of agentNames) {
      const agent = this.agents[name];
      if (!agent) throw new Error(`Agente ${name} não encontrado.`);

      const profile = this.profiles[agent.profile];
      if (!profile) throw new Error(`Perfil ${agent.profile} do agente ${name} não encontrado.`);

      const agentConfig = {
        ...profile,
        model: agent.modelOverride || profile.model
      };

      const provider = createProvider(agentConfig);
      const spinner = ora({
        text: chalk.magenta(`Agente [${name}] trabalhando...`),
        color: agent.mode === 'edit' ? 'red' : 'magenta'
      }).start();

      const messages = [
        { role: 'system', content: `Você é o agente ${name}. Sua tarefa específica é: ${agent.role}\n\nMODO ATUAL: ${agent.mode.toUpperCase()}\n${getProjectContext()}` },
        { role: 'user', content: `CONTEXTO ATUAL:\n${currentContext}\n\nOBJETIVO DO ENXAME:\n${goal}\n\nPor favor, execute sua parte e retorne o resultado final processado.` }
      ];

      try {
        const response = await provider.sendMessage(messages, { signal: options.signal });
        spinner.succeed(chalk.green(`Agente [${name}] concluído.`));
        
        currentContext = response;
        results.push({ agent: name, output: response });
      } catch (err) {
        spinner.fail(chalk.red(`Agente [${name}] falhou: ${err.message}`));
        throw err;
      }
    }

    return currentContext;
  }

  /**
   * Executa uma tarefa hierárquica.
   * Um Manager recebe o objetivo, define o que cada Worker deve fazer, e consolida.
   */
  async runHierarchical(managerName, workerNames, goal, options = {}) {
    console.log(chalk.cyan(`\n👑 Iniciando Enxame Hierárquico (Líder: ${managerName})\n`));

    // Passo 1: Manager analisa e delega
    const managerOutput = await this.runSequential([managerName], `Analise o objetivo abaixo e descreva o que cada um dos seguintes agentes deve fazer: ${workerNames.join(', ')}.\n\nOBJETIVO: ${goal}`);

    // Passo 2: Workers executam baseado na delegação do Manager (em paralelo para velocidade)
    console.log(chalk.blue(`\n👷 Workers entrando em ação...\n`));
    const workerPromises = workerNames.map(name => 
      this.runSequential([name], `Baseado no plano do Manager:\n${managerOutput}\n\nExecute sua tarefa para o objetivo: ${goal}`, options)
    );

    const workerResults = await Promise.all(workerPromises);

    // Passo 3: Manager consolida tudo
    const finalResult = await this.runSequential([managerName], `Aqui estão os resultados dos workers:\n${workerResults.join('\n---\n')}\n\nPor favor, consolide tudo em um resultado final perfeito para o objetivo: ${goal}`, options);

    return finalResult;
  }
}
