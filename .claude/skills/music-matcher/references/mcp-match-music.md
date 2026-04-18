# MCP match_music Field Mapping & Call Example

## Field Mapping

| segments JSON field | MCP parameter |
|---------------------|---------------|
| segment_id | segment_id |
| start | start |
| end | end |
| mood | mood |
| scene | scene |
| energy_curve | energy_curve |
| instruments | instruments |
| tempo | tempo |
| description | description |

## Call Example

```
mcp__anime-mcp__match_music(
  segments=[
    {
      "segment_id": seg.segment_id,
      "start": seg.start,
      "end": seg.end,
      "mood": seg.mood,
      "scene": seg.scene,
      "energy_curve": seg.energy_curve,
      "instruments": seg.instruments,
      "tempo": seg.tempo,
      "description": seg.description
    }
    // ... for each segment where needs_music=true
  ],
  match_params={
    "top_n": 5,
    "min_segment_duration": 10,
    "duration_ratio_min": 0.8,
    "duration_ratio_max": 1.2
  }
)
```

## Notes

- Only pass segments with `needs_music: true` (skip `needs_music: false`, pass empty strings for mood etc.)
- No need to pass `duration_seconds` (MCP calculates from start/end automatically)
