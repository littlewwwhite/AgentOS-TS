import { fileUrl } from "../../../lib/fileUrl";

interface Props { projectName: string; path: string; }

export function ImageView({ projectName, path }: Props) {
  return (
    <div className="h-full flex items-center justify-center bg-[oklch(10%_0_0)] p-4">
      <img
        src={fileUrl(projectName, path)}
        alt={path}
        className="max-w-full max-h-full object-contain"
      />
    </div>
  );
}
