import { describe, expect, it } from "vitest";
import { validateBashCommand } from "../src/security.js";

describe("validateBashCommand", () => {
  it("allows safe commands", () => {
    const [safe, msg] = validateBashCommand("ls -la");
    expect(safe).toBe(true);
    expect(msg).toBe("Command validated");
  });

  it("allows git commands", () => {
    const [safe] = validateBashCommand("git status");
    expect(safe).toBe(true);
  });

  it("blocks rm -rf /", () => {
    const [safe, msg] = validateBashCommand("rm -rf /");
    expect(safe).toBe(false);
    expect(msg).toContain("dangerous pattern");
  });

  it("blocks sudo", () => {
    const [safe, msg] = validateBashCommand("sudo apt-get install foo");
    expect(safe).toBe(false);
    expect(msg).toContain("sudo");
  });

  it("blocks dd if=", () => {
    const [safe, msg] = validateBashCommand("dd if=/dev/zero of=/dev/sda");
    expect(safe).toBe(false);
    expect(msg).toContain("dd if=");
  });

  it("warns on rm -rf (non-root)", () => {
    const [safe, msg] = validateBashCommand("rm -rf build/");
    expect(safe).toBe(true);
    expect(msg).toContain("Warning");
  });

  it("warns on chmod 777", () => {
    const [safe, msg] = validateBashCommand("chmod 777 myfile");
    expect(safe).toBe(true);
    expect(msg).toContain("Warning");
  });

  it("is case insensitive for blocking", () => {
    const [safe] = validateBashCommand("SUDO rm -rf /");
    expect(safe).toBe(false);
  });
});
