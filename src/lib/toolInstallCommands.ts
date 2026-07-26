import { isWindows } from "@/lib/platform";

const posixScriptInstallCommand = (url: string) =>
  `bash -c 'tmp=$(mktemp) && curl -fsSL ${url} -o $tmp && bash $tmp; status=$?; rm -f $tmp; exit $status'`;

const HERMES_WINDOWS_INSTALL_SCRIPT =
  "irm https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.ps1 | iex";

const powershellEncodedCommand = (script: string): string => {
  let binary = "";
  for (let i = 0; i < script.length; i += 1) {
    const code = script.charCodeAt(i);
    binary += String.fromCharCode(code & 0xff, code >> 8);
  }
  return btoa(binary);
};

export const POSIX_ONE_CLICK_INSTALL_COMMANDS = `# Claude Code
${posixScriptInstallCommand("https://claude.ai/install.sh")} || npm i -g @anthropic-ai/claude-code@latest
# Codex
npm i -g @openai/codex@latest
# Gemini CLI
npm i -g @google/gemini-cli@latest
# Grok Build
npm i -g @xai-official/grok@latest
# OpenCode
${posixScriptInstallCommand("https://opencode.ai/install")} || npm i -g opencode-ai@latest
# OpenClaw
npm i -g openclaw@latest
# Hermes
${posixScriptInstallCommand("https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh")}`;

export const WINDOWS_ONE_CLICK_INSTALL_COMMANDS = `# Claude Code
npm i -g @anthropic-ai/claude-code@latest
# Codex
npm i -g @openai/codex@latest
# Gemini CLI
npm i -g @google/gemini-cli@latest
# Grok Build
npm i -g @xai-official/grok@latest
# OpenCode
npm i -g opencode-ai@latest
# OpenClaw
npm i -g openclaw@latest
# Hermes
powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${powershellEncodedCommand(
  HERMES_WINDOWS_INSTALL_SCRIPT,
)}`;

export const LOCAL_ONE_CLICK_INSTALL_COMMANDS = isWindows()
  ? WINDOWS_ONE_CLICK_INSTALL_COMMANDS
  : POSIX_ONE_CLICK_INSTALL_COMMANDS;
