interface Props {
  projectName: string;
  path: string;
}

export function FallbackView({ projectName, path }: Props) {
  return (
    <div className="p-6 text-[oklch(55%_0_0)] text-sm">
      <div className="font-semibold text-[oklch(75%_0_0)] mb-2">无可用渲染</div>
      <div className="text-xs">项目：{projectName}</div>
      <div className="text-xs">路径：{path || "(root)"}</div>
      <div className="mt-4 text-xs">此节点类型尚未配备视图组件。</div>
    </div>
  );
}
