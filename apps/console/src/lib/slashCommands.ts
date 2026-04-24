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

export function nextSlashCommandIndex(
  currentIndex: number,
  optionCount: number,
  direction: "up" | "down",
): number {
  if (optionCount <= 0) return 0;
  const delta = direction === "down" ? 1 : -1;
  return (currentIndex + delta + optionCount) % optionCount;
}
