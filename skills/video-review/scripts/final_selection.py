#!/usr/bin/env python3
"""
最终视频选择管理工具
用于记录和管理最终选择使用的视频素材
"""

import argparse
import json
from pathlib import Path
from typing import Dict, List, Optional


class FinalSelectionManager:
    """最终视频选择管理器"""

    def __init__(self, config_file: str = "final_selection.json"):
        """
        初始化管理器

        Args:
            config_file: 配置文件路径
        """
        self.config_file = Path(config_file)
        self.selections = self._load_config()

    def _load_config(self) -> Dict:
        """加载配置文件"""
        if self.config_file.exists():
            with open(self.config_file, "r", encoding="utf-8") as f:
                return json.load(f)
        return {}

    def _save_config(self):
        """保存配置文件"""
        with open(self.config_file, "w", encoding="utf-8") as f:
            json.dump(self.selections, f, ensure_ascii=False, indent=2)
        print(f"✓ 配置已保存: {self.config_file}")

    def set_selected_l(
        self, l_id: str, filename: str, path: str, auto_save: bool = True
    ):
        """
        设置选择的 l 视频

        Args:
            l_id: l 的 ID（如 ep01-sc01-l01）
            filename: 文件名
            path: 完整路径
            auto_save: 是否自动保存
        """
        if l_id not in self.selections:
            self.selections[l_id] = {
                "id": l_id,
                "selected_l": None,
                "selected_shots": [],
            }

        self.selections[l_id]["selected_l"] = {"filename": filename, "path": path}

        print(f"✓ 已设置 {l_id} 的选择 l: {filename}")

        if auto_save:
            self._save_config()

    def add_selected_shot(
        self, l_id: str, filename: str, path: str, auto_save: bool = True
    ):
        """
        添加选择的镜头

        Args:
            l_id: l 的 ID（如 ep01-sc01-l01）
            filename: 文件名
            path: 完整路径
            auto_save: 是否自动保存
        """
        if l_id not in self.selections:
            self.selections[l_id] = {
                "id": l_id,
                "selected_l": None,
                "selected_shots": [],
            }

        # 检查是否已存在
        for shot in self.selections[l_id]["selected_shots"]:
            if shot["filename"] == filename:
                print(f"[WARN]  镜头 {filename} 已存在，跳过")
                return

        self.selections[l_id]["selected_shots"].append(
            {"filename": filename, "path": path}
        )

        print(f"✓ 已添加 {l_id} 的镜头: {filename}")

        if auto_save:
            self._save_config()

    def remove_selected_shot(
        self, l_id: str, filename: str, auto_save: bool = True
    ):
        """
        移除选择的镜头

        Args:
            l_id: l 的 ID
            filename: 文件名
            auto_save: 是否自动保存
        """
        if l_id not in self.selections:
            print(f"✗ 未找到 {l_id}")
            return

        original_count = len(self.selections[l_id]["selected_shots"])
        self.selections[l_id]["selected_shots"] = [
            shot
            for shot in self.selections[l_id]["selected_shots"]
            if shot["filename"] != filename
        ]

        removed_count = original_count - len(self.selections[l_id]["selected_shots"])
        if removed_count > 0:
            print(f"✓ 已移除 {removed_count} 个镜头")
            if auto_save:
                self._save_config()
        else:
            print(f"[WARN]  未找到镜头 {filename}")

    def get_selection(self, l_id: str) -> Optional[Dict]:
        """
        获取指定 l 的选择

        Args:
            l_id: l 的 ID

        Returns:
            选择信息，如果不存在返回 None
        """
        return self.selections.get(l_id)

    def list_all_selections(self):
        """列出所有选择"""
        if not self.selections:
            print("暂无选择记录")
            return

        print("\n" + "=" * 70)
        print("最终视频选择列表")
        print("=" * 70)

        for l_id, selection in sorted(self.selections.items()):
            print(f"\n【{l_id}】")

            if selection["selected_l"]:
                l_info = selection["selected_l"]
                print(f"  选择的 l: {l_info['filename']}")
                print(f"  路径: {l_info['path']}")
            else:
                print(f"  选择的 l: 未设置")

            if selection["selected_shots"]:
                print(f"  替换的镜头 ({len(selection['selected_shots'])} 个):")
                for i, shot in enumerate(selection["selected_shots"], 1):
                    print(f"    {i}. {shot['filename']}")
                    print(f"       {shot['path']}")
            else:
                print(f"  替换的镜头: 无")

        print("\n" + "=" * 70)

    def export_file_list(self, output_file: str):
        """
        导出文件列表（仅路径）

        Args:
            output_file: 输出文件路径
        """
        file_list = []

        for l_id, selection in sorted(self.selections.items()):
            if selection["selected_l"]:
                file_list.append(selection["selected_l"]["path"])

            for shot in selection["selected_shots"]:
                file_list.append(shot["path"])

        output_path = Path(output_file)
        with open(output_path, "w", encoding="utf-8") as f:
            for path in file_list:
                f.write(f"{path}\n")

        print(f"✓ 文件列表已导出: {output_path}")
        print(f"  共 {len(file_list)} 个文件")


def main():
    parser = argparse.ArgumentParser(description="最终视频选择管理工具")
    parser.add_argument(
        "-c", "--config", default="final_selection.json", help="配置文件路径"
    )

    subparsers = parser.add_subparsers(dest="command", help="命令")

    # set-l 命令
    set_l_parser = subparsers.add_parser("set-l", help="设置选择的 l 视频")
    set_l_parser.add_argument("l_id", help="l 的 ID（如 ep01-sc01-l01）")
    set_l_parser.add_argument("video_path", help="视频文件路径")

    # add-shot 命令
    add_shot_parser = subparsers.add_parser("add-shot", help="添加选择的镜头")
    add_shot_parser.add_argument("l_id", help="l 的 ID（如 ep01-sc01-l01）")
    add_shot_parser.add_argument("shot_path", help="镜头文件路径")

    # remove-shot 命令
    remove_shot_parser = subparsers.add_parser("remove-shot", help="移除选择的镜头")
    remove_shot_parser.add_argument("l_id", help="l 的 ID")
    remove_shot_parser.add_argument("filename", help="文件名")

    # list 命令
    subparsers.add_parser("list", help="列出所有选择")

    # export 命令
    export_parser = subparsers.add_parser("export", help="导出文件列表")
    export_parser.add_argument(
        "-o", "--output", default="file_list.txt", help="输出文件路径"
    )

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return

    manager = FinalSelectionManager(args.config)

    if args.command == "set-l":
        video_path = Path(args.video_path)
        if not video_path.exists():
            print(f"✗ 文件不存在: {video_path}")
            return

        manager.set_selected_l(
            args.l_id, video_path.name, str(video_path.absolute())
        )

    elif args.command == "add-shot":
        shot_path = Path(args.shot_path)
        if not shot_path.exists():
            print(f"✗ 文件不存在: {shot_path}")
            return

        manager.add_selected_shot(args.l_id, shot_path.name, str(shot_path.absolute()))

    elif args.command == "remove-shot":
        manager.remove_selected_shot(args.l_id, args.filename)

    elif args.command == "list":
        manager.list_all_selections()

    elif args.command == "export":
        manager.export_file_list(args.output)


if __name__ == "__main__":
    main()
