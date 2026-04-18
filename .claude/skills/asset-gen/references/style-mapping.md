# Style Keyword Mapping

Quick entry style parsing for "one-click" workflow:

| User Input Keyword | style-override Value |
|--------------------|---------------------|
| Live-action / Realistic | 真人 |
| Chinese animation | 国漫 |
| Japanese anime | 日漫 |
| American comics | 美漫 |
| Webtoon / Strip | 条漫 |
| Chibi / Q-version | Q版 |
| Game CG / Stylized 3D | 游戏CG |
| Next-gen | 次世代 |

- **With style keyword** -> map directly to `--style-override`
- **Without style keyword** -> omit `--style-override`, let `script.json` decide automatically
