export function shouldClearChatInputFiles(
  isMultiModal: boolean,
  filesCount: number,
): boolean {
  return !isMultiModal && filesCount > 0
}
