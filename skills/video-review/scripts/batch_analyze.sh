#!/bin/bash

API_KEY="AIzaSyCVKb4sf3hoWPcFTFwbOogq_kIycTRTQaQ"
JSON_FILE="d:/Zhuchen/Projects/ep01_shots(2).json"
VIDEO_BASE="d:/Zhuchen/Projects/video"

cd "d:/Zhuchen/Projects/.claude/skills/video-review"

# 提取所有segment信息
python -c "
import json
data = json.load(open('$JSON_FILE', 'r', encoding='utf-8'))
for seg in data['segments']:
    seg_id = seg['segment_id']
    duration = seg.get('duration_estimate', '10s').replace('s', '')
    print(f'{seg_id}|{duration}')
" | while IFS='|' read -r seg_id duration; do
    echo "=========================================="
    echo "处理片段: $seg_id (期望时长: ${duration}s)"
    echo "=========================================="
    
    # 查找对应的视频文件
    video_file=$(find "$VIDEO_BASE" -name "*${seg_id}*.mp4" -type f | head -1)
    
    if [ -z "$video_file" ]; then
        echo "[SKIP] 未找到 $seg_id 的视频文件"
        continue
    fi
    
    echo "[FOUND] 视频文件: $video_file"
    
    # 运行分析
    python scripts/workflow.py "$video_file" "$seg_id" "$duration" "$JSON_FILE" -f -k "$API_KEY"
    
    echo ""
done

echo "=========================================="
echo "批量分析完成！"
echo "=========================================="
