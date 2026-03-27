import fs from "fs";
import path from "path";
import { execSync } from "child_process";
function getProjectContext() {
  const cwd = process.cwd();
  let context = "=== CONTEXTO DO PROJETO ===\n";
  const bimmoRcPath = path.join(cwd, ".bimmorc.json");
  if (fs.existsSync(bimmoRcPath)) {
    try {
      const rc = JSON.parse(fs.readFileSync(bimmoRcPath, "utf-8"));
      context += `Regras de Projeto (.bimmorc):
${JSON.stringify(rc, null, 2)}

`;
    } catch (e) {
    }
  }
  const instructionFiles = ["CLAUDE.md", "INSTRUCTIONS.md", ".bimmo-context.md", "CONTRIBUTING.md"];
  for (const file of instructionFiles) {
    const p = path.join(cwd, file);
    if (fs.existsSync(p)) {
      context += `Instru\xE7\xF5es de ${file}:
${fs.readFileSync(p, "utf-8")}

`;
    }
  }
  try {
    const tree = execSync('find . -maxdepth 2 -not -path "*/.*" -not -path "./node_modules*"', { encoding: "utf-8" });
    context += `Estrutura de Arquivos (Resumo):
${tree}
`;
  } catch (e) {
    context += "Estrutura de arquivos indispon\xEDvel.\n";
  }
  return context;
}
export {
  getProjectContext
};
