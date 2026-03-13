# Batch Video Generation (Kling 3.0 Omni Reference Mode)

When user asks "batch generate videos", "generate all L videos", "use Kling 3.0 Omni", follow this workflow.

## Prerequisites

1. **JSON file**: contains all segment prompts and metadata (e.g. `ep01_shots.json`)
2. **Reference images**: `02-assert/output/` containing character, scene, prop references
3. **Auth**: logged in to animeworkbench platform with team selected

## Auto Image Matching

From `02-assert/output/`:

- **Characters**: `characters/{name}/{name}.png` or `characters/{name}/{name}_front.png`
- **Scenes**: `scene/{name}/main.png`
- **Props**: `props/{name}/main.png` or `props/{name}/{name}.png`

## Workflow

### 1. Read JSON and parse segments

```python
import json
with open('ep01_shots.json', 'r', encoding='utf-8') as f:
    data = json.load(f)
segments = data['scenes'][0]['segments']
```

### 2. For each segment

- Extract `segment_id` (e.g. SC01-L01)
- Extract `{segment_id}_prompts_cn` (Chinese prompt)
- Extract `characters`, `scene`, `props` (metadata)

### 3. Find and upload reference images

```python
import os, glob

def find_reference_image(name, category):
    base_path = '02-assert/output'
    if category == 'characters':
        patterns = [
            f'{base_path}/characters/{name}/{name}.png',
            f'{base_path}/characters/*{name}*/{name}.png',
            f'{base_path}/characters/{name}/{name}_front.png'
        ]
    elif category == 'scene':
        patterns = [
            f'{base_path}/scene/{name}/main.png',
            f'{base_path}/scene/*{name}*/main.png'
        ]
    elif category == 'props':
        patterns = [
            f'{base_path}/props/{name}/main.png',
            f'{base_path}/props/{name}/{name}.png',
            f'{base_path}/props/*{name}*/main.png'
        ]
    for pattern in patterns:
        matches = glob.glob(pattern)
        if matches:
            return matches[0]
    return None
```

**Upload failure rule**: When reference image upload fails, **MUST skip** that segment's video generation task. Mark as `SKIPPED` status.

### 4. Build reference video request

Extract `【element】` markers from prompt, build `multi_param` and `richTaskPrompt`:

```python
import re, time

def extract_references(prompt_text):
    return re.findall(r'【([^】]+)】', prompt_text)

def build_rich_prompt(prompt_text, ref_map, references):
    ts = int(time.time() * 1000)
    resource_list = []
    current_pos = 0
    for i, ref_name in enumerate(references):
        if ref_name not in ref_map:
            continue
        pattern = f'【{re.escape(ref_name)}】'
        match = re.search(pattern, prompt_text[current_pos:])
        if match:
            text_before = prompt_text[current_pos:current_pos + match.start()]
            if text_before:
                resource_list.append({
                    'id': f'text-before-{ts}-{len(resource_list)}',
                    'type': 'text', 'value': text_before
                })
            resource_list.append({
                'id': f'mention-{ts}-{i}',
                'type': 'image',
                'value': ref_map[ref_name],
                'displayName': f'image{i+1}'
            })
            current_pos = current_pos + match.end()
    if current_pos < len(prompt_text):
        remaining = prompt_text[current_pos:]
        if remaining:
            resource_list.append({
                'id': f'text-after-{ts}',
                'type': 'text', 'value': remaining
            })
    return [{'label': '', 'resource': resource_list}]

def build_video_request(segment, uploaded_images):
    ts = int(time.time() * 1000)
    prompt_key = f"{segment['segment_id']}_prompts_cn"
    prompt_text = segment[prompt_key]
    references = extract_references(prompt_text)
    multi_param = []
    ref_map = {}
    for i, ref_name in enumerate(references):
        if ref_name in uploaded_images:
            subject_no = f'ref-{ts}-{i}'
            ref_map[ref_name] = subject_no
            cos_url = uploaded_images[ref_name]
            relative_path = cos_url.split('myqcloud.com')[1].split('?')[0]
            multi_param.append({
                'subjectNo': subject_no,
                'subjectName': f'image{i+1}',
                'referenceType': 'IMAGE',
                'resources': [{'type': 'IMAGE', 'url': relative_path}]
            })
    rich_prompt = build_rich_prompt(prompt_text, ref_map, references)
    task_prompt = prompt_text
    for i, ref_name in enumerate(references):
        task_prompt = task_prompt.replace(f'【{ref_name}】', f'image{i+1}')
    return {
        'modelCode': 'KeLing3_Omni_VideoCreate_tencent',
        'taskPrompt': task_prompt,
        'promptParams': {
            'quality': '720',
            'generated_time': segment.get('duration_seconds', '10'),
            'frames': [], 'prompt': '',
            'reference_video': True, 'audio': False,
            'multi_param': multi_param,
            'richTaskPrompt': rich_prompt
        }
    }
```

### 5. Submit and manage tasks

```python
result = auth.api_request(
    'https://animeworkbench.lingjingai.cn/api/material/creation/videoCreate',
    data=json.dumps(request_data).encode('utf-8'),
    method='POST'
)
task_id = result['data']
```

### 6. Poll task status

Use background polling to monitor all tasks. Check every 10 seconds.

## Notes

1. **Rate limit**: wait 1-2s between submissions
2. **Image cache**: same reference images only need uploading once
3. **Chinese filenames**: upload_to_cos.py uses URL encoding automatically
4. **Upload failure**: MUST skip segment if reference upload fails (mark as SKIPPED)
5. **Task management**: use JSON file to record task IDs and statuses (PROCESSING/FAILED/SKIPPED)
6. **Cost control**: test with a few segments first before batch generation
