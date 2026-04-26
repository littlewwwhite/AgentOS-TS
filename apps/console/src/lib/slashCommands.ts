// input: SDK slash command names + current composer text
// output: filtered command suggestions and keyboard selection helpers
// pos: normalizes Claude Code slash commands before ChatPane renders them

const FALLBACK_SLASH_COMMANDS = [
  "/script-adapt",
  "/script-writer",
  "/storyboard",
  "/asset-gen",
  "/video-gen",
  "/video-editing",
  "/music-matcher",
  "/subtitle-maker",
];

const UNAVAILABLE_SLASH_COMMANDS = new Set(["/rewind", "/wangwen"]);

const SLASH_COMMAND_DESCRIPTIONS: Record<string, string> = {
  "/script-adapt": "将长篇小说或完整文本改编为正式剧本",
  "/script-writer": "从故事源扩写正式剧本",
  "/storyboard": "根据剧本和视觉设定生成视频前故事板",
  "/asset-gen": "生成角色、场景、道具视觉设定",
  "/video-gen": "根据定稿故事板生成分集视频",
  "/video-editing": "筛选并剪辑已生成的视频素材",
  "/music-matcher": "为成片匹配并合成配乐",
  "/subtitle-maker": "生成字幕并烧录最终视频",
};

export interface SlashCommandOption {
  command: string;
  description: string;
}

export function describeSlashCommand(command: string): string {
  return SLASH_COMMAND_DESCRIPTIONS[command] ?? "Claude Code command";
}

export function normalizeSlashCommands(commands: string[] | undefined): string[] {
  const source = commands && commands.length > 0 ? commands : FALLBACK_SLASH_COMMANDS;
  const normalized = source
    .map((command) => command.trim())
    .filter(Boolean)
    .map((command) => (command.startsWith("/") ? command : `/${command}`))
    .filter((command) => !UNAVAILABLE_SLASH_COMMANDS.has(command));
  return Array.from(new Set(normalized)).sort((a, b) => a.localeCompare(b));
}

export function visibleSlashCommands(input: string, commands: string[] | undefined): string[] {
  const trimmedStart = input.trimStart();
  if (!trimmedStart.startsWith("/")) return [];
  const commandToken = trimmedStart.slice(1);
  if (/\s/.test(commandToken)) return [];
  const prefix = commandToken.toLowerCase();
  return normalizeSlashCommands(commands)
    .filter((command) => command.slice(1).toLowerCase().startsWith(prefix))
    .slice(0, 12);
}

export function visibleSlashCommandOptions(input: string, commands: string[] | undefined): SlashCommandOption[] {
  return visibleSlashCommands(input, commands).map((command) => ({
    command,
    description: describeSlashCommand(command),
  }));
}

export function nextSlashCommandIndex(
  currentIndex: number,
  optionCount: number,
  direction: "up" | "down",
): number {
  if (optionCount <= 0) return 0;
  const delta = direction === "down" ? 1 : -1;
  return (currentIndex + delta + optionCount) % optionCount;
}
