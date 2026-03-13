# Video Download and Directory Organization

## Directory Structure

Generated videos are organized as follows:

```
03-video/output/
├── ep01/
│   ├── ep01_shots.json
│   ├── sc01/
│   │   ├── l01/
│   │   │   └── ep01-sc01-l01.mp4
│   │   └── l02/
│   │       └── ep01-sc01-l02.mp4
│   └── sc02/
│       ├── l01/
│       │   └── ep01-sc02-l01.mp4
│       └── l02/
│           └── ep01-sc02-l02.mp4
├── ep02/
│   └── ...
```

## Naming Rules

- **segment_id**: `SC02-L01`
- **Directory path**: `output/ep{episode}/sc{scene}/l{segment}/`
- **Filename**: `ep{episode}-sc{scene}-l{segment}.mp4`

## Manual Query and Download

### 1. Query task status

```python
import sys
sys.path.insert(0, '${CLAUDE_SKILL_DIR}/scripts')
import auth

task_id = 'YOUR_TASK_ID'
result = auth.api_request(
    f'https://animeworkbench.lingjingai.cn/api/material/creation/videoCreateGet?taskId={task_id}',
    method='GET'
)

if result.get('code') == 200:
    data = result['data']
    status = data.get('taskStatus')
    if status == 'SUCCESS':
        video_url = data['resultFileList'][0]
        print(f'Video URL: {video_url}')
    elif status in ['FAIL', 'FAILED']:
        print(f'Failed: {data.get("errorMsg")}')
    else:
        print(f'Processing, status: {status}')
```

### 2. Download video

```python
import urllib.request, os

video_url = 'https://...'
segment_id = 'SC02-L01'
episode = '01'
scene = segment_id.split('-')[0].replace('SC', '')
segment = segment_id.split('-')[1].replace('L', '')

output_dir = f'03-video/output/ep{episode}/sc{scene}/l{segment}'
os.makedirs(output_dir, exist_ok=True)

filename = f'ep{episode}-sc{scene}-l{segment}.mp4'
output_path = os.path.join(output_dir, filename)

req = urllib.request.Request(video_url, headers={'User-Agent': 'Mozilla/5.0'})
with urllib.request.urlopen(req, timeout=300) as response:
    with open(output_path, 'wb') as f:
        while True:
            chunk = response.read(8192)
            if not chunk:
                break
            f.write(chunk)
```

## Troubleshooting

### Login expired

```bash
cd 03-video
python ${CLAUDE_SKILL_DIR}/scripts/login.py --phone PHONE --code CODE
python ${CLAUDE_SKILL_DIR}/scripts/login.py --select-group GROUP_ID
```

### SSL error on download

```python
import ssl
context = ssl._create_unverified_context()
with urllib.request.urlopen(req, timeout=300, context=context) as response:
    # ... download code
```
