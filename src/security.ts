// input: Shell command strings from Bash tool calls
// output: Safety verdict (safe/blocked/warning)
// pos: Security boundary — validates commands before execution

const DANGEROUS_PATTERNS = [
  // Destructive file operations
  "rm -rf /",
  "rm -rf /*",
  "rm -rf ~",
  "rm -rf $HOME",
  "> /dev/",
  "dd if=",
  // System operations
  "sudo",
  "su ",
  "shutdown",
  "reboot",
  "halt",
  "poweroff",
  "init 0",
  "init 6",
  // Package removal
  "apt-get remove",
  "apt remove",
  "yum remove",
  "brew uninstall",
  "pip uninstall",
  // Process operations
  "kill -9 1",
  "killall -9",
  "pkill -9",
  // Network
  "iptables",
  "ufw disable",
  "firewall-cmd",
  // Disk
  "mkfs",
  "fdisk",
  "parted",
  "mount -o remount",
];

const WARNING_PATTERNS = ["rm -rf", "rm -r", "chmod 777", "chown", "kill", "pkill"];

export function validateBashCommand(command: string): [safe: boolean, message: string] {
  const lower = command.toLowerCase().trim();

  for (const pattern of DANGEROUS_PATTERNS) {
    if (lower.includes(pattern.toLowerCase())) {
      return [false, `Blocked: contains dangerous pattern '${pattern}'`];
    }
  }

  const warnings: string[] = [];
  for (const pattern of WARNING_PATTERNS) {
    if (lower.includes(pattern.toLowerCase())) {
      warnings.push(`Warning: command contains risky pattern '${pattern}'`);
    }
  }

  if (warnings.length > 0) {
    return [true, warnings.join("; ")];
  }

  return [true, "Command validated"];
}
