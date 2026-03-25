import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseEpisodes } from "../src/tools/script-parser";

describe("script parser mixed-language dialogue edge case", () => {
  it("uses the following English translation line instead of the preceding Chinese dialogue content", async () => {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-script-parser-"));
    await fs.mkdir(path.join(projectDir, "draft", "episodes"), { recursive: true });
    await fs.writeFile(
      path.join(projectDir, "draft", "episodes", "ep02.md"),
      `第2集

2-1 夜 内 国王寝宫
人物：罗莎琳德、赛勒斯
▲罗莎琳德端着红酒托盘缓缓推开寝宫厚重木门
罗莎琳德（极力压制语气中的恨意）：陛下，您的睡前红酒。
Your Majesty, your bedtime wine.
▲赛勒斯闪电般抓住罗莎琳德手腕
赛勒斯（凑近罗莎琳德耳边，声如恶魔低语）：你在找什么？
What are you looking for?
`,
      "utf-8",
    );

    const result = await parseEpisodes(projectDir);
    if ("error" in result) {
      throw new Error(result.error);
    }

    const scriptPath = path.join(projectDir, "output", "script.json");
    const script = JSON.parse(await fs.readFile(scriptPath, "utf-8"));
    const actions = script.episodes[0]?.scenes[0]?.actions ?? [];
    const dialogues = actions.filter((action) => action.type === "dialogue");

    expect(dialogues).toHaveLength(2);
    expect(dialogues[0]?.content).toBe("Your Majesty, your bedtime wine.");
    expect(dialogues[1]?.content).toBe("What are you looking for?");
  });
});
