import { fileUrl } from "../../../lib/fileUrl";

interface Props { projectName: string; path: string; }

export function VideoView({ projectName, path }: Props) {
  return (
    <div className="h-full flex items-center justify-center bg-black p-4">
      <video src={fileUrl(projectName, path)} controls preload="metadata" className="max-w-full max-h-full" />
    </div>
  );
}
