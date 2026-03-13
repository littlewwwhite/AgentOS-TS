# 视频提示词优化器
# 根据评审结果自动优化视频生成提示词

import os
import json
import xml.etree.ElementTree as ET
from typing import Dict, List, Optional, Tuple


class PromptOptimizer:
    """视频提示词优化器 - 基于 drama-storyboard JSON 格式"""

    def __init__(self, rules_dir: Optional[str] = None):
        """
        初始化优化器

        Args:
            rules_dir: 规则文件目录，默认为当前文件所在目录
        """
        if rules_dir is None:
            from pathlib import Path
            rules_dir = str(Path(__file__).parent.parent / "references" / "prompt-rules")

        self.rules_dir = rules_dir
        self.content_rules = self._load_xml_rules("content_rules.xml")

    def _load_xml_rules(self, filename: str) -> str:
        """加载 XML 规则文件"""
        filepath = os.path.join(self.rules_dir, filename)
        if not os.path.exists(filepath):
            return ""

        with open(filepath, 'r', encoding='utf-8') as f:
            return f.read()

    def load_prompt_json(self, json_path: str) -> Dict:
        """
        加载原始提示词 JSON 文件

        Args:
            json_path: JSON 文件路径

        Returns:
            完整的 JSON 数据
        """
        with open(json_path, 'r', encoding='utf-8') as f:
            return json.load(f)

    def extract_segment_prompt(
        self,
        json_data: Dict,
        segment_id: str,
        language: str = "cn"
    ) -> Tuple[str, Dict]:
        """
        从 JSON 中提取指定 segment 的提示词

        Args:
            json_data: 完整的 JSON 数据
            segment_id: segment ID，如 "SC01-L01"
            language: 语言版本 ("cn" 或 "en")

        Returns:
            (提示词文本, segment 完整数据)
        """
        # 尝试从顶层 segments 数组查找
        if "segments" in json_data:
            for segment in json_data["segments"]:
                if segment.get("segment_id") == segment_id:
                    prompt_key = f"{segment_id}_prompts"
                    if language == "cn":
                        prompt_key += "_cn"

                    prompt_text = segment.get(prompt_key, "")
                    return prompt_text, segment

        # 尝试从 scenes[].segments[] 嵌套结构查找
        for scene in json_data.get("scenes", []):
            for segment in scene.get("segments", []):
                if segment.get("segment_id") == segment_id:
                    prompt_key = f"{segment_id}_prompts"
                    if language == "cn":
                        prompt_key += "_cn"

                    prompt_text = segment.get(prompt_key, "")
                    return prompt_text, segment

        raise ValueError(f"Segment {segment_id} not found in JSON")

    def optimize_prompt_from_json(
        self,
        json_path: str,
        segment_id: str,
        review_result: Dict,
        failed_dimensions: List[str],
        language: str = "cn"
    ) -> Tuple[str, Dict]:
        """
        从 JSON 文件中读取并优化提示词

        Args:
            json_path: 原始 JSON 文件路径
            segment_id: segment ID，如 "SC01-L01"
            review_result: 评审结果
            failed_dimensions: 不达标的维度列表
            language: 语言版本

        Returns:
            (优化后的提示词, 完整的 segment 数据)
        """
        # 加载 JSON
        json_data = self.load_prompt_json(json_path)

        # 提取原始提示词
        original_prompt, segment_data = self.extract_segment_prompt(
            json_data, segment_id, language
        )

        # 优化提示词
        optimized_prompt = self._optimize_prompt_text(
            original_prompt,
            segment_data,
            review_result,
            failed_dimensions
        )

        return optimized_prompt, segment_data

    def _optimize_prompt_text(
        self,
        prompt: str,
        segment_data: Dict,
        review_result: Dict,
        failed_dimensions: List[str]
    ) -> str:
        """
        优化提示词文本

        Args:
            prompt: 原始提示词
            segment_data: segment 完整数据
            review_result: 评审结果
            failed_dimensions: 不达标的维度列表

        Returns:
            优化后的提示词
        """
        # 简化优化策略：在原始提示词前添加强化要求
        optimization_hints = []

        for dimension in failed_dimensions:
            if dimension == "character_consistency_critical":
                optimization_hints.append("【强化要求】严格遵循角色参考图，面部特征、骨骼结构、眼距、下颚几何形状必须100%一致，禁止美化或改变年龄")
            elif dimension == "scene_consistency_critical":
                optimization_hints.append("【强化要求】严格遵循场景参考图，建筑风格、材质、布局、道具位置必须完全一致")
            elif dimension == "character":
                optimization_hints.append("【优化】强化角色表情和动作细节描述")
            elif dimension == "scene":
                optimization_hints.append("【优化】增加环境光线和空间深度描述")
            elif dimension == "direction":
                optimization_hints.append("【优化】明确运镜指令和构图要求")

        # 在原始提示词前添加优化要求
        if optimization_hints:
            optimized = "\n".join(optimization_hints) + "\n\n" + prompt
        else:
            optimized = prompt

        return optimized

    def _parse_prompt_structure(self, prompt: str) -> Dict:
        """
        解析提示词结构

        提示词格式：
        保持人物与参考图完全一致... 0-2s, 描述1. 2-5s, 描述2. 对话...

        Returns:
            {
                "prefix": "保持人物与参考图完全一致...",
                "time_slices": [
                    {"time": "0-2s", "description": "..."},
                    {"time": "2-5s", "description": "..."}
                ],
                "dialogues": ["对话1", "对话2"]
            }
        """
        parts = {
            "prefix": "",
            "time_slices": [],
            "dialogues": []
        }

        # 提取前缀（保持人物一致性要求）
        if "保持人物与参考图完全一致" in prompt:
            prefix_end = prompt.find("。", prompt.find("保持人物")) + 1
            parts["prefix"] = prompt[:prefix_end].strip()
            prompt = prompt[prefix_end:].strip()

        # 提取时间切片和描述
        import re
        time_pattern = r'(\d+-\d+s),\s*([^。]+(?:。)?)'
        matches = re.findall(time_pattern, prompt)

        for time_range, description in matches:
            parts["time_slices"].append({
                "time": time_range,
                "description": description.strip()
            })

        # 提取对话
        dialogue_pattern = r'【([^】]+)】[（(]([^)）]+)[)）]：["""\'](.*?)["""\'"]'
        dialogues = re.findall(dialogue_pattern, prompt)

        for character, emotion, text in dialogues:
            parts["dialogues"].append({
                "character": character,
                "emotion": emotion,
                "text": text
            })

        return parts

    def _get_optimization_hints(
        self,
        dimension: str,
        dimension_review: Dict,
        segment_data: Dict
    ) -> List[str]:
        """
        根据维度获取优化提示

        Args:
            dimension: 维度名称
            dimension_review: 该维度的评审结果
            segment_data: segment 数据

        Returns:
            优化提示列表
        """
        hints = []
        evaluation = dimension_review.get("evaluation", "")
        score = dimension_review.get("score", 5)

        if dimension == "plot":
            if "逻辑" in evaluation or score < 5:
                hints.append("强化时间顺序连贯性，确保每个动作都有明确的因果关系")
            if "跳跃" in evaluation:
                hints.append("补充关键转折动作，避免情节突然跳跃")
            if "节奏" in evaluation:
                hints.append("调整动作节奏，确保信息密度适中")

        elif dimension == "character":
            if "口型" in evaluation or "对话" in evaluation:
                hints.append("对话时明确标注：嘴唇张合幅度、语速、情绪表现")
            if "动作" in evaluation:
                hints.append("动作描述更具体：主体 + 动作 + 方向 + 幅度 + 速度")
            if "表情" in evaluation:
                hints.append("强化表情细节：眉头、眼神、嘴角的微妙变化")

        elif dimension == "scene":
            if "环境" in evaluation:
                hints.append("增加环境细节：光线质感、空间深度、背景元素")
            if "美术" in evaluation or "风格" in evaluation:
                hints.append("统一美术风格：色调、质感、装饰细节保持一致")

        elif dimension == "direction":
            if "镜头" in evaluation or "运镜" in evaluation:
                hints.append("明确运镜指令：[推近] [拉远] [跟随] [固定]")
            if "构图" in evaluation:
                hints.append("优化构图：景别（全景/中景/特写）+ 角度（俯拍/仰拍）")
            if "节奏" in evaluation:
                hints.append("控制镜头节奏：动作速度与镜头切换时机匹配")

        elif dimension == "duration":
            duration = segment_data.get("duration_seconds", "")
            if score < 5:
                hints.append(f"严格控制时长在 {duration}，删除冗余描述")
            else:
                hints.append(f"微调时长至 {duration}，平衡动作速度")

        return hints

    def _rebuild_prompt(
        self,
        prompt_parts: Dict,
        optimization_hints: List[str],
        segment_data: Dict
    ) -> str:
        """
        重建优化后的提示词

        Args:
            prompt_parts: 解析后的提示词结构
            optimization_hints: 优化提示列表
            segment_data: segment 数据

        Returns:
            优化后的完整提示词
        """
        # 保留前缀
        optimized = prompt_parts["prefix"]

        # 添加优化要求（在时间切片之前）
        if optimization_hints:
            optimized += "\n\n【优化要求】\n"
            for hint in optimization_hints:
                optimized += f"- {hint}\n"
            optimized += "\n"

        # 重建时间切片
        for slice_data in prompt_parts["time_slices"]:
            optimized += f"{slice_data['time']}, {slice_data['description']} "

        # 添加对话
        for dialogue in prompt_parts["dialogues"]:
            optimized += f"【{dialogue['character']}】（{dialogue['emotion']}）：\"{dialogue['text']}\" "

        return optimized.strip()

    def save_optimized_json(
        self,
        original_json_path: str,
        segment_id: str,
        optimized_prompt: str,
        output_path: str,
        language: str = "cn"
    ):
        """
        保存优化后的 JSON 文件

        Args:
            original_json_path: 原始 JSON 路径
            segment_id: segment ID
            optimized_prompt: 优化后的提示词
            output_path: 输出路径
            language: 语言版本
        """
        # 加载原始 JSON
        json_data = self.load_prompt_json(original_json_path)

        # 更新指定 segment 的提示词
        updated = False

        # 尝试从顶层 segments 数组更新
        if "segments" in json_data:
            for segment in json_data["segments"]:
                if segment.get("segment_id") == segment_id:
                    prompt_key = f"{segment_id}_prompts"
                    if language == "cn":
                        prompt_key += "_cn"

                    segment[prompt_key] = optimized_prompt
                    updated = True
                    break

        # 尝试从 scenes[].segments[] 嵌套结构更新
        if not updated:
            for scene in json_data.get("scenes", []):
                for segment in scene.get("segments", []):
                    if segment.get("segment_id") == segment_id:
                        prompt_key = f"{segment_id}_prompts"
                        if language == "cn":
                            prompt_key += "_cn"

                        segment[prompt_key] = optimized_prompt
                        updated = True
                        break
                if updated:
                    break

        # 保存
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(json_data, f, ensure_ascii=False, indent=2)


# 使用示例
if __name__ == "__main__":
    optimizer = PromptOptimizer()

    # 示例：优化 SC01-L01
    json_path = "c:/Users/Admin/Downloads/ep01_shots(1).json"
    segment_id = "SC01-L01"

    # 模拟评审结果
    review_result = {
        "plot": {
            "score": 4,
            "evaluation": "逻辑跳跃，缺少转折"
        },
        "character": {
            "score": 6,
            "evaluation": "动作描述不够具体"
        }
    }

    failed_dimensions = ["plot", "character"]

    # 优化提示词
    optimized_prompt, segment_data = optimizer.optimize_prompt_from_json(
        json_path,
        segment_id,
        review_result,
        failed_dimensions,
        language="cn"
    )

    print("=" * 80)
    print("优化后的提示词：")
    print("=" * 80)
    print(optimized_prompt)
    print("=" * 80)

    # 保存优化后的 JSON
    output_path = "ep01_shots_optimized.json"
    optimizer.save_optimized_json(
        json_path,
        segment_id,
        optimized_prompt,
        output_path,
        language="cn"
    )
    print(f"\n已保存到: {output_path}")

# ============ 便捷函数（供 workflow 调用）============

def optimize_prompt_from_json(
    json_path: str,
    segment_id: str,
    review_result: Dict,
    failed_dimensions: List[str],
    language: str = "cn"
) -> Tuple[str, Dict]:
    """
    便捷函数：优化提示词
    
    Args:
        json_path: 原始JSON文件路径
        segment_id: 片段ID
        review_result: 评审结果
        failed_dimensions: 不合格维度列表
        language: 语言
        
    Returns:
        (优化后的提示词, 元数据)
    """
    optimizer = PromptOptimizer()
    optimized_prompt, segment_data = optimizer.optimize_prompt_from_json(
        json_path,
        segment_id,
        review_result,
        failed_dimensions,
        language
    )
    
    metadata = {
        "original_json": json_path,
        "segment_id": segment_id,
        "failed_dimensions": failed_dimensions,
        "segment_data": segment_data
    }
    
    return optimized_prompt, metadata


def save_optimized_json(
    original_json_path: str,
    segment_id: str,
    optimized_prompt: str,
    output_path: str,
    language: str = "cn"
) -> str:
    """
    便捷函数：保存优化后的JSON
    
    Args:
        original_json_path: 原始JSON路径
        segment_id: 片段ID
        optimized_prompt: 优化后的提示词
        output_path: 输出路径
        language: 语言
        
    Returns:
        保存的文件路径
    """
    optimizer = PromptOptimizer()
    optimizer.save_optimized_json(
        original_json_path,
        segment_id,
        optimized_prompt,
        output_path,
        language
    )
    return output_path
