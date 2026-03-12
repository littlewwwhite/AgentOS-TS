export type SandboxFileWriter = {
  write(filePath: string, content: string): Promise<unknown>;
};

export type FragmentGeneratedFile = {
  file_path: string;
  file_content: string;
};

export type FragmentFileInput = {
  file_path: string;
  code: string | FragmentGeneratedFile[] | null | undefined;
};

function getSandboxFiles(fragment: FragmentFileInput): Array<{
  filePath: string;
  content: string;
}> {
  if (Array.isArray(fragment.code)) {
    return fragment.code.map((file) => ({
      filePath: file.file_path,
      content: file.file_content,
    }));
  }

  return [
    {
      filePath: fragment.file_path,
      content: fragment.code ?? "",
    },
  ];
}

export async function writeSandboxFiles(
  filesApi: SandboxFileWriter,
  fragment: FragmentFileInput,
): Promise<void> {
  for (const file of getSandboxFiles(fragment)) {
    await filesApi.write(file.filePath, file.content);
  }
}

export function getSandboxRunCode(fragment: FragmentFileInput): string {
  if (!Array.isArray(fragment.code)) {
    return fragment.code ?? "";
  }

  return (
    fragment.code.find((file) => file.file_path === fragment.file_path)
      ?.file_content ??
    fragment.code[0]?.file_content ??
    ""
  );
}
