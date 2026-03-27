import chalk from "chalk";
import ora from "ora";
import { createProvider } from "./providers/factory.js";
import { getProjectContext } from "./project-context.js";
class SwarmOrchestrator {
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
    console.log(chalk.cyan(`
\u{1F680} Iniciando Enxame Sequencial: ${agentNames.join(" \u2192 ")}
`));
    for (const name of agentNames) {
      const agent = this.agents[name];
      if (!agent) throw new Error(`Agente ${name} n\xE3o encontrado.`);
      const profile = this.profiles[agent.profile];
      if (!profile) throw new Error(`Perfil ${agent.profile} do agente ${name} n\xE3o encontrado.`);
      const agentConfig = {
        ...profile,
        model: agent.modelOverride || profile.model
      };
      const provider = createProvider(agentConfig);
      const spinner = ora({
        text: chalk.magenta(`Agente [${name}] trabalhando...`),
        color: agent.mode === "edit" ? "red" : "magenta"
      }).start();
      const messages = [
        { role: "system", content: `Voc\xEA \xE9 o agente ${name}. Sua tarefa espec\xEDfica \xE9: ${agent.role}

MODO ATUAL: ${agent.mode.toUpperCase()}
${getProjectContext()}` },
        { role: "user", content: `CONTEXTO ATUAL:
${currentContext}

OBJETIVO DO ENXAME:
${goal}

Por favor, execute sua parte e retorne o resultado final processado.` }
      ];
      try {
        const response = await provider.sendMessage(messages, { signal: options.signal });
        spinner.succeed(chalk.green(`Agente [${name}] conclu\xEDdo.`));
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
    console.log(chalk.cyan(`
\u{1F451} Iniciando Enxame Hier\xE1rquico (L\xEDder: ${managerName})
`));
    const managerOutput = await this.runSequential([managerName], `Analise o objetivo abaixo e descreva o que cada um dos seguintes agentes deve fazer: ${workerNames.join(", ")}.

OBJETIVO: ${goal}`);
    console.log(chalk.blue(`
\u{1F477} Workers entrando em a\xE7\xE3o...
`));
    const workerPromises = workerNames.map(
      (name) => this.runSequential([name], `Baseado no plano do Manager:
${managerOutput}

Execute sua tarefa para o objetivo: ${goal}`, options)
    );
    const workerResults = await Promise.all(workerPromises);
    const finalResult = await this.runSequential([managerName], `Aqui est\xE3o os resultados dos workers:
${workerResults.join("\n---\n")}

Por favor, consolide tudo em um resultado final perfeito para o objetivo: ${goal}`, options);
    return finalResult;
  }
}
export {
  SwarmOrchestrator
};
